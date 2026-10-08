import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { JobHuntService, fairRequestSchedule } from "../src/automation/job-hunt-service.mjs";
import { discoveryTimeoutPolicy, validateDiscoveryTimeoutPolicy } from "../src/discovery/discovery-timeout-policy.mjs";

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "discovery-runtime-p0-")),
    store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  return { store, close: async () => { store.close(); await rm(dir, { recursive: true, force: true }); } };
}

const emptyResult = (input) => ({
  run: { id: `discovery-${Math.random()}` }, jobs: [], discoveredCount: 0,
  newCount: 0, duplicateCount: 0, closedCount: 0, ok: true,
  sourceReports: [{ provider: input.providers[0], status: "HEALTHY", sites: [] }],
});

test("deadline contract exige portal < engine < transport", () => {
  assert.deepEqual(discoveryTimeoutPolicy({}), { portalDeadlineMs: 30000, engineDeadlineMs: 70000, transportDeadlineMs: 85000 });
  assert.throws(() => validateDiscoveryTimeoutPolicy({ portalDeadlineMs: 30000, engineDeadlineMs: 20000, transportDeadlineMs: 85000 }), (error) => error.code === "DISCOVERY_TIMEOUT_POLICY_INVALID");
});

test("fair scheduler intercala providers por combinação", () => {
  const schedule = fairRequestSchedule([
    [{ query: "Q1", provider: "A" }, { query: "Q1", provider: "B" }, { query: "Q1", provider: "C" }],
    [{ query: "Q2", provider: "A" }, { query: "Q2", provider: "B" }, { query: "Q2", provider: "C" }],
  ]);
  assert.deepEqual(schedule.map((item) => `${item.query}:${item.provider}`), ["Q1:A", "Q1:B", "Q1:C", "Q2:A", "Q2:B", "Q2:C"]);
  const budgeted=fairRequestSchedule(Array.from({length:10},(_,index)=>["A","B","C"].map(provider=>({query:`Q${index+1}`,provider})))).slice(0,20),counts=Object.fromEntries(["A","B","C"].map(provider=>[provider,budgeted.filter(item=>item.provider===provider).length]));
  assert.deepEqual(counts,{A:7,B:7,C:6});
});

test("REMOTE_BRAZIL e LOCAL_DF chegam corretamente ao boundary do provider", async () => {
  const f = await fixture();
  try {
    const calls = [], service = new JobHuntService({
      store: f.store,
      discoveryService: { discover: async (input) => (calls.push(input), emptyResult(input)) },
      matcher: () => null,
      profileProvider: async () => ({}),
    });
    const profile = service.saveProfile({
      name: "Backend DF e remoto", jobFamilies: ["BACKEND"], seniorities: ["JUNIOR"],
      sourcePreferences: ["indeed"], workModels: ["HYBRID", "REMOTE"],
      locationPolicy: { priorities: [
        { priority: 1, location: "Brasília, DF", workModel: "HYBRID", accepted: true },
        { priority: 2, location: "Brasil", remoteScope: "Brasil", workModel: "REMOTE", accepted: true },
      ] },
      queryBudget: { maxQueries: 4, maxQueriesPerProvider: 4, maxRequests: 4 }, enabled: false,
    });
    await service.run(profile.id);
    const local = calls.find((item) => item.geographySurface === "LOCAL_DF"),
      remote = calls.find((item) => item.geographySurface === "REMOTE_BRAZIL");
    assert.ok(local, JSON.stringify(calls.map(item=>({surface:item.geographySurface,location:item.location,remote:item.remote}))));
    assert.ok(remote, JSON.stringify(calls.map(item=>({surface:item.geographySurface,location:item.location,remote:item.remote}))));
    assert.equal(local.remote, false);
    assert.equal(local.location, "Brasília, DF");
    assert.equal(remote.remote, true);
    assert.equal(remote.location, "Brasil");
    assert.equal(remote.country, "Brazil");
    assert.equal("timeoutMs" in remote, false);
  } finally { await f.close(); }
});

test("logs de início existem enquanto discovery ainda está em execução", async () => {
  const f = await fixture();
  try {
    let release;
    const pending = new Promise((resolve) => { release = resolve; }), service = new JobHuntService({
      store: f.store,
      discoveryService: { discover: async (input) => (await pending, emptyResult(input)) },
      matcher: () => null,
      profileProvider: async () => ({}),
    });
    const profile = service.saveProfile({ name: "Incremental", queries: ["Suporte"], sourcePreferences: ["indeed"], queryBudget: { maxQueries: 1, maxQueriesPerProvider: 1, maxRequests: 1 }, enabled: false });
    const running = service.run(profile.id);
    for (let attempt = 0; attempt < 50 && !f.store.structuredLogs.list({ limit: 100 }).some((item) => item.event === "PROVIDER_REQUEST_STARTED"); attempt++)
      await new Promise((resolve) => setImmediate(resolve));
    const before = new Set(f.store.structuredLogs.list({ limit: 100 }).map((item) => item.event));
    assert.ok(before.has("DISCOVERY_RUN_STARTED"));
    assert.ok(before.has("QUERY_EXECUTION_STARTED"));
    assert.ok(before.has("PROVIDER_REQUEST_STARTED"));
    assert.equal(before.has("DISCOVERY_RUN_COMPLETED"), false);
    release();
    await running;
    assert.ok(f.store.structuredLogs.list({ limit: 100 }).some((item) => item.event === "DISCOVERY_RUN_COMPLETED"));
  } finally { await f.close(); }
});
