export const MASS_HUNT_FUNNEL_FIELDS = Object.freeze([
  "rawDiscoveries",
  "normalizedDiscoveries",
  "candidateDiscoveries",
  "hiringRelevantSignals",
  "opportunityLeads",
  "hiringSignals",
  "canonicalOpportunities",
  "preMatchEvaluated",
  "roleMismatch",
  "locationMismatch",
  "seniorityMismatch",
  "stale",
  "nonJob",
  "passedPreMatch",
  "matchEvaluated",
  "relevantOpportunities",
  "priorityOpportunities",
  "duplicates",
  "filteredOut",
  "backlogConsidered",
  "needsReview",
  "decisionBlocked",
  "decisionSkipped",
  "decisionStretch",
  "decisionReview",
  "decisionRecommended",
  "decisionPrepareEligible",
  "risky",
  "errors",
]);
export function createMassHuntFunnel(input = {}) {
  return Object.fromEntries(
    MASS_HUNT_FUNNEL_FIELDS.map((key) => [
      key,
      Math.max(0, Number(input[key] || 0)),
    ]),
  );
}
export function classifyThresholdScore(
  input,
  {
    consider = 70,
    priority = 85,
    minimumCoverage = 35,
    minimumConfidence = 25,
  } = {},
) {
  const values =
      typeof input === "number"
        ? {
            technicalMatch: input,
            opportunityPriority: input,
            evidenceCoverage: 100,
            confidence: 100,
          }
        : input || {},
    technicalMatch = Number(values.technicalMatch || 0),
    opportunityPriority = Number(values.opportunityPriority || 0),
    evidenceCoverage = Number(values.evidenceCoverage ?? 0),
    confidence = Number(values.confidence ?? 0),
    relevant =
      technicalMatch >= consider &&
      evidenceCoverage >= minimumCoverage &&
      confidence >= minimumConfidence;
  return {
    filtered: !relevant,
    relevant,
    priority: relevant && opportunityPriority >= priority,
  };
}
export function funnelFromFixture({
  raw = 0,
  leads = 0,
  canonical = 0,
  relevant = 0,
  priority = 0,
  duplicates = 0,
} = {}) {
  const canonicalCount = canonical || Math.max(0, raw - duplicates);
  return createMassHuntFunnel({
    rawDiscoveries: raw,
    candidateDiscoveries: canonicalCount,
    hiringRelevantSignals: raw,
    opportunityLeads: leads,
    duplicates,
    canonicalOpportunities: canonicalCount,
    filteredOut: Math.max(0, canonicalCount - relevant),
    matchEvaluated: canonicalCount,
    relevantOpportunities: relevant,
    priorityOpportunities: priority,
  });
}
