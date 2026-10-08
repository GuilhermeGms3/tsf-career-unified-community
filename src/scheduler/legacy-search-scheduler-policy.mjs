export const LEGACY_SCHEDULE_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  RETRY_WAIT: "RETRY_WAIT",
  INVALID_REFERENCE: "INVALID_REFERENCE",
  FAILED_PERMANENT: "FAILED_PERMANENT",
  RETRY_EXHAUSTED: "RETRY_EXHAUSTED"
});

export const DEFAULT_TRANSIENT_RETRY_DELAYS_MS = Object.freeze([
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000
]);

const PERMANENT_CODES = new Set([
  "INVALID_REFERENCE",
  "SCHEDULE_INVALID_REFERENCE",
  "SQLITE_CONSTRAINT_FOREIGNKEY"
]);

function errorCode(error) {
  return String(error?.code || error?.sqliteCode || error?.cause?.code || "SCHEDULE_EXECUTION_FAILED").toUpperCase();
}

function isForeignKeyFailure(error) {
  const codes = [error?.code, error?.sqliteCode, error?.cause?.code].map((value) => String(value || "").toUpperCase());
  const messages = [error?.message, error?.cause?.message].map((value) => String(value || "").toUpperCase());
  return codes.some((code) => code.includes("FOREIGNKEY")) || messages.some((message) => message.includes("FOREIGN KEY CONSTRAINT FAILED"));
}

export function classifyLegacyScheduleFailure(error) {
  const code = errorCode(error);
  if (isForeignKeyFailure(error)) {
    return {
      permanent: true,
      status: LEGACY_SCHEDULE_STATUS.FAILED_PERMANENT,
      errorCode: "FOREIGN_KEY_CONSTRAINT",
      message: "Falha permanente de integridade referencial; agendamento desativado."
    };
  }
  if (PERMANENT_CODES.has(code)) {
    return {
      permanent: true,
      status: LEGACY_SCHEDULE_STATUS.INVALID_REFERENCE,
      errorCode: "INVALID_REFERENCE",
      message: "Referencia invalida; agendamento desativado."
    };
  }
  return {
    permanent: false,
    status: LEGACY_SCHEDULE_STATUS.RETRY_WAIT,
    errorCode: code.replace(/[^A-Z0-9_-]/g, "_").slice(0, 80),
    message: "Falha transitoria; nova tentativa sera feita com backoff limitado."
  };
}

export function isLegacyScheduleRunnable(schedule, at = new Date()) {
  if (!schedule?.enabled) return false;
  if ([
    LEGACY_SCHEDULE_STATUS.INVALID_REFERENCE,
    LEGACY_SCHEDULE_STATUS.FAILED_PERMANENT,
    LEGACY_SCHEDULE_STATUS.RETRY_EXHAUSTED
  ].includes(schedule.schedulerStatus)) return false;
  const nextRunAt = Date.parse(schedule.nextRunAt || "");
  return Number.isFinite(nextRunAt) && nextRunAt <= at.getTime();
}

export function completeLegacySchedule(schedule, at = new Date()) {
  const intervalHours = Math.max(1, Number(schedule.intervalHours || 12));
  return {
    ...schedule,
    schedulerStatus: LEGACY_SCHEDULE_STATUS.ACTIVE,
    failureCount: 0,
    lastErrorCode: "",
    lastFailureAt: "",
    lastError: "",
    lastRunAt: at.toISOString(),
    nextRunAt: new Date(at.getTime() + intervalHours * 60 * 60 * 1000).toISOString(),
    updatedAt: at.toISOString()
  };
}

export function failLegacySchedule(schedule, error, {
  at = new Date(),
  retryDelaysMs = DEFAULT_TRANSIENT_RETRY_DELAYS_MS
} = {}) {
  const failure = classifyLegacyScheduleFailure(error);
  const failureCount = Math.max(0, Number(schedule.failureCount || 0)) + 1;
  if (failure.permanent) {
    return {
      ...schedule,
      enabled: false,
      schedulerStatus: failure.status,
      failureCount,
      lastErrorCode: failure.errorCode,
      lastError: failure.message,
      lastFailureAt: at.toISOString(),
      lastRunAt: at.toISOString(),
      nextRunAt: "",
      updatedAt: at.toISOString()
    };
  }
  const delay = retryDelaysMs[failureCount - 1];
  if (!Number.isFinite(delay)) {
    return {
      ...schedule,
      enabled: false,
      schedulerStatus: LEGACY_SCHEDULE_STATUS.RETRY_EXHAUSTED,
      failureCount,
      lastErrorCode: "TRANSIENT_RETRY_EXHAUSTED",
      lastError: "Limite de tentativas transitorias atingido; agendamento desativado.",
      lastFailureAt: at.toISOString(),
      lastRunAt: at.toISOString(),
      nextRunAt: "",
      updatedAt: at.toISOString()
    };
  }
  return {
    ...schedule,
    schedulerStatus: LEGACY_SCHEDULE_STATUS.RETRY_WAIT,
    failureCount,
    lastErrorCode: failure.errorCode,
    lastError: failure.message,
    lastFailureAt: at.toISOString(),
    lastRunAt: at.toISOString(),
    nextRunAt: new Date(at.getTime() + delay).toISOString(),
    updatedAt: at.toISOString()
  };
}

export function legacyScheduleLogContext(schedule) {
  return {
    scheduleId: String(schedule?.id || "").slice(0, 100),
    schedulerStatus: schedule?.schedulerStatus || LEGACY_SCHEDULE_STATUS.ACTIVE,
    errorCode: String(schedule?.lastErrorCode || "").slice(0, 80),
    failureCount: Math.max(0, Number(schedule?.failureCount || 0))
  };
}

export async function runDueLegacySchedules({ schedules, run, at = new Date(), limit = 2, logger = console }) {
  const due = schedules.filter((schedule) => isLegacyScheduleRunnable(schedule, at)).slice(0, limit);
  const outcomes = [];
  for (const schedule of due) {
    try {
      outcomes.push(await run(schedule.id));
    } catch {
      logger.error?.("Falha inesperada no scheduler legado.", {
        scheduleId: String(schedule.id || "").slice(0, 100),
        errorCode: "SCHEDULE_RUNNER_FAILED"
      });
      outcomes.push({ ok: false, errorCode: "SCHEDULE_RUNNER_FAILED" });
    }
  }
  return outcomes;
}
