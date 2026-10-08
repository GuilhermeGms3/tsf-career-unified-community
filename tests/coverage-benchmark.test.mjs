import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { DiscoveryService } from "../src/discovery/discovery-service.mjs";
import { CoverageBenchmarkService, canonicalizeReferenceUrl } from "../src/benchmark/coverage-benchmark-service.mjs";

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "coverage-benchmark-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  const discoveryService = new DiscoveryService({
    registry: {}, repositories: store.discovery, jobRepository: store.jobs,
    boardRepository: store.watchlists, leadRepository: store.discoveryV4,
    sourceHealthRepository: store.discoverySourceHealth,
  });
  let evaluated = 0;
  const jobHuntService = {
    listProfiles: () => [],
    evaluateDiscoveredJobs: async (jobs) => { evaluated += jobs.length; return { matchEvaluated: jobs.length }; },
  };
  const opportunityService = {
    invalidated: false,
    invalidate() { this.invalidated = true; },
    async list() { return store.jobs.all().map((job) => ({ job, priority: { score: 80 }, decision: { disposition: "RECOMMENDED", reasons: [], decisionExplanation: { summary: "Compatível" } } })); },
  };
  const service = new CoverageBenchmarkService({ repository: store.coverageBenchmark, store, discoveryService, jobHuntService, opportunityService });
  return { store, service, discoveryService, jobHuntService, opportunityService, evaluated: () => evaluated, close: async () => { store.close(); await rm(dataDir, { recursive: true, force: true }); } };
}

test("ground truth aceita URL, múltiplas URLs, CSV e JSON sem duplicar URL canônica", async () => {
  const f = await fixture();
  try {
    const first = f.service.add({ url: "https://www.linkedin.com/jobs/view/noc-junior-4469289203?utm_source=x", interest: "alta" });
    assert.equal(first.canonicalUrl, "https://www.linkedin.com/jobs/view/4469289203");
    assert.equal(first.perceivedSource, "jobspy:linkedin");
    f.service.addMany(["https://remotar.com.br/job/163885"]);
    f.service.importData({ format: "CSV", content: "url,cargo,empresa,fonte\nhttps://www.nerdin.com.br/vaga_emprego/vaga-devops-junior-99068.php,DevOps Junior,Acme,Nerdin" });
    f.service.importData({ format: "JSON", content: JSON.stringify([{ url: "https://jobs.ashbyhq.com/acme/abc", title: "NOC" }]) });
    f.service.add({ url: "https://www.linkedin.com/jobs/view/4469289203?ref=again", notes: "atualizada" });
    assert.equal(f.store.coverageBenchmark.references().length, 4);
    assert.equal(f.store.coverageBenchmark.findReference(first.id).notes, "atualizada");
  } finally { await f.close(); }
});

test("diagnóstico distingue descoberta normal, outra fonte, paginação e source sem configuração", async () => {
  const f = await fixture();
  try {
    f.discoveryService.ingestResolvedJobs([
      { provider: "jobspy", providerJobId: "linkedin:1", discoveredVia: "linkedin", sourceUrl: "https://www.linkedin.com/jobs/view/1001", canonicalUrl: "https://www.linkedin.com/jobs/view/1001", title: "NOC Junior", company: "Acme", location: "Brasília, DF" },
      { provider: "jobspy", providerJobId: "linkedin:2", discoveredVia: "linkedin", sourceUrl: "https://www.linkedin.com/jobs/view/1002", canonicalUrl: "https://www.linkedin.com/jobs/view/1002", title: "Cloud Junior", company: "Beta", location: "Brasil" },
    ], { source: "jobspy", query: { query: "NOC", location: "Brasília, DF" }, recordSourceHealth: false });
    const automatic = f.service.add({ url: "https://www.linkedin.com/jobs/view/1001", title: "NOC Junior", company: "Acme" });
    const other = f.service.add({ url: "https://www.linkedin.com/jobs/view/1002", title: "Cloud Junior", company: "Beta", perceivedSource: "Indeed" });
    const paginated = f.service.add({ url: "https://remotar.com.br/job/200002", title: "DevOps Junior", perceivedSource: "Remotar", sourcePage: 2 });
    const unsupported = f.service.add({ url: "https://acme.gupy.io/jobs/123", title: "Service Desk", perceivedSource: "Gupy" });
    f.store.discoverySourceHealth.record({ providerId: "remotar", surfaceId: "remotar", status: "OPERATIONAL_REAL", realQuery: true, query: "Cloud", location: "Brasil", pagesScanned: 1, rawCount: 50, parsedCount: 10, validCount: 10, resultsLimit: 10, metadata: { totalAvailable: 1117 }, finishedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), lastRealQueryAt: new Date().toISOString() });
    f.opportunityService.list = async () => f.store.jobs.all().map((job) => ({
      job,
      priority: { score: 80 },
      decision: { disposition: job.title === "Cloud Junior" ? "BLOCKED" : "RECOMMENDED", reasons: [], decisionExplanation: { summary: "Fixture" } },
    }));
    assert.equal((await f.service.diagnose(automatic)).status, "FOUND_AUTOMATICALLY");
    assert.equal((await f.service.diagnose(other)).status, "FOUND_BY_OTHER_SOURCE");
    const pageDiagnostic = await f.service.diagnose(paginated);
    assert.equal(pageDiagnostic.status, "MISSED_PAGINATION");
    assert.equal(pageDiagnostic.evidence[1].code, "PAGE_NOT_SCANNED");
    assert.equal((await f.service.diagnose(unsupported)).status, "SOURCE_NOT_CONFIGURED");
  } finally { await f.close(); }
});

test("planner diferencia Brasília de Brasil remoto e prova combinação fora do budget", async () => {
  const f = await fixture();
  try {
    const profile = f.store.jobHuntProfiles.save({ name: "Fixture", enabled: true });
    const run = f.store.jobHuntRuns.start(profile.id, "MANUAL");
    f.store.jobHuntRuns.finish(run.id, {
      report: {
        providers: ["nerdin"],
        queryPlanner: {
          effectiveQueryBudget: 1,
          requiredCombinationCount: 6,
          coverage: { remainingCombinations: ["INFRASTRUCTURE:LOCAL_DF"] },
        },
      },
    });
    const reference = f.service.add({
      url: "https://www.nerdin.com.br/vaga_emprego/vaga-analista-de-infraestrutura-sr-99999.php",
      title: "Analista de Infraestrutura Sr",
      perceivedSource: "Nerdin",
      location: "Brasília, DF",
      providerPosition: 32,
    });
    const diagnostic = await f.service.diagnose(reference);
    assert.equal(diagnostic.status, "MISSED_PLANNER_BUDGET");
    assert.equal(diagnostic.evidence[1].code, "COMBINATION_NOT_EXECUTED");
  } finally { await f.close(); }
});

test("importação manual usa pipeline canônico, não forja Source Health e aceita LinkedIn Post", async () => {
  const f = await fixture();
  try {
    const reference = f.service.add({
      url: "https://www.linkedin.com/posts/recrutadora_vaga-activity-123",
      perceivedSource: "LinkedIn Post",
      sourceText: "Vaga: Analista NOC Junior\nEmpresa: Acme Infra\nLocalização: Brasília, DF\nContato: recrutadora@example.com\nhttps://careers.example.com/noc-123",
    });
    assert.equal(reference.title, "Analista NOC Junior");
    assert.equal(reference.company, "Acme Infra");
    const imported = await f.service.importReference(reference.id);
    assert.equal(imported.alreadyImported, false);
    assert.equal(imported.job.provenance.originType, "MANUAL_IMPORT");
    assert.equal(imported.job.provenance.referenceJobId, reference.id);
    assert.equal(imported.job.canonicalUrl, "https://careers.example.com/noc-123");
    assert.equal(f.evaluated(), 1);
    assert.equal(f.opportunityService.invalidated, true);
    assert.equal(f.store.discoverySourceHealth.latest("linkedin-posts"), null);
    assert.equal(f.store.discovery.sourcesForJob(imported.job.id)[0].provenance.originType, "MANUAL_IMPORT");
  } finally { await f.close(); }
});

test("benchmark persiste classificação, métricas e histórico imutável", async () => {
  const f = await fixture();
  try {
    f.discoveryService.ingestResolvedJobs([{ provider: "nerdin", providerJobId: "99068", discoveredVia: "nerdin", sourceUrl: "https://www.nerdin.com.br/vaga_emprego/vaga-devops-junior-99068.php", canonicalUrl: "https://www.nerdin.com.br/vaga_emprego/vaga-devops-junior-99068.php", title: "DevOps Junior", company: "Acme", location: "Brasília, DF" }], { source: "nerdin", query: { query: "DevOps Junior", location: "Brasília, DF" }, recordSourceHealth: false });
    f.service.add({ url: "https://www.nerdin.com.br/vaga_emprego/vaga-devops-junior-99068.php", title: "DevOps Junior", company: "Acme" });
    f.service.add({ url: "https://acme.gupy.io/jobs/999", title: "NOC", perceivedSource: "Gupy" });
    const run = await f.service.runBenchmark();
    assert.equal(run.items.length, 2);
    assert.equal(run.summary.totalReferenceJobs, 2);
    assert.equal(run.summary.found, 1);
    assert.equal(run.summary.foundAutomatically, 1);
    assert.equal(run.summary.coverageRate, 0.5);
    assert.throws(() => f.store.database.connection.prepare("UPDATE coverage_benchmark_items SET coverage_status='UNKNOWN'").run(), /append-only/);
  } finally { await f.close(); }
});

test("contrato da UI oferece diagnóstico, benchmark e importação sem candidatura", async () => {
  const [migration, page] = await Promise.all([
    readFile(new URL("../db/migrations/033_coverage_benchmark.sql", import.meta.url), "utf8"),
    readFile(new URL("../public/features/quality-lab/page.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Por que o TSF não encontrou esta vaga\?/);
  assert.match(page, /Importar e analisar/);
  assert.match(page, /Coverage Benchmark/);
  assert.match(migration, /coverage_benchmark_items_no_update/);
  assert.doesNotMatch(migration, /applications|submission/i);
  assert.equal(canonicalizeReferenceUrl("https://example.com/job?utm_source=x"), "https://example.com/job");
});
