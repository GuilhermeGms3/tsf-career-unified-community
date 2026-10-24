import { hostAllowed } from "../../../source-connections/session-provider-registry.mjs";
import { FAILURE_TEXT, SUCCESS_TEXT } from "../../submission-confirmation.mjs";
import { DEFAULT_ENTRY_BUTTON, DEFAULT_FINAL_BUTTON, DEFAULT_PROGRESSION_BUTTON } from "./portal-submit-profiles.mjs";

// Ultima milha compartilhada pelos portais com Cofre, dirigida pelo perfil do portal:
// restringe a rede aos hosts oficiais, avanca etapas sem ambiguidade, acha um unico botao final e
// so declara envio quando o texto de confirmacao surge depois do clique. Sem confirmacao o resultado
// e UNCERTAIN e nunca ha segundo clique. Os codigos de erro levam o prefixo do portal (ex.: GUPY_).
const fail = (code, message) => Object.assign(new Error(message), { code });
const codeOf = (profile, suffix) => `${profile.codePrefix}_${suffix}`;

export function profileHostAllowed(profile, value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === "https:" && !url.port && !url.username && !url.password && hostAllowed({ allowedHosts: profile.hosts }, url.hostname);
}

export function assertSubmitProfile(profile) {
  if (profile?.status !== "COMPLETE") throw fail(codeOf(profile, "SUBMIT_PROFILE_INCOMPLETE"), `Envio ${profile?.label || ""} sem perfil homologável: falta ${(profile?.missing || []).join(", ")}.`);
}

export async function restrictToProfileHosts(context, profile, { mode = "" } = {}) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!profileHostAllowed(profile, request.url())) return route.abort();
    if (mode === "DRY_RUN" && !["GET", "HEAD"].includes(request.method())) return route.abort();
    return route.continue();
  });
}

export async function findFinalBoundary(page, profile) {
  assertSubmitProfile(profile);
  const matches = page.getByRole("button", { name: profile.finalButton });
  if (await matches.count() !== 1 || !await matches.isVisible()) throw fail(codeOf(profile, "BOUNDARY_UNSAFE"), `Boundary final ${profile.label} ausente ou ambígua.`);
  return matches;
}

export async function findProgression(page, profile) {
  if (!profile.progressionButton) throw fail(codeOf(profile, "STEP_BOUNDARY_MISSING"), `Avanço ${profile.label} não configurado no perfil.`);
  const candidates = page.getByRole("button", { name: profile.progressionButton }), available = [];
  for (let index = 0; index < await candidates.count(); index++) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible() && await candidate.isEnabled()) available.push(candidate);
  }
  if (available.length !== 1) throw fail(codeOf(profile, available.length ? "STEP_BOUNDARY_AMBIGUOUS" : "STEP_BOUNDARY_MISSING"), `Avanço ${profile.label} ausente ou ambíguo.`);
  return available[0];
}

// `inspect(page)` devolve {signature, challenge}; a etapa so conta como avancada se a assinatura mudar.
export async function advanceStep(page, profile, { inspect, previousSignature = "", timeoutMs = 3000 } = {}) {
  await (await findProgression(page, profile)).click();
  if (!previousSignature) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const current = await inspect(page).catch(() => null);
    if (current && (current.challenge || current.signature !== previousSignature)) return;
  }
  throw fail(codeOf(profile, "STEP_NOT_ADVANCED"), `A etapa ${profile.label} não mudou após o avanço.`);
}

export async function submitWithProfile(page, profile, { onActionTriggered, confirmationTimeoutMs = 5000 } = {}) {
  const boundary = await findFinalBoundary(page, profile), success = page.getByText(profile.successText);
  if (await success.count()) throw fail("BLOCKED_DUPLICATE", "Confirmação já existia antes do envio.");
  await onActionTriggered?.();
  try {
    await boundary.click();
    await success.first().waitFor({ state: "visible", timeout: confirmationTimeoutMs });
  } catch {
    return { status: "UNCERTAIN", errorCode: codeOf(profile, "CONFIRMATION_NOT_OBSERVED") };
  }
  const url = new URL(page.url());
  url.search = ""; url.hash = "";
  return { status: "SUBMITTED", receipt: { confirmationUrl: url.href, confirmationText: profile.receiptText || profile.label, metadata: { confirmationKind: "NEW_VISIBLE_SUCCESS_TEXT", providerStatus: "SUBMITTED" } } };
}

// Texto que costuma aparecer depois de uma candidatura (portais brasileiros e o padrao dos outros ATS).
// Sozinho nao e recibo: confirma o successText do perfil (validado por captura) ou a IA local, que so
// escolhe entre textos novos que passaram pelas travas de assistedReceipt.
const LIKELY_SUCCESS = new RegExp(`candidatura (?:enviada|realizada|confirmada|recebida)|voc[eê] (?:j[aá] )?se candidatou|obrigad[oa] pela sua candidatura|application (?:submitted|received)|${SUCCESS_TEXT.source}`, "i");

async function visibleMatches(locator) {
  const visible = [];
  for (let index = 0; index < await locator.count(); index++) if (await locator.nth(index).isVisible()) visible.push(locator.nth(index));
  return visible;
}

const labelOf = async (locator) => ((await locator.textContent().catch(() => "")) || (await locator.getAttribute("aria-label").catch(() => "")) || (await locator.getAttribute("value").catch(() => "")) || "").replace(/\s+/g, " ").trim();

async function successTexts(page) {
  const matches = page.getByText(LIKELY_SUCCESS), texts = new Set();
  for (let index = 0; index < Math.min(await matches.count().catch(() => 0), 20); index++) {
    if (!await matches.nth(index).isVisible().catch(() => false)) continue;
    const text = String(await matches.nth(index).textContent().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
    if (text) texts.add(text);
  }
  return texts;
}

// Confirmacao pela IA local. Travas antes dela: pagina num host oficial do Cofre e textos novos (nao
// existiam antes do clique), visiveis, com cara de sucesso e sem palavra de falha. A IA so escolhe entre
// esses textos; o recibo guarda o texto observado e o metodo LLM_CONFIRMED_DOM_V1.
async function assistedReceipt(page, profile, { assistant, baseline, onStep }) {
  if (!assistant || !baseline || !profileHostAllowed(profile, page.url())) return null;
  const fresh = [...await successTexts(page)].filter((text) => !baseline.has(text) && !FAILURE_TEXT.test(text));
  if (!fresh.length) return null;
  const verdict = await assistant.classifyConfirmation({ provider: profile.provider, texts: fresh });
  if (verdict.status !== "CONFIRMED" || !fresh.includes(verdict.text)) return null;
  await onStep?.({ kind: "SUCCESS_TEXT_CONFIRMED", label: verdict.text, source: "MODEL" });
  const url = new URL(page.url());
  url.search = ""; url.hash = "";
  return { status: "SUBMITTED", receipt: { confirmationUrl: url.href, confirmationText: verdict.text, metadata: { confirmationKind: "NEW_VISIBLE_SUCCESS_TEXT", verificationMethod: "LLM_CONFIRMED_DOM_V1", providerStatus: "SUBMITTED" } } };
}

// Botoes visiveis e habilitados da tela (no maximo 25), para a IA escolher quando as regras do perfil
// nao decidem. Links ficam de fora: o envio e o avanco sao sempre botoes.
async function listButtons(page, { exclude = [] } = {}) {
  const buttons = page.getByRole("button"), listed = [];
  for (let index = 0; index < Math.min(await buttons.count(), 60) && listed.length < 25; index++) {
    const candidate = buttons.nth(index);
    if (!await candidate.isVisible().catch(() => false) || !await candidate.isEnabled().catch(() => false)) continue;
    const label = await labelOf(candidate);
    if (!label || exclude.includes(label)) continue;
    const place = await candidate.evaluate((element) => ({ inForm: Boolean(element.closest("form")), inDialog: Boolean(element.closest("dialog,[role=dialog]")) })).catch(() => ({}));
    listed.push({ candidate, label, ...place });
  }
  return listed;
}

// Unico botao ou link visivel que abre a candidatura na pagina da vaga.
export async function findEntry(page, profile) {
  const pattern = profile.entryButton || DEFAULT_ENTRY_BUTTON;
  const visible = [...await visibleMatches(page.getByRole("button", { name: pattern })), ...await visibleMatches(page.getByRole("link", { name: pattern }))];
  if (visible.length !== 1) throw fail(codeOf(profile, visible.length ? "ENTRY_AMBIGUOUS" : "ENTRY_MISSING"), `Entrada da candidatura ${profile.label} ${visible.length ? "ambígua" : "ausente"}.`);
  return visible[0];
}

// Clique de entrada ("Candidatar-se"). Logado, ele pode ja ser o envio, entao e armado como envio
// (onActionTriggered antes do clique) e so deve ser chamado no caminho com consentimento. Nunca ha
// segundo clique. `inspect(page)` devolve {signature, challenge, fields}. Desfechos:
// SUBMITTED (confirmacao do perfil apareceu), FORM (abriu formulario ou questionario: seguir a ultima
// milha), LOGIN_REQUIRED/CHALLENGE (handoff humano) ou UNCERTAIN (sem evidencia; nada se repete).
// Com `assistant`, um texto de sucesso novo pode ser confirmado pela IA local (assistedReceipt).
export async function enterApplication(page, profile, { onActionTriggered, inspect, assistant = null, onStep, confirmationTimeoutMs = 8000, pollMs = 250 } = {}) {
  const entry = await findEntry(page, profile), success = profile.successText ? page.getByText(profile.successText) : null;
  if (success && await success.count()) throw fail("BLOCKED_DUPLICATE", "Confirmação já existia antes do clique de entrada.");
  const likely = page.getByText(LIKELY_SUCCESS), likelyBefore = await likely.count(), before = await inspect(page).catch(() => null);
  const baseline = assistant ? await successTexts(page) : null;
  await onActionTriggered?.();
  await entry.click();
  const deadline = Date.now() + confirmationTimeoutMs;
  let likelySeen = false, asked = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(pollMs);
    if (success && await success.first().isVisible().catch(() => false)) {
      const url = new URL(page.url());
      url.search = ""; url.hash = "";
      return { status: "SUBMITTED", receipt: { confirmationUrl: url.href, confirmationText: profile.receiptText || profile.label, metadata: { confirmationKind: "NEW_VISIBLE_SUCCESS_TEXT", providerStatus: "SUBMITTED", entryClick: true } } };
    }
    const current = await inspect(page).catch(() => null);
    if (current?.challenge) return { status: current.challenge === "LOGIN_REQUIRED" ? "LOGIN_REQUIRED" : "CHALLENGE", challenge: current.challenge, errorCode: codeOf(profile, "ENTRY_CHALLENGE") };
    if (current && current.fields > 0 && current.signature !== before?.signature) return { status: "FORM", signature: current.signature };
    likelySeen ||= await likely.count().catch(() => 0) > likelyBefore;
    if (likelySeen && assistant && !asked) {
      asked = true;
      const confirmed = await assistedReceipt(page, profile, { assistant, baseline, onStep });
      if (confirmed) return confirmed;
    }
  }
  return { status: "UNCERTAIN", errorCode: codeOf(profile, likelySeen ? "ENTRY_SUCCESS_UNCONFIRMED" : "ENTRY_RESULT_UNKNOWN") };
}

// Vaga encerrada ou ja candidatada, como os portais brasileiros mostram na pagina da vaga.
export const CLOSED_JOB_TEXT = /vaga (?:encerrada|expirada|finalizada|pausada|indispon[ií]vel)|esta vaga (?:foi encerrada|n[aã]o est[aá] mais dispon[ií]vel|expirou)|n[aã]o (?:aceita|recebe) mais candidaturas|job (?:closed|expired|no longer available)|this job (?:has expired|is no longer)/i;
export const ALREADY_APPLIED_TEXT = /voc[eê] j[aá] (?:se )?candidatou|j[aá] se inscreveu|candidatura j[aá] (?:enviada|realizada)|already applied/i;

async function visibleText(page, pattern) {
  const matches = page.getByText(pattern);
  for (let index = 0; index < Math.min(await matches.count(), 20); index++) if (await matches.nth(index).isVisible().catch(() => false)) return (await matches.nth(index).textContent())?.replace(/\s+/g, " ").trim() || "match";
  return "";
}

// Situacao da vaga lida na propria pagina logada: nao existe API de vaga nos Cofres.
// OPEN exige evidencia positiva (entrada ou formulario com botao de envio visivel).
export async function vaultJobStatus(page, { openEvidence = false, clock = () => new Date() } = {}) {
  const checkedAt = clock().toISOString(), reference = (() => { try { const url = new URL(page.url()); return `${url.origin}${url.pathname}`; } catch { return ""; } })();
  if (await visibleText(page, ALREADY_APPLIED_TEXT)) return { status: "ALREADY_APPLIED", checkedAt, authority: "vault-page", reference };
  if (await visibleText(page, CLOSED_JOB_TEXT)) return { status: "CLOSED", checkedAt, authority: "vault-page", reference };
  return { status: openEvidence ? "OPEN" : "UNKNOWN", checkedAt, authority: "vault-page", reference };
}

// Botao final unico. `exclude` tira rotulos ja clicados (o "Candidatar-se" que abriu o formulario continua na tela).
export async function findFinalButton(page, profile, { exclude = [] } = {}) {
  const candidates = await visibleMatches(page.getByRole("button", { name: profile.finalButton || DEFAULT_FINAL_BUTTON }));
  const named = [];
  for (const candidate of candidates) { const label = await labelOf(candidate); if (!exclude.includes(label)) named.push({ candidate, label }); }
  if (named.length > 1) throw fail(codeOf(profile, "BOUNDARY_UNSAFE"), `Boundary final ${profile.label} ausente ou ambígua.`);
  return named[0] || null;
}

// Ultima milha progressiva dos Cofres. O envio e armado uma unica vez, antes do primeiro clique que pode
// entregar (entrada, avanco ou final); dali em diante nada se repete e falta de evidencia vira UNCERTAIN.
// Antes de armar, um bloqueio sai como erro PRE_ACTION (nada aconteceu no portal). Cada clique vai para
// onStep com a origem da decisao (RULE ou MODEL). SUBMITTED com o successText do perfil ou, com
// `assistant` (IA local), com um texto de sucesso novo confirmado por ela; senao o texto vira
// SUCCESS_TEXT_OBSERVED para a pessoa confirmar o envio e completar o perfil.
// A IA so entra quando as regras do perfil nao decidem: botao final ambiguo ou nem final nem avanco
// unicos. Ela escolhe entre os botoes listados aqui, e a escolha passa pelas travas do assistente.
// `inspect(page)` -> {signature, challenge, fields}; `fillStep(page,{step})` -> {status:"FILLED"|"USER_REQUIRED"|"INVALID"|"FAILED"}.
export async function progressiveSubmit(page, profile, { onActionTriggered, inspect, fillStep = async () => ({ status: "FILLED" }), onStep = async () => {}, assistant = null, entryFirst = false, confirmationTimeoutMs = 8000, pollMs = 250, maxSteps = 8 } = {}) {
  let armed = false;
  const clicked = [];
  const arm = async (kind, label, source = "RULE") => { if (!armed) { armed = true; await onActionTriggered?.(); } clicked.push(label); await onStep({ kind, label, source }); };
  const stop = (suffix, message) => { if (!armed) throw Object.assign(fail(codeOf(profile, suffix), message), { phase: "PRE_ACTION" }); return { status: "UNCERTAIN", errorCode: codeOf(profile, suffix) }; };
  const observed = async () => { const text = await visibleText(page, LIKELY_SUCCESS); if (text) await onStep({ kind: "SUCCESS_TEXT_OBSERVED", label: text }); return text; };

  const choose = async (step) => {
    if (!assistant) return null;
    const choice = await assistant.chooseAction({ provider: profile.provider, step, candidates: await listButtons(page, { exclude: clicked }) });
    if (choice.action === "NONE" || !choice.candidate) return null;
    const { candidate, label } = choice.candidate;
    // O botao precisa continuar visivel e com o mesmo rotulo no momento do clique.
    if (!await candidate.isVisible().catch(() => false) || await labelOf(candidate) !== label) return null;
    return { kind: choice.action, candidate, label };
  };

  const submitFinal = async (candidate, label, source) => {
    const success = profile.successText ? page.getByText(profile.successText) : null;
    if (success && await success.count()) return stop("ALREADY_CONFIRMED", "Confirmação já existia antes do envio.");
    const likelyBefore = await page.getByText(LIKELY_SUCCESS).count(), baseline = assistant ? await successTexts(page) : null;
    await arm("FINAL", label, source);
    await candidate.click();
    const deadline = Date.now() + confirmationTimeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(pollMs);
      if (success && await success.first().isVisible().catch(() => false)) {
        const url = new URL(page.url());
        url.search = ""; url.hash = "";
        return { status: "SUBMITTED", receipt: { confirmationUrl: url.href, confirmationText: profile.receiptText || profile.label, metadata: { confirmationKind: "NEW_VISIBLE_SUCCESS_TEXT", providerStatus: "SUBMITTED", steps: clicked.length } } };
      }
      const current = await inspect(page).catch(() => null);
      if (current?.challenge) return { status: "UNCERTAIN", errorCode: codeOf(profile, "FINAL_CHALLENGE") };
      if (await page.getByText(LIKELY_SUCCESS).count().catch(() => 0) > likelyBefore) {
        const confirmed = await assistedReceipt(page, profile, { assistant, baseline, onStep });
        if (confirmed) return confirmed;
        await observed();
        return { status: "UNCERTAIN", errorCode: codeOf(profile, "SUCCESS_UNCONFIRMED") };
      }
    }
    return { status: "UNCERTAIN", errorCode: codeOf(profile, "CONFIRMATION_NOT_OBSERVED") };
  };

  const advance = async (candidate, label, source) => {
    const before = await inspect(page).catch(() => null);
    await arm("STEP", label, source);
    await candidate.click();
    const deadline = Date.now() + confirmationTimeoutMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(pollMs);
      const current = await inspect(page).catch(() => null);
      if (current?.challenge) return { status: "UNCERTAIN", errorCode: codeOf(profile, "STEP_CHALLENGE") };
      if (current && current.signature !== before?.signature) return null;
    }
    return { status: "UNCERTAIN", errorCode: codeOf(profile, "STEP_NOT_ADVANCED") };
  };

  if (entryFirst) {
    const entry = await enterApplication(page, profile, { inspect, assistant, onStep, onActionTriggered: async () => arm("ENTRY", (await labelOf(await findEntry(page, profile))) || profile.label), confirmationTimeoutMs, pollMs });
    if (entry.status === "SUBMITTED") return entry;
    if (entry.status !== "FORM") { await observed(); return { status: "UNCERTAIN", errorCode: entry.errorCode || codeOf(profile, "ENTRY_RESULT_UNKNOWN") }; }
  }
  for (let step = 1; step <= maxSteps; step++) {
    const filled = await fillStep(page, { step });
    if (filled?.status !== "FILLED") return stop(`STEP_${filled?.status || "FAILED"}`, `Etapa ${step} de ${profile.label} não pôde ser preenchida.`);
    let final = null, unsafe = null, next = null;
    try { final = await findFinalButton(page, profile, { exclude: clicked }); } catch (error) { unsafe = error; }
    if (final) return submitFinal(final.candidate, final.label, "RULE");
    if (!unsafe) next = await findProgression(page, { ...profile, progressionButton: profile.progressionButton || DEFAULT_PROGRESSION_BUTTON }).catch(() => null);
    if (next) {
      const blocked = await advance(next, await labelOf(next), "RULE");
      if (blocked) return blocked;
      continue;
    }
    const chosen = await choose(step);
    if (chosen?.kind === "FINAL") return submitFinal(chosen.candidate, chosen.label, "MODEL");
    if (chosen?.kind === "NEXT") {
      const blocked = await advance(chosen.candidate, chosen.label, "MODEL");
      if (blocked) return blocked;
      continue;
    }
    return unsafe ? stop("BOUNDARY_UNSAFE", unsafe.message) : stop("SUBMIT_BOUNDARY_MISSING", `Nem botão final nem avanço únicos em ${profile.label}.`);
  }
  return { status: "UNCERTAIN", errorCode: codeOf(profile, "STEP_LIMIT_REACHED") };
}
