import { MATCH_STATUS } from "./constants.mjs";

const blockingTypes = new Set(["work_authorization", "location", "work_model", "certification", "language", "experience_years", "relocation", "travel"]);

export function evaluateEligibility(items) {
  const blockingIssues = [];
  const warnings = [];
  const unknownRequirements = [];

  for (const item of items) {
    const label = item.requirement.originalText || item.requirement.normalizedName;
    if (item.status === MATCH_STATUS.UNKNOWN) {
      unknownRequirements.push({ requirementId: item.requirementId, requirement: label, required: item.requirement.required, reason: item.explanation });
      continue;
    }
    if (item.status === MATCH_STATUS.NO_MATCH && item.requirement.required && blockingTypes.has(item.requirement.type)) {
      blockingIssues.push({ blocking: true, requirementId: item.requirementId, requirement: label, reason: item.explanation, candidateEvidence: item.evidence[0] || null });
      continue;
    }
    if (item.status === MATCH_STATUS.NO_MATCH) {
      warnings.push(`${item.requirement.importance === "preferred" ? "Diferencial ausente" : "Requisito nao comprovado"}: ${label}`);
    } else if (item.status === MATCH_STATUS.PARTIAL_MATCH && item.requirement.required) {
      warnings.push(`Evidencia parcial para requisito obrigatorio: ${label}`);
    }
  }

  let eligibility = "ELIGIBLE";
  if (blockingIssues.length) eligibility = "NOT_ELIGIBLE";
  else if (unknownRequirements.some((item) => item.required)) eligibility = "REVIEW_REQUIRED";
  else if (warnings.length || unknownRequirements.length) eligibility = "ELIGIBLE_WITH_WARNINGS";

  return { eligibility, blockingIssues, warnings, unknownRequirements };
}
