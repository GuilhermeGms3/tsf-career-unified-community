import { hostAllowed } from "../../../source-connections/session-provider-registry.mjs";

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
