import { spawn } from "node:child_process";
import { AppError } from "./errors.mjs";

export async function fetchJsonWithTimeout(url, options = {}, settings = {}) {
  const timeout = settings.timeout ?? 30000;
  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(timeout)
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new AppError(settings.timeoutMessage || "A operacao externa excedeu o tempo limite.", {
        status: 504,
        code: settings.timeoutCode || "EXTERNAL_TIMEOUT",
        cause: error
      });
    }
    throw new AppError(settings.unavailableMessage || "O servico externo esta indisponivel.", {
      status: settings.unavailableStatus || 503,
      code: settings.unavailableCode || "EXTERNAL_UNAVAILABLE",
      cause: error
    });
  }
}

export function attachProcessTimeout(child, timeout, onTimeout) {
  if (!Number.isFinite(timeout) || timeout <= 0) return () => {};
  const timer = setTimeout(() => {
    terminateProcessTree(child);
    onTimeout?.();
  }, timeout);
  timer.unref();
  const clear = () => clearTimeout(timer);
  child.once("exit", clear);
  child.once("error", clear);
  return clear;
}

export function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore"
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}
