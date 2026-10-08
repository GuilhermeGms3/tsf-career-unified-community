export const KNOWLEDGE_TYPES = Object.freeze([
  "IDENTITY","CONTACT","LOCATION","SKILL","TOOL","TECHNOLOGY","WORK_EXPERIENCE",
  "WORK_RESPONSIBILITY","WORK_ACHIEVEMENT","EDUCATION","CERTIFICATION","LANGUAGE","PROJECT",
  "PROJECT_TECHNOLOGY","PREFERENCE","JOB_PREFERENCE","APPLICATION_FACT","APPLICATION_ANSWER","SENSITIVE"
]);

export const VERIFICATION_STATUSES = Object.freeze([
  "SYSTEM_EXTRACTED","USER_CONFIRMED","IMPORTED_CONFIRMED","REVIEW_REQUIRED","REJECTED"
]);

export const REUSE_POLICIES = Object.freeze([
  "REUSABLE","REUSABLE_WITH_CONFIRMATION","APPLICATION_SPECIFIC","SENSITIVE_CONFIRM_EACH_TIME","NEVER_AUTO_REUSE"
]);

export const LIFECYCLE_STATUSES = Object.freeze(["ACTIVE","REJECTED","ARCHIVED","LEGACY_READ_ONLY"]);

const includes = (values, value, fallback) => values.includes(value) ? value : fallback;

export function applyKnowledgePolicy(input = {}) {
  const sensitive = Boolean(input.sensitive) || input.unitType === "SENSITIVE" || input.classification === "SENSITIVE";
  const verificationStatus = includes(VERIFICATION_STATUSES, input.verificationStatus,
    input.verified ? (input.source === "USER_CONFIRMED" ? "USER_CONFIRMED" : "IMPORTED_CONFIRMED") : "SYSTEM_EXTRACTED");
  let reusePolicy = includes(REUSE_POLICIES, input.reusePolicy,
    sensitive ? "SENSITIVE_CONFIRM_EACH_TIME" : input.requiresConfirmation ? "REUSABLE_WITH_CONFIRMATION" : input.reusable === false ? "NEVER_AUTO_REUSE" : "REUSABLE");
  if (sensitive) reusePolicy = "SENSITIVE_CONFIRM_EACH_TIME";
  if (verificationStatus === "REJECTED") reusePolicy = "NEVER_AUTO_REUSE";
  const reusable = reusePolicy === "REUSABLE" && verificationStatus !== "REJECTED";
  return {
    ...input,
    unitType: includes(KNOWLEDGE_TYPES, input.unitType, sensitive ? "SENSITIVE" : "APPLICATION_FACT"),
    verificationStatus,
    reusePolicy,
    lifecycleStatus: includes(LIFECYCLE_STATUSES, input.lifecycleStatus, verificationStatus === "REJECTED" ? "REJECTED" : "ACTIVE"),
    sensitive,
    reusable,
    requiresConfirmation: ["REUSABLE_WITH_CONFIRMATION","SENSITIVE_CONFIRM_EACH_TIME","APPLICATION_SPECIFIC"].includes(reusePolicy),
    verified: ["USER_CONFIRMED","IMPORTED_CONFIRMED"].includes(verificationStatus)
  };
}

export function canReuseKnowledge(fact) {
  return fact?.lifecycleStatus === "ACTIVE" && fact?.verificationStatus !== "REJECTED" && fact?.reusePolicy === "REUSABLE" && !fact?.sensitive;
}

// Analysis may use extracted evidence; external writing requires confirmed authority.
export function isConfirmedKnowledge(fact) {
  return ["USER_CONFIRMED", "IMPORTED_CONFIRMED"].includes(fact?.verificationStatus);
}

export function wouldDowngradeAuthority(current, incoming) {
  const authority = { SYSTEM_EXTRACTED: 1, REVIEW_REQUIRED: 0, IMPORTED_CONFIRMED: 2, USER_CONFIRMED: 3 };
  return isConfirmedKnowledge(current) && (authority[incoming?.verificationStatus] ?? 0) < authority[current.verificationStatus];
}

export function canAutofillApplicationField(fact, field = {}, { explicit = false } = {}) {
  if (!fact || !isConfirmedKnowledge(fact) || fact.verified === false ||
      (fact.lifecycleStatus && fact.lifecycleStatus !== "ACTIVE") || field.hidden || field.type === "password") return false;
  if (explicit) return fact.verificationStatus === "USER_CONFIRMED";
  return fact.reusePolicy === "REUSABLE" && !fact.sensitive && !fact.requiresConfirmation &&
    !field.sensitive && !field.consentType && !field.explicitOnly && !field.requiresConfirmation;
}

export function maskKnowledgeValue(fact) {
  if (!fact?.sensitive) return fact?.value;
  return { masked: true, display: "Informação protegida" };
}
