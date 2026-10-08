import { api, queryCache } from "../api/client.js";
import { escapeHtml, toast } from "./ui.js";

const STORAGE_KEY = "career.backgroundJobs.v1";
const TERMINAL = new Set(["COMPLETED", "PARTIAL_SUCCESS", "REVIEW_REQUIRED", "FAILED", "CANCELLED", "BLOCKED"]);
let timer = null;
let polling = false;

function readJobs() {
  try {
    const jobs = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(jobs) ? jobs.filter((item) => item?.id && item?.statusUrl) : [];
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  if (jobs.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  else localStorage.removeItem(STORAGE_KEY);
}

function render(jobs = readJobs(), message = "") {
  const target = document.querySelector("#background-job-region");
  if (!target) return;
  if (!jobs.length) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  const current = jobs[0];
  target.hidden = false;
  target.innerHTML = `<div class="background-job-card" role="status" aria-live="polite"><div class="background-job-copy"><strong>${escapeHtml(jobs.length > 1 ? `${jobs.length} currículos em preparação` : current.label)}</strong><small>${escapeHtml(message || "Processando em segundo plano. Você pode continuar usando o sistema.")}</small></div><a data-link href="${escapeHtml(current.targetUrl)}">Ver vaga</a><div class="background-job-track" aria-hidden="true"><span></span></div></div>`;
}

function completionMessage(item) {
  return item.kind === "RESUME_VERSION"
    ? "Versão do currículo pronta para revisão."
    : "Ajustes do currículo prontos para revisão.";
}

function notifyCompletion(message, targetUrl) {
  toast(message);
  document.dispatchEvent(
    new CustomEvent("career:background-job-complete", {
      detail: { message, targetUrl },
    }),
  );
  if (document.hidden && globalThis.Notification?.permission === "granted") {
    try {
      const notification = new Notification("Career Unified", { body: message });
      notification.onclick = () => {
        globalThis.focus();
        location.assign(targetUrl);
      };
    } catch {
      // The in-app toast remains the notification fallback.
    }
  }
}

async function poll() {
  if (polling) return;
  const jobs = readJobs();
  if (!jobs.length) {
    render([]);
    return;
  }
  polling = true;
  try {
    const remaining = [];
    for (const item of jobs) {
      try {
        const response = await api(item.statusUrl, { cache: false });
        const status = String(response.job?.status || "").toUpperCase();
        if (!TERMINAL.has(status)) {
          remaining.push(item);
          continue;
        }
        if (["COMPLETED", "PARTIAL_SUCCESS", "REVIEW_REQUIRED"].includes(status)) {
          queryCache.invalidate((key) =>
            key.startsWith("GET:/api/opportunities") ||
            key.startsWith("GET:/api/resumes") ||
            key.startsWith("GET:/api/experience/resumes"),
          );
          notifyCompletion(completionMessage(item), item.targetUrl);
        } else {
          toast(response.job?.errorMessage || "Não foi possível preparar o currículo.", "error");
        }
      } catch {
        remaining.push(item);
      }
    }
    saveJobs(remaining);
    render(remaining);
  } finally {
    polling = false;
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  timer = readJobs().length ? setTimeout(poll, 1500) : null;
}

export function initBackgroundJobs() {
  render();
  schedule();
}

export function trackBackgroundJob({ id, kind, statusUrl, label, targetUrl }) {
  const jobs = readJobs().filter((item) => item.id !== id);
  jobs.push({ id, kind, statusUrl, label, targetUrl, createdAt: new Date().toISOString() });
  saveJobs(jobs);
  render(jobs);
  schedule();
}
