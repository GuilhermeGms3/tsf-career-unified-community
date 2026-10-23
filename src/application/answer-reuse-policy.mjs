const contextualKey = /^(COMPENSATION\.|WORK_AUTHORIZATION\.|CONSENT\.|DEMOGRAPHIC\.|APPLICATION\.|WORK_ARRANGEMENT\.)/;
export const requiresApplicationConfirmation = field => contextualKey.test(field.semanticKey || "");

export function reusableApplicationLibraryAnswer(field, answer, { now = Date.now() } = {}) {
  if (!answer || field.explicitOnly || requiresApplicationConfirmation({semanticKey:field.normalizedSemanticType}) || field.sensitive || field.consentType || field.category === "CONSENT" ||
      answer.provenance !== "USER_CONFIRMED" || answer.scope?.provider !== "GUPY" || answer.scope?.type !== field.type) return false;
  const scope=answer.scope;
  return !scope.applicationId && !scope.jobId && (!scope.expiresAt || Number.isFinite(Date.parse(scope.expiresAt)) && Date.parse(scope.expiresAt)>now);
}

export function reusableFormAnswer(field, answers = [], { now = Date.now(), applicationId = "", jobId = "" } = {}) {
  if (field.sensitive || field.consentType || contextualKey.test(field.semanticKey || "") ||
      !["FACT", "PREFERENCE"].includes(field.answerCategory)) return null;
  return answers.find(answer => {
    if (!field.fingerprint || answer.fingerprint !== field.fingerprint || !answer.verified ||
        !answer.reusable || answer.sensitive || answer.source !== "USER_CONFIRMED" ||
        answer.semanticKey !== field.semanticKey || answer.answerType !== (field.fieldType || field.type)) return false;
    const scope = answer.scope || {};
    if (scope.applicationId && scope.applicationId !== applicationId || scope.jobId && scope.jobId !== jobId) return false;
    if (scope.expiresAt && (!Number.isFinite(Date.parse(scope.expiresAt)) || Date.parse(scope.expiresAt) <= now)) return false;
    return true;
  }) || null;
}
