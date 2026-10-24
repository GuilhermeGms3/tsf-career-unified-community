import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { FakeProvider } from "../src/intelligence/providers/fake-provider.mjs";
import { IntelligenceService } from "../src/intelligence/intelligence-service.mjs";
import { LastMileAssistant } from "../src/intelligence/tasks/last-mile-assistant.mjs";
import { PORTAL_SUBMIT_PROFILES } from "../src/automation/ats/last-mile/portal-submit-profiles.mjs";
import { progressiveSubmit } from "../src/automation/ats/last-mile/last-mile-engine.mjs";
import { vaultPageState } from "../src/automation/ats/assisted/assisted-ats-adapters.mjs";

class MemoryCacheRepo { constructor() { this.map = new Map(); } get(key) { const row = this.map.get(key); return row ? { result: row } : null; } put(item) { this.map.set(item.key, item.result); } }
class MemoryRunRepo { constructor() { this.items = []; } create(item) { this.items.push(item); return item; } metrics() { return { calls: this.items.length }; } }

// IA local falsa: as respostas sao funcoes do contexto que o assistente montou (botoes ou textos listados).
const contextOf = (prompt) => JSON.parse(prompt.slice(prompt.indexOf("CONTEXTO SANITIZADO:\n") + "CONTEXTO SANITIZADO:\n".length));
const pick = (action, label, confidence = 0.92) => ({ prompt }) => ({ action, candidateId: contextOf(prompt).candidates.find((item) => item.label === label)?.id || "", confidence, reason: "" });
const confirm = (status = "CONFIRMED", confidence = 0.9) => ({ prompt }) => ({ status, textId: contextOf(prompt).texts[0]?.id || "", confidence, reason: "" });

async function assistantWith(responses, { mode = "valid" } = {}) {
  const provider = new FakeProvider({ responses, mode });
  const service = new IntelligenceService({ provider, settings: { provider: "fake", fastModel: "fake-fast", balancedModel: "fake-balanced", contextBudget: 4096, policies: {} }, repositories: { cache: new MemoryCacheRepo(), runs: new MemoryRunRepo() }, hardwareProfile: { memoryProfile: "LOW_VRAM", recommendedConcurrency: 1 } });
  await service.initialize();
  return { provider, assistant: new LastMileAssistant(() => service), tasks: () => provider.calls.map((call) => call.options.task) };
}

const buttons = ["Salvar vaga", "Enviar candidatura", "Cancelar", "Seguir", "Entrar", "Continuar"].map((label) => ({ label }));

test("travas do assistente: id listado, rótulo de envio ou avanço, nada de cancelar, login ou seguir", async () => {
  const chosen = await (await assistantWith({ LAST_MILE_ACTION: pick("FINAL", "Enviar candidatura") })).assistant.chooseAction({ provider: "catho", candidates: buttons });
  assert.deepEqual([chosen.action, chosen.candidate, chosen.source], ["FINAL", buttons[1], "MODEL"]);
  assert.equal((await (await assistantWith({ LAST_MILE_ACTION: pick("NEXT", "Continuar") })).assistant.chooseAction({ provider: "catho", candidates: buttons })).candidate, buttons[5]);

  const rejected = [
    { action: "FINAL", candidateId: "b9", confidence: 0.99, reason: "" },
    pick("FINAL", "Cancelar"),
    pick("NEXT", "Seguir"),
    pick("FINAL", "Entrar"),
    pick("FINAL", "Salvar vaga"),
    pick("NEXT", "Enviar candidatura"),
    pick("FINAL", "Enviar candidatura", 0.5),
  ];
  for (const response of rejected) {
    const result = await (await assistantWith({ LAST_MILE_ACTION: response })).assistant.chooseAction({ provider: "catho", candidates: buttons });
    assert.deepEqual([result.action, result.candidate, result.source], ["NONE", null, "GUARD_REJECTED"]);
  }
  assert.equal((await (await assistantWith({ LAST_MILE_ACTION: pick("FINAL", "Enviar candidatura") }, { mode: "offline" })).assistant.chooseAction({ provider: "catho", candidates: buttons })).source, "FALLBACK");
  assert.equal((await new LastMileAssistant(() => null).chooseAction({ provider: "catho", candidates: buttons })).source, "FALLBACK");
  assert.equal((await (await assistantWith({})).assistant.chooseAction({ provider: "catho", candidates: [] })).source, "NO_CANDIDATES");

  const texts = ["Candidatura realizada com sucesso!"];
  assert.deepEqual(await (await assistantWith({ LAST_MILE_CONFIRMATION: confirm() })).assistant.classifyConfirmation({ provider: "catho", texts }).then(({ status, text }) => [status, text]), ["CONFIRMED", texts[0]]);
  assert.equal((await (await assistantWith({ LAST_MILE_CONFIRMATION: { status: "CONFIRMED", textId: "t7", confidence: 0.99, reason: "" } })).assistant.classifyConfirmation({ provider: "catho", texts })).status, "UNKNOWN");
  assert.equal((await (await assistantWith({ LAST_MILE_CONFIRMATION: confirm("CONFIRMED", 0.4) })).assistant.classifyConfirmation({ provider: "catho", texts })).status, "UNKNOWN");
  assert.equal((await (await assistantWith({ LAST_MILE_CONFIRMATION: confirm("ERROR") })).assistant.classifyConfirmation({ provider: "catho", texts })).status, "ERROR");
  assert.equal((await (await assistantWith({ LAST_MILE_CONFIRMATION: confirm() }, { mode: "timeout" })).assistant.classifyConfirmation({ provider: "catho", texts })).source, "FALLBACK");
});

const SUCCESS = "Candidatura realizada com sucesso!";
const appendText = (text) => `const p=document.createElement('p');p.textContent=${JSON.stringify(text)};document.body.append(p);`;
// Botao final do questionario e "Enviar" da newsletter: as regras do perfil acham dois finais (ambiguo).
const ambiguous = (after = appendText(SUCCESS)) => `<main><h1>Analista de Suporte</h1><form><label for=r>Por que esta vaga?</label><textarea id=r></textarea><button type=button id=send>Enviar candidatura</button></form><form><label for=e>Receba vagas por e-mail</label><input id=e><button type=button>Enviar</button></form><button type=button id=cancel>Cancelar</button></main><script>window.sent=0;document.getElementById('send').onclick=()=>{window.sent++;${after}};document.getElementById('cancel').onclick=()=>{window.cancelled=true;};</script>`;

async function withPortal(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage(), pages = new Map();
    await tab.route("https://www.catho.com.br/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: pages.get(new URL(route.request().url()).pathname) || "<p>404</p>" }));
    const open = async (pathname, body) => { pages.set(pathname, body); await tab.goto(`https://www.catho.com.br${pathname}`); };
    const run = async (options = {}) => { const steps = []; let armed = 0; const result = await progressiveSubmit(tab, PORTAL_SUBMIT_PROFILES.catho, { inspect: vaultPageState, onActionTriggered: () => { armed++; }, onStep: (step) => steps.push(`${step.kind}:${step.label}:${step.source || ""}`), confirmationTimeoutMs: 1500, pollMs: 100, ...options }); return { result, steps, armed }; };
    await fn({ tab, open, run });
  } finally { await browser.close(); }
}

test("botão final ambíguo: a IA escolhe entre os listados e confirma o texto novo; sem IA nada é clicado", async () => {
  await withPortal(async ({ tab, open, run }) => {
    await open("/vagas/1", ambiguous());
    let armed = 0;
    await assert.rejects(progressiveSubmit(tab, PORTAL_SUBMIT_PROFILES.catho, { inspect: vaultPageState, onActionTriggered: () => { armed++; } }), (error) => error.code === "CATHO_BOUNDARY_UNSAFE" && error.phase === "PRE_ACTION");
    assert.deepEqual([armed, await tab.evaluate(() => window.sent)], [0, 0], "sem IA continua parando antes de qualquer clique");

    const { assistant, tasks } = await assistantWith({ LAST_MILE_ACTION: pick("FINAL", "Enviar candidatura"), LAST_MILE_CONFIRMATION: confirm() });
    await open("/vagas/2", ambiguous());
    const assisted = await run({ assistant });
    assert.equal(assisted.result.status, "SUBMITTED");
    assert.deepEqual([assisted.result.receipt.confirmationText, assisted.result.receipt.metadata.verificationMethod, assisted.result.receipt.confirmationUrl], [SUCCESS, "LLM_CONFIRMED_DOM_V1", "https://www.catho.com.br/vagas/2"]);
    assert.deepEqual(assisted.steps, ["FINAL:Enviar candidatura:MODEL", `SUCCESS_TEXT_CONFIRMED:${SUCCESS}:MODEL`]);
    assert.deepEqual([assisted.armed, await tab.evaluate(() => window.sent)], [1, 1]);
    assert.deepEqual(tasks(), ["LAST_MILE_ACTION", "LAST_MILE_CONFIRMATION"]);

    // A IA escolhe "Cancelar": a trava rejeita e nada e clicado nem armado.
    await open("/vagas/3", ambiguous());
    let blocked = 0;
    await assert.rejects(progressiveSubmit(tab, PORTAL_SUBMIT_PROFILES.catho, { inspect: vaultPageState, onActionTriggered: () => { blocked++; }, assistant: (await assistantWith({ LAST_MILE_ACTION: pick("FINAL", "Cancelar") })).assistant }), (error) => error.code === "CATHO_BOUNDARY_UNSAFE" && error.phase === "PRE_ACTION");
    assert.deepEqual([blocked, await tab.evaluate(() => [window.sent, Boolean(window.cancelled)])], [0, [0, false]]);

    // IA fora do ar: mesmo desfecho deterministico.
    await open("/vagas/4", ambiguous());
    await assert.rejects(progressiveSubmit(tab, PORTAL_SUBMIT_PROFILES.catho, { inspect: vaultPageState, assistant: (await assistantWith({ LAST_MILE_ACTION: pick("FINAL", "Enviar candidatura") }, { mode: "offline" })).assistant }), (error) => error.code === "CATHO_BOUNDARY_UNSAFE");
    assert.equal(await tab.evaluate(() => window.sent), 0);
  });
});

test("rótulos fora do perfil: a IA avança a etapa e envia, cada clique registrado como MODEL", async () => {
  await withPortal(async ({ tab, open, run }) => {
    const stepTwo = `document.body.innerHTML='<form><label for=c>Cidade</label><input id=c><button type=button id=send>Enviar minha candidatura agora</button><button type=button>Voltar</button></form>';document.getElementById('send').onclick=()=>{window.sent++;${appendText(SUCCESS)}};`;
    const body = `<main><form><label for=a>Anos de Linux</label><input id=a><button type=button id=next>Ir para a próxima etapa</button><button type=button>Seguir</button></form></main><script>window.sent=0;document.getElementById('next').onclick=()=>{${stepTwo}};</script>`;
    await open("/vagas/5", body);
    await assert.rejects(run(), (error) => error.code === "CATHO_SUBMIT_BOUNDARY_MISSING" && error.phase === "PRE_ACTION");

    const action = ({ prompt }) => { const { candidates } = contextOf(prompt), final = candidates.find((item) => item.label === "Enviar minha candidatura agora"); return final ? { action: "FINAL", candidateId: final.id, confidence: 0.9, reason: "" } : { action: "NEXT", candidateId: candidates.find((item) => item.label === "Ir para a próxima etapa").id, confidence: 0.9, reason: "" }; };
    await open("/vagas/6", body);
    const assisted = await run({ assistant: (await assistantWith({ LAST_MILE_ACTION: action, LAST_MILE_CONFIRMATION: confirm() })).assistant });
    assert.equal(assisted.result.status, "SUBMITTED");
    assert.deepEqual(assisted.steps, ["STEP:Ir para a próxima etapa:MODEL", "FINAL:Enviar minha candidatura agora:MODEL", `SUCCESS_TEXT_CONFIRMED:${SUCCESS}:MODEL`]);
    assert.deepEqual([assisted.armed, await tab.evaluate(() => window.sent)], [1, 1]);
  });
});

test("confirmação: só texto novo, sem palavra de falha e que a IA afirma; senão o envio fica incerto", async () => {
  await withPortal(async ({ open, run }) => {
    const single = (after, before = "") => `<main>${before}<form><label for=r>Por que esta vaga?</label><textarea id=r></textarea><button type=button id=send>Enviar candidatura</button></form></main><script>window.sent=0;document.getElementById('send').onclick=()=>{window.sent++;${after}};</script>`;

    // Texto com palavra de falha nem chega a IA, mesmo que ela fosse confirmar.
    const failing = await assistantWith({ LAST_MILE_CONFIRMATION: confirm() });
    await open("/vagas/7", single(appendText("Candidatura enviada, mas não conseguimos anexar seu currículo")));
    const partial = await run({ assistant: failing.assistant });
    assert.deepEqual([partial.result.status, partial.result.errorCode], ["UNCERTAIN", "CATHO_SUCCESS_UNCONFIRMED"]);
    assert.deepEqual(failing.tasks(), []);

    // O mesmo texto ja estava na pagina antes do clique: nao e novo.
    const stale = await assistantWith({ LAST_MILE_CONFIRMATION: confirm() });
    await open("/vagas/8", single(appendText(SUCCESS), `<p>${SUCCESS}</p>`));
    const repeated = await run({ assistant: stale.assistant });
    assert.deepEqual([repeated.result.status, stale.tasks()], ["UNCERTAIN", []]);

    // A IA nao afirma o envio: fica o texto observado para a pessoa conferir.
    await open("/vagas/9", single(appendText(SUCCESS)));
    const unsure = await run({ assistant: (await assistantWith({ LAST_MILE_CONFIRMATION: confirm("UNKNOWN") })).assistant });
    assert.deepEqual([unsure.result.status, unsure.result.errorCode], ["UNCERTAIN", "CATHO_SUCCESS_UNCONFIRMED"]);
    assert.deepEqual(unsure.steps, ["FINAL:Enviar candidatura:RULE", `SUCCESS_TEXT_OBSERVED:${SUCCESS}:`]);
  });
});
