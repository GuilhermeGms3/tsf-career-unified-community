import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { SESSION_PROVIDER_IDS, sessionProviderById } from "../src/source-connections/session-provider-registry.mjs";
import { PORTAL_SUBMIT_PROFILES, vaultProvidersWithoutProfile } from "../src/automation/ats/last-mile/portal-submit-profiles.mjs";
import { advanceStep, findProgression, profileHostAllowed, restrictToProfileHosts, submitWithProfile } from "../src/automation/ats/last-mile/last-mile-engine.mjs";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";

const pending = SESSION_PROVIDER_IDS.filter((id) => id !== "gupy");
const testProfile = Object.freeze({
  provider: "teste", label: "Portal Teste", codePrefix: "TESTE", hosts: ["portal.example.test", "*.portal.example.test"],
  finalButton: /^enviar candidatura$/i, progressionButton: /^próximo$/i, successText: /^candidatura recebida$/i, receiptText: "Candidatura recebida",
  status: "COMPLETE", missing: [],
});
// Página que falha ao ser tocada: prova que um perfil incompleto recusa antes de qualquer interação.
const untouchable = new Proxy({}, { get: (_, key) => { throw new Error(`página tocada: ${String(key)}`); } });

test("todo Cofre tem perfil de última milha com os hosts oficiais do próprio Cofre", () => {
  assert.deepEqual(vaultProvidersWithoutProfile(), []);
  for (const id of SESSION_PROVIDER_IDS) assert.deepEqual([...PORTAL_SUBMIT_PROFILES[id].hosts], [...sessionProviderById(id).allowedHosts], id);
  assert.equal(PORTAL_SUBMIT_PROFILES.gupy.status, "COMPLETE");
  for (const id of pending) assert.deepEqual([PORTAL_SUBMIT_PROFILES[id].status, [...PORTAL_SUBMIT_PROFILES[id].missing]], ["INCOMPLETE", ["finalButton", "successText"]], id);
});

test("registry mostra o que falta em cada perfil e não promove portal incompleto", async () => {
  const registry = new AdapterRegistry();
  for (const id of pending) {
    const described = registry.describe(id);
    assert.equal(described.submitProfile.status, "INCOMPLETE", id);
    assert.equal(described.canSubmit, false, id);
    const adapter = registry.get(id);
    assert.equal(adapter.submitProfile.provider, id);
    assert.equal(typeof adapter.submit, "undefined", `${id} assistido não pode ter submit`);
    await assert.rejects(submitWithProfile(untouchable, PORTAL_SUBMIT_PROFILES[id], { onActionTriggered: () => assert.fail("não pode armar o envio") }), (error) => error.code === `${id.toUpperCase()}_SUBMIT_PROFILE_INCOMPLETE`, id);
  }
  assert.equal(registry.describe("gupy").submitProfile.status, "COMPLETE");
  assert.equal(registry.describe("greenhouse").submitProfile, undefined);
});

test("hosts do perfil exigem https oficial e recusam imitações", () => {
  const gupy = PORTAL_SUBMIT_PROFILES.gupy;
  for (const allowed of ["https://gupy.io/x", "https://acme.gupy.io/jobs/1", "https://portal.gupy.io/my/applications"]) assert.equal(profileHostAllowed(gupy, allowed), true, allowed);
  for (const denied of ["http://acme.gupy.io/", "https://acme.gupy.io:8443/", "https://user:pw@acme.gupy.io/", "https://gupy.io.evil.test/", "https://evilgupy.io/", "nada"]) assert.equal(profileHostAllowed(gupy, denied), false, denied);
});

test("rede fica restrita aos hosts do portal e o DRY_RUN não envia nada", async () => {
  let handler;
  await restrictToProfileHosts({ route: async (_, fn) => { handler = fn; } }, testProfile, { mode: "DRY_RUN" });
  const decide = async (url, method = "GET") => { let decision = ""; await handler({ request: () => ({ url: () => url, method: () => method }), abort: () => { decision = "abort"; }, continue: () => { decision = "continue"; } }); return decision; };
  assert.equal(await decide("https://a.portal.example.test/form"), "continue");
  assert.equal(await decide("https://a.portal.example.test/apply", "POST"), "abort");
  assert.equal(await decide("https://tracker.example.com/pixel"), "abort");
});

test("motor de última milha: um clique, confirmação nova ou resultado incerto", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const form = (body) => page.setContent(`<main>${body}</main><script>window.clicks=0;document.querySelectorAll('[data-final]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();window.clicks++;if(b.dataset.final==='ok')setTimeout(()=>{const p=document.createElement('p');p.textContent='Candidatura recebida';document.body.append(p);},50);}));</script>`);
    let armed = 0;
    await form('<button data-final="ok">Enviar candidatura</button>');
    const submitted = await submitWithProfile(page, testProfile, { onActionTriggered: () => { armed++; }, confirmationTimeoutMs: 2000 });
    assert.deepEqual([submitted.status, submitted.receipt.confirmationText, armed, await page.evaluate(() => window.clicks)], ["SUBMITTED", "Candidatura recebida", 1, 1]);

    await form('<p>Candidatura recebida</p><button data-final="ok">Enviar candidatura</button>');
    await assert.rejects(submitWithProfile(page, testProfile, {}), (error) => error.code === "BLOCKED_DUPLICATE");
    assert.equal(await page.evaluate(() => window.clicks), 0);

    await form('<button data-final="ok">Enviar candidatura</button><button data-final="ok">Enviar candidatura</button>');
    await assert.rejects(submitWithProfile(page, testProfile, {}), (error) => error.code === "TESTE_BOUNDARY_UNSAFE");

    await form('<button data-final="silent">Enviar candidatura</button>');
    const uncertain = await submitWithProfile(page, testProfile, { confirmationTimeoutMs: 300 });
    assert.deepEqual([uncertain.status, uncertain.errorCode, await page.evaluate(() => window.clicks)], ["UNCERTAIN", "TESTE_CONFIRMATION_NOT_OBSERVED", 1]);
  } finally { await browser.close(); }
});

test("avanço de etapa exige um único botão e uma etapa que realmente muda", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<button>Próximo</button><button>Próximo</button>");
    await assert.rejects(findProgression(page, testProfile), (error) => error.code === "TESTE_STEP_BOUNDARY_AMBIGUOUS");
    await page.setContent("<button>Voltar</button>");
    await assert.rejects(findProgression(page, testProfile), (error) => error.code === "TESTE_STEP_BOUNDARY_MISSING");
    await page.setContent(`<h2 id="step">1</h2><button onclick="document.getElementById('step').textContent='2'">Próximo</button>`);
    const inspect = async (current) => ({ signature: await current.textContent("#step"), challenge: "" });
    await advanceStep(page, testProfile, { inspect, previousSignature: "1", timeoutMs: 2000 });
    assert.equal(await page.textContent("#step"), "2");
    await page.setContent(`<h2 id="step">1</h2><button>Próximo</button>`);
    await assert.rejects(advanceStep(page, testProfile, { inspect, previousSignature: "1", timeoutMs: 300 }), (error) => error.code === "TESTE_STEP_NOT_ADVANCED");
  } finally { await browser.close(); }
});
