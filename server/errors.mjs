export class AppError extends Error {
  constructor(message, { status = 500, code = "INTERNAL_ERROR", cause } = {}) {
    super(message, { cause });
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeError(error, fallback = {}) {
  if (error instanceof AppError) return error;

  if (error?.name === "TimeoutError" || error?.name === "AbortError" || error?.code === "ETIMEDOUT") {
    return new AppError(fallback.timeoutMessage || "A operacao excedeu o tempo limite.", {
      status: 504,
      code: fallback.timeoutCode || "TIMEOUT",
      cause: error
    });
  }

  if (error?.code === "EACCES" || error?.code === "EPERM") {
    return new AppError("Permissao negada ao acessar ou salvar o arquivo.", {
      status: 403,
      code: "PERMISSION_DENIED",
      cause: error
    });
  }

  if (error?.code === "ENOENT") {
    return new AppError(fallback.notFoundMessage || "Arquivo ou projeto nao encontrado.", {
      status: 404,
      code: fallback.notFoundCode || "NOT_FOUND",
      cause: error
    });
  }

  return new AppError(fallback.message || "Nao foi possivel concluir a operacao.", {
    status: fallback.status || 500,
    code: fallback.code || "INTERNAL_ERROR",
    cause: error
  });
}

export function errorPayload(error, fallback) {
  const normalized = normalizeError(error, fallback);
  return {
    status: normalized.status,
    body: { ok: false, error: normalized.message, code: normalized.code }
  };
}
