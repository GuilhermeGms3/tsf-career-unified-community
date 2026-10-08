export const PLAN_DECISIONS = Object.freeze(["APPLY", "REVIEW", "SKIP", "BLOCKED"]);
export const AUTOMATION_MODES = Object.freeze(["DRY_RUN", "FILL_ONLY"]);
export const ANSWER_STATUSES = Object.freeze(["KNOWN", "DERIVED", "UNKNOWN", "USER_REQUIRED"]);

export function assertAutomationMode(value) {
  const mode = String(value || "DRY_RUN").toUpperCase();
  if (!AUTOMATION_MODES.includes(mode)) throw new Error("Modo deve ser DRY_RUN ou FILL_ONLY.");
  return mode;
}
