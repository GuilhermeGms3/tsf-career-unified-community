import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { JobHuntService } from "../src/automation/job-hunt-service.mjs";

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mass-hunt-async-"));
  const store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  return { dir, store, close: async () => { store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("P1 async Mass Hunt persists RUNNING before returning and survives caller navigation", async () => {
  const f = await fixture();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    const service = new JobHuntService({
      store: f.store,
      discoveryService: { discover: async () => { await gate; return { run: { id: "discovery-async" }, jobs: [], discoveredCount: 0, newCount: 0, duplicateCount: 0, closedCount: 0, sourceReports: [{ provider: "jobspy", status: "CONSULTED", sites: [{ site: "indeed", status: "NO_RESULTS", acceptedResults: 0 }] }], ok: true }; } },
      matcher: () => null, profileProvider: async () => ({}),
    });
    const profile = service.saveProfile({ name: "Async", jobFamilies: ["BACKEND"], seniorities: ["JUNIOR"], locations: ["Brasil"], sourcePreferences: ["indeed"], queryBudget: { maxQueries: 1, maxQueriesPerProvider: 1, maxRequests: 1 }, enabled: false });
    const queued = service.queue(profile.id, { triggerType: "MANUAL" });
    assert.ok(queued.id);
    assert.equal(queued.status, "RUNNING");
    assert.equal(f.store.jobHuntRuns.findById(queued.id).status, "RUNNING");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(["PLANNED", "DISCOVERY"].includes(f.store.jobHuntRuns.findById(queued.id).report.progress.stage));
    release();
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline && f.store.jobHuntRuns.findById(queued.id).status === "RUNNING") await new Promise((resolve) => setTimeout(resolve, 20));
    const completed = f.store.jobHuntRuns.findById(queued.id);
    assert.ok(["COMPLETED", "PARTIAL"].includes(completed.status));
    assert.equal(completed.report.sourceReports[0].sites[0].site, "indeed");
  } finally { release?.(); await f.close(); }
});

test("Mass Hunt reuses the persisted active run instead of starting a duplicate", async () => {
  const f = await fixture();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  try {
    const service = new JobHuntService({
      store: f.store,
      discoveryService: { discover: async () => { await gate; return { run: { id: "discovery-single" }, jobs: [], discoveredCount: 0, newCount: 0, duplicateCount: 0, closedCount: 0, sourceReports: [], ok: true }; } },
      matcher: () => null,
      profileProvider: async () => ({}),
    });
    const profile = service.saveProfile({ name: "Single run", jobFamilies: ["BACKEND"], seniorities: ["JUNIOR"], locations: ["Brasil"], sourcePreferences: ["indeed"], queryBudget: { maxQueries: 1, maxQueriesPerProvider: 1, maxRequests: 1 }, enabled: false });
    const first = service.queue(profile.id, { triggerType: "MANUAL" });
    const repeated = service.queue(profile.id, { triggerType: "MANUAL" });
    assert.equal(repeated.id, first.id);
    assert.equal(repeated.status, "RUNNING");
    assert.equal(repeated.reused, true);
    assert.equal(f.store.jobHuntRuns.active(profile.id).length, 1);
  } finally {
    release?.();
    await new Promise((resolve) => setImmediate(resolve));
    await f.close();
  }
});

test("restart finaliza Mass Hunt interrompido sem apagar o relatório parcial", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mass-hunt-recovery-"));
  let firstStore;
  let reopenedStore;
  try {
    firstStore = await new UnifiedStateStore({ dataDir: dir }).initialize();
    const profile = firstStore.jobHuntProfiles.save({
      name: "Recovery",
      jobFamilies: ["BACKEND"],
      seniorities: ["JUNIOR"],
      enabled: false,
    });
    const run = firstStore.jobHuntRuns.start(profile.id, "MANUAL");
    firstStore.jobHuntRuns.progress(run.id, {
      rawCount: 12,
      canonicalCount: 9,
      report: { progress: { stage: "MATCHING", partialDiscoveredCount: 12 } },
    });
    firstStore.close();
    firstStore = null;

    reopenedStore = await new UnifiedStateStore({ dataDir: dir }).initialize();
    const recovered = reopenedStore.jobHuntRuns.findById(run.id);
    assert.equal(recovered.status, "FAILED");
    assert.equal(recovered.errorCode, "PROCESS_INTERRUPTED");
    assert.equal(recovered.rawCount, 12);
    assert.equal(recovered.canonicalCount, 9);
    assert.equal(recovered.report.progress.stage, "MATCHING");
    assert.ok(recovered.completedAt);
  } finally {
    firstStore?.close();
    reopenedStore?.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("P1 async HTTP contract returns 202 and exposes persisted progress endpoint", async () => {
  const discoveryRoutes = await readFile(new URL("../server/routes/discovery-v4-routes.mjs", import.meta.url), "utf8");
  const autopilotRoutes = await readFile(new URL("../server/routes/autopilot-routes.mjs", import.meta.url), "utf8");
  const frontend = await readFile(new URL("../public/features/opportunities/page.js", import.meta.url), "utf8");
  assert.match(discoveryRoutes, /service\.queueMass/);
  assert.match(discoveryRoutes, /}, 202\)/);
  assert.match(autopilotRoutes, /\/api\/job-hunt\/runs/);
  assert.match(autopilotRoutes, /runMatch\[2\]===\"pause\"/);
  assert.match(autopilotRoutes, /jobHuntService\.pause/);
  assert.match(frontend, /career\.massHuntRunId/);
  assert.match(frontend, /continua mesmo se você navegar/i);
  assert.match(frontend, /Ver busca em andamento/);
  assert.match(frontend, /runs\?status=RUNNING&limit=1/);
  assert.match(frontend, /career\.massHuntPanelMinimized/);
  assert.match(frontend, /data-restore-mass-hunt/);
  assert.match(frontend, /data-pause-mass-hunt/);
  assert.match(frontend, /\/pause/);
  assert.doesNotMatch(frontend, /data-close-mass-hunt/);
});

test("Mass Hunt persists recent discoveries in the run report", async () => {
  const f = await fixture();
  try {
    const createdAt = new Date().toISOString();
    const discoveredJob = f.store.jobs.upsert({
      id: "job-live", externalId: "indeed:live", source: "indeed", provider: "jobspy", providerJobId: "live",
      canonicalKey: "indeed:live", title: "Backend Junior", company: "Acme", location: "Remoto, BR",
      description: "Node.js", url: "https://example.test/jobs/live", applicationUrl: "https://example.test/jobs/live",
      lifecycleStatus: "OPEN", contentHash: "live-content", createdAt, updatedAt: createdAt,
    });
    const service = new JobHuntService({
      store: f.store,
      discoveryService: { discover: async () => ({
        run: { id: "discovery-live" },
        jobs: [discoveredJob],
        discoveredCount: 1, newCount: 1, duplicateCount: 0, closedCount: 0, ok: true,
        sourceReports: [{ provider: "jobspy", status: "CONSULTED", sites: [{ site: "indeed", status: "SUCCESS", acceptedResults: 1 }] }],
      }) },
      matcher: ({ job, resume }) => ({
        id: `analysis-${job.id}`, jobId: job.id, resumeId: resume.id, score: 10, overallScore: 10,
        calibratedMatchScore: 10, evidenceCoverage: 100, matchConfidence: 100, eligibility: "ELIGIBLE",
        blockingIssues: [], warnings: [], unknownRequirements: [], requirements: [], items: [], candidateEvidence: [],
        dimensions: {}, resumeParseability: { status: "NOT_EVALUATED" }, matched: [], missing: [], suggestions: [],
        algorithmVersion: "test", createdAt, updatedAt: createdAt,
      }),
      profileProvider: async () => ({}),
    });
    const profile = service.saveProfile({ name: "Live", jobFamilies: ["BACKEND"], seniorities: ["JUNIOR"], locations: ["Brasil"], sourcePreferences: ["indeed"], queryBudget: { maxQueries: 1, maxQueriesPerProvider: 1, maxRequests: 1 }, enabled: false });
    const queued = service.queue(profile.id, { triggerType: "MANUAL" });
    const deadline = Date.now() + 3_000;
    let current = f.store.jobHuntRuns.findById(queued.id);
    while (Date.now() < deadline && current.status === "RUNNING") {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = f.store.jobHuntRuns.findById(queued.id);
    }
    assert.ok(Array.isArray(current.report?.recentDiscoveries), JSON.stringify(current));
    assert.equal(current.report.recentDiscoveries[0].title, "Backend Junior");
    assert.equal(current.report.recentDiscoveries[0].source, "indeed");
  } finally {
    await f.close();
  }
});
