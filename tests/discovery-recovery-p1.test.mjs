import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { JobHuntService } from "../src/automation/job-hunt-service.mjs";
import { SourceResolver } from "../src/discovery/source-resolver.mjs";
import { discoveryRecovery } from "../src/discovery/discovery-recovery.mjs";
import { mergeJobFields } from "../src/discovery/field-merge.mjs";
import { duplicateOpportunityKey, distinctOpportunityJobs } from "../src/opportunities/opportunity-freshness.mjs";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";
import { jobInformationQuality } from "../src/matching/job-information-quality.mjs";
import { atsAnalysisStatus, CURRENT_MATCHER_VERSION, CURRENT_REQUIREMENT_EXTRACTOR_VERSION } from "../src/matching/analysis-version.mjs";
import { GupyPublicProvider } from "../src/discovery/providers/gupy-public-provider.mjs";
import { SmartRecruitersProvider } from "../src/discovery/providers/direct-ats-providers.mjs";
import { DiscoveryService } from "../src/discovery/discovery-service.mjs";
import { createAutopilotRoutes, summarizeJobHuntRun } from "../server/routes/autopilot-routes.mjs";

const description = "Atendimento de suporte técnico aos colaboradores, resolução de incidentes em Windows e Linux, administração de usuários no Active Directory e documentação dos chamados de Service Desk.";

test("descrição ausente ou curta não autoriza confiança alta nem score automático", () => {
  for (const text of ["", "Tecnologia\nvacancy_type_effective", "<p>Linux</p>"]) {
    const analysis = runAtsMatcherV2({ job: { id: "job", title: "Analista de Suporte Junior", description: text, location: "Brasil" }, profile: { career: { skills: "Linux Windows Active Directory", targetRoles: "Analista de Suporte" } } });
    assert.ok(analysis.overallScore <= 59);
    assert.ok(analysis.matchConfidence <= 35);
    assert.equal(analysis.confidenceBand, "LOW");
    assert.equal(analysis.dimensions.jobInformation.sufficient, false);
    assert.ok(analysis.warnings.some(warning => warning.includes("descrição")));
  }
  assert.equal(jobInformationQuality({ description }).sufficient, true);
});

test("score anterior exige recálculo sem apagar histórico", () => {
  assert.equal(atsAnalysisStatus({ matcherVersion: CURRENT_MATCHER_VERSION, scoringModelVersion: "confidence-calibrated-v1", requirementExtractorVersion: CURRENT_REQUIREMENT_EXTRACTOR_VERSION }), "RECALCULATION_REQUIRED");
});

test("Lever /apply preserva ID real e SmartRecruiters ignora slug do cargo", () => {
  const resolver = new SourceResolver();
  assert.equal(resolver.resolve("https://jobs.lever.co/acme/first-job/apply").providerJobId, "first-job");
  assert.equal(resolver.resolve("https://jobs.lever.co/acme/second-job/apply").providerJobId, "second-job");
  assert.equal(resolver.resolve("https://jobs.smartrecruiters.com/Acme/744000123456789-support").providerJobId, "744000123456789");
});

test("dedup remoto reconhece Brasil e localização vazia sem juntar cidades diferentes", () => {
  const base = { company: "SoftExpert", title: "Desenvolvedor Full Stack Junior" };
  const key = duplicateOpportunityKey({ ...base, location: "", workModel: "Remoto" });
  assert.equal(key, duplicateOpportunityKey({ ...base, location: "Remoto - Brasil", workModel: "REMOTE" }));
  assert.equal(key, duplicateOpportunityKey({ ...base, location: "Brasil", workModel: "REMOTE" }));
  const distinct = distinctOpportunityJobs([{ ...base, id: "linkedin", provider: "jobspy", location: "", workModel: "Remoto" }, { ...base, id: "gupy", provider: "gupy", location: "Brasil", workModel: "REMOTE", description }]);
  assert.equal(distinct.length, 1);
  assert.equal(distinct[0].id, "gupy");
  assert.notEqual(key, duplicateOpportunityKey({ ...base, location: "Portugal", workModel: "REMOTE" }));
  assert.notEqual(duplicateOpportunityKey({ ...base, location: "Brasilia", workModel: "ONSITE" }), duplicateOpportunityKey({ ...base, location: "Sao Paulo", workModel: "ONSITE" }));
});

test("catálogo resumido não sobrescreve descrição enriquecida", () => {
  assert.equal(mergeJobFields({ provider: "gupy", description }, { provider: "gupy", description: "Tecnologia" }).description, description);
});

test("erros externos têm tratamentos distintos e vazio não vira indisponibilidade", () => {
  assert.equal(discoveryRecovery("HTTP_502").retryable, true);
  assert.equal(discoveryRecovery("HTTP_403").retryable, false);
  assert.equal(discoveryRecovery("HTTP_404").action, "CHECK_BOARD");
  assert.equal(discoveryRecovery("PORTAL_LOCATION_UNSUPPORTED").action, "ADJUST_LOCATION");
  assert.equal(discoveryRecovery("", "EMPTY").action, "REFINE_QUERY");
});

test("Gupy recupera texto público completo e rejeita identidade divergente", async () => {
  let id = 42;
  const provider = new GupyPublicProvider({ client: { getText: async () => ({ url: "https://acme.gupy.io/jobs/42", data: `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { subdomain: "acme", job: { id, description: "<p>Suporte</p>", responsibilities: description, prerequisites: "Linux Windows" } } } })}</script>` }) } });
  const job = { id: "job", companyIdentity: "acme", providerJobId: "42" };
  assert.ok((await provider.resolveJob(job)).description.includes(description));
  id = 43;
  await assert.rejects(() => provider.resolveJob(job), error => error.code === "GUPY_PUBLIC_JOB_IDENTITY_MISMATCH");
});

test("SmartRecruiters recupera descrição e qualificações do posting", async () => {
  const provider = new SmartRecruitersProvider({ client: { getJson: async () => ({ data: { id: "42", jobAd: { sections: { jobDescription: { text: description }, qualifications: { text: "Linux e Windows" } } } } }) } });
  assert.ok((await provider.resolveJob({ companyIdentity: "acme", providerJobId: "42" })).description.includes("Requisitos:"));
});

test("enriquecimento registra snapshot e expiração explícita antes do ranking", async () => {
  const snapshots = [];
  const service = new DiscoveryService({
    registry: { get: () => ({ resolveJob: async () => ({ description, expiresAt: "2020-01-01T00:00:00Z" }) }) },
    repositories: { snapshot: (...args) => snapshots.push(args) },
    jobRepository: { upsert: job => job },
  });
  const enriched = await service.enrichJob({ id: "job", title: "Suporte", description: "Tecnologia", lifecycleStatus: "OPEN", url: "https://acme.gupy.io/jobs/42" });
  assert.equal(enriched.description, description);
  assert.equal(enriched.lifecycleStatus, "CLOSED");
  assert.equal(enriched.availability.status, "CLOSED");
  assert.ok(enriched.contentHash);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0][3], "UPDATED");
});

test("Mass Hunt isola falhas repetidas e busca direcionada não altera agenda", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "discovery-recovery-"));
  const store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  try {
    const called = [];
    const service = new JobHuntService({ store, matcher: () => null, profileProvider: async () => ({}), discoveryService: { discover: async input => {
      const provider = input.providers[0]; called.push(provider);
      return { run: { id: `discovery-${called.length}` }, jobs: [], discoveredCount: 0, ok: provider !== "recrutei", sourceReports: [{ provider, status: provider === "recrutei" ? "ERROR" : "EMPTY", errorCode: provider === "recrutei" ? "HTTP_502" : "" }] };
    } } });
    const profile = service.saveProfile({ name: "Recovery", jobFamilies: ["SUPPORT"], seniorities: ["JUNIOR"], sourcePreferences: ["recrutei", "nerdin"], companyWatchlistIds: ["watchlist-original"], queries: ["suporte", "help desk", "service desk", "analista suporte"], queryBudget: { maxQueries: 6, maxQueriesPerProvider: 6, maxRequests: 12 }, enabled: false });
    const result = await service.run(profile.id);
    assert.equal(called.filter(provider => provider === "recrutei").length, 2);
    assert.ok(called.filter(provider => provider === "nerdin").length > 2);
    assert.equal(result.status, "PARTIAL");
    assert.ok(result.report.sourceReports.find(source => source.provider === "recrutei").skippedRequests > 0);
    assert.equal(result.report.failedRequests[0].recovery.action, "RETRY_LATER");
    const summary = summarizeJobHuntRun(store.jobHuntRuns.list(profile.id, { summary: true })[0]);
    assert.equal(summary.report, undefined);
    assert.equal(summary.sourceRecovery.find(source => source.provider === "recrutei").recovery.action, "RETRY_LATER");
    assert.throws(() => service.queueSource(result.id, "unknown"), error => error.code === "JOB_HUNT_SOURCE_INVALID");
    const original = JSON.stringify(store.jobHuntProfiles.findById(profile.id));
    const targeted = service.queueSource(result.id, "recrutei");
    assert.equal(service.queueSource(result.id, "recrutei").id, targeted.id);
    const targetProfile = store.jobHuntProfiles.findById(targeted.profileId);
    assert.deepEqual(targetProfile.sourcePreferences, ["recrutei"]);
    assert.equal(targetProfile.enabled, false);
    assert.equal(targetProfile.prepareResume, false);
    assert.deepEqual(targetProfile.companyWatchlistIds, []);
    assert.equal(JSON.stringify(store.jobHuntProfiles.findById(profile.id)), original);
    while (store.jobHuntRuns.findById(targeted.id).status === "RUNNING") await new Promise(resolve => setTimeout(resolve, 10));
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("endpoint de busca por fonte retorna 202 e rejeita origem externa", async () => {
  let response, queued = 0;
  const route = createAutopilotRoutes({ store: {}, jobHuntService: { queueSource: (id, source) => { queued++; assert.equal(id, "run"); assert.equal(source, "nerdin"); return { id: "targeted", status: "RUNNING" }; } }, readJson: async () => ({ source: "nerdin" }), json: (res, body, status) => { response = { body, status }; }, sendError: (res, error, data) => { response = data; } });
  const url = new URL("http://127.0.0.1:7123/api/job-hunt/runs/run/source");
  const req = { method: "POST", headers: { host: "127.0.0.1:7123", origin: url.origin, "content-type": "application/json" }, socket: { localPort: 7123 } };
  await route(req, {}, url);
  assert.equal(response.status, 202);
  assert.equal(response.body.runId, "targeted");
  await route({ ...req, headers: { ...req.headers, origin: "https://external.example" } }, {}, url);
  assert.equal(response.code, "SAME_ORIGIN_REQUIRED");
  assert.equal(queued, 1);
});
