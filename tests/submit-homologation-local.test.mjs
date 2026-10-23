import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { SubmissionPreflight } from "../src/application/submission-preflight.mjs";
import { SubmissionConsentService } from "../src/application/submission-consent-service.mjs";
import { ControlledSubmissionService } from "../src/application/controlled-submission-service.mjs";
import { FixtureSubmissionTransport } from "../src/application/submission-transport.mjs";
import { SubmitHomologationService } from "../src/application/submit-homologation-service.mjs";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";
import { submitHomologation } from "../src/automation/ats/submit-homologation.mjs";
import { AutoApplyOrchestrator } from "../src/automation/auto-apply-orchestrator.mjs";
import { GupyApplicationAdapter } from "../src/automation/ats/gupy/gupy-application-adapter.mjs";
import { createSubmitHomologationRoutes } from "../server/routes/submit-homologation-routes.mjs";

const preflightRegistry = { describe: (type) => ({ implemented: true, canSubmit: true, canInspect: true, canFill: true, canValidate: true, level: "CONTROLLED_SUBMIT", label: type }) };
const SCENARIO = "hosted-form";

// Mesmo caminho do Application V2: preflight, consentimento e Controlled Submit com transporte de fixture.
async function fixture({ adapterVersion = new AdapterRegistry().version("greenhouse"), submit = true } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "submit-homologation-")), store = await new UnifiedStateStore({ dataDir }).initialize();
  const t = new Date(Date.now() - 60000).toISOString(), resumeId = "resume-h", versionId = "version-h", applicationId = "application-h", jobId = "job-h";
  store.jobs.upsert({ id: jobId, title: "Platform Engineer", company: "Acme", description: "Linux", url: "https://boards.greenhouse.io/acme/jobs/42", canonicalUrl: "https://boards.greenhouse.io/acme/jobs/42", status: "open", lifecycleStatus: "OPEN", createdAt: t, updatedAt: t });
  store.resumes.upsert({ id: resumeId, title: "Base", text: "Platform Engineer", createdAt: t, updatedAt: t });
  store.applications.create({ id: applicationId, jobId, resumeId, status: "READY_TO_SUBMIT", createdAt: t, updatedAt: t }, {}, { allowHistorical: true });
  store.resumeVersions.create({ id: versionId, resumeId, jobId, applicationId, templateId: "ATS_STRICT", templateVersion: "ats-strict-v1", language: "pt-BR", status: "READY", contentHash: "spec-hash", resumeSpec: { candidate: { fullName: "Ana", email: "ana@example.test" }, experiences: [{ title: "Engineer" }] }, source: "USER", approvedAt: t });
  store.applications.updateDetails({ ...store.applications.findById(applicationId), resumeVersionId: versionId });
  const artifactDir = path.join(dataDir, "resumes", resumeId, "versions", versionId), pdf = Buffer.from("%PDF-1.4 fixture"), pdfPath = path.join(artifactDir, "resume.pdf");
  await mkdir(artifactDir, { recursive: true }); await writeFile(pdfPath, pdf);
  store.resumeArtifacts.create({ id: "artifact-h", resumeVersionId: versionId, artifactType: "PDF", storagePath: pdfPath, contentHash: createHash("sha256").update(pdf).digest("hex"), sizeBytes: pdf.length, mimeType: "application/pdf", status: "READY" });
  store.applicationPlans.save({ applicationId, selectedResumeId: resumeId, selectedResumeVersionId: versionId, atsType: "greenhouse", decision: "APPLY", matchScore: 90, eligibility: "ELIGIBLE", blockingIssues: [], warnings: [], unknownRequirements: [], policySnapshot: {} });
  store.applicationInspections.create({ applicationId, adapterType: "greenhouse", adapterVersion, detectedVariant: SCENARIO, compatibilityConfidence: 0.95, health: "HEALTHY", domSignature: "fixture-signature", report: { fieldsFound: 0, requiredFields: 0, knownFields: 0, unknownFields: 0, formStructureHash: "fixture-structure" } });
  const revalidator = { inspect: async () => ({ inspection: store.applicationInspections.latest(applicationId), jobCheck: { status: "OPEN", checkedAt: new Date().toISOString(), authority: "fixture", reference: "fixture-job" }, formStructureHash: "fixture-structure" }) };
  const preflight = new SubmissionPreflight({ store, dataDir, registry: preflightRegistry, revalidator, policy: { submissionEnabled: true, submissionRateLimitPerHour: 5 } });
  if (submit) {
    const evaluated = await preflight.evaluate(applicationId), granted = new SubmissionConsentService({ store, ttlMs: 600000 }).grant(applicationId, evaluated);
    const transport = new FixtureSubmissionTransport(async (command) => { command.onActionTriggered(); return { status: "SUBMITTED", receipt: { externalReference: "gh-42", confirmationUrl: "https://example.test/receipt", confirmationText: "Application received" } }; });
    const result = await new ControlledSubmissionService({ store, preflight, transport }).submit({ applicationId, consentToken: granted.token, idempotencyKey: "homologation-submit" });
    assert.equal(result.attempt.status, "SUBMITTED");
  }
  const registry = new AdapterRegistry({ homologationRecords: (provider) => store.submitHomologations.evidenceRecords(provider) });
  const service = new SubmitHomologationService({ store, registry });
  return { store, registry, service, applicationId, close: async () => { store.close(); await rm(dataDir, { recursive: true, force: true }); } };
}

const eligible = (registry, provider = "greenhouse", scenario = SCENARIO) => registry.describe(provider, { scenario }).homologation.automaticSubmitEligible;

test("envio confirmado vira homologação local e libera o envio automático só daquele portal e cenário", async () => {
  const f = await fixture();
  try {
    assert.equal(eligible(f.registry), false);
    const first = f.service.approve(f.applicationId, { externalConfirmation: "PORTAL_APPLICATION_LIST", validDays: 30 });
    assert.equal(first.reused, false);
    assert.equal(first.homologation.scenario, SCENARIO);
    assert.equal(eligible(f.registry), true);
    assert.equal(f.registry.describe("greenhouse", { scenario: SCENARIO }).homologation.status, "APPROVED");
    assert.equal(eligible(f.registry, "greenhouse", "outro-cenario"), false);
    assert.equal(eligible(f.registry, "lever"), false);
    assert.equal(f.service.approve(f.applicationId, { externalConfirmation: "CONFIRMATION_EMAIL" }).reused, true);
    assert.ok(f.store.applications.events(f.applicationId).some((event) => event.eventType === "SUBMIT_HOMOLOGATION_APPROVED"));
    // O orquestrador usa o mesmo registry para decidir o envio por limiar de nota.
    const orchestrator = new AutoApplyOrchestrator({ store: f.store, applicationEngine: { registry: f.registry } });
    assert.equal(orchestrator.automaticSubmitVerified("greenhouse", f.applicationId), true);
  } finally { await f.close(); }
});

test("homologação exige recibo, confirmação fora da página e validade sensata", async () => {
  const pending = await fixture({ submit: false });
  try {
    assert.throws(() => pending.service.approve(pending.applicationId, { externalConfirmation: "PORTAL_APPLICATION_LIST" }), (error) => error.code === "SUBMIT_HOMOLOGATION_RECEIPT_REQUIRED");
  } finally { await pending.close(); }
  const f = await fixture();
  try {
    assert.throws(() => f.service.approve(f.applicationId, {}), (error) => error.code === "SUBMIT_HOMOLOGATION_CONFIRMATION_REQUIRED");
    for (const validDays of [0, 91, 2.5]) assert.throws(() => f.service.approve(f.applicationId, { externalConfirmation: "CONFIRMATION_EMAIL", validDays }), (error) => error.code === "SUBMIT_HOMOLOGATION_VALIDITY_INVALID");
    assert.equal(eligible(f.registry), false);
  } finally { await f.close(); }
});

test("envio feito por versão antiga do adapter não homologa a versão atual", async () => {
  const f = await fixture({ adapterVersion: "greenhouse-adapter-antigo" });
  try {
    assert.throws(() => f.service.approve(f.applicationId, { externalConfirmation: "PORTAL_APPLICATION_LIST" }), (error) => error.code === "SUBMIT_HOMOLOGATION_ADAPTER_CHANGED");
  } finally { await f.close(); }
});

test("revogar ou vencer a validade bloqueia de novo o envio automático", async () => {
  const f = await fixture();
  try {
    const { homologation } = f.service.approve(f.applicationId, { externalConfirmation: "RECRUITER_CONTACT", validDays: 1 });
    const later = Date.parse(homologation.validUntil) + 1000;
    assert.equal(submitHomologation("greenhouse", f.registry.version("greenhouse"), { scenario: SCENARIO, now: later, records: f.store.submitHomologations.evidenceRecords("greenhouse") }).automaticSubmitEligible, false);
    assert.equal(new SubmitHomologationService({ store: f.store, registry: f.registry, clock: () => new Date(later) }).list()[0].active, false);
    assert.equal(f.service.list()[0].active, true);
    f.service.revoke(homologation.id, { reason: "portal mudou o formulário" });
    assert.equal(eligible(f.registry), false);
    assert.equal(f.service.list({ provider: "GREENHOUSE" })[0].status, "REVOKED");
    assert.ok(f.store.applications.events(f.applicationId).some((event) => event.eventType === "SUBMIT_HOMOLOGATION_REVOKED"));
  } finally { await f.close(); }
});

test("Gupy homologa pelo rascunho V2 do Application Batch", async () => {
  const now = Date.now(), receipt = { id: "receipt-gupy", provider: "gupy", submissionAttemptId: "attempt-gupy", submittedAt: new Date(now - 60000).toISOString(), receiptHash: "hash-gupy" };
  const saved = new Map(), events = [];
  let draft = { adapterVersion: GupyApplicationAdapter.version, flow: { stepsVisited: 3 }, readyAt: new Date(now - 120000).toISOString() };
  const store = {
    submissionReceipts: { latest: () => receipt },
    submissionAttempts: { findById: () => ({ status: "SUBMITTED" }) },
    applicationBatches: { forApplication: () => draft },
    applications: { recordEvent: (...args) => events.push(args) },
    submitHomologations: { forReceipt: (id) => [...saved.values()].find((item) => item.submissionReceiptId === id) || null, create: (item) => { const record = { id: `h-${saved.size + 1}`, status: "APPROVED", ...item }; saved.set(record.id, record); return record; }, list: () => [...saved.values()] },
  };
  const service = new SubmitHomologationService({ store, registry: new AdapterRegistry() });
  const { homologation } = service.approve("application-gupy", { externalConfirmation: "PORTAL_APPLICATION_LIST" });
  assert.deepEqual([homologation.provider, homologation.adapterVersion, homologation.scenario], ["gupy", GupyApplicationAdapter.version, "multi-step"]);
  assert.equal(service.list()[0].active, true);
  saved.clear();
  draft = { ...draft, adapterVersion: "gupy-application-v2" };
  assert.throws(() => service.approve("application-gupy", { externalConfirmation: "PORTAL_APPLICATION_LIST" }), (error) => error.code === "SUBMIT_HOMOLOGATION_ADAPTER_CHANGED");
  draft = null;
  assert.throws(() => service.approve("application-gupy", { externalConfirmation: "PORTAL_APPLICATION_LIST" }), (error) => error.code === "SUBMIT_HOMOLOGATION_INSPECTION_MISSING");
});

test("rotas de homologação exigem JSON da própria origem", async () => {
  const f = await fixture();
  try {
    const responses = [], json = (res, body, status = 200) => responses.push({ status, body }), sendError = (res, error, fallback) => responses.push({ status: fallback.status, body: { code: error.code } });
    const routes = createSubmitHomologationRoutes({ service: f.service, readJson: async () => ({ externalConfirmation: "PORTAL_APPLICATION_LIST" }), json, sendError });
    const url = new URL(`http://127.0.0.1:7123/api/applications/${f.applicationId}/submit-homologation`), socket = { localPort: 7123 };
    assert.equal(await routes({ method: "POST", headers: { host: "127.0.0.1:7123", "content-type": "text/plain", origin: "https://evil.test" }, socket }, null, url), true);
    assert.deepEqual([responses.at(-1).status, responses.at(-1).body.code], [403, "SAME_ORIGIN_REQUIRED"]);
    assert.equal(eligible(f.registry), false);
    await routes({ method: "POST", headers: { host: "127.0.0.1:7123", "content-type": "application/json" }, socket }, null, url);
    assert.equal(responses.at(-1).status, 201);
    await routes({ method: "GET", headers: { host: "127.0.0.1:7123" }, socket }, null, new URL("http://127.0.0.1:7123/api/submit-homologations"));
    assert.equal(responses.at(-1).body.items[0].active, true);
    assert.equal(await routes({ method: "GET", headers: {}, socket }, null, new URL("http://127.0.0.1:7123/api/outra-coisa")), false);
  } finally { await f.close(); }
});
