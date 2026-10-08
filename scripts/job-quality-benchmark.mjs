import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";
import { calculateOpportunityPriority } from "../src/opportunities/opportunity-priority.mjs";
import { evaluateOpportunityDecision } from "../src/opportunities/opportunity-decision-policy-v2.mjs";
import { assessJobAnalyzability } from "../src/discovery/provider-quality-service.mjs";

const CONFIG_VERSION = "job-quality-benchmark-v2";
const argument = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const jsonLines = (items) => `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
const parseJsonLines = (body) => body.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const normalizedSet = (values = []) => new Set(values.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
const unavailable = (labeled = 0) => ({ value: null, status: "INSUFFICIENT_DATA", labeled });

export function benchmarkOriginType(job = {}) {
  const urls = [job.canonicalUrl, job.applicationUrl, job.url, job.sourceUrl].join(" ");
  if (/example\.(?:test|com)|localhost|127\.0\.0\.1|fixture/i.test(urls) || /fixture|test/i.test(String(job.provider || job.source))) return "FIXTURE";
  if (job.discoveredVia) return "DISCOVERY";
  if (job.provider) return "PROVIDER";
  if (/manual|import/i.test(String(job.source || ""))) return "MANUAL_IMPORT";
  return "UNKNOWN";
}

export function isOfficialBenchmarkRecord(record, { includeManual = false } = {}) {
  return ["DISCOVERY", "PROVIDER", ...(includeManual ? ["MANUAL_IMPORT"] : [])].includes(record.provenance?.originType);
}

function deterministicSample(items, size) {
  const groups = new Map();
  for (const item of [...items].sort((a, b) => String(a.job?.id).localeCompare(String(b.job?.id)))) {
    const key = `${item.job?.provider || "unknown"}:${item.job?.discoveredVia || item.job?.portal || "unknown"}`.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const result = [], queues = [...groups.values()];
  while (result.length < size && queues.some((queue) => queue.length)) for (const queue of queues) if (queue.length && result.length < size) result.push(queue.shift());
  return result;
}

function setMetrics(rows, labelKey, predicted) {
  const labeled = rows.filter(({ label }) => Array.isArray(label?.[labelKey]));
  if (!labeled.length) return unavailable();
  let tp = 0, fp = 0, fn = 0;
  for (const row of labeled) {
    const expected = normalizedSet(row.label[labelKey]), actual = normalizedSet(predicted(row.record));
    for (const value of actual) expected.has(value) ? tp++ : fp++;
    for (const value of expected) if (!actual.has(value)) fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
  return { status: "MEASURED", labeled: labeled.length, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 };
}

function accuracy(rows, labelKey, predicted) {
  const labeled = rows.filter(({ label }) => label?.[labelKey] !== null && label?.[labelKey] !== undefined && label?.[labelKey] !== "");
  if (!labeled.length) return unavailable();
  const correct = labeled.filter((row) => String(predicted(row.record) ?? "").toLowerCase() === String(row.label[labelKey]).toLowerCase()).length;
  return { status: "MEASURED", labeled: labeled.length, correct, value: correct / labeled.length };
}

function precisionAt(rows, size) {
  const top = rows.slice(0, size).filter(({ label }) => typeof label?.humanWouldApply === "boolean");
  if (!top.length) return unavailable();
  const positives = top.filter(({ label }) => label.humanWouldApply).length;
  return { status: "MEASURED", labeled: top.length, positives, value: positives / top.length };
}

export function ndcgAt(rows, size) {
  const top = rows.slice(0, size).filter(({ label }) => label?.humanPriority !== null && label?.humanPriority !== undefined && label?.humanPriority !== "" && Number.isFinite(Number(label.humanPriority)));
  if (!top.length) return unavailable();
  const dcg = (values) => values.reduce((sum, value, index) => sum + (Math.pow(2, value) - 1) / Math.log2(index + 2), 0);
  const values = top.map(({ label }) => Number(label.humanPriority) / 100), ideal = [...values].sort((a, b) => b - a);
  return { status: "MEASURED", labeled: top.length, value: dcg(ideal) ? dcg(values) / dcg(ideal) : 0 };
}

export function runBenchmarkPipeline(item, profile = {}) {
  const job = item.job || {};
  const analysis = runAtsMatcherV2({ job, profile, resume: { id: null, text: "", sections: {} } });
  const priority = calculateOpportunityPriority({ job, analysis, requirements: analysis.requirements, items: analysis.items, profile, sourceQuality: job.sourceQuality || null });
  const decision = evaluateOpportunityDecision({ job, analysis, preMatch: item.preMatch || {}, requirements: analysis.requirements, items: analysis.items, priority, policies: [], intent: {} });
  return { analysis, priority, decision };
}

function makeRecord(item, profileSnapshotId, profile) {
  const job = item.job || {}, pipeline = runBenchmarkPipeline(item, profile), assessment = assessJobAnalyzability(job, pipeline.analysis.requirements);
  return {
    schemaVersion: 2, benchmarkConfigurationVersion: CONFIG_VERSION, benchmarkJobId: `benchmark-${job.id}`,
    candidateProfileSnapshotId: profileSnapshotId, resumeSnapshotId: null, sourceId: job.sourceId || null,
    technicalProvider: job.provider || job.source || null, sourcePortal: job.discoveredVia || job.portal || job.provider || null,
    externalJobId: job.externalId || null, canonicalUrl: job.canonicalUrl || job.applicationUrl || job.url || null,
    company: job.company || null, title: job.title || null, location: job.location || null,
    rawDescription: job.rawDescription || job.description || null, normalizedDescription: job.description || null,
    publishedAt: job.postedAt || job.datePosted || null, retrievedAt: job.lastSeenAt || job.createdAt || null,
    lifecycle: job.lifecycleStatus || null,
    provenance: { originType: benchmarkOriginType(job), discoveredVia: job.discoveredVia || null, provider: job.provider || null },
    sourceSnapshotMetadata: job.sourceMetadata || null, analyzability: assessment,
    matcher: {
      matcherVersion: pipeline.analysis.matcherVersion, scoringModelVersion: pipeline.analysis.scoringModelVersion,
      requirementExtractorVersion: pipeline.analysis.requirementExtractorVersion, executionMode: "END_TO_END",
      calibratedMatchScore: pipeline.analysis.calibratedMatchScore, knownEvidenceMatch: pipeline.analysis.knownEvidenceMatch,
      evidenceCoverage: pipeline.analysis.evidenceCoverage, matchConfidence: pipeline.analysis.matchConfidence,
      predictedJobFamily: item.preMatch?.primaryJobFamily || item.preMatch?.jobFamily || null,
      predictedSeniority: item.preMatch?.seniority || job.seniority || null,
      extractedRequirements: pipeline.analysis.requirements.filter((requirement) => requirement.metadata?.provenance !== "CLASSIFICATION_CONTEXT").map((requirement) => ({ name: requirement.normalizedName, type: requirement.type, required: requirement.required, importance: requirement.importance })),
    },
    decision: { disposition: pipeline.decision.disposition, recommended: pipeline.decision.visibility.recommended },
    ranking: { score: pipeline.priority.score, reasons: pipeline.priority.rankingReasons, warnings: pipeline.priority.rankingWarnings },
  };
}

const labelTemplate = (record) => ({ jobId: record.benchmarkJobId, relevant: null, jobFamily: null, seniority: null, locationAcceptable: null, openAtLabelTime: null, requiredSkills: null, preferredSkills: null, hardRequirements: null, blockingRequirements: null, humanWouldApply: null, humanPriority: null, notes: null, labeledAt: null, labelVersion: 1 });

export async function main() {
  const baseUrl = argument("--base-url", "http://127.0.0.1:7123").replace(/\/$/, ""), limit = Math.max(100, Math.min(300, Number(argument("--limit", 250)) || 250));
  const dataDir = path.resolve(process.env.HUB_DATA_DIR || "data");
  const outputDir = path.resolve(argument("--output", path.join(dataDir, "benchmarks", "jobs"))), labelsPath = path.resolve(argument("--labels", path.join(dataDir, "benchmarks", "labels", "gold-labels.jsonl")));
  let profile = {}; try { profile = JSON.parse(await readFile(path.join(dataDir, "profile.json"), "utf8")); } catch {}
  const benchmarkProfile = { career: profile.career || {}, experience: profile.experience || "", education: profile.education || "", certifications: profile.certifications || "" };
  const profileSnapshotId = `profile-${createHash("sha256").update(JSON.stringify(benchmarkProfile)).digest("hex").slice(0, 16)}`;
  const response = await fetch(`${baseUrl}/api/opportunities`); if (!response.ok) throw new Error(`Career Unified respondeu HTTP ${response.status}.`);
  const payload = await response.json(), records = deterministicSample(payload.opportunities || [], limit).map((item) => makeRecord(item, profileSnapshotId, benchmarkProfile));
  const officialRecords = records.filter((record) => isOfficialBenchmarkRecord(record, { includeManual: process.argv.includes("--include-manual") }));
  let labels = []; try { labels = parseJsonLines(await readFile(labelsPath, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const labelsByJob = new Map(labels.map((label) => [label.jobId, label]));
  for (const record of officialRecords) if (!labelsByJob.has(record.benchmarkJobId)) labelsByJob.set(record.benchmarkJobId, labelTemplate(record));
  labels = [...labelsByJob.values()].filter((label) => officialRecords.some((record) => record.benchmarkJobId === label.jobId));
  const joined = officialRecords.map((record) => ({ record, label: labelsByJob.get(record.benchmarkJobId) })).sort((a, b) => b.record.ranking.score - a.record.ranking.score);
  const hard = setMetrics(joined, "hardRequirements", (record) => record.matcher.extractedRequirements.filter((item) => item.required).map((item) => item.name));
  const preferred = setMetrics(joined, "preferredSkills", (record) => record.matcher.extractedRequirements.filter((item) => item.importance === "preferred").map((item) => item.name));
  const skills = setMetrics(joined, "requiredSkills", (record) => record.matcher.extractedRequirements.filter((item) => ["skill", "tool", "framework", "platform", "cloud"].includes(item.type)).map((item) => item.name));
  const duplicateRate = officialRecords.length ? 1 - new Set(officialRecords.map((record) => record.canonicalUrl || record.benchmarkJobId)).size / officialRecords.length : null;
  const top10 = joined.slice(0, 10);
  const report = {
    schemaVersion: 2, generatedAt: new Date().toISOString(), benchmarkConfigurationVersion: CONFIG_VERSION,
    dataset: { requested: limit, captured: records.length, officialRealRecords: officialRecords.length, excludedFixturesOrUnknown: records.length - officialRecords.length, humanLabels: labels.filter((label) => label.labeledAt).length, profileSnapshotId },
    metrics: {
      precisionAt5: precisionAt(joined, 5), precisionAt10: precisionAt(joined, 10), recall: unavailable(), ndcgAt5: ndcgAt(joined, 5), ndcgAt10: ndcgAt(joined, 10),
      humanWouldApplyAt5: precisionAt(joined, 5), humanWouldApplyAt10: precisionAt(joined, 10),
      jobFamilyAccuracy: accuracy(joined, "jobFamily", (record) => record.matcher.predictedJobFamily), seniorityAccuracy: accuracy(joined, "seniority", (record) => record.matcher.predictedSeniority), locationAccuracy: unavailable(),
      hardRequirementPrecisionRecallF1: hard, preferredRequirementPrecisionRecallF1: preferred, skillExtractionPrecisionRecallF1: skills, blockerMissRate: unavailable(),
      duplicateRate, staleTop10Rate: top10.length ? top10.filter(({ record }) => record.lifecycle === "CLOSED").length / top10.length : null,
      descriptionAvailabilityRate: officialRecords.length ? officialRecords.filter((record) => record.rawDescription).length / officialRecords.length : null,
      analyzableJobRate: officialRecords.length ? officialRecords.filter((record) => record.analyzability.analyzable).length / officialRecords.length : null,
      lowCoverageHighScoreIncidentRate: officialRecords.length ? officialRecords.filter((record) => record.matcher.evidenceCoverage < 50 && record.matcher.calibratedMatchScore >= 70).length / officialRecords.length : null,
    },
    targets: { precisionAt10: .8, descriptionAvailabilityRate: .9, hardRequirementF1: .9, staleTop10RateMax: .05, blockerMissRateTarget: 0, lowCoverageHighScoreWithoutWarning: 0, duplicateRateMax: .02, humanWouldApplyAt10: .7, analyzableRecommendedRate: .9 },
  };
  await mkdir(outputDir, { recursive: true }); await mkdir(path.dirname(labelsPath), { recursive: true });
  await writeFile(path.join(outputDir, `${profileSnapshotId}.json`), `${JSON.stringify(benchmarkProfile, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "jobs.jsonl"), jsonLines(records), "utf8"); await writeFile(labelsPath, jsonLines(labels), "utf8"); await writeFile(path.join(outputDir, "latest-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
