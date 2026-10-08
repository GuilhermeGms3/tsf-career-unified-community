import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { DiscoveryService } from "../src/discovery/discovery-service.mjs";
import { NerdinProvider, RemotarProvider } from "../src/discovery/providers/brazilian-public-providers.mjs";
import { JobHuntService } from "../src/automation/job-hunt-service.mjs";

const remotarJob = (id, title = `Infra ${id}`) => ({
  id,
  title,
  description: "Linux, redes e cloud.",
  type: "remote",
  active: true,
  expired: false,
  createdAt: `2026-09-${String((id % 20) + 1).padStart(2, "0")}T12:00:00Z`,
  company: { id: `company-${id}`, name: `Empresa ${id}` },
});

const jobPostingPage = (id) => `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: `Analista de Infraestrutura ${id}`,
  description: "Linux e redes.",
  identifier: { "@type": "PropertyValue", value: String(id) },
  hiringOrganization: { "@type": "Organization", name: `Empresa ${id}` },
  jobLocationType: "TELECOMMUTE",
  applicantLocationRequirements: { "@type": "Country", name: "Brazil" },
  datePosted: "2026-09-20",
  validThrough: "2026-12-20",
})}</script>`;

const serviceFor = (store, provider) => new DiscoveryService({
  registry: { get: (id) => id === provider.id ? provider : null },
  repositories: store.discovery,
  jobRepository: store.jobs,
  boardRepository: store.watchlists,
  leadRepository: store.discoveryV4,
  sourceHealthRepository: store.discoverySourceHealth,
});

test("Remotar percorre páginas com deduplicação e retoma do checkpoint após restart", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "remotar-c1-"));
  let store = await new UnifiedStateStore({ dataDir }).initialize();
  const calls = [];
  const client = {
    async getJson(url) {
      const page = Number(new URL(url).searchParams.get("page"));
      calls.push(page);
      const rows = page === 1
        ? [remotarJob(1), remotarJob(2)]
        : page === 2
          ? [remotarJob(2), remotarJob(3)]
          : [remotarJob(4)];
      return { data: { meta: { total: 4, current_page: page, last_page: 3 }, data: rows } };
    },
  };
  try {
    let provider = new RemotarProvider({ client, checkpointRepository: store.discoveryProviderCheckpoints, pageBudget: 2, pageDelayMs: 0 });
    const first = await serviceFor(store, provider).discover({ providers: ["remotar"], query: "", limit: 50 });
    assert.deepEqual(calls, [1, 2]);
    assert.equal(first.discoveredCount, 3);
    assert.equal(store.jobs.all().length, 3);
    assert.equal(store.discoveryProviderCheckpoints.get("remotar", "active:all").cursor, 3);
    const health = store.discoverySourceHealth.latest("remotar");
    assert.equal(health.pagesScanned, 2);
    assert.equal(health.metadata.recordsExamined, 4);
    assert.equal(health.metadata.checkpoint.page, 3);

    store.close();
    store = await new UnifiedStateStore({ dataDir }).initialize();
    provider = new RemotarProvider({ client, checkpointRepository: store.discoveryProviderCheckpoints, pageBudget: 2, pageDelayMs: 0 });
    const second = await serviceFor(store, provider).discover({ providers: ["remotar"], query: "", limit: 50 });
    assert.equal(calls[2], 3);
    assert.equal(second.newCount, 1);
    assert.equal(store.jobs.all().length, 4);
    assert.equal(store.discoveryProviderCheckpoints.get("remotar", "active:all").cursor, 1);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Remotar preserva a página falha quando a continuação recebe rate limit", async () => {
  const provider = new RemotarProvider({
    pageBudget: 2,
    pageDelayMs: 0,
    client: {
      async getJson(url) {
        const page = Number(new URL(url).searchParams.get("page"));
        if (page === 2) throw Object.assign(new Error("limited"), { code: "RATE_LIMITED" });
        return { data: { meta: { total: 100, current_page: 1, last_page: 2 }, data: [remotarJob(1)] } };
      },
    },
  });
  const result = await provider.search({ limit: 50 });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.diagnostic.status, "DEGRADED");
  assert.equal(result.diagnostic.rateLimited, true);
  assert.equal(result.diagnostic.checkpoint.page, 2);
});

test("Nerdin avança por URLs inalteradas e continua após restart", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "nerdin-c1-"));
  let store = await new UnifiedStateStore({ dataDir }).initialize();
  const visited = [];
  const urls = [10005, 10004, 10003, 10002, 10001].map((id) => `https://www.nerdin.com.br/vaga_emprego/vaga-infra-${id}.php`);
  const sitemap = `<urlset>${urls.map((url) => `<url><loc>${url}</loc><lastmod>2026-09-20</lastmod></url>`).join("")}</urlset>`;
  const client = {
    async getText(url) {
      const value = String(url);
      if (value.endsWith("sitemap.xml")) return { data: sitemap };
      visited.push(value);
      return { data: jobPostingPage(value.match(/(\d+)\.php$/)[1]) };
    },
  };
  try {
    let provider = new NerdinProvider({ client, checkpointRepository: store.discoveryProviderCheckpoints, urlBudget: 2 });
    const first = await serviceFor(store, provider).discover({ providers: ["nerdin"], query: "Infra", location: "Brasil", limit: 50 });
    assert.equal(first.newCount, 2);
    assert.equal(store.discoverySourceHealth.latest("nerdin").metadata.remainingUrls, 3);
    const firstVisited = [...visited];

    store.close();
    store = await new UnifiedStateStore({ dataDir }).initialize();
    provider = new NerdinProvider({ client, checkpointRepository: store.discoveryProviderCheckpoints, urlBudget: 2 });
    const second = await serviceFor(store, provider).discover({ providers: ["nerdin"], query: "Infra", location: "Brasil", limit: 50 });
    assert.equal(second.newCount, 2);
    assert.equal(store.jobs.all().length, 4);
    assert.equal(store.discoverySourceHealth.latest("nerdin").metadata.remainingUrls, 1);
    assert.ok(visited.slice(firstVisited.length).every((url) => !firstVisited.includes(url)));
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("Nerdin não avança o cursor sobre URLs não examinadas ao priorizar uma URL relevante", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "nerdin-priority-c1-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  const visited = [];
  const urls = [10005, 10004, 10003, 10002, 10001].map((id) =>
    `https://www.nerdin.com.br/vaga_emprego/vaga-${id === 10001 ? "prioridade" : "geral"}-${id}.php`,
  );
  const sitemap = `<urlset>${urls.map((url) => `<url><loc>${url}</loc><lastmod>2026-09-20</lastmod></url>`).join("")}</urlset>`;
  const client = {
    async getText(url) {
      const value = String(url);
      if (value.endsWith("sitemap.xml")) return { data: sitemap };
      visited.push(value);
      return { data: jobPostingPage(value.match(/(\d+)\.php$/)[1]) };
    },
  };
  try {
    const provider = new NerdinProvider({ client, checkpointRepository: store.discoveryProviderCheckpoints, urlBudget: 2 });
    await serviceFor(store, provider).discover({ providers: ["nerdin"], query: "Prioridade", location: "Brasil", limit: 50 });
    assert.equal(store.discoveryProviderCheckpoints.get("nerdin", "catalog").cursor, 1);
    assert.ok(visited.some((url) => url.includes("10001")));
    assert.ok(visited.some((url) => url.includes("10005")));

    await serviceFor(store, provider).discover({ providers: ["nerdin"], query: "Prioridade", location: "Brasil", limit: 50 });
    assert.ok(visited.some((url) => url.includes("10004")));
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("planner completa seis combinações em seis rodadas e preserva cursor no restart", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "planner-c1-"));
  const calls = [];
  let store = await new UnifiedStateStore({ dataDir }).initialize();
  const discoveryService = { discover: async (input) => {
    calls.push(`${input.queryProvenance.familyId}:${input.geographySurface}`);
    return { run: { id: `discovery-${calls.length}` }, jobs: [], discoveredCount: 0, newCount: 0, duplicateCount: 0, closedCount: 0, sourceReports: [{ provider: "fixture", status: "HEALTHY" }], ok: true };
  } };
  try {
    let service = new JobHuntService({ store, discoveryService, matcher: () => null, profileProvider: async () => ({}) });
    const profile = service.saveProfile({
      name: "C1 planner cycle",
      enabled: false,
      jobFamilies: ["INFRASTRUCTURE", "NETWORK_NOC", "DEVOPS_SRE"],
      queries: [],
      seniorities: ["JUNIOR"],
      providers: ["fixture"],
      locationPolicy: { priorities: [
        { location: "Brasil", workModel: "REMOTE", remoteScope: "Brasil", accepted: true },
        { location: "Brasília, DF", workModel: "ONSITE", accepted: true },
      ] },
      queryBudget: { maxQueries: 2, maxQueriesPerProvider: 2, maxRequests: 1, concurrency: 1 },
    });
    for (let round = 0; round < 3; round++) await service.run(profile.id);
    const beforeRestart = store.discoveryQueryPlannerState.get(profile.id);
    assert.equal(beforeRestart.round, 3);
    assert.equal(beforeRestart.combinationCursor, 3);

    store.close();
    store = await new UnifiedStateStore({ dataDir }).initialize();
    service = new JobHuntService({ store, discoveryService, matcher: () => null, profileProvider: async () => ({}) });
    let finalRun;
    for (let round = 0; round < 3; round++) finalRun = await service.run(profile.id);
    assert.equal(new Set(calls).size, 6);
    assert.equal(calls.length, 6);
    assert.equal(finalRun.report.queryPlanner.cycleProgress.completedCycles, 1);
    assert.equal(finalRun.report.queryPlanner.cycleProgress.cycleCompletedThisRound, true);
    assert.equal(finalRun.report.queryPlanner.cycleProgress.roundsPerCycle, 6);
    assert.equal(finalRun.report.queryPlanner.coverage.executedCombinations.length, 1);
    assert.equal(finalRun.report.queryPlanner.coverage.deferredCombinations.length, 5);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
