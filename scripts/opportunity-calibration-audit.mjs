import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateOpportunityDecision } from "../src/opportunities/opportunity-decision-policy-v2.mjs";

const DEFAULT_RUN_ID = "job-hunt-run-a34621ba-3e07-41c0-9bdc-e081c2f02099";
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const baseUrl = String(args.get("--base-url") || "http://127.0.0.1:7123").replace(/\/$/, "");
const runId = args.get("--run-id") || DEFAULT_RUN_ID;
const phase = args.get("--phase") || "snapshot";
const recalculate = args.get("--recalculate") === "true";
const baselinePath = args.get("--baseline") ? path.resolve(args.get("--baseline")) : "";
const outputPath = path.resolve(args.get("--output") || `docs/audits/opportunity-calibration-${phase}.json`);

function countBy(items, selector) {
  return Object.fromEntries(
    [...items.reduce((counts, item) => {
      const key = selector(item) || "UNSPECIFIED";
      counts.set(key, (counts.get(key) || 0) + 1);
      return counts;
    }, new Map())].sort(([leftKey, leftCount], [rightKey, rightCount]) =>
      rightCount - leftCount || String(leftKey).localeCompare(String(rightKey))),
  );
}

function jobRef(jobId) {
  return `job-${createHash("sha256").update(String(jobId)).digest("hex").slice(0, 12)}`;
}

function requirementProvenance(requirement = {}) {
  if (requirement.metadata?.provenance) return requirement.metadata.provenance;
  if (requirement.source === "job.title") return "INFERRED_FROM_TITLE";
  if (["job.location", "job.workModel", "job.jobType", "job.salary"].includes(requirement.source)) return "CLASSIFICATION_CONTEXT";
  return requirement.importance === "unspecified" && !requirement.required
    ? "INFERRED_FROM_DESCRIPTION"
    : "EXPLICIT_REQUIREMENT";
}

function sanitizedGap(gap, items) {
  const item = items.find((candidate) => {
    const normalized = String(candidate.requirement?.normalizedName || "")
      .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
      .replace(/[^a-z0-9+#]+/g, "-").replace(/^-+|-+$/g, "");
    return normalized === gap.requirement;
  });
  const requirement = item?.requirement || {};
  return {
    type: requirement.type || "unknown",
    requirementRef: createHash("sha256").update(`${requirement.type || ""}|${requirement.normalizedName || gap.requirement || ""}`).digest("hex").slice(0, 10),
    required: requirement.required === true,
    importance: requirement.importance || "unspecified",
    criticality: gap.criticality,
    provenance: requirementProvenance(requirement),
    extractionConfidence: Number(requirement.confidence ?? 0),
    matchStatus: item?.status || "UNKNOWN",
    evidenceResolution: item?.resolution?.reason || "UNSPECIFIED",
    gapStatus: gap.status,
  };
}

function rootCauses(opportunity) {
  const decision = opportunity.decision || {};
  const causes = [];
  if (decision.gapSummary?.counts?.MATERIAL_GAP) causes.push("MATERIAL_GAP");
  if (opportunity.preMatch?.seniority === "MID") causes.push("MID_SENIORITY");
  if (decision.familyFit?.level === "ADJACENT") causes.push("FAMILY_ADJACENCY");
  if (Number(opportunity.analysis?.matchConfidence ?? 100) < 40) causes.push("LOW_CONFIDENCE");
  for (const type of ["experience_years", "education", "language", "domain", "specific_experience"]) {
    if ((opportunity.items || []).some((item) => item.requirement?.type === type && item.status !== "MATCH")) causes.push(type.toUpperCase());
  }
  return [...new Set(causes)];
}

function summarize(opportunity) {
  const gaps = (opportunity.decision?.gapSummary?.items || []).map((gap) => sanitizedGap(gap, opportunity.items || []));
  return {
    jobRef: jobRef(opportunity.job.id),
    disposition: opportunity.decision?.disposition || "UNKNOWN",
    familyFit: opportunity.decision?.familyFit?.level || "UNKNOWN",
    primaryJobFamily: opportunity.decision?.familyFit?.primary || opportunity.preMatch?.primaryJobFamily || "UNKNOWN",
    seniority: opportunity.preMatch?.seniority || opportunity.job?.seniority || "UNKNOWN",
    technicalMatch: Number(opportunity.analysis?.technicalMatch ?? opportunity.analysis?.overallScore ?? 0),
    evidenceCoverage: Number(opportunity.analysis?.evidenceCoverage ?? 0),
    matchConfidence: Number(opportunity.analysis?.matchConfidence ?? 0),
    rootCauses: rootCauses(opportunity),
    primaryDecisionReason: opportunity.decision?.primaryDecisionReason || "LEGACY_UNSTRUCTURED",
    hardBlockers: opportunity.decision?.hardBlockers || [],
    gapCounts: opportunity.decision?.gapSummary?.counts || {},
    gaps,
  };
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} while reading ${url}`);
  return response.json();
}

const [{ run }, opportunityPayload, profilePayload] = await Promise.all([
  getJson(`${baseUrl}/api/discovery-v4/runs/${encodeURIComponent(runId)}`),
  getJson(`${baseUrl}/api/opportunities`),
  getJson(`${baseUrl}/api/job-hunt/profiles`),
]);
const intentPayload = await getJson(`${baseUrl}/api/discovery-v3/search-intents/${encodeURIComponent(run.profileId)}`);
const originPolicy = (profilePayload.profiles || []).find((item) => item.id === run.profileId) || {};
const originIntent = intentPayload.intent || {};
const runJobIds = new Set((run.report?.preMatchDecisions || []).map((item) => item.jobId));
let runOpportunities = (opportunityPayload.opportunities || []).filter((item) => runJobIds.has(item.job.id));
if (recalculate) {
  runOpportunities = runOpportunities.map((item) => {
    return { ...item, decision: evaluateOpportunityDecision({ ...item, intent: originIntent, policies: [originPolicy], thresholds: item.decision?.thresholds || {} }) };
  });
}
const byDisposition = Object.groupBy(runOpportunities, (item) => item.decision?.disposition || "UNKNOWN");
const stretches = (byDisposition.STRETCH || []).map(summarize).sort((left, right) => left.jobRef.localeCompare(right.jobRef));
const reviews = (byDisposition.REVIEW || []).map(summarize).sort((left, right) => left.jobRef.localeCompare(right.jobRef));
const blockedBoundary = (byDisposition.BLOCKED || []).map(summarize)
  .sort((left, right) => right.technicalMatch - left.technicalMatch || left.jobRef.localeCompare(right.jobRef)).slice(0, 5);
const historicalPositiveControls = (opportunityPayload.opportunities || [])
  .filter((item) => !runJobIds.has(item.job.id) && ["RECOMMENDED", "PREPARE_ELIGIBLE"].includes(item.decision?.disposition))
  .map(summarize).sort((left, right) => right.technicalMatch - left.technicalMatch || left.jobRef.localeCompare(right.jobRef)).slice(0, 10);
const stretchGaps = stretches.flatMap((item) => item.gaps);
let transitions = {};
if (baselinePath) {
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const before = [...(baseline.audited?.stretch || []), ...(baseline.audited?.review || [])];
  const after = new Map(runOpportunities.map((item) => [jobRef(item.job.id), item.decision?.disposition || "UNKNOWN"]));
  transitions = countBy(before, (item) => `${item.disposition} -> ${after.get(item.jobRef) || "MISSING"}`);
}

const audit = {
  schemaVersion: 1,
  phase,
  generatedAt: new Date().toISOString(),
  source: { runId, externalDiscoveryExecuted: false, canonicalJobs: run.canonicalCount, rawJobs: run.rawCount },
  persistedBaselineCounts: run.report?.opportunityDecisionCounts || {},
  evaluatedSnapshotCounts: countBy(runOpportunities, (item) => item.decision?.disposition),
  transitions,
  rootCauseDistribution: countBy(stretches.flatMap((item) => item.rootCauses), (item) => item),
  stretchCriticality: countBy(stretchGaps, (item) => item.criticality),
  stretchProvenance: countBy(stretchGaps, (item) => item.provenance),
  stretchEvidenceResolution: countBy(stretchGaps, (item) => item.evidenceResolution),
  systematicBias: {
    materialGapItems: stretchGaps.filter((item) => item.gapStatus === "MATERIAL_GAP").length,
    unspecifiedNonRequiredMaterialItems: stretchGaps.filter((item) => item.gapStatus === "MATERIAL_GAP" && !item.required && item.importance === "unspecified").length,
    stretchJobsWithUnspecifiedNonRequiredMaterial: stretches.filter((item) => item.gaps.some((gap) => gap.gapStatus === "MATERIAL_GAP" && !gap.required && gap.importance === "unspecified")).length,
  },
  samples: {
    oldStretch: stretches.slice(0, 10),
    oldReview: reviews,
    blockedBoundary,
    historicalPositiveControls,
  },
  audited: { stretch: stretches, review: reviews },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, ...audit.source, persistedBaselineCounts: audit.persistedBaselineCounts, evaluatedSnapshotCounts: audit.evaluatedSnapshotCounts, rootCauseDistribution: audit.rootCauseDistribution, systematicBias: audit.systematicBias, samples: Object.fromEntries(Object.entries(audit.samples).map(([key, value]) => [key, value.length])) }, null, 2));
