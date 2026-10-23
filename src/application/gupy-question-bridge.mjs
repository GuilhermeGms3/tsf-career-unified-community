import {isResolved} from "./application-field-schema.mjs";
import {normalizeQuestionText} from "./question-semantics.mjs";

const confirmed = new Set(["USER_CONFIRMED", "LLM_APPROVED", "LLM_EXTRACTIVE", "user"]);

export function gupyConfirmedAnswers(store, draft) {
  if (!draft.applicationId) return draft.answers;
  const answers = {...draft.answers};
  for (const question of store.applicationQuestions.forApplication(draft.applicationId)) {
    if (question.externalKey.startsWith("gupy:") && question.answerStatus === "KNOWN" && confirmed.has(question.answerSource))
      answers[question.fingerprint] = {value:question.answerValue, source:question.answerSource==="LLM_EXTRACTIVE"?"LLM_EXTRACTIVE":"USER_CONFIRMED"};
  }
  return answers;
}

export function publishGupyQuestions(store, draft, fields) {
  if (!draft.applicationId) return;
  const questions = fields.filter(field => !field.hidden && field.required && field.category !== "RESUME_UPLOAD").map(field => ({
    externalKey:`gupy:${field.questionIdentity}`, fingerprint:field.questionIdentity,
    semanticKey:field.normalizedSemanticType, label:field.label, type:field.type,
    normalizedQuestion:normalizeQuestionText(field.label), required:true, options:field.options,
    multiple:field.type === "checkbox-group" || field.type === "select-multiple",
    sensitive:field.sensitive, consentType:field.category === "CONSENT" ? "EXPLICIT_PORTAL_CONSENT" : "",
    confidence:field.confidence, answer:isResolved(field)?field.answer:undefined,
    answerStatus:isResolved(field)?"KNOWN":"USER_REQUIRED", answerSource:field.answerProvenance?.source || "",
    answerFormatInvalid:field.answerState === "NEEDS_REVIEW",
    reasonRequired:"Resposta necessaria para continuar esta etapa da Gupy.",
  }));
  const current=new Set(questions.map(question=>question.externalKey));
  const retired=store.applicationQuestions.forApplication(draft.applicationId).filter(question=>question.externalKey.startsWith("gupy:")&&!current.has(question.externalKey)).map(question=>({...question,required:false,answerStatus:"UNKNOWN"}));
  store.applicationQuestions.sync(draft.applicationId, [...retired,...questions]);
}
