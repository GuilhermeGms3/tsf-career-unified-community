const technicalTypes = new Set([
  "skill", "tool", "framework", "platform", "cloud", "operating_system",
  "methodology", "certification",
]);

export const REQUIREMENT_CRITICALITIES = Object.freeze([
  "MUST_HAVE", "IMPORTANT", "NICE_TO_HAVE", "UNKNOWN_CRITICALITY",
]);
export const REQUIREMENT_PROVENANCE = Object.freeze([
  "EXPLICIT_REQUIREMENT", "INFERRED_FROM_TITLE", "INFERRED_FROM_DESCRIPTION",
  "CLASSIFICATION_CONTEXT", "ONTOLOGY_INFERENCE",
]);
export const isTechnicalRequirement = (requirement) => technicalTypes.has(requirement?.type);

export function requirementProvenance(requirement = {}) {
  const declared = String(requirement.metadata?.provenance || "").toUpperCase();
  if (REQUIREMENT_PROVENANCE.includes(declared)) return declared;
  if (requirement.source === "job.title") return "INFERRED_FROM_TITLE";
  if (["job.location", "job.workModel", "job.jobType", "job.salary"].includes(requirement.source)) return "CLASSIFICATION_CONTEXT";
  if (requirement.required === true || ["required", "preferred"].includes(String(requirement.importance).toLowerCase())) return "EXPLICIT_REQUIREMENT";
  return "INFERRED_FROM_DESCRIPTION";
}

export function classifyRequirementCriticality(requirement = {}) {
  const importance = String(requirement.importance || "").toLowerCase();
  const declared = String(requirement.metadata?.criticality || "").toUpperCase();
  if (requirement.required === true || importance === "required" || declared === "MUST_HAVE") return "MUST_HAVE";
  if (importance === "preferred" || declared === "NICE_TO_HAVE") return "NICE_TO_HAVE";
  if (declared === "IMPORTANT") return "IMPORTANT";
  return "UNKNOWN_CRITICALITY";
}
