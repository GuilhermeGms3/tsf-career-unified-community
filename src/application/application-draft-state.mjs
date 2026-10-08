// Draft lifecycle is separate from the submitted Application aggregate.
const retry = ["PREPARING", "WAITING_USER", "CANCELLED"];
const failure = ["FAILED", "WAITING_USER", "PREPARATION_REQUIRED"];
export const DRAFT_TRANSITIONS = Object.freeze({
  PREPARATION_REQUIRED: Object.freeze(retry),
  BLOCKED: Object.freeze(retry),
  FAILED: Object.freeze(retry),
  WAITING_USER: Object.freeze(retry),
  PREPARING: Object.freeze(["READY_TO_FILL", "FILLING", "BLOCKED", ...failure]),
  READY_TO_FILL: Object.freeze(retry),
  FILLING: Object.freeze(["FILLED", ...failure]),
  FILLED: Object.freeze(["VALIDATING", ...failure]),
  VALIDATING: Object.freeze(["READY_TO_SUBMIT", ...failure]),
  READY_TO_SUBMIT: Object.freeze(["SUBMITTING", ...retry]),
  SUBMITTING: Object.freeze(["SUBMITTED", "SUBMISSION_UNCERTAIN", "WAITING_USER"]),
  SUBMITTED: Object.freeze([]),
  SUBMISSION_UNCERTAIN: Object.freeze([]),
  CANCELLED: Object.freeze([]),
});
export function draftError(code, current, next) {
  return Object.assign(new Error(code), {code, status:409, draftId:current?.id, from:current?.status, to:next, currentStatus:current?.status});
}
export function assertDraftTransition(current,next){
  if(!DRAFT_TRANSITIONS[current.status]?.includes(next))throw draftError("DRAFT_TRANSITION_INVALID",current,next);
}
