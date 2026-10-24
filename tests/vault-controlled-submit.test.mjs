import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";
import { PORTAL_SUBMIT_PROFILES } from "../src/automation/ats/last-mile/portal-submit-profiles.mjs";
import { VaultFinalRevalidator } from "../src/application/vault-final-revalidator.mjs";
import { SubmissionPreflight } from "../src/application/submission-preflight.mjs";
import { SubmissionConsentService } from "../src/application/submission-consent-service.mjs";
import { ControlledSubmissionService } from "../src/application/controlled-submission-service.mjs";
import { AdapterSubmissionTransport } from "../src/application/submission-transport.mjs";
import { SubmissionReconciliationService } from "../src/application/submission-reconciliation-service.mjs";
import { SubmitHomologationService } from "../src/application/submit-homologation-service.mjs";
import { FakeProvider } from "../src/intelligence/providers/fake-provider.mjs";
import { IntelligenceService } from "../src/intelligence/intelligence-service.mjs";
import { LastMileAssistant } from "../src/intelligence/tasks/last-mile-assistant.mjs";

const JOB_URL = "https://www.catho.com.br/vagas/analista-de-suporte/123/";
const vaultState = { cookies: [{ name: "sid", value: "catho-session", domain: "www.catho.com.br", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] };
const withOptIn = async (fn) => { const previous = process.env.CAREER_VAULT_SUBMIT_PROVIDERS; process.env.CAREER_VAULT_SUBMIT_PROVIDERS = "catho"; try { await fn(); } finally { if (previous === undefined) delete process.env.CAREER_VAULT_SUBMIT_PROVIDERS; else process.env.CAREER_VAULT_SUBMIT_PROVIDERS = previous; } };

// Navegador de teste: páginas da Catho servidas por rota local com a URL real; nada sai para a internet.
function portalBrowser(pages, dir) {
  let browser;
  return {
    headless: true, opened: [],
    async open(applicationId, attemptId, { storageState } = {}) {
      browser ||= await chromium.launch({ headless: true });
      const context = await browser.newContext(storageState ? { storageState } : {});
      await context.route("https://www.catho.com.br/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: pages.get(new URL(route.request().url()).pathname) || "<p>404</p>" }));
      this.opened.push(Boolean(storageState));
      return { page: await context.newPage(), context, applicationId, attemptId };
    },
    resume: () => null, status: () => ({ status: "NONE" }),
    async close(session) { await session?.context?.close().catch(() => {}); },
    async hold(session) { await this.close(session); },
    async screenshot(session, name) { const file = path.join(dir, `${name}-${Date.now()}.png`); await session.page.screenshot({ path: file }); return file; },
    async shutdown() { await browser?.close(); },
  };
}

const page = (body, script = "") => `<header><input type="search" aria-label="Buscar vagas"></header><main>${body}</main><script>window.clicks=0;${script}</script>`;
const entryLink = (afterClick) => page(`<h1>Analista de Suporte</h1><a href="#" id="go">Quero me candidatar</a>`, `document.getElementById('go').addEventListener('click',e=>{e.preventDefault();window.clicks++;setTimeout(()=>{${afterClick}},60);});`);
const showSuccess = "const p=document.createElement('p');p.textContent='Candidatura realizada com sucesso!';document.body.append(p);";

async function fixture({ sessionState = vaultState } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vault-submit-")), store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  const t = new Date(Date.now() - 60000).toISOString(), resumeId = "resume-c", versionId = "version-c", applicationId = "application-c", jobId = "job-c";
  store.jobs.upsert({ id: jobId, title: "Analista de Suporte", company: "Acme", description: "Linux", url: JOB_URL, canonicalUrl: JOB_URL, applicationUrl: JOB_URL, status: "open", lifecycleStatus: "OPEN", createdAt: t, updatedAt: t });
  store.resumes.upsert({ id: resumeId, title: "Base", text: "Suporte", createdAt: t, updatedAt: t });
  store.applications.create({ id: applicationId, jobId, resumeId, status: "READY_TO_SUBMIT", createdAt: t, updatedAt: t }, {}, { allowHistorical: true });
  store.resumeVersions.create({ id: versionId, resumeId, jobId, applicationId, templateId: "ATS_STRICT", templateVersion: "ats-strict-v1", language: "pt-BR", status: "READY", contentHash: "spec", resumeSpec: { candidate: { fullName: "Ana", email: "ana@example.test" }, experiences: [{ title: "Suporte" }] }, source: "USER", approvedAt: t });
  store.applications.updateDetails({ ...store.applications.findById(applicationId), resumeVersionId: versionId });
  const artifactDir = path.join(dir, "resumes", resumeId, "versions", versionId), pdf = Buffer.from("%PDF-1.4 catho"), pdfPath = path.join(artifactDir, "resume.pdf");
  await mkdir(artifactDir, { recursive: true }); await writeFile(pdfPath, pdf);
  store.resumeArtifacts.create({ id: "artifact-c", resumeVersionId: versionId, artifactType: "PDF", storagePath: pdfPath, contentHash: createHash("sha256").update(pdf).digest("hex"), sizeBytes: pdf.length, mimeType: "application/pdf", status: "READY" });
  store.applicationPlans.save({ applicationId, selectedResumeId: resumeId, selectedResumeVersionId: versionId, atsType: "catho", decision: "APPLY", matchScore: 90, eligibility: "ELIGIBLE", blockingIssues: [], warnings: [], unknownRequirements: [], policySnapshot: {} });
  const pages = new Map(), browserManager = portalBrowser(pages, dir), rejected = [];
  const registry = new AdapterRegistry({ homologationRecords: (provider) => store.submitHomologations.evidenceRecords(provider) });
  const revalidator = new VaultFinalRevalidator({ provider: "catho", store, dataDir: dir, registry, browserManager, sessionStateProvider: async () => sessionState, onSessionRejected: (provider, context) => rejected.push([provider, context.applicationId]) });
  return { dir, store, pages, browserManager, registry, revalidator, rejected, applicationId, close: async () => { await browserManager.shutdown(); store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("revalidação dos Cofres exige sessão e lê na página se a vaga está aberta", async () => {
  const noSession = await fixture({ sessionState: null });
  try {
    noSession.pages.set(new URL(JOB_URL).pathname, entryLink(""));
    await assert.rejects(noSession.revalidator.inspect(noSession.applicationId), (error) => error.code === "LOGIN_REQUIRED" && error.vaultSessionMissing);
    assert.deepEqual(noSession.browserManager.opened, []);
  } finally { await noSession.close(); }
  const f = await fixture();
  try {
    const pathname = new URL(JOB_URL).pathname;
    f.pages.set(pathname, entryLink(""));
    const live = await f.revalidator.inspect(f.applicationId);
    assert.deepEqual([live.jobCheck.status, live.schema.variant, live.inspection.report.submissionBoundary, live.inspection.report.resumeSource, live.inspection.adapterType], ["OPEN", "apply-entry", true, "PORTAL_PROFILE", "catho"]);
    assert.deepEqual(f.browserManager.opened, [true], "abre com a sessão do Cofre");

    f.pages.set(pathname, page(`<p>Esta vaga foi encerrada</p><a href="#">Quero me candidatar</a>`));
    await assert.rejects(f.revalidator.prepareForSubmit(f.applicationId), (error) => error.code === "CATHO_JOB_NOT_OPEN" && error.phase === "PRE_ACTION");
    f.pages.set(pathname, page(`<p>Você já se candidatou a esta vaga</p><a href="#">Quero me candidatar</a>`));
    await assert.rejects(f.revalidator.prepareForSubmit(f.applicationId), (error) => error.code === "CATHO_ALREADY_APPLIED");
    f.pages.set(pathname, page(`<form><input type="email" aria-label="E-mail"><input type="password" aria-label="Senha"></form>`));
    await assert.rejects(f.revalidator.inspect(f.applicationId), (error) => error.code === "LOGIN_REQUIRED");
    assert.deepEqual(f.rejected, [["catho", f.applicationId]]);
  } finally { await f.close(); }
});

test("travessia progressiva: entrada, etapas e final armados uma vez, cada clique registrado", async () => {
  await withOptIn(async () => {
    const adapter = new AdapterRegistry().get("catho"), browser = await chromium.launch({ headless: true });
    try {
      const tab = await browser.newPage(), pages = new Map();
      await tab.route("https://www.catho.com.br/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: pages.get(new URL(route.request().url()).pathname) }));
      const open = async (pathname, body) => { pages.set(pathname, body); await tab.goto(`https://www.catho.com.br${pathname}`); };
      const run = async (options = {}) => { const steps = []; let armed = 0; const result = await adapter.submit(tab, { onActionTriggered: () => { armed++; }, onStep: (step) => steps.push(`${step.kind}:${step.label}`), fillStep: async () => ({ status: "FILLED" }), confirmationTimeoutMs: 1500, ...options }); return { result, steps, armed }; };
      const questionnaire = "document.body.insertAdjacentHTML('beforeend','<form id=q><label for=r>Por que esta vaga?</label><textarea id=r></textarea><button type=button id=send>Enviar candidatura</button></form>');document.getElementById('send').onclick=()=>{" + showSuccess + "};";

      await open("/vagas/1", entryLink(questionnaire));
      const generic = await run();
      assert.deepEqual([generic.result.status, generic.result.errorCode, generic.armed], ["UNCERTAIN", "CATHO_SUCCESS_UNCONFIRMED", 1]);
      assert.deepEqual(generic.steps, ["ENTRY:Quero me candidatar", "FINAL:Enviar candidatura", "SUCCESS_TEXT_OBSERVED:Candidatura realizada com sucesso!"]);

      // Com o texto de confirmação capturado no perfil, o mesmo fluxo vira SUBMITTED.
      const captured = new AdapterRegistry().get("catho");
      captured.submitProfile = { ...PORTAL_SUBMIT_PROFILES.catho, successText: /^Candidatura realizada com sucesso!$/, receiptText: "Candidatura realizada" };
      await open("/vagas/2", entryLink(questionnaire));
      assert.equal((await captured.submit(tab, { onActionTriggered: () => {}, confirmationTimeoutMs: 1500 })).status, "SUBMITTED");

      const stepTwo = "document.body.innerHTML='<form><label for=c>Cidade</label><input id=c><button type=button id=send>Confirmar candidatura</button></form>';document.getElementById('send').onclick=()=>{" + showSuccess + "};";
      await open("/vagas/3", entryLink(`document.body.insertAdjacentHTML('beforeend','<form><label for=a>Anos de Linux</label><input id=a><button type=button id=next>Próximo</button></form>');document.getElementById('next').onclick=()=>{${stepTwo}};`));
      const multi = await run();
      assert.deepEqual(multi.steps.slice(0, 3), ["ENTRY:Quero me candidatar", "STEP:Próximo", "FINAL:Confirmar candidatura"]);
      assert.equal(multi.armed, 1);

      await open("/vagas/4", entryLink(questionnaire));
      const unknown = await run({ fillStep: async () => ({ status: "USER_REQUIRED" }) });
      assert.deepEqual([unknown.result.status, unknown.result.errorCode, unknown.armed], ["UNCERTAIN", "CATHO_STEP_USER_REQUIRED", 1]);

      await open("/vagas/5", page(`<form><label for=r>Por que esta vaga?</label><textarea id=r></textarea><button type=button>Enviar candidatura</button></form>`));
      let armed = 0;
      await assert.rejects(adapter.submit(tab, { onActionTriggered: () => { armed++; }, fillStep: async () => ({ status: "USER_REQUIRED" }) }), (error) => error.code === "CATHO_STEP_USER_REQUIRED" && error.phase === "PRE_ACTION");
      assert.equal(armed, 0, "sem clique, nada foi armado");
    } finally { await browser.close(); }
  });
});

test("ponta a ponta: consentimento, envio incerto, confirmação manual e homologação do Cofre", async () => {
  await withOptIn(async () => {
    const f = await fixture();
    try {
      const pathname = new URL(JOB_URL).pathname;
      f.pages.set(pathname, entryLink(showSuccess));
      assert.equal(f.registry.describe("catho").canSubmit, true);
      const preflight = new SubmissionPreflight({ store: f.store, dataDir: f.dir, registry: f.registry, revalidator: f.revalidator, policy: { submissionEnabled: true, submissionRateLimitPerHour: 5 } });
      const evaluated = await preflight.evaluate(f.applicationId);
      assert.equal(evaluated.readyForConsent, true, JSON.stringify(evaluated.gates.filter((gate) => gate.status !== "READY")));
      const granted = new SubmissionConsentService({ store: f.store, ttlMs: 600000 }).grant(f.applicationId, evaluated);
      const transport = new AdapterSubmissionTransport({ store: f.store, registry: f.registry, revalidator: f.revalidator, allowExternal: true, confirmationTimeoutMs: 1500 });
      const service = new ControlledSubmissionService({ store: f.store, preflight, transport });
      const result = await service.submit({ applicationId: f.applicationId, consentToken: granted.token, idempotencyKey: "vault-catho-1" });
      assert.equal(result.attempt.status, "UNCERTAIN");
      const events = f.store.applications.events(f.applicationId).map((event) => event.eventType);
      for (const expected of ["SUBMISSION_USES_PORTAL_RESUME", "SUBMIT_ACTION_ARMED", "SUBMIT_STEP"]) assert.ok(events.includes(expected), expected);
      const steps = f.store.applications.events(f.applicationId).filter((event) => event.eventType === "SUBMIT_STEP").map((event) => event.metadata.kind);
      assert.deepEqual(steps, ["ENTRY", "SUCCESS_TEXT_OBSERVED"]);

      // Você confere em "Minhas candidaturas" que chegou: o envio incerto vira recibo e o Cofre pode ser homologado.
      new SubmissionReconciliationService({ store: f.store, transport }).resolve(f.applicationId, { resolution: "SENT" });
      const { homologation } = new SubmitHomologationService({ store: f.store, registry: f.registry }).approve(f.applicationId, { externalConfirmation: "PORTAL_APPLICATION_LIST" });
      assert.deepEqual([homologation.provider, homologation.scenario], ["catho", "apply-entry"]);
      assert.equal(f.registry.describe("catho", { scenario: "apply-entry" }).homologation.automaticSubmitEligible, true);
    } finally { await f.close(); }
  });
});

test("ponta a ponta com a IA local: o texto novo confirmado vira recibo e o Cofre pode ser homologado", async () => {
  await withOptIn(async () => {
    const f = await fixture();
    try {
      const provider = new FakeProvider({ responses: { LAST_MILE_CONFIRMATION: ({ prompt }) => ({ status: "CONFIRMED", textId: JSON.parse(prompt.split("CONTEXTO SANITIZADO:")[1]).texts[0].id, confidence: 0.9, reason: "" }) } });
      const intelligence = new IntelligenceService({ provider, settings: { provider: "fake", fastModel: "fake-fast", balancedModel: "fake-balanced", contextBudget: 4096, policies: {} }, repositories: { cache: { get: () => null, put: () => {} }, runs: { create: (item) => item } }, hardwareProfile: { memoryProfile: "LOW_VRAM", recommendedConcurrency: 1 } });
      f.revalidator.assistant = new LastMileAssistant(() => intelligence);
      f.pages.set(new URL(JOB_URL).pathname, entryLink(showSuccess));
      const preflight = new SubmissionPreflight({ store: f.store, dataDir: f.dir, registry: f.registry, revalidator: f.revalidator, policy: { submissionEnabled: true, submissionRateLimitPerHour: 5 } });
      const granted = new SubmissionConsentService({ store: f.store, ttlMs: 600000 }).grant(f.applicationId, await preflight.evaluate(f.applicationId));
      const transport = new AdapterSubmissionTransport({ store: f.store, registry: f.registry, revalidator: f.revalidator, allowExternal: true, confirmationTimeoutMs: 1500 });
      const result = await new ControlledSubmissionService({ store: f.store, preflight, transport }).submit({ applicationId: f.applicationId, consentToken: granted.token, idempotencyKey: "vault-catho-llm" });
      assert.equal(result.attempt.status, "SUBMITTED");
      assert.deepEqual([result.receipt.confirmationText, result.receipt.metadata.verificationMethod], ["Candidatura realizada com sucesso!", "LLM_CONFIRMED_DOM_V1"]);
      const steps = f.store.applications.events(f.applicationId).filter((event) => event.eventType === "SUBMIT_STEP").map((event) => `${event.metadata.kind}:${event.metadata.source}`);
      assert.deepEqual(steps, ["ENTRY:RULE", "SUCCESS_TEXT_CONFIRMED:MODEL"]);
      const { homologation } = new SubmitHomologationService({ store: f.store, registry: f.registry }).approve(f.applicationId, { externalConfirmation: "PORTAL_APPLICATION_LIST" });
      assert.deepEqual([homologation.provider, homologation.scenario], ["catho", "apply-entry"]);
    } finally { await f.close(); }
  });
});
