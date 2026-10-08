import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  jobMatchesLocationPolicy,
  jobMatchesSeniority,
  jobMatchesWorkModels,
} from "../src/automation/job-hunt-policy.mjs";

const fixturePath = fileURLToPath(
    new URL("../tests/fixtures/discovery/relevance-r1.json", import.meta.url),
  ),
  fixture = JSON.parse(await readFile(fixturePath, "utf8")),
  positiveLabels = new Set(["HIGHLY_RELEVANT", "RELEVANT"]),
  irrelevantLabels = new Set([
    "IRRELEVANT_ROLE",
    "IRRELEVANT_LOCATION",
    "IRRELEVANT_SENIORITY",
    "IRRELEVANT_OPPORTUNITY_TYPE",
    "STALE",
    "DUPLICATE",
  ]),
  grade = (label) =>
    label === "HIGHLY_RELEVANT"
      ? 3
      : label === "RELEVANT"
        ? 2
        : ["NEEDS_REVIEW", "INSUFFICIENT_INFORMATION"].includes(label)
          ? 1
          : 0,
  round = (value) => Number(value.toFixed(4));

function legacyDecision(job, intent) {
  if (job.lifecycleStatus && job.lifecycleStatus !== "OPEN")
    return { decision: "REJECT", reasons: ["LIFECYCLE_MISMATCH"] };
  if (
    !jobMatchesWorkModels(job, ["REMOTE", "HYBRID", "ONSITE"]) ||
    !jobMatchesSeniority(job, intent.seniorities)
  )
    return { decision: "REJECT", reasons: ["SENIORITY_MISMATCH"] };
  const location = jobMatchesLocationPolicy(job, intent.locationPolicy);
  if (!location.accepted)
    return { decision: "REJECT", reasons: ["LOCATION_MISMATCH"] };
  return { decision: "PASS", reasons: [] };
}

function dcg(items, k) {
  return items
    .slice(0, k)
    .reduce(
      (total, item, index) =>
        total + (2 ** grade(item.expectedLabel) - 1) / Math.log2(index + 2),
      0,
    );
}

function accuracy(items, predicate, observed) {
  const scoped = items.filter(predicate);
  return scoped.length
    ? round(scoped.filter((item) => observed(item)).length / scoped.length)
    : null;
}

export function benchmark(items, decide) {
  const evaluated = items.map((item, index) => ({
      ...item,
      index,
      result: decide(item, fixture.intent),
    })),
    ranked = [...evaluated].sort((a, b) => {
      const order = { PASS: 0, PASS_WITH_WARNINGS: 1, REVIEW: 2, REJECT: 3 };
      return (
        (order[a.result.decision] ?? 3) - (order[b.result.decision] ?? 3) ||
        Number(b.result.score || 0) - Number(a.result.score || 0) ||
        a.index - b.index
      );
    }),
    visible = ranked.filter((item) => item.result.decision !== "REJECT"),
    relevant = evaluated.filter((item) => positiveLabels.has(item.expectedLabel)),
    truePositive = visible.filter((item) =>
      positiveLabels.has(item.expectedLabel),
    ).length,
    falsePositive = visible.filter((item) =>
      irrelevantLabels.has(item.expectedLabel),
    ).length,
    falseNegative = evaluated.filter(
      (item) =>
        positiveLabels.has(item.expectedLabel) &&
        item.result.decision === "REJECT",
    ).length,
    ideal = [...evaluated].sort(
      (a, b) => grade(b.expectedLabel) - grade(a.expectedLabel),
    ),
    precision = (k) =>
      round(
        ranked
          .slice(0, k)
          .filter(
            (item) =>
              item.result.decision !== "REJECT" &&
              positiveLabels.has(item.expectedLabel),
          ).length / Math.min(k, ranked.length),
      ),
    ndcg = (k) => round(dcg(ranked, k) / (dcg(ideal, k) || 1));
  return {
    dataset: fixture.name,
    sampleSize: evaluated.length,
    metrics: {
      precisionAt5: precision(5),
      precisionAt10: precision(10),
      recall: round(truePositive / (relevant.length || 1)),
      ndcgAt5: ndcg(5),
      ndcgAt10: ndcg(10),
      falsePositiveRate: round(
        falsePositive / Math.max(1, truePositive + falsePositive),
      ),
      falseNegativeRate: round(falseNegative / Math.max(1, relevant.length)),
      familyAccuracy: accuracy(
        evaluated,
        () => true,
        (item) =>
          item.result.reasons.includes("ROLE_FAMILY_MISMATCH") ===
          (item.expectedReason === "ROLE_FAMILY_MISMATCH"),
      ),
      locationAccuracy: accuracy(
        evaluated,
        () => true,
        (item) =>
          item.result.reasons.includes("LOCATION_MISMATCH") ===
          (item.expectedReason === "LOCATION_MISMATCH"),
      ),
      seniorityAccuracy: accuracy(
        evaluated,
        () => true,
        (item) =>
          item.result.reasons.includes("SENIORITY_MISMATCH") ===
          (item.expectedReason === "SENIORITY_MISMATCH"),
      ),
      freshnessAccuracy: accuracy(
        evaluated,
        () => true,
        (item) =>
          item.result.reasons.includes("STALE") ===
          (item.expectedReason === "STALE"),
      ),
    },
    decisions: evaluated.map((item) => ({
      id: item.id,
      expectedLabel: item.expectedLabel,
      expectedReason: item.expectedReason,
      decision: item.result.decision,
      reasons: item.result.reasons,
    })),
  };
}

export { fixture, legacyDecision };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseline = benchmark(fixture.items, legacyDecision);
  if (process.argv.includes("--baseline-only"))
    console.log(JSON.stringify({ baseline }, null, 2));
  else {
    const { PreMatchPlausibility } = await import(
        "../src/discovery/relevance/pre-match-plausibility.mjs"
      ),
      plausibility = new PreMatchPlausibility(),
      after = benchmark(fixture.items, (job, intent) =>
        plausibility.evaluate(job, intent),
      );
    console.log(JSON.stringify({ baseline, after }, null, 2));
  }
}
