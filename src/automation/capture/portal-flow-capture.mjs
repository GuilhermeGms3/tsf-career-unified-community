import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Captura guiada por humano do fluxo de candidatura de um portal com Cofre. A pessoa faz login,
// preenche e envia; esta captura so observa (nunca clica nem digita) e grava cada tela estavel ja
// sanitizada, para completar o perfil de ultima milha (botao final e texto de confirmacao).

const FINAL_BUTTON = /enviar|candidat|finalizar|concluir|confirmar|submit|apply|send/i;
const PROGRESSION_BUTTON = /pr[oó]xim|continuar|avan[cç]ar|seguir|next|continue/i;
const SUCCESS_TEXT = /candidatura|inscri[cç][aã]o|enviad|sucesso|recebid|obrigad|parab[eé]ns|applied|submitted|received|thank|success/i;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripAccents = (value) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "");

// Padroes de redacao serializaveis: usados no Node (resumos) e dentro da pagina (HTML).
export function redactionPatterns(redact = []) {
  const literals = [...new Set(redact.flatMap((value) => {
    const text = String(value || "").trim();
    if (text.length < 3) return [];
    const words = text.split(/\s+/).filter((word) => word.length >= 3);
    return [text, stripAccents(text), ...(words.length > 1 ? words.flatMap((word) => [word, stripAccents(word)]) : [])];
  }))].sort((left, right) => right.length - left.length);
  return [
    { source: "[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+", flags: "gi", replacement: "[email]" },
    { source: "\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b", flags: "g", replacement: "[cpf]" },
    { source: "\\+?\\d[\\d\\s().-]{7,}\\d", flags: "g", replacement: "[telefone]" },
    { source: "\\b\\d{5}-\\d{3}\\b|\\b\\d{4}-\\d{3}\\b", flags: "g", replacement: "[cep]" },
    { source: "linkedin\\.com/in/[\\w%-]+|github\\.com/[\\w-]+", flags: "gi", replacement: "[perfil]" },
    ...(literals.length ? [{ source: literals.map(escapeRegex).join("|"), flags: "gi", replacement: "[pessoal]" }] : []),
  ];
}

export function redactText(value, patterns) {
  return patterns.reduce((text, { source, flags, replacement }) => text.replace(new RegExp(source, flags), replacement), String(value ?? ""));
}

// Roda dentro da pagina: devolve o HTML sem scripts, midia, valores digitados, tokens nem dados pessoais.
function sanitizeDocumentInPage(patterns) {
  const redact = (value) => patterns.reduce((text, { source, flags, replacement }) => text.replace(new RegExp(source, flags), replacement), String(value ?? ""));
  // Links ficam so com origem e caminho: query e fragmento costumam carregar tokens de sessao.
  const keepPath = (value) => {
    try { const url = new URL(value, location.href); return url.protocol.startsWith("http") ? redact(url.origin + url.pathname) : ""; }
    catch { return /^[a-z][a-z0-9+.-]*:/i.test(value) ? "" : redact(String(value).split(/[?#]/)[0]); }
  };
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll("script,noscript,style,link,meta,iframe,frame,object,embed,svg,canvas,video,audio,source,img,picture,template,base").forEach((element) => {
    if (/^i?frame$/i.test(element.tagName)) element.replaceWith(Object.assign(document.createElement("div"), { textContent: "[iframe removido]" }));
    else element.remove();
  });
  const keepData = /^data-(?:testid|test|cy|qa|step|automation-id)$/i, urlAttributes = new Set(["href", "action", "formaction"]);
  for (const element of clone.querySelectorAll("*")) {
    for (const { name, value } of [...element.attributes]) {
      const lower = name.toLowerCase();
      if (lower.startsWith("on") || ["value", "checked", "selected", "style", "nonce", "integrity", "srcset", "src"].includes(lower) || (lower.startsWith("data-") && !keepData.test(lower))) element.removeAttribute(name);
      else if (urlAttributes.has(lower)) element.setAttribute(name, keepPath(value));
      else element.setAttribute(name, redact(value));
    }
    if (element.tagName === "TEXTAREA" || element.isContentEditable || element.getAttribute("contenteditable") === "true") element.textContent = "";
  }
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.nodeValue = redact(node.nodeValue);
  return `<!doctype html>\n${clone.outerHTML}`;
}

// Roda dentro da pagina: o que interessa para o perfil (botoes, titulos, campos e mensagens visiveis).
function summarizeDocumentInPage(successSource) {
  const success = new RegExp(successSource, "i");
  const visible = (element) => Boolean(element.getClientRects().length) && getComputedStyle(element).visibility !== "hidden";
  const text = (element) => (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
  const labelOf = (element) => text(element.labels?.[0] || document.querySelector(`[for="${CSS.escape(element.id || "")}"]`) || { textContent: element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.name || "" });
  const buttons = [...document.querySelectorAll("button,[role=button],input[type=submit],input[type=button]")].filter(visible)
    .map((element) => (element.getAttribute("aria-label") || text(element) || element.value || "").trim()).filter(Boolean);
  const headings = [...document.querySelectorAll("h1,h2,h3,[role=heading]")].filter(visible).map(text).filter(Boolean);
  const fields = [...document.querySelectorAll("input:not([type=hidden]),select,textarea")].filter(visible)
    .map((element) => ({ type: element.type || element.tagName.toLowerCase(), label: labelOf(element), required: element.required || element.getAttribute("aria-required") === "true" }));
  const messages = [...document.querySelectorAll("h1,h2,h3,h4,p,span,div,strong,[role=alert],[role=status]")]
    .filter((element) => (!element.children.length || element.matches("[role=alert],[role=status]")) && visible(element)).map(text)
    .filter((value) => value.length >= 4 && value.length <= 160 && success.test(value));
  return { page: location.origin + location.pathname, title: document.title, buttons: [...new Set(buttons)].slice(0, 60), headings: [...new Set(headings)].slice(0, 30), fields: fields.slice(0, 80), messages: [...new Set(messages)].slice(0, 30) };
}

function redactSummary(summary, patterns) {
  const clean = (value) => redactText(value, patterns);
  return { ...summary, page: clean(summary.page), title: clean(summary.title), buttons: summary.buttons.map(clean), headings: summary.headings.map(clean), messages: summary.messages.map(clean), fields: summary.fields.map((field) => ({ ...field, label: clean(field.label) })) };
}

export const sanitizePage = (page, patterns) => page.evaluate(sanitizeDocumentInPage, patterns);
export const summarizePage = async (page, patterns) => redactSummary(await page.evaluate(summarizeDocumentInPage, SUCCESS_TEXT.source), patterns);

// Confirmacao = primeira tela (depois da inicial) com mensagem de sucesso que nao existia antes.
// O botao final sai da tela anterior; o perfil so fica pronto com um unico candidato a botao final.
export function proposeProfile(steps, { provider = "" } = {}) {
  let confirmation = -1, successTexts = [];
  for (let index = 1; index < steps.length && confirmation < 0; index++) {
    const earlier = new Set(steps.slice(0, index).flatMap((step) => step.messages));
    const fresh = steps[index].messages.filter((message) => !earlier.has(message));
    if (fresh.length) { confirmation = index; successTexts = fresh; }
  }
  const beforeConfirmation = confirmation > 0 ? steps[confirmation - 1] : steps.at(-1);
  const finalButtons = (beforeConfirmation?.buttons || []).filter((button) => FINAL_BUTTON.test(button));
  const progression = [...new Set(steps.slice(0, confirmation > 0 ? confirmation - 1 : steps.length).flatMap((step) => step.buttons).filter((button) => PROGRESSION_BUTTON.test(button)))];
  const exact = (values) => values.length ? `^(?:${values.map(escapeRegex).join("|")})$` : null;
  return {
    provider, confirmationStep: confirmation > 0 ? confirmation + 1 : null,
    finalButtonCandidates: finalButtons, successTextCandidates: successTexts, progressionCandidates: progression,
    suggested: { finalButton: finalButtons.length === 1 ? exact(finalButtons) : null, successText: exact(successTexts), progressionButton: exact(progression) },
    ready: finalButtons.length === 1 && successTexts.length > 0,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Grava uma etapa quando a tela muda e fica igual por duas leituras seguidas (evita estados de transicao).
export async function captureFlow(page, { outDir, provider = "", redact = [], pollMs = 800, maxSteps = 40, signal, onStep = () => {} } = {}) {
  await mkdir(outDir, { recursive: true });
  const patterns = redactionPatterns(redact), steps = [];
  let pending = "", saved = "";
  while (!page.isClosed() && !signal?.aborted && steps.length < maxSteps) {
    try {
      const summary = await summarizePage(page, patterns), signature = createHash("sha256").update(JSON.stringify(summary)).digest("hex").slice(0, 16);
      if (signature === pending && signature !== saved) {
        const html = await sanitizePage(page, patterns), name = `step-${String(steps.length + 1).padStart(2, "0")}`;
        await writeFile(path.join(outDir, `${name}.html`), html);
        const step = { index: steps.length + 1, file: `${name}.html`, signature, capturedAt: new Date().toISOString(), ...summary };
        await writeFile(path.join(outDir, `${name}.json`), `${JSON.stringify(step, null, 2)}\n`);
        steps.push(step); saved = signature; onStep(step);
      }
      pending = signature;
    } catch {
      // Navegacao em andamento ou pagina fechando: a proxima leitura decide.
    }
    await sleep(pollMs);
  }
  const proposal = proposeProfile(steps, { provider });
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify({ provider, capturedAt: new Date().toISOString(), observedOnly: true, steps: steps.map(({ index, file, page: url, title }) => ({ index, file, page: url, title })), proposal }, null, 2)}\n`);
  return { steps, proposal };
}
