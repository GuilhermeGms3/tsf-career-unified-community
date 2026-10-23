export const APPLICATION_STATUSES = Object.freeze([
  "DISCOVERED", "MATCHED", "PLANNED", "APPROVED", "QUEUED", "OPENING_PAGE", "FILLING",
  "WAITING_USER", "VALIDATING", "READY_TO_SUBMIT", "SUBMITTING", "SUBMITTED", "FAILED",
  "RETRYABLE", "SUBMISSION_UNCERTAIN", "BLOCKED", "CANCELLED"
]);

const legacyStatuses = Object.freeze({
  descoberta: "DISCOVERED", encontrada: "DISCOVERED", matched: "MATCHED", planejada: "PLANNED",
  aplicada: "SUBMITTED", enviada: "SUBMITTED", entrevista: "WAITING_USER", proposta: "WAITING_USER",
  rejeitada: "CANCELLED", sem_resposta: "WAITING_USER", cancelada: "CANCELLED"
});

const transitions = Object.freeze({
  DISCOVERED: ["MATCHED", "PLANNED", "CANCELLED", "BLOCKED"],
  MATCHED: ["PLANNED", "APPROVED", "CANCELLED", "BLOCKED"],
  PLANNED: ["APPROVED", "CANCELLED", "BLOCKED"],
  APPROVED: ["QUEUED", "WAITING_USER", "CANCELLED"],
  QUEUED: ["OPENING_PAGE", "WAITING_USER", "BLOCKED", "CANCELLED"],
  OPENING_PAGE: ["FILLING", "WAITING_USER", "FAILED", "RETRYABLE", "BLOCKED", "CANCELLED"],
  FILLING: ["WAITING_USER", "VALIDATING", "FAILED", "RETRYABLE", "BLOCKED", "CANCELLED"],
  WAITING_USER: ["OPENING_PAGE", "FILLING", "VALIDATING", "READY_TO_SUBMIT", "CANCELLED", "BLOCKED"],
  VALIDATING: ["FILLING", "WAITING_USER", "READY_TO_SUBMIT", "FAILED", "RETRYABLE", "BLOCKED", "CANCELLED"],
  READY_TO_SUBMIT: ["SUBMITTING", "WAITING_USER", "CANCELLED"],
  SUBMITTING: ["SUBMITTED", "SUBMISSION_UNCERTAIN", "FAILED", "RETRYABLE", "BLOCKED"],
  SUBMISSION_UNCERTAIN: ["SUBMITTED", "WAITING_USER", "BLOCKED", "CANCELLED"],
  FAILED: ["RETRYABLE", "CANCELLED"],
  RETRYABLE: ["QUEUED", "CANCELLED", "BLOCKED"],
  BLOCKED: ["WAITING_USER", "RETRYABLE", "CANCELLED"],
  SUBMITTED: [],
  CANCELLED: []
});

export class ApplicationStateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ApplicationStateError";
    this.code = code;
  }
}

export function normalizeApplicationStatus(value) {
  const raw = String(value || "PLANNED").trim();
  const normalized = raw.toUpperCase();
  const status = APPLICATION_STATUSES.includes(normalized) ? normalized : legacyStatuses[raw.toLowerCase()];
  if (!status) throw new ApplicationStateError(`Status de candidatura invalido: ${raw}.`, "INVALID_APPLICATION_STATUS");
  return status;
}

export function canTransitionApplication(fromStatus, toStatus) {
  const from = normalizeApplicationStatus(fromStatus);
  const to = normalizeApplicationStatus(toStatus);
  return from === to || transitions[from].includes(to);
}

export function assertApplicationTransition(fromStatus, toStatus) {
  const from = normalizeApplicationStatus(fromStatus);
  const to = normalizeApplicationStatus(toStatus);
  if (!canTransitionApplication(from, to)) {
    throw new ApplicationStateError(`Transicao de candidatura nao permitida: ${from} -> ${to}.`, "INVALID_APPLICATION_TRANSITION");
  }
  return { from, to };
}

export const APPLICATION_TRANSITIONS = transitions;
