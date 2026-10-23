import {
  classifyFreshness, classifyGeography, classifyJobFamily,
  classifyOpportunityType, classifySeniority,
} from "../discovery/relevance/pre-match-plausibility.mjs";
import { classifyRequirementCriticality, REQUIREMENT_CRITICALITIES } from "../matching/requirement-criticality.mjs";
import { classifyRequirementGap, GAP_STATUSES } from "../matching/gap-engine.mjs";
import { isCurrentAtsAnalysis } from "../matching/analysis-version.mjs";
import { jobInformationQuality } from "../matching/job-information-quality.mjs";

export const OPPORTUNITY_DISPOSITIONS = Object.freeze(["BLOCKED", "SKIP", "STRETCH", "REVIEW", "RECOMMENDED", "PREPARE_ELIGIBLE"]);
export { classifyRequirementCriticality, classifyRequirementGap, REQUIREMENT_CRITICALITIES, GAP_STATUSES };

const familyAdjacency = Object.freeze({
  BACKEND: new Set(["FULLSTACK", "DEVOPS_SRE", "SOFTWARE_INTERNSHIP"]),
  FULLSTACK: new Set(["BACKEND", "FRONTEND", "SOFTWARE_INTERNSHIP"]),
  DEVOPS_SRE: new Set(["BACKEND", "CLOUD_INFRA", "SOFTWARE_INTERNSHIP"]),
  SOFTWARE_INTERNSHIP: new Set(["BACKEND", "FULLSTACK", "DEVOPS_SRE", "FRONTEND"]),
});
const unique = (values) => [...new Set(values.filter(Boolean))];
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function requestedFamilies(intent = {}, policies = []) {
  const original = intent.originalIntent || {};
  const policy = policies[0] || {};
  return unique([...(intent.families || []), ...(original.jobFamilies || []), ...(original.families || []), ...(policy.jobFamilies || [])]);
}

export function classifyFamilyFit({ job = {}, preMatch = {}, intent = {}, policies = [] } = {}) {
  const requested = requestedFamilies(intent, policies);
  const canonical = preMatch.primaryJobFamily && Array.isArray(preMatch.secondaryJobFamilies)
    ? preMatch
    : classifyJobFamily(job, { families: requested });
  const classified = {
    ...canonical, ...preMatch,
    secondaryJobFamilies: Array.isArray(preMatch.secondaryJobFamilies) ? preMatch.secondaryJobFamilies : canonical.secondaryJobFamilies,
    negativeOccupationalEvidence: Array.isArray(preMatch.negativeOccupationalEvidence) ? preMatch.negativeOccupationalEvidence : canonical.negativeOccupationalEvidence,
  };
  const primary = classified.primaryJobFamily || "UNKNOWN";
  const secondary = classified.secondaryJobFamilies || [];
  if (!requested.length || primary === "UNKNOWN") return { level: "UNKNOWN", primary, secondary, requested };
  if (requested.includes(primary)) return { level: "EXACT_PRIMARY", primary, secondary, requested };
  if (secondary.some((family) => requested.includes(family))) return { level: "EXACT_SECONDARY", primary, secondary, requested };
  if (requested.some((target) => familyAdjacency[target]?.has(primary) || secondary.some((family) => familyAdjacency[target]?.has(family)))) return { level: "ADJACENT", primary, secondary, requested };
  return { level: "UNRELATED", primary, secondary, requested };
}

const DEFAULT_THRESHOLDS = Object.freeze({ considerThreshold: 70, prepareResumeThreshold: 82, notifyThreshold: 85, reviewFloor: 35, stretchFloor: 50 });
const threshold = (value, fallback) => Math.max(0, Math.min(100, number(value, fallback)));
export function resolveOpportunityThresholds(policies = [], overrides = {}) {
  const policy = policies[0] || {};
  return Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([key, fallback]) => [key, threshold(overrides[key] ?? policy[key], fallback)]));
}

function explanationFor({ disposition, primaryDecisionReason, counts, gaps, hardBlockers }) {
  const material = counts.MATERIAL_GAP || 0;
  const topMaterial = gaps.find((item) => item.status === "MATERIAL_GAP")?.requirement?.replaceAll("-", " ");
  if (disposition === "BLOCKED") return `Não é compatível com a política atual: ${String(hardBlockers[0] || "bloqueio confirmado").replaceAll("_", " ").toLowerCase()}.`;
  if (primaryDecisionReason === "MATERIAL_GAP_PRESENT") return `Vale considerar, mas há ${material} requisito(s) obrigatório(s) ou importante(s) sem evidência suficiente${topMaterial ? `; primeiro ponto: ${topMaterial}` : ""}.`;
  if (primaryDecisionReason === "MID_SENIORITY_DISTANCE") return "Vale considerar com cautela: a vaga foi classificada como nível pleno e exige revisão da distância de senioridade.";
  if (primaryDecisionReason === "FAMILY_ADJACENT") return "Vale considerar como transição: a família profissional é adjacente, não uma correspondência direta.";
  if (disposition === "REVIEW") return "A oportunidade é plausível, mas precisa de revisão por score, confiança ou evidência ainda incompleta.";
  if (disposition === "SKIP") return "A oportunidade ficou abaixo do piso de aderência ou foi marcada como não interessante.";
  if (disposition === "PREPARE_ELIGIBLE") return "Aderência e evidências permitem preparar um currículo para revisão humana.";
  return "Aderência suficiente e nenhum bloqueio ou requisito material sem resolução foi encontrado.";
}

export function evaluateOpportunityDecision(input = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const job = input.job || {};
  const analysis = input.analysis || null;
  const priority = input.priority || {};
  const preMatch = input.preMatch || {};
  const feedback = input.feedback || null;
  const policies = input.policies || [];
  const intent = input.intent || {};
  const requested = requestedFamilies(intent, policies);
  const canonicalFamily = preMatch.primaryJobFamily && Array.isArray(preMatch.secondaryJobFamilies)
    ? preMatch
    : classifyJobFamily(job, { families: requested });
  const familyDiagnostics = {
    ...canonicalFamily, ...preMatch,
    secondaryJobFamilies: Array.isArray(preMatch.secondaryJobFamilies) ? preMatch.secondaryJobFamilies : canonicalFamily.secondaryJobFamilies,
    negativeOccupationalEvidence: Array.isArray(preMatch.negativeOccupationalEvidence) ? preMatch.negativeOccupationalEvidence : canonicalFamily.negativeOccupationalEvidence,
  };
  const familyFit = classifyFamilyFit({ job, preMatch: familyDiagnostics, intent, policies });
  const seniority = preMatch.seniority || classifySeniority(job).seniority;
  const freshness = preMatch.freshness || classifyFreshness(job, now);
  const geography = preMatch.geography || classifyGeography(job, intent.locationPolicy || {});
  const opportunityType = preMatch.opportunityType || classifyOpportunityType(job).opportunityType;
  const gaps = (input.items || []).map((item) => classifyRequirementGap(item, { familyFit, intent }));
  const hardBlockers = [];
  const warnings = [];
  if (!jobInformationQuality(job).sufficient) warnings.push("JOB_DESCRIPTION_INSUFFICIENT");
  const thresholds = resolveOpportunityThresholds(policies, input.thresholds);
  const currentAnalysis = isCurrentAtsAnalysis(analysis);
  const addBlock = (value) => { if (value && !hardBlockers.includes(value)) hardBlockers.push(value); };

  if (String(job.lifecycleStatus).toUpperCase() === "CLOSED" || preMatch.reasons?.includes("JOB_CLOSED")) addBlock("JOB_CLOSED");
  if (freshness.stale || preMatch.reasons?.includes("STALE")) addBlock("STALE");
  if (preMatch.reasons?.includes("NON_JOB_CONTENT") || ["EVENT", "COURSE", "SCHOLARSHIP"].includes(opportunityType)) addBlock("NON_JOB_CONTENT");
  const geographyBlock = preMatch.reasons?.find((reason) => ["LOCATION_MISMATCH", "FOREIGN_LOCATION", "OUTSIDE_ACCEPTED_REGION", "LOCATION_CONFLICT", "WORK_MODEL_MISMATCH"].includes(reason));
  if (geographyBlock || !geography.accepted) addBlock(geographyBlock || geography.geographicMatch?.reasonCodes?.[0] || "OUTSIDE_ACCEPTED_REGION");
  const negativeOccupation = familyDiagnostics.negativeOccupationalEvidence || [];
  const strongNegativeOccupation = negativeOccupation.some((item) => item.inTitle) || (familyFit.primary === "UNKNOWN" && negativeOccupation.length > 0);
  if (familyFit.level === "UNRELATED" || (strongNegativeOccupation && familyFit.level !== "EXACT_PRIMARY" && familyFit.level !== "EXACT_SECONDARY")) addBlock("ROLE_FAMILY_MISMATCH");
  if (seniority === "SENIOR") addBlock("SENIORITY_MISMATCH");
  else if (seniority === "MID") warnings.push("MID_SENIORITY_STRETCH");
  for (const gap of gaps.filter((item) => item.status === "BLOCKING_GAP")) addBlock(`BLOCKING_GAP:${gap.requirement}`);
  for (const issue of analysis?.blockingIssues || []) addBlock(typeof issue === "object" && issue.code ? `ANALYSIS:${issue.code}` : "ANALYSIS_BLOCKING_ISSUE");
  if (preMatch.reasons?.includes("UNKNOWN_REMOTE_SCOPE")) warnings.push("UNKNOWN_REMOTE_SCOPE");
  if (familyFit.level === "UNKNOWN") warnings.push("UNKNOWN_FAMILY_FIT");

  const counts = Object.fromEntries(GAP_STATUSES.map((status) => [status, gaps.filter((item) => item.status === status).length]));
  const technical = currentAnalysis ? number(priority.technicalMatch, number(analysis?.calibratedMatchScore)) : 0;
  const confidence = number(analysis?.matchConfidence, number(priority.components?.confidence));
  const coverage = number(analysis?.evidenceCoverage);
  const consider = thresholds.considerThreshold;
  const prepare = thresholds.prepareResumeThreshold;
  let disposition;
  let primaryDecisionReason;
  if (hardBlockers.length) { disposition = "BLOCKED"; primaryDecisionReason = counts.BLOCKING_GAP ? "BLOCKING_GAP_PRESENT" : hardBlockers[0]; }
  else if (feedback?.verdict === "NOT_FOR_ME") { disposition = "SKIP"; primaryDecisionReason = "NOT_FOR_ME"; }
  else if (analysis && !currentAnalysis) { disposition = "REVIEW"; primaryDecisionReason = "ANALYSIS_RECALCULATION_REQUIRED"; warnings.push("ANALYSIS_RECALCULATION_REQUIRED"); }
  else if (analysis && technical < thresholds.reviewFloor) { disposition = "SKIP"; primaryDecisionReason = "LOW_TECHNICAL_MATCH"; }
  else if (counts.MATERIAL_GAP) { disposition = "STRETCH"; primaryDecisionReason = "MATERIAL_GAP_PRESENT"; }
  else if (seniority === "MID") { disposition = "STRETCH"; primaryDecisionReason = "MID_SENIORITY_DISTANCE"; }
  else if (!analysis) { disposition = "REVIEW"; primaryDecisionReason = "MISSING_ANALYSIS"; }
  else if (warnings.length) { disposition = "REVIEW"; primaryDecisionReason = warnings.includes("UNKNOWN_REMOTE_SCOPE") ? "UNKNOWN_REMOTE_SCOPE" : "REVIEW_WARNING"; }
  else if (confidence < 40) { disposition = "REVIEW"; primaryDecisionReason = "LOW_CONFIDENCE"; }
  else if (coverage < 35) { disposition = "REVIEW"; primaryDecisionReason = "LOW_EVIDENCE_COVERAGE"; }
  else if (technical < consider) { disposition = "REVIEW"; primaryDecisionReason = "BELOW_CONSIDER_THRESHOLD"; }
  else if (technical >= prepare && analysis?.eligibility !== "INELIGIBLE") { disposition = "PREPARE_ELIGIBLE"; primaryDecisionReason = "PREPARE_THRESHOLD_MET"; }
  else { disposition = "RECOMMENDED"; primaryDecisionReason = "CONSIDER_THRESHOLD_MET"; }
  if (feedback?.verdict === "INTERESTED" && disposition === "SKIP") { disposition = "REVIEW"; primaryDecisionReason = "HUMAN_INTEREST_OVERRIDE"; }

  const supportingReasons = unique([
    familyFit.level === "EXACT_PRIMARY" ? "EXACT_PRIMARY_FIT" : "",
    familyFit.level === "EXACT_SECONDARY" ? "SECONDARY_FAMILY_FIT" : "",
    familyFit.level === "ADJACENT" ? "FAMILY_ADJACENT" : "",
    counts.TRANSFERABLE ? "TRANSFERABLE_EVIDENCE_PRESENT" : "",
    counts.LEARNABLE_GAP ? "LEARNABLE_GAPS_ONLY" : "",
    counts.NON_MATERIAL_GAP ? "NON_MATERIAL_UNRESOLVED_REQUIREMENTS" : "",
    ...warnings,
  ]);
  const humanReview = (feedback?.verdict === "INTERESTED" && !hardBlockers.length) || ["REVIEW", "STRETCH"].includes(disposition);
  const recommended = ["RECOMMENDED", "PREPARE_ELIGIBLE"].includes(disposition);
  const decisionExplanation = {
    primaryReasonCode: primaryDecisionReason,
    supportingReasonCodes: supportingReasons,
    summary: explanationFor({ disposition, primaryDecisionReason, counts, gaps, hardBlockers }),
    gapSummary: { material: counts.MATERIAL_GAP, blocking: counts.BLOCKING_GAP, learnable: counts.LEARNABLE_GAP, nonMaterial: counts.NON_MATERIAL_GAP },
  };
  return {
    disposition, primaryDecisionReason, supportingReasons, decisionExplanation,
    hardBlockers, warnings: unique(warnings), familyFit,
    gapSummary: { counts, items: gaps }, thresholds,
    contextProvenance: input.contextProvenance || { source: "UNSPECIFIED", usedFallback: true },
    visibility: {
      discovery: feedback?.verdict !== "NOT_FOR_ME",
      today: !hardBlockers.length && feedback?.verdict !== "NOT_FOR_ME" && (recommended || humanReview),
      recommended, review: disposition === "REVIEW", stretch: disposition === "STRETCH", humanReview,
      prepareEligible: disposition === "PREPARE_ELIGIBLE" && !hardBlockers.length,
    },
    reasons: unique([primaryDecisionReason, ...supportingReasons]),
    evaluatedAt: now.toISOString(),
    inputVersions: { policy: "opportunity-decision-policy-v2.1", preMatch: preMatch.algorithmVersion || "unknown", priority: priority.algorithmVersion || "unknown", analysis: analysis?.algorithmVersion || "unknown", intent: intent.version || 0 },
  };
}

export class OpportunityDecisionPolicyV2 {
  constructor(options = {}) { this.options = options; }
  evaluate(input) { return evaluateOpportunityDecision(input, this.options); }
}
