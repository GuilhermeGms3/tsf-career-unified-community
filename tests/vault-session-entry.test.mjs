import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { CredentialVault } from "../src/discovery/source-center/credential-vault.mjs";
import { SourceAuthService, verificationUrl } from "../src/source-connections/source-auth-service.mjs";
import { sessionProviderById } from "../src/source-connections/session-provider-registry.mjs";
import { GUPY_ACCOUNT_SCOPE, ownedProviderState, providerOwnsCookieDomain, validateOwnedState, validateProviderState } from "../src/source-connections/session-state.mjs";
import { applicationProvider } from "../src/discovery/source-attribution.mjs";
import { ApplicationEngine, detectChallenge, vaultLoginWall } from "../src/automation/application-engine.mjs";
import { AtsDetector } from "../src/automation/ats/ats-detector.mjs";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";
import { PORTAL_SUBMIT_PROFILES } from "../src/automation/ats/last-mile/portal-submit-profiles.mjs";
import { enterApplication, findEntry } from "../src/automation/ats/last-mile/last-mile-engine.mjs";

const cookie = (domain, extra = {}) => ({ name: "sid", value: `v-${domain}`, domain, path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax", ...extra });

test("cookies de host exato dos hosts oficiais entram no Cofre; sufixo público e imitação não", () => {
  const catho = sessionProviderById("catho");
  for (const domain of ["www.catho.com.br", ".catho.com.br", "catho.com.br", "login.catho.com.br"]) assert.equal(providerOwnsCookieDomain(catho, domain), true, domain);
  for (const domain of [".com.br", "com.br", "catho.com.br.evil.test", "evilcatho.com.br", ".linkedin.com", ""]) assert.equal(providerOwnsCookieDomain(catho, domain), false, domain);
  assert.equal(providerOwnsCookieDomain(sessionProviderById("indeed"), "secure.indeed.com"), true);
  assert.equal(providerOwnsCookieDomain(sessionProviderById("geekhunter"), "www.geekhunter.com"), true);
  const state = validateProviderState({ cookies: [cookie("www.catho.com.br"), cookie(".catho.com.br")], origins: [] }, "catho");
  assert.deepEqual(state.cookies.map((item) => item.domain), ["www.catho.com.br", ".catho.com.br"]);
});

test("runner e validação usam o mesmo recorte: estado misto do navegador nunca é recusado", () => {
  const raw = {
    cookies: [cookie("www.catho.com.br"), cookie(".google.com"), cookie(".catho.com.br", { secure: false }), cookie("login.catho.com.br")],
    origins: [{ origin: "https://www.catho.com.br", localStorage: [{ name: "auth_token", value: "spa" }, { name: "senha", value: "nunca" }] }, { origin: "https://www.google.com", localStorage: [] }],
  };
  const owned = ownedProviderState(raw, "catho");
  assert.deepEqual(owned.cookies.map((item) => item.domain), ["www.catho.com.br", "login.catho.com.br"]);
  const safe = validateProviderState(owned, "catho");
  assert.deepEqual(safe.origins, [{ origin: "https://www.catho.com.br", localStorage: [{ name: "auth_token", value: "spa" }] }]);
});

test("conta Gupy aceita cookies de host exato e localStorage do próprio Gupy", () => {
  const raw = { cookies: [cookie("portal.gupy.io"), cookie(".gupy.io"), cookie("acme.gupy.io")], origins: [{ origin: "https://portal.gupy.io", localStorage: [{ name: "token", value: "jwt" }, { name: "password", value: "x" }] }] };
  const owned = ownedProviderState(raw, "gupy");
  assert.deepEqual(owned.cookies.map((item) => item.domain), ["portal.gupy.io", ".gupy.io"]);
  const safe = validateOwnedState(owned, GUPY_ACCOUNT_SCOPE);
  assert.deepEqual(safe.origins[0].localStorage, [{ name: "token", value: "jwt" }]);
});

test("página de verificação aceita só https oficial e descarta query", () => {
  const catho = sessionProviderById("catho");
  assert.equal(verificationUrl(catho, "https://www.catho.com.br/area-candidato/minhas-candidaturas/?token=abc#x"), "https://www.catho.com.br/area-candidato/minhas-candidaturas/");
  for (const value of ["http://www.catho.com.br/x", "https://evil.test/x", "https://www.catho.com.br:8443/x", "https://u:p@www.catho.com.br/x", "lixo"]) assert.equal(verificationUrl(catho, value), "", value);
});

async function authFixture(verifySession) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vault-entry-")), store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  const vault = await new CredentialVault({ vaultPath: path.join(dir, "vault.json"), keyPath: path.join(dir, "key") }).initialize();
  const auth = new SourceAuthService({ store, vault, connections: { secret: () => "", list: async () => [] }, githubEvidence: {}, verifySession });
  return { store, auth, close: async () => { store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("a página comprovada no login vira verificação, e a sessão recusada pelo portal expira o Cofre", async () => {
  const calls = [], f = await authFixture(async (state, scope, provider, options = {}) => { calls.push(options.urls || []); return true; });
  try {
    const request = await f.auth.begin("catho"), ticket = f.auth.issueTicket(request.id);
    f.auth.claim(request.id, ticket); f.auth.runnerEvent(request.id, ticket, { event: "BROWSER_OPENED" });
    await f.auth.completeSession(request.id, ticket, { cookies: [cookie("www.catho.com.br")], origins: [] }, { authenticatedUrl: "https://www.catho.com.br/area-candidato/?utm=x" });
    assert.deepEqual(calls.at(-1), ["https://www.catho.com.br/area-candidato/"]);
    assert.equal(f.auth.storageState("catho").cookies[0].domain, "www.catho.com.br");
    await f.auth.check("catho");
    assert.deepEqual(calls.at(-1), ["https://www.catho.com.br/area-candidato/"]);
    assert.equal(f.auth.rejectSession("catho", { applicationId: "app-1" }), true);
    assert.equal(f.auth.status("catho").status, "SESSION_EXPIRED");
    assert.equal(f.auth.storageState("catho"), undefined);
    assert.ok(f.store.structuredLogs.list({ provider: "catho" }).some((entry) => entry.eventCode === "SESSION_REJECTED_BY_PORTAL"));
    assert.equal(f.auth.rejectSession("catho"), false);
  } finally { await f.close(); }
});

test("GeekHunter migrou para geekhunter.com e continua sendo o mesmo Cofre", async () => {
  assert.equal(applicationProvider("https://www.geekhunter.com/pt/vagas/123"), "GEEKHUNTER");
  assert.equal(applicationProvider("https://geekhunter.com.evil.test/x"), "UNKNOWN");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://www.geekhunter.com/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>Vaga</h1>" }));
    await page.goto("https://www.geekhunter.com/pt/vagas/123");
    assert.equal((await new AtsDetector().detect(page)).type, "geekhunter");
  } finally { await browser.close(); }
});

// Páginas servidas por rota local com URL real do portal: nada sai para a internet.
async function withPortalPage(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), pages = new Map();
    await page.route("https://www.catho.com.br/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: pages.get(new URL(route.request().url()).pathname) || "<p>404</p>" }));
    await fn(page, async (pathname, body) => { pages.set(pathname, body); await page.goto(`https://www.catho.com.br${pathname}`); });
  } finally { await browser.close(); }
}
const inspect = async (page) => ({ signature: await page.evaluate(() => document.querySelectorAll("input,select,textarea").length + ":" + location.pathname), challenge: await detectChallenge(page), fields: await page.locator("input:not([type=hidden]),select,textarea").count() });
const clicks = (page) => page.evaluate(() => window.clicks || 0);
const entryPage = (afterClick) => `<header><input type="search" aria-label="Buscar vagas"></header><h1>Analista de Suporte</h1><a href="#" id="go">Quero me candidatar</a>
  <script>window.clicks=0;document.getElementById('go').addEventListener('click',e=>{e.preventDefault();window.clicks++;setTimeout(()=>{${afterClick}},80);});</script>`;

test("tela de login com a sessão do Cofre aplicada avisa o Cofre; sem sessão, não", async () => {
  await withPortalPage(async (page, open) => {
    const rejected = [], events = [], engine = new ApplicationEngine({ store: { applications: { recordEvent: (...args) => events.push(args) } }, browserManager: {}, onSessionRejected: (provider, context) => rejected.push([provider, context.applicationId]) });
    await open("/login", "<h1>Entrar</h1><input type=email>");
    assert.equal(vaultLoginWall(page, "catho"), true);
    assert.equal(await engine.vaultChallenge(page, "catho", "app-1", false), "");
    assert.equal(await engine.vaultChallenge(page, "catho", "app-1", true), "LOGIN_REQUIRED");
    await open("/vagas/1", "<input type=password>");
    assert.equal(await engine.vaultChallenge(page, "catho", "app-2", true), "LOGIN_REQUIRED");
    assert.deepEqual(rejected, [["catho", "app-1"], ["catho", "app-2"]]);
    assert.equal(events.filter(([, type]) => type === "VAULT_SESSION_REJECTED").length, 2);
  });
});

test("botão de entrada precisa ser único e visível", async () => {
  await withPortalPage(async (page, open) => {
    await open("/vagas/1", entryPage(""));
    assert.equal(await (await findEntry(page, PORTAL_SUBMIT_PROFILES.catho)).textContent(), "Quero me candidatar");
    await open("/vagas/2", "<button>Candidatar-me</button><li><button>Candidatar-me</button></li>");
    await assert.rejects(findEntry(page, PORTAL_SUBMIT_PROFILES.catho), (error) => error.code === "CATHO_ENTRY_AMBIGUOUS");
    await open("/vagas/3", "<button>Salvar vaga</button>");
    await assert.rejects(findEntry(page, PORTAL_SUBMIT_PROFILES.catho), (error) => error.code === "CATHO_ENTRY_MISSING");
  });
});

test("clique de entrada é armado antes e tem quatro desfechos, sem segundo clique", async () => {
  const withSuccess = { ...PORTAL_SUBMIT_PROFILES.catho, successText: /^Candidatura realizada com sucesso!$/, receiptText: "Candidatura realizada" };
  await withPortalPage(async (page, open) => {
    let armed = 0;
    const run = (profile = PORTAL_SUBMIT_PROFILES.catho, timeout = 1500) => enterApplication(page, profile, { inspect, onActionTriggered: () => { armed++; }, confirmationTimeoutMs: timeout, pollMs: 50 });
    const success = "const p=document.createElement('p');p.textContent='Candidatura realizada com sucesso!';document.body.append(p);";

    await open("/vagas/1", entryPage("document.body.insertAdjacentHTML('beforeend','<form><label for=q>Por que esta vaga?</label><textarea id=q></textarea></form>')"));
    assert.equal((await run()).status, "FORM");

    await open("/vagas/2", entryPage(success));
    assert.deepEqual([(await run(withSuccess)).status, await clicks(page)], ["SUBMITTED", 1]);

    await open("/vagas/3", entryPage(success));
    assert.equal((await run()).errorCode, "CATHO_ENTRY_SUCCESS_UNCONFIRMED");

    await open("/vagas/4", entryPage("document.body.insertAdjacentHTML('beforeend','<input type=password>')"));
    assert.equal((await run()).status, "LOGIN_REQUIRED");

    await open("/vagas/5", entryPage(""));
    const unknown = await run(PORTAL_SUBMIT_PROFILES.catho, 400);
    assert.deepEqual([unknown.status, unknown.errorCode, await clicks(page)], ["UNCERTAIN", "CATHO_ENTRY_RESULT_UNKNOWN", 1]);
    assert.equal(armed, 5);

    await open("/vagas/6", `<p>Candidatura realizada com sucesso!</p>${entryPage("")}`);
    await assert.rejects(run(withSuccess), (error) => error.code === "BLOCKED_DUPLICATE");
    assert.deepEqual([armed, await clicks(page)], [5, 0]);
  });
});

test("página da vaga vira cenário de entrada e questionário logado deixa de ser layout não suportado", async () => {
  const adapter = new AdapterRegistry().get("catho");
  await withPortalPage(async (page, open) => {
    await open("/vagas/1", entryPage(""));
    const listing = await adapter.inspectApplicationForm(page, { sessionApplied: true });
    assert.deepEqual([listing.schema.variant, listing.schema.health, listing.fields.length, listing.schema.warnings.map((item) => item.code)], ["apply-entry", "HEALTHY", 0, ["ENTRY_CLICK_MAY_SUBMIT"]]);
    assert.equal(await clicks(page), 0, "a inspeção nunca clica na entrada");
    assert.ok((await adapter.inspectApplicationForm(page, {})).schema.warnings.some((item) => item.code === "VAULT_SESSION_MISSING"));

    const questionnaire = `<form><label for=q>Por que você quer esta vaga?</label><textarea id=q required></textarea><label for=n>Nível de inglês</label><select id=n><option>Básico</option><option>Avançado</option></select><button>Enviar candidatura</button></form>`;
    await open("/vagas/2", questionnaire);
    assert.equal((await adapter.inspectApplicationForm(page, {})).schema.health, "UNSUPPORTED");
    const logged = await adapter.inspectApplicationForm(page, { sessionApplied: true });
    assert.equal(logged.schema.variant, "logged-in-form");
    assert.notEqual(logged.schema.health, "UNSUPPORTED");

    // Botão "Candidatar para a vaga" dentro do formulário é envio do formulário, não entrada.
    await open("/vagas/3", `<form><label for=c>Carta</label><textarea id=c></textarea><button>Candidatar para a vaga</button></form>`);
    assert.equal((await adapter.inspectApplicationForm(page, { sessionApplied: true })).schema.variant, "logged-in-form");
  });
});
