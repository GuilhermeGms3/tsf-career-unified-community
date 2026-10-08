const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "REVIEW_REQUIRED", "PARTIAL_SUCCESS"]);
export const isTerminalJobStatus = (status) => TERMINAL.has(String(status || "").toUpperCase());
export const isSuccessfulJobStatus = (status) => ["COMPLETED", "PARTIAL_SUCCESS"].includes(String(status || "").toUpperCase());
export const requiresHumanReview = (status) => ["REVIEW_REQUIRED", "AWAITING_SELECTION", "AWAITING_REVIEW", "TAILORING_REVIEW_REQUIRED", "VERSION_REVIEW_REQUIRED", "BLOCKED"].includes(String(status || "").toUpperCase());
export const canRetryJob = (status) => ["FAILED", "PARTIAL_SUCCESS"].includes(String(status || "").toUpperCase());
