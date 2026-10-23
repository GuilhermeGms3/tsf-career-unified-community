import assert from "node:assert/strict";
import test from "node:test";
import { OpportunityService } from "../src/opportunities/opportunity-service.mjs";

function fixture(size = 1_000) {
  let revision = 1;
  const calls = { jobs: 0, analyses: 0, requirements: 0, items: 0, forJob: 0, forAnalysis: 0 };
  const jobs = Array.from({ length: size }, (_, index) => ({ id: `job-${index}`, title: "Backend Developer Jr", description: "APIs", rawContent: "bulky source payload", location: "Brasil", workModel: "REMOTE", lifecycleStatus: "OPEN", createdAt: "2026-08-26", updatedAt: "2026-08-26" }));
  const analyses = jobs.map((job, index) => ({ id: `analysis-${index}`, jobId: job.id, overallScore: 75, score: 75, matchConfidence: 70, evidenceCoverage: 70, eligibility: "ELIGIBLE", blockingIssues: [], candidateEvidence: [{ id: "bulky-evidence" }], updatedAt: "2026-08-26", createdAt: "2026-08-26", algorithmVersion: "ats-matcher-v2" }));
  const store = {
    database: { connection: { prepare: () => ({ all: () => [{ domain: "jobs", count: size, latest: String(revision) }] }) } },
    jobs: { all: () => { calls.jobs++; return jobs; } },
    analyses: { all: () => { calls.analyses++; return analyses; } },
    applications: { all: () => [] }, jobFeedback: { all: () => [] }, jobAlerts: { list: () => [] },
    jobHuntProfiles: { all: () => [] }, jobHuntRuns: { list: () => [] }, candidateFacts: { active: () => [] },
    jobRequirements: { all: () => { calls.requirements++; return []; }, forJob: () => { calls.forJob++; throw new Error("N+1 requirements query"); } },
    analysisItems: { all: () => { calls.items++; return []; }, forAnalysis: () => { calls.forAnalysis++; throw new Error("N+1 items query"); } },
  };
  return { store, calls, mutate: () => { revision++; }, mutateUnrelated: () => {} };
}

test("P1 projection pre-indexes analyses, requirements and items in linear passes", async () => {
  const f = fixture();
  const service = new OpportunityService({ store: f.store, profileProvider: async () => ({}) });
  const first = await service.list();
  const second = await service.list();
  assert.equal(first.length, 1_000);
  assert.equal(first, second);
  assert.equal(service.projectionBuildCount, 1);
  assert.deepEqual(f.calls, { jobs: 1, analyses: 1, requirements: 1, items: 1, forJob: 0, forAnalysis: 0 });
});

test("projection carrega cada intent uma vez e libera o loop durante o ranking", async () => {
  const f = fixture(200);
  f.store.jobHuntProfiles.all = () => [{ id: "profile", jobFamilies: ["BACKEND"], searchIntentVersion: 1 }];
  let queries = 0, yielded = false;
  f.store.searchIntents = { forProfile: () => { queries++; return { families: ["BACKEND"], locationPolicy: {} }; } };
  const service = new OpportunityService({ store: f.store, profileProvider: async () => ({}) });
  const nextTick = new Promise(resolve => setImmediate(() => { yielded = true; resolve(); }));
  const projection = await service.list();
  assert.equal(queries, 1);
  assert.equal(yielded, true);
  assert.equal(projection.length, 200);
  await nextTick;
});

test("P1 projection revision invalidates on persisted mutation without rescanning tables on cached reads", async () => {
  const f = fixture(182);
  const service = new OpportunityService({ store: f.store, profileProvider: async () => ({}) });
  const first = await service.list();
  await service.list();
  f.mutate();
  const rebuilt = await service.list();
  assert.notEqual(rebuilt, first);
  assert.equal(service.projectionBuildCount, 2);
  assert.equal(f.calls.jobs, 2);
});

test("P1 projection cache ignora mutação operacional fora do domínio", async () => {
  const f = fixture(182);
  const service = new OpportunityService({ store: f.store, profileProvider: async () => ({}) });
  const first = await service.list();
  f.mutateUnrelated();
  const second = await service.list();
  assert.equal(second, first);
  assert.equal(service.projectionBuildCount, 1);
});

test("list summaries preserve queue fields without detailed workspace payloads", async () => {
  const f = fixture(1);
  const service = new OpportunityService({ store: f.store, profileProvider: async () => ({}) });
  const [summary] = await service.summaries();

  assert.equal(summary.job.title, "Backend Developer Jr");
  assert.equal(summary.job.description, "APIs");
  assert.equal(summary.job.rawContent, undefined);
  assert.equal(summary.analysis.candidateEvidence, undefined);
  assert.equal(summary.requirements, undefined);
  assert.equal(summary.items, undefined);
});

test("card page preserves canonical ordering while limiting the payload", async () => {
  const f = fixture(40);
  const service = new OpportunityService({ store: f.store, profileProvider: async () => ({}) });
  const page = await service.page({ section: "all", offset: 10, limit: 5 });

  assert.equal(page.opportunities.length, 5);
  assert.equal(page.pagination.total, 40);
  assert.equal(page.pagination.hasMore, true);
  assert.equal(page.opportunities[0].job.id, "job-10");
  assert.equal(page.opportunities[0].job.description, undefined);
  assert.equal(page.opportunities[0].priority.trace, undefined);
  assert.deepEqual(Object.keys(page.opportunities[0].priority.components), ["confidence"]);
});

test("find reuses the current projection without recomputing its revision", async () => {
  const f = fixture(20);
  const service = new OpportunityService({ store: f.store, profileProvider: async () => ({}) });
  await service.list();
  const before = service.projectionBuildCount;
  const item = await service.find("job-7");

  assert.equal(item.job.id, "job-7");
  assert.equal(service.projectionBuildCount, before);
  assert.equal(f.calls.jobs, 1);
});

test("runtime revision window serves the current projection until the next bounded check", async () => {
  const f = fixture(20);
  let now = 1_000;
  const service = new OpportunityService({
    store: f.store,
    profileProvider: async () => ({}),
    revisionCheckIntervalMs: 30_000,
    clock: () => now,
  });
  const first = await service.list();
  f.mutate();
  now += 10_000;
  assert.equal(await service.list(), first);
  now += 30_000;
  assert.notEqual(await service.list(), first);
  assert.equal(service.projectionBuildCount, 2);
});

test("projection prefers compact latest analyses when repository provides it", async () => {
  const f = fixture(3);
  let compactCalls = 0;
  f.store.analyses.latestProjectionPerJob = () => {
    compactCalls++;
    return f.store.analyses.all().map(({ candidateEvidence: _evidence, ...analysis }) => analysis);
  };
  const service = new OpportunityService({ store: f.store, profileProvider: async () => ({}) });

  const result = await service.list();

  assert.equal(result.length, 3);
  assert.equal(compactCalls, 1);
  assert.deepEqual(result[0].analysis.candidateEvidence, undefined);
});
