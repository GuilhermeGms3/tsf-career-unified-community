import assert from "node:assert/strict";
import test from "node:test";
import {
  ATS_ANALYSIS_STATUS,
  CURRENT_MATCHER_VERSION,
  CURRENT_REQUIREMENT_EXTRACTOR_VERSION,
  CURRENT_SCORING_MODEL_VERSION,
  atsAnalysisStatus,
} from "../src/matching/analysis-version.mjs";
import { extractJobRequirements } from "../src/matching/job-requirement-extractor.mjs";
import { calibrateMatchScore, SCORING_MODEL_CONFIG } from "../src/matching/scoring-engine.mjs";
import { assessJobAnalyzability, buildProviderQualityReport } from "../src/discovery/provider-quality-service.mjs";
import { buildDailyDecisionSummary } from "../src/product/daily-decision-service.mjs";
import { buildDailyPlan, buildOpportunityTrend, buildSearchQueue } from "../src/product/daily-decision-service.mjs";
import { classifyGeography } from "../src/discovery/relevance/pre-match-plausibility.mjs";
import { WeeklyTechRadarService } from "../src/product/weekly-tech-radar-service.mjs";
import { benchmarkOriginType, isOfficialBenchmarkRecord, ndcgAt, runBenchmarkPipeline } from "../scripts/job-quality-benchmark.mjs";
import { AtsRecalculationService } from "../src/matching/ats-recalculation-service.mjs";
import { QualityLabelService } from "../src/benchmark/quality-label-service.mjs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LMStudioProvider, OpenAICompatibleLocalProvider } from "../src/intelligence/providers/openai-compatible-local-provider.mjs";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";

const currentVersions = {
  matcherVersion: CURRENT_MATCHER_VERSION,
  scoringModelVersion: CURRENT_SCORING_MODEL_VERSION,
  requirementExtractorVersion: CURRENT_REQUIREMENT_EXTRACTOR_VERSION,
};

test("analysis current exige matcher, scoring model e extractor atuais", () => {
  assert.equal(atsAnalysisStatus(currentVersions), ATS_ANALYSIS_STATUS.CURRENT);
  assert.equal(atsAnalysisStatus({ ...currentVersions, scoringModelVersion: "" }), ATS_ANALYSIS_STATUS.RECALCULATION_REQUIRED);
  assert.equal(atsAnalysisStatus({ algorithmVersion: CURRENT_MATCHER_VERSION }), ATS_ANALYSIS_STATUS.LEGACY);
});

test("headings reais encerram required e classificam required/preferred", () => {
  const cases = [
    ["Requirements:\nDocker\nAbout the role:\nUse Kubernetes.", "docker", "kubernetes"],
    ["Requirements:\nLinux\nYour responsibilities:\nMaintain Kubernetes.", "linux", "kubernetes"],
  ];
  for (const [description, requiredName, contextName] of cases) {
    const requirements = extractJobRequirements({ id: requiredName, title: "Engineer", description });
    assert.equal(requirements.find((item) => item.normalizedName === requiredName)?.required, true);
    assert.equal(requirements.find((item) => item.normalizedName === contextName)?.required, false);
  }
  for (const [heading, skill, importance] of [
    ["Basic Qualifications", "java", "required"],
    ["Minimum Requirements", "postgresql", "required"],
    ["## Nice to have", "terraform", "preferred"],
    ["Desired Skills", "aws", "preferred"],
  ]) {
    const requirements = extractJobRequirements({ id: skill, title: "Engineer", description: `${heading}:\n${skill}` });
    assert.equal(requirements.find((item) => item.normalizedName === skill)?.importance, importance);
  }
});

test("skills conhecidas dominam spans e não geram fragmentos gramaticais", () => {
  const requirements = extractJobRequirements({
    id: "false-skills",
    title: "Backend Engineer",
    description: "Experience working with Node.js applications.\nStrong knowledge of Spring Boot and REST APIs.\nNice to have:\nExperience with AWS is preferred.\nFamiliarity with Kubernetes is a plus.",
  });
  for (const name of ["nodejs", "spring", "rest-api", "aws", "kubernetes"])
    assert.ok(requirements.some((item) => item.normalizedName === name), name);
  assert.equal(requirements.find((item) => item.normalizedName === "aws")?.importance, "preferred");
  assert.equal(requirements.find((item) => item.normalizedName === "kubernetes")?.importance, "preferred");
  assert.ok(!requirements.some((item) => /experience-working|applications|strong-knowledge|spring-boot-and|kubernetes-is/.test(item.normalizedName)));
});

test("calibração versionada respeita invariantes matemáticos", () => {
  assert.equal(SCORING_MODEL_CONFIG.version, CURRENT_SCORING_MODEL_VERSION);
  assert.ok(calibrateMatchScore(95, { evidenceCoverage: 20, matchConfidence: 14 }).calibratedMatchScore < 70);
  assert.ok(calibrateMatchScore(95, { evidenceCoverage: 90, matchConfidence: 90 }).calibratedMatchScore > calibrateMatchScore(95, { evidenceCoverage: 20, matchConfidence: 20 }).calibratedMatchScore);
  assert.ok(calibrateMatchScore(20, { evidenceCoverage: 95, matchConfidence: 95 }).calibratedMatchScore < 30);
  assert.equal(calibrateMatchScore(95, { evidenceCoverage: 0, matchConfidence: 0 }).calibratedMatchScore, 50);
  for (let known = -20; known <= 120; known += 5) {
    let previousReliability = -1;
    for (let coverage = 0; coverage <= 100; coverage += 5) {
      const result = calibrateMatchScore(known, { evidenceCoverage: coverage, matchConfidence: 73 });
      assert.ok(result.calibratedMatchScore >= 0 && result.calibratedMatchScore <= 100);
      assert.ok(result.reliability >= previousReliability);
      previousReliability = result.reliability;
    }
  }
});

test("provider técnico e portal de origem têm métricas separadas e honestas", () => {
  const now = new Date().toISOString();
  const description = "Requirements: Java, Spring Boot, PostgreSQL and REST APIs. Experience building reliable backend services in production environments.";
  const report = buildProviderQualityReport({ jobs: [
    { id: "indeed", provider: "jobspy", discoveredVia: "indeed", title: "Backend", description, location: "Brasil", canonicalUrl: "https://example.test/1", lifecycleStatus: "OPEN", lastSeenAt: now, availability: { status: "AVAILABLE", checkedAt: now } },
    { id: "linkedin", provider: "jobspy", discoveredVia: "linkedin", title: "Backend", description, location: "Brasil", canonicalUrl: "https://example.test/2", lifecycleStatus: "OPEN", lastSeenAt: now },
  ] });
  assert.equal(report.providers.find((item) => item.providerId === "jobspy").foundCount, 2);
  assert.deepEqual(report.sourcePortals.map((item) => item.sourcePortal).sort(), ["indeed", "linkedin"]);
  assert.equal(report.providers[0].recentlySeenOpenRate, 100);
  assert.equal(report.providers[0].verifiedAvailableRate, 50);
  assert.equal(assessJobAnalyzability({ provider: "jobspy", title: "Backend", description: "" }).reasons.includes("DESCRIPTION_MISSING"), true);
});

test("Daily Decision exclui bloqueadas e escolhe a melhor vaga pelo ranking backend", () => {
  const opportunity = (id, priority, disposition = "RECOMMENDED") => ({
    job: { id, title: id, company: "Acme", lifecycleStatus: "OPEN", createdAt: new Date().toISOString() },
    analysis: { ...currentVersions, analysisStatus: "CURRENT", calibratedMatchScore: priority, evidenceCoverage: 90, matchConfidence: 85, matched: ["java"] },
    priority: { score: priority, rankingReasons: ["HIGH_CALIBRATED_MATCH"], rankingWarnings: [] },
    decision: { disposition, visibility: { today: disposition !== "BLOCKED" }, hardBlockers: disposition === "BLOCKED" ? ["ROLE_FAMILY_MISMATCH"] : [], gapSummary: { items: [] } },
    freshness: { current: true }, feedback: null,
  });
  const summary = buildDailyDecisionSummary({ opportunities: [opportunity("second", 82), opportunity("best", 91), opportunity("blocked", 99, "BLOCKED")] });
  assert.equal(summary.bestOpportunity.job.id, "best");
  assert.equal(summary.worthAttention, 2);
  assert.equal(summary.automaticallyExcluded, 1);
  assert.ok(!summary.triageQueue.some((item) => item.job.id === "blocked"));
});

test("Daily Decision remove vagas já decididas da melhor vaga e da triagem", () => {
  const opportunity = (id, priority, userDecision = "") => ({
    job: { id, title: id, company: "Acme", lifecycleStatus: "OPEN" },
    analysis: { ...currentVersions, analysisStatus: "CURRENT", calibratedMatchScore: priority, evidenceCoverage: 90, matchConfidence: 85, matched: [] },
    priority: { score: priority, rankingReasons: [], rankingWarnings: [] },
    decision: { disposition: "RECOMMENDED", visibility: { today: true }, hardBlockers: [], gapSummary: { items: [] } },
    freshness: { current: true },
    feedback: userDecision ? { userDecision, updatedAt: new Date().toISOString() } : null,
  });
  const summary = buildDailyDecisionSummary({
    opportunities: [opportunity("decided", 99, "APPLY"), opportunity("pending", 80)],
  });
  assert.equal(summary.bestOpportunity.job.id, "pending");
  assert.deepEqual(summary.triageQueue.map((item) => item.job.id), ["pending"]);
});

test("Daily Decision exclui localizações estrangeiras explícitas sem confundir Santa Catarina", () => {
  const locationPolicy = { priorities: [{ priority: 1, location: "Brasília, DF", workModel: "ONSITE", accepted: true }, { priority: 2, location: "Brasil", workModel: "REMOTE", remoteScope: "Brasil", accepted: true }] };
  const base = { analysis: null, priority: { score: 50 }, decision: { disposition: "REVIEW", visibility: { today: true }, hardBlockers: [], gapSummary: { items: [] } }, freshness: { current: true }, feedback: null };
  const opportunities = [
    { ...base, job: { id: "south-carolina", title: "NOC", location: "Charleston, South Carolina Metropolitan Area", lifecycleStatus: "OPEN" } },
    { ...base, job: { id: "washington", title: "NOC", location: "Washington, DC", lifecycleStatus: "OPEN" } },
    { ...base, job: { id: "pittsburgh", title: "NOC", location: "Pittsburgh, PA", provider: "jobspy", workModel: "Remote", lifecycleStatus: "OPEN" } },
    { ...base, job: { id: "norwood", title: "NOC", location: "Norwood, MA", provider: "jobspy", workModel: "Remote", lifecycleStatus: "OPEN" } },
    { ...base, job: { id: "florianopolis", title: "Suporte", location: "Florianópolis, SC", workModel: "Remoto", lifecycleStatus: "OPEN" } },
    { ...base, job: { id: "sao-luis", title: "Suporte", location: "São Luís, MA", provider: "jobspy", workModel: "Remoto", lifecycleStatus: "OPEN" } },
  ];
  const summary = buildDailyDecisionSummary({ opportunities, locationPolicy });
  assert.deepEqual(summary.triageQueue.map((item) => item.job.id), ["florianopolis", "sao-luis"]);
  assert.equal(classifyGeography(opportunities[0].job, locationPolicy).geographicMatch.reasonCodes[0], "FOREIGN_LOCATION");
  assert.equal(classifyGeography(opportunities[4].job, locationPolicy).geographicMatch.normalizedCountry, "BR");
});

test("planejamento diário usa histórico real e prioriza consultas menos executadas", () => {
  const now = new Date("2026-09-10T12:00:00.000Z");
  const opportunities = ["2026-09-04", "2026-09-08", "2026-09-09", "2026-09-10"].map((date, index) => ({ job: { id: String(index), firstSeenAt: `${date}T10:00:00.000Z` } }));
  const trend = buildOpportunityTrend(opportunities, now);
  assert.equal(trend.days.length, 7);
  assert.equal(trend.recent, 3);
  assert.equal(trend.direction, "UP");
  const queue = buildSearchQueue({
    profile: { id: "profile", name: "Principal", enabled: true, lastRunAt: "2026-09-08T10:00:00.000Z" },
    runs: [], plannerState: { familySelectionCounts: { SUPPORT: 8, BACKEND: 1 } }, now,
    expandedQueries: [{ query: "Suporte N1", familyId: "SUPPORT", tier: "TIER_1" }, { query: "Backend junior", familyId: "BACKEND", tier: "TIER_1" }],
  });
  assert.equal(queue.status, "UPDATE_RECOMMENDED");
  assert.equal(queue.recommendedQueries[0].query, "Backend junior");
});

test("radar semanal usa conteúdo público real e falha sem bloquear a Home", async () => {
  const service = new WeeklyTechRadarService({ fetchImpl: async () => ({ ok: true, json: async () => [{ id: 1, title: "Node.js hoje", url: "https://dev.to/test/node", user: { name: "Dev" }, tag_list: ["node"], comments_count: 3, public_reactions_count: 8 }] }), now: () => new Date("2026-09-10T12:00:00.000Z") });
  const result = await service.get();
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.items[0].comments, 3);
  const unavailable = await new WeeklyTechRadarService({ fetchImpl: async () => { throw Object.assign(new Error("offline"), { code: "OFFLINE" }); } }).get();
  assert.equal(unavailable.status, "UNAVAILABLE");
});

test("plano diário não inventa triagem quando todas as vagas já foram decididas", () => {
  const plan = buildDailyPlan({
    summary: { worthAttention: 2, reviewRequired: 3, triageQueue: [], dailyProgress: { prepared: 0, applied: 0 }, bestOpportunity: null },
    searchQueue: { status: "SCHEDULED" },
  });
  assert.equal(plan.some((item) => item.kind === "TRIAGE"), false);
});

test("benchmark end-to-end executa matcher atual e fixture não conta como vaga real", () => {
  const job = { id: "real", provider: "jobspy", discoveredVia: "indeed", title: "Backend Developer", company: "Acme", location: "Brasil", description: "Requirements:\nJava\nSpring Boot\nPostgreSQL\nREST APIs\nBuild reliable backend services in a collaborative production environment.", lifecycleStatus: "OPEN" };
  const result = runBenchmarkPipeline({ job }, { career: { skills: ["Java", "Spring Boot", "PostgreSQL"] } });
  assert.equal(result.analysis.matcherVersion, CURRENT_MATCHER_VERSION);
  assert.equal(result.analysis.scoringModelVersion, CURRENT_SCORING_MODEL_VERSION);
  assert.equal(result.analysis.requirementExtractorVersion, CURRENT_REQUIREMENT_EXTRACTOR_VERSION);
  assert.ok(Array.isArray(result.priority.rankingReasons));
  assert.equal(benchmarkOriginType(job), "DISCOVERY");
  assert.equal(isOfficialBenchmarkRecord({ provenance: { originType: "FIXTURE" } }), false);
  assert.deepEqual(ndcgAt([{ record: { ranking: { score: 90 } }, label: { humanPriority: null } }], 5), { value: null, status: "INSUFFICIENT_DATA", labeled: 0 });
});

test("recálculo reexecuta matcher e registra contagens", async () => {
  const service = new AtsRecalculationService({
    store: { analyses: { all: () => [{ id: "old", jobId: "job", createdAt: "2026-01-01T00:00:00.000Z" }] }, jobs: { findById: () => ({ id: "job", title: "Backend", description: "Requirements: Java" }) }, resumes: { findById: () => null } },
    reanalyze: async () => ({ ok: true }),
  });
  const { completedAt, ...report } = await service.run();
  assert.ok(completedAt);
  assert.deepEqual(report, { found: 1, recalculated: 1, failed: 0, insufficientData: 0, failures: [] });
});

test("laboratório persiste somente rótulo humano explícito e preserva null", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "quality-labels-"));
  try {
    const jobsDir = path.join(dataDir, "benchmarks", "jobs");
    await mkdir(jobsDir, { recursive: true });
    await writeFile(path.join(jobsDir, "jobs.jsonl"), `${JSON.stringify({ benchmarkJobId: "benchmark-real", title: "Backend", provenance: { originType: "DISCOVERY" }, matcher: { extractedRequirements: [] } })}\n`, "utf8");
    const service = new QualityLabelService({ dataDir });
    const label = await service.save("benchmark-real", { applicationDecision: "MAYBE", relevant: true, hardRequirements: ["Java"] });
    assert.equal(label.humanWouldApply, null);
    assert.equal(label.relevant, true);
    assert.ok(label.labeledAt);
    const result = await service.list();
    assert.equal(result.summary.labeled, 1);
    assert.equal(result.items[0].label.hardRequirements[0], "Java");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("provider OpenAI-compatible aceita somente endpoint local e saída estruturada", async () => {
  assert.throws(() => new OpenAICompatibleLocalProvider({ baseUrl: "https://api.example.com/v1" }), (error) => error.code === "PROVIDER_MISCONFIGURED");
  let requestBody;
  const provider = new OpenAICompatibleLocalProvider({
    baseUrl: "http://127.0.0.1:1234/v1",
    defaultModel: "local-model",
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ model: "local-model", choices: [{ message: { content: '{"status":"UNKNOWN"}' } }] }) };
    },
  });
  const result = await provider.generateStructured("classifique", { schema: { type: "object", properties: { status: { type: "string" } }, required: ["status"] } });
  assert.equal(JSON.parse(result.text).status, "UNKNOWN");
  assert.equal(requestBody.response_format.type, "json_schema");
  assert.equal(requestBody.max_tokens, 1556);
});

test("provider LM Studio normaliza endpoint, aplica TTL e descarrega o modelo", async () => {
  const requests = [];
  const provider = new LMStudioProvider({
    baseUrl: "http://host.docker.internal:1234",
    defaultModel: "qwen/local",
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      if (String(url).endsWith("/api/v1/models"))
        return { ok: true, json: async () => ({ models: [{ key: "qwen/local", size_bytes: 2_500_000_000, params_string: "4B", max_context_length: 32768, loaded_instances: [{ id: "qwen/local", config: { context_length: 15948 } }] }] }) };
      if (String(url).endsWith("/models/unload"))
        return { ok: true, json: async () => ({ instance_id: "qwen/local" }) };
      return { ok: true, json: async () => ({ model: "qwen/local", choices: [{ message: { content: '{"status":"READY"}' } }] }) };
    },
  });

  assert.equal(provider.baseUrl, "http://host.docker.internal:1234/v1");
  assert.equal((await provider.health()).status, "HEALTHY");
  assert.deepEqual(await provider.listModels(), [{ name: "qwen/local", installed: true, loaded: true, size: 2_500_000_000, details: { parameter_size: "4B", context_length: 15948 } }]);
  await provider.generateStructured("teste", { schema: { type: "object" } });
  await provider.unload("qwen/local");
  assert.equal(requests.find((item) => item.url.endsWith("/chat/completions")).body.ttl, 300);
  assert.deepEqual(requests.at(-1), {
    url: "http://host.docker.internal:1234/api/v1/models/unload",
    body: { instance_id: "qwen/local" },
  });
});

test("provider LM Studio descarrega automaticamente somente depois de ficar ocioso", async () => {
  const requests = [];
  const provider = new LMStudioProvider({
    baseUrl: "http://host.docker.internal:1234",
    defaultModel: "qwen/local",
    ttlSeconds: 0.01,
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      if (String(url).endsWith("/models/unload")) return { ok: true, json: async () => ({ instance_id: "qwen/local" }) };
      return { ok: true, json: async () => ({ model: "qwen/local", choices: [{ message: { content: '{"status":"READY"}' } }] }) };
    },
  });

  await provider.generateStructured("teste", { schema: { type: "object" } });
  assert.equal(requests.some((item) => item.url.endsWith("/models/unload")), false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(requests.filter((item) => item.url.endsWith("/models/unload")).length, 1);
});

test("sincronização substitui requisito canônico antigo com ID derivado diferente", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "requirement-sync-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  try {
    const timestamp = new Date().toISOString();
    store.jobs.upsert({ id: "job-sync", title: "Backend", company: "Acme", description: "Java", url: "https://example.test/job", createdAt: timestamp, updatedAt: timestamp });
    const requirement = (id, originalText) => ({ id, type: "skill", normalizedName: "java", originalText, importance: "required", required: true, weight: 1, confidence: .9 });
    store.jobRequirements.syncForJob("job-sync", [requirement("old-id", "Java obrigatório")]);
    store.jobRequirements.syncForJob("job-sync", [requirement("new-id", "Experiência com Java")]);
    assert.deepEqual(store.jobRequirements.forJob("job-sync").map((item) => item.id), ["new-id"]);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
