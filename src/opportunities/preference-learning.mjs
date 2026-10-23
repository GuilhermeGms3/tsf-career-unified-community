import { classifyJobFamily } from "../discovery/relevance/pre-match-plausibility.mjs";

export function preferenceLearning(jobs = [], feedback = [], now = Date.now()) {
  const byId = new Map(jobs.map(job => [job.id, job])), families = new Map();
  for (const item of feedback) {
    if (!["APPLY", "REJECT"].includes(item.userDecision)) continue;
    if (item.userDecision === "REJECT" && !["", "NOT_INTERESTED", "BAD_ROLE"].includes(item.rejectionReason || "")) continue;
    const job = byId.get(item.jobId);
    if (!job) continue;
    const family = classifyJobFamily({ title: job.title }).primaryJobFamily;
    if (!family || family === "UNKNOWN") continue;
    const record = families.get(family) || { family, accepted: 0, rejected: 0, weight: 0, adjustment: 0 };
    const age = Math.max(0, now - (Date.parse(item.updatedAt || item.createdAt) || now));
    const weight = Math.exp(-age / (90 * 86_400_000));
    record[item.userDecision === "APPLY" ? "accepted" : "rejected"]++;
    record.weight += (item.userDecision === "APPLY" ? 1 : -1) * weight;
    const count = record.accepted + record.rejected;
    record.adjustment = count >= 3 ? Math.round(3 * record.weight / (count + 4) * 100) / 100 : 0;
    families.set(family, record);
  }
  return families;
}
