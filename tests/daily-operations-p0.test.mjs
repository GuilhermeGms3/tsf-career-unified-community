import assert from "node:assert/strict";
import test from "node:test";
import { DailyRefreshService } from "../src/product/daily-refresh-service.mjs";
import { DecisionInboxService } from "../src/product/decision-inbox-service.mjs";

class RefreshRuns {
  constructor() { this.items = new Map(); }
  start(profileId) { const item = { id: "daily-1", profileId, status: "RUNNING", stage: "SEARCHING", result: {}, startedAt: new Date().toISOString() }; this.items.set(item.id, item); return item; }
  update(id, changes) { const item = { ...this.items.get(id), ...changes }; this.items.set(id, item); return item; }
  findById(id) { return this.items.get(id) || null; }
  active() { return [...this.items.values()].find((item) => item.status === "RUNNING") || null; }
  latest() { return [...this.items.values()].at(-1) || null; }
}

test("checagem do catálogo independe de perfil, relevância e candidatura e percorre os mais antigos", async () => {
  const runs = new RefreshRuns(), checked = [];
  const jobs = [
    { id: "recent", lastCheckedAt: "2026-10-14", lifecycleStatus: "OPEN" },
    { id: "old", lastCheckedAt: "2026-01-01", lifecycleStatus: "OPEN" },
    { id: "never", lifecycleStatus: "UNKNOWN" },
    { id: "closed", lifecycleStatus: "CLOSED" },
  ];
  const service = new DailyRefreshService({ store: { jobs: { all: () => jobs }, dailyRefreshRuns: runs }, opportunityService: { invalidate() {}, list: async () => { throw new Error("Não deve ranquear para escolher o lote"); } }, decisionInbox: { build: async () => ({}) },
    availabilityService: { verify: async id => { checked.push(id); return { availability: { status: id === "old" ? "CLOSED" : "AVAILABLE", reason: "fixture", checkedAt: new Date().toISOString() } }; } } });
  const run = runs.start();
  const result = await service.execute(run.id, null, { skipSearch: true, catalog: true, batchSize: 2 });
  assert.deepEqual(checked.sort(), ["never", "old"]);
  assert.equal(result.closedCount, 1);
  assert.equal(result.remainingCount, 1);
  assert.equal(result.result.checks.length, 2);
});

test("Hoje entrega snapshot persistido sem reconstruir a projeção pesada", async () => {
  const inbox = { generatedAt: new Date().toISOString(), items: [], dailyDecision: {} };
  const service = new DecisionInboxService({
    store: { dailyInboxSnapshots: { get: () => ({ inbox, generatedAt: inbox.generatedAt }) } },
    opportunityService: { list: async () => { throw new Error("não deveria reconstruir"); } },
    snapshotRefreshMs: 60_000,
  });
  const result = await service.read();
  assert.equal(result.generatedAt, inbox.generatedAt);
  assert.equal(result.snapshot.served, true);
});

test("renovação diária busca, confirma vagas antigas e recompõe o snapshot", async () => {
  const refreshRuns = new RefreshRuns();
  const searchRun = { id: "search-1", profileId: "profile", status: "COMPLETED", discoveredCount: 8, canonicalCount: 6, duplicateCount: 2, closedCount: 1, report: { sourceReports: [{ provider: "jobspy", status: "CONSULTED", sites: [{ site: "indeed", status: "SUCCESS", acceptedResults: 8 }] }] } };
  const stale = (id, score, blockers = ["STALE"]) => ({ job: { id, title: "Backend Júnior", company: "Acme", location: "Remoto, Brasil", lifecycleStatus: "OPEN" }, freshness: { current: false, needsUpdate: true }, decision: { disposition: "BLOCKED", hardBlockers: blockers }, priority: { score }, application: null });
  let rebuilds = 0;
  const store = {
    dailyRefreshRuns: refreshRuns,
    jobHuntProfiles: { all: () => [{ id: "profile", enabled: true, locationPolicy: {} }] },
    jobHuntRuns: { findById: () => searchRun, list: () => [searchRun] },
  };
  const service = new DailyRefreshService({
    store,
    jobHuntService: { queue: () => searchRun },
    opportunityService: { invalidate: () => {}, list: async () => [stale("available", 90), stale("closed", 80), stale("foreign-blocked", 99, ["STALE", "LOCATION_MISMATCH"])] },
    availabilityService: { verify: async (id) => ({ availability: { status: id === "available" ? "AVAILABLE" : "CLOSED" } }) },
    decisionInbox: { build: async () => { rebuilds++; } },
    searchPollMs: 1,
  });
  const run = refreshRuns.start("profile");
  const result = await service.execute(run.id, store.jobHuntProfiles.all()[0]);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.verificationTotal, 2);
  assert.equal(result.availableCount, 1);
  assert.equal(result.closedCount, 1);
  assert.equal(result.result.search.duplicates, 2);
  assert.equal(result.result.search.sources[0].sites[0].source, "indeed");
  assert.equal(rebuilds, 1);
});

test("renovação preserva estado parcial quando a fonte não confirma a vaga", async () => {
  const refreshRuns = new RefreshRuns();
  const store = { dailyRefreshRuns: refreshRuns, jobHuntProfiles: { all: () => [] }, jobHuntRuns: { list: () => [] } };
  const service = new DailyRefreshService({
    store, jobHuntService: {},
    opportunityService: { invalidate: () => {}, list: async () => [{ job: { id: "uncertain", title: "Suporte", company: "Acme", location: "Brasil", lifecycleStatus: "OPEN" }, freshness: { needsUpdate: true }, decision: { hardBlockers: ["STALE"] }, priority: { score: 70 } }] },
    availabilityService: { verify: async () => ({ availability: { status: "INCONCLUSIVE" } }) },
    decisionInbox: { build: async () => ({}) },
  });
  const run = refreshRuns.start("");
  const result = await service.execute(run.id, null);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.inconclusiveCount, 1);
});

test("verificação em Vagas não dispara uma nova busca e preserva respostas inconclusivas", async () => {
  const refreshRuns = new RefreshRuns();
  let searchCalls = 0;
  const store = {
    dailyRefreshRuns: refreshRuns,
    jobHuntProfiles: { all: () => [{ id: "profile", enabled: true, locationPolicy: {} }] },
    jobHuntRuns: { list: () => [] },
  };
  const service = new DailyRefreshService({
    store,
    jobHuntService: { queue: () => { searchCalls++; } },
    opportunityService: {
      invalidate: () => {},
      list: async () => [{ job: { id: "stale", lifecycleStatus: "OPEN" }, freshness: { needsUpdate: true }, decision: { hardBlockers: ["STALE"] }, priority: { score: 90 }, application: null }],
    },
    availabilityService: { verify: async () => ({ availability: { status: "INCONCLUSIVE" } }) },
    decisionInbox: { build: async () => ({}) },
  });
  const run = refreshRuns.start("profile", "VERIFYING");
  const result = await service.execute(run.id, store.jobHuntProfiles.all()[0], { skipSearch: true });
  assert.equal(searchCalls, 0);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.result.search.status, "NOT_REQUESTED");
  assert.equal(result.inconclusiveCount, 1);
  assert.equal(result.closedCount, 0);
});
