import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const runId = "job-hunt-run-a34621ba-3e07-41c0-9bdc-e081c2f02099";
const outputIndex = process.argv.indexOf("--output");
const outputPath = path.resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : "docs/audits/linkedin-cost-analysis.json");
const response = await fetch(`http://127.0.0.1:7123/api/discovery-v4/runs/${encodeURIComponent(runId)}`);
if (!response.ok) throw new Error(`Audit run unavailable: HTTP ${response.status}`);
const { run } = await response.json();
const sites = (run.report?.sourceReports || []).flatMap((report) => report.sites || []);
const aggregate = (site) => {
  const items = sites.filter((item) => item.site === site || item.source === site);
  return {
    attempts: items.length,
    outcomes: Object.fromEntries([...items.reduce((map, item) => map.set(item.status, (map.get(item.status) || 0) + 1), new Map())]),
    durationMs: items.reduce((total, item) => total + Number(item.durationMs || 0), 0),
    acceptedResults: items.reduce((total, item) => total + Number(item.acceptedResults || 0), 0),
  };
};
const linkedin = aggregate("linkedin"), indeed = aggregate("indeed");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceRunId: runId,
  externalDiscoveryExecuted: false,
  linkedin,
  indeed,
  comparison: {
    durationRatioLinkedinToIndeed: Number((linkedin.durationMs / Math.max(1, indeed.durationMs)).toFixed(3)),
    descriptionRetrievalDominantCauseProven: false,
    conclusion: "Persisted telemetry proves LinkedIn is costly and timeout-prone, but does not isolate description enrichment as the dominant cause.",
    decision: "KEEP_CURRENT_SINGLE_STAGE_BEHAVIOR",
  },
  safety: { loginAutomation: 0, cookies: 0, captchaBypass: 0, stealthBrowser: 0, externalRequestsFromThisAnalysis: 0 },
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
