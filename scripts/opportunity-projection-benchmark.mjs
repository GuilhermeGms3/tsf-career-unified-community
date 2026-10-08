import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { OpportunityService } from "../src/opportunities/opportunity-service.mjs";

const outputIndex = process.argv.indexOf("--output");
const outputPath = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : "docs/audits/opportunity-projection-benchmark.json");

function storeFor(size) {
  const jobs = Array.from({ length: size }, (_, index) => ({ id: `job-${index}`, title: "Backend Developer Jr", description: "APIs", location: "Brasil", workModel: "REMOTE", lifecycleStatus: "OPEN", createdAt: "2026-08-26", updatedAt: "2026-08-26" }));
  const analyses = jobs.map((job, index) => ({ id: `analysis-${index}`, jobId: job.id, overallScore: 75, score: 75, matchConfidence: 70, evidenceCoverage: 70, eligibility: "ELIGIBLE", blockingIssues: [], updatedAt: "2026-08-26", createdAt: "2026-08-26", algorithmVersion: "ats-matcher-v2" }));
  return {
    database: { connection: { prepare: (sql) => ({ get: () => sql.includes("total_changes") ? { value: 1 } : { data_version: 1 } }) } },
    jobs: { all: () => jobs }, analyses: { all: () => analyses }, applications: { all: () => [] },
    jobFeedback: { all: () => [] }, jobAlerts: { list: () => [] }, jobHuntProfiles: { all: () => [] },
    jobHuntRuns: { list: () => [] }, candidateFacts: { active: () => [] }, jobRequirements: { all: () => [] },
    analysisItems: { all: () => [] },
  };
}

const results = [];
for (const size of [182, 1_000, 5_000, 10_000]) {
  const service = new OpportunityService({ store: storeFor(size), profileProvider: async () => ({}) });
  const rebuildStarted = performance.now();
  await service.list();
  const rebuildMs = performance.now() - rebuildStarted;
  const cachedStarted = performance.now();
  await service.list();
  const cachedReadMs = performance.now() - cachedStarted;
  results.push({ jobs: size, rebuildMs: Number(rebuildMs.toFixed(3)), cachedReadMs: Number(cachedReadMs.toFixed(3)), projectionBuildCount: service.projectionBuildCount, complexity: "O(jobs + analyses + requirements + items)" });
}
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), synthetic: true, externalRequests: 0, results };
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
