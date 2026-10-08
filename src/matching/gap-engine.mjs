import {
  classifyRequirementCriticality,
  isTechnicalRequirement,
  requirementProvenance,
} from "./requirement-criticality.mjs";

export const GAP_STATUSES = Object.freeze([
  "MATCHED", "TRANSFERABLE", "LEARNABLE_GAP", "NON_MATERIAL_GAP",
  "MATERIAL_GAP", "BLOCKING_GAP",
]);

const blockingTypes = new Set(["work_authorization", "location", "work_model", "relocation"]);
const learnable = new Set(["kubernetes", "terraform", "docker", "ansible", "gitlab-ci", "github-actions", "ci-cd", "aws", "azure"]);
const transferPairs = new Map([
  ["github-actions", new Set(["ci-cd", "gitlab-ci"])],
  ["gitlab-ci", new Set(["ci-cd", "github-actions"])],
  ["ci-cd", new Set(["github-actions", "gitlab-ci"])],
  ["aws", new Set(["azure"])], ["azure", new Set(["aws"])],
  ["terraform", new Set(["iac", "infrastructure-as-code"])],
  ["iac", new Set(["terraform", "infrastructure-as-code"])],
]);
const fold = (value) => String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9+#]+/g, "-").replace(/^-+|-+$/g, "");
const evidenceNames = (item) => (item.evidence || []).flatMap((evidence) => [evidence.normalizedName, evidence.text, evidence.metadata?.canonicalSkill, evidence.metadata?.alias]).map(fold).filter(Boolean);
const transferFor = (required, evidence = []) => {
  const accepted = transferPairs.get(fold(required));
  return Boolean(accepted && evidence.some((value) => [...accepted].some((candidate) => value === candidate || value.includes(candidate))));
};
const materialityFor = (status) => ({
  MATCHED: "NONE", TRANSFERABLE: "NON_MATERIAL", LEARNABLE_GAP: "NON_MATERIAL",
  NON_MATERIAL_GAP: "NON_MATERIAL", MATERIAL_GAP: "MATERIAL", BLOCKING_GAP: "BLOCKING",
})[status];

function gap(status, { criticality, name, provenance, evidenceResolution, reasonCode, reason }) {
  return { status, materiality: materialityFor(status), criticality, requirement: name, provenance, evidenceResolution, reasonCode, reason };
}

export function classifyRequirementGap(item = {}, context = {}) {
  const requirement = item.requirement || {};
  const criticality = classifyRequirementCriticality(requirement);
  const provenance = requirementProvenance(requirement);
  const name = fold(requirement.normalizedName || requirement.originalText);
  const evidence = evidenceNames(item);
  const evidenceResolution = item.resolution?.reason || (item.status === "MATCH" ? "EVIDENCE_FOUND" : item.status === "PARTIAL_MATCH" ? "INSUFFICIENT_EVIDENCE" : item.status === "NO_MATCH" ? "EXPLICIT_NEGATIVE_OR_INCOMPATIBLE" : "NO_EVIDENCE");
  const details = { criticality, name, provenance, evidenceResolution };

  if (item.status === "MATCH") return gap("MATCHED", { ...details, reasonCode: "EXACT_EVIDENCE_MATCH", reason: "Evidência compatível confirmada." });
  if (item.status === "PARTIAL_MATCH" || transferFor(name, evidence)) return gap("TRANSFERABLE", { ...details, reasonCode: "TRANSFERABLE_EVIDENCE", reason: "A evidência é semanticamente transferível, sem equivalência exata." });

  const inferredDomain = requirement.type === "domain" && ["CLASSIFICATION_CONTEXT", "INFERRED_FROM_TITLE", "ONTOLOGY_INFERENCE"].includes(provenance);
  const familyAligned = ["EXACT_PRIMARY", "EXACT_SECONDARY", "ADJACENT"].includes(context.familyFit?.level);
  if (inferredDomain) return gap("NON_MATERIAL_GAP", { ...details, reasonCode: familyAligned ? "DOMAIN_CONTEXT_ALIGNED" : "INFERRED_DOMAIN_CONTEXT", reason: familyAligned ? "O domínio inferido está coerente com a família alvo, mas não constitui evidência profissional." : "O domínio foi inferido para classificação e não constitui requisito explícito do candidato." });

  if (criticality === "MUST_HAVE" && blockingTypes.has(requirement.type) && item.status === "NO_MATCH") return gap("BLOCKING_GAP", { ...details, reasonCode: "MANDATORY_OPERATIONAL_CONFLICT", reason: "Incompatibilidade explícita em requisito operacional obrigatório." });
  if (criticality === "MUST_HAVE" && requirement.type === "experience_years" && item.status === "NO_MATCH") return gap("BLOCKING_GAP", { ...details, reasonCode: "MANDATORY_EXPERIENCE_SHORTFALL", reason: "Experiência mínima obrigatória explicitamente não atendida." });
  if (criticality === "MUST_HAVE") return gap("MATERIAL_GAP", { ...details, reasonCode: item.status === "NO_MATCH" ? "MANDATORY_REQUIREMENT_NOT_MET" : "MISSING_CRITICAL_EVIDENCE", reason: "Requisito obrigatório sem evidência suficiente; exige avaliação do contexto." });

  const reliableImportant = criticality === "IMPORTANT" && !(provenance !== "EXPLICIT_REQUIREMENT" && Number(requirement.confidence ?? 0) < 0.8);
  if (reliableImportant) return gap("MATERIAL_GAP", { ...details, reasonCode: item.status === "NO_MATCH" ? "IMPORTANT_REQUIREMENT_NOT_MET" : "MISSING_IMPORTANT_EVIDENCE", reason: "Requisito importante sem evidência suficiente." });

  if (isTechnicalRequirement(requirement) && (criticality === "NICE_TO_HAVE" || learnable.has(name))) return gap("LEARNABLE_GAP", { ...details, reasonCode: "OPTIONAL_TECHNOLOGY_GAP", reason: "Tecnologia opcional ou de criticidade não comprovada pode ser aprendida; a ausência não prova inviabilidade." });
  if (criticality === "NICE_TO_HAVE") return gap("NON_MATERIAL_GAP", { ...details, reasonCode: "OPTIONAL_REQUIREMENT_MISSING", reason: "Preferência explícita sem evidência; não é uma lacuna material." });
  return gap("NON_MATERIAL_GAP", { ...details, reasonCode: "CRITICALITY_UNRESOLVED", reason: "A criticidade não foi comprovada; a ausência de evidência não é tratada como deficiência material." });
}
