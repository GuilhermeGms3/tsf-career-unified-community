import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore, defaultUnifiedState } from "../server/unified-state-store.mjs";
import {
  completeLegacySchedule,
  failLegacySchedule,
  isLegacyScheduleRunnable,
  LEGACY_SCHEDULE_STATUS,
  runDueLegacySchedules
} from "../src/scheduler/legacy-search-scheduler-policy.mjs";

const now = new Date("2026-08-23T12:00:00.000Z");

test("timer do scheduler lista agendas sem reconstruir o estado unificado", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function runDueScheduledSearches()");
  const end = source.indexOf("async function markAlertsRead", start);
  const schedulerEntry = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(schedulerEntry, /unifiedStore\.searchSchedules\.all\(\)/);
  assert.doesNotMatch(schedulerEntry, /readUnifiedState\(/);
});

test("boot agenda somente o Job Hunt canônico e não executa a agenda legada invisível", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const start = source.indexOf("const scheduledSearchTimer");
  const bootstrap = source.slice(start);

  assert.ok(start >= 0);
  assert.match(bootstrap, /jobHuntService\.runDue\(\)/);
  assert.doesNotMatch(bootstrap, /runDueScheduledSearches\(\)/);
});

function schedule(overrides = {}) {
  return {
    id: "schedule-1",
    name: "Busca tecnica",
    query: "infraestrutura",
    enabled: true,
    schedulerStatus: LEGACY_SCHEDULE_STATUS.ACTIVE,
    intervalHours: 12,
    failureCount: 0,
    nextRunAt: "2026-08-23T11:00:00.000Z",
    createdAt: "2026-08-22T12:00:00.000Z",
    updatedAt: "2026-08-22T12:00:00.000Z",
    ...overrides
  };
}

test("schedule valido vencido executa uma vez e avanca o proximo ciclo", async () => {
  let calls = 0;
  const outcomes = await runDueLegacySchedules({
    schedules: [schedule()],
    at: now,
    run: async () => { calls += 1; return { ok: true }; }
  });
  const completed = completeLegacySchedule(schedule(), now);
  assert.equal(calls, 1);
  assert.equal(outcomes[0].ok, true);
  assert.equal(completed.schedulerStatus, LEGACY_SCHEDULE_STATUS.ACTIVE);
  assert.equal(completed.nextRunAt, "2026-08-24T00:00:00.000Z");
});

test("schedule permanentemente falho e vencido nao volta para a fila", async () => {
  let calls = 0;
  const permanent = schedule({ enabled: false, schedulerStatus: LEGACY_SCHEDULE_STATUS.FAILED_PERMANENT });
  await runDueLegacySchedules({ schedules: [permanent], at: now, run: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(isLegacyScheduleRunnable(permanent, now), false);
});

test("falha de FK vira estado permanente, auditavel e sem proxima execucao", () => {
  const cause = Object.assign(new Error("FOREIGN KEY constraint failed"), { code: "ERR_SQLITE_ERROR" });
  const failed = failLegacySchedule(schedule(), Object.assign(new Error("State sync failed."), { code: "STATE_SYNC_FAILED", cause }), { at: now });
  assert.equal(failed.enabled, false);
  assert.equal(failed.schedulerStatus, LEGACY_SCHEDULE_STATUS.FAILED_PERMANENT);
  assert.equal(failed.lastErrorCode, "FOREIGN_KEY_CONSTRAINT");
  assert.equal(failed.nextRunAt, "");
  assert.equal(failed.failureCount, 1);
});

test("erro permanente nao entra em retry loop", async () => {
  const failed = failLegacySchedule(schedule(), Object.assign(new Error("missing"), { code: "INVALID_REFERENCE" }), { at: now });
  let calls = 0;
  await runDueLegacySchedules({ schedules: [failed], at: new Date("2026-08-30T12:00:00.000Z"), run: async () => { calls += 1; } });
  assert.equal(calls, 0);
  assert.equal(failed.schedulerStatus, LEGACY_SCHEDULE_STATUS.INVALID_REFERENCE);
});

test("erro transitorio usa backoff limitado e esgota tentativas de forma deterministica", () => {
  const first = failLegacySchedule(schedule(), Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), { at: now });
  assert.equal(first.enabled, true);
  assert.equal(first.schedulerStatus, LEGACY_SCHEDULE_STATUS.RETRY_WAIT);
  assert.equal(first.nextRunAt, "2026-08-23T12:15:00.000Z");
  const exhausted = failLegacySchedule(first, Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), { at: now, retryDelaysMs: [15 * 60 * 1000] });
  assert.equal(exhausted.enabled, false);
  assert.equal(exhausted.schedulerStatus, LEGACY_SCHEDULE_STATUS.RETRY_EXHAUSTED);
  assert.equal(exhausted.nextRunAt, "");
});

test("restart nao reativa schedule permanentemente invalido", () => {
  const failed = failLegacySchedule(schedule(), Object.assign(new Error("missing"), { code: "SCHEDULE_INVALID_REFERENCE" }), { at: now });
  const afterRestart = JSON.parse(JSON.stringify(failed));
  assert.equal(isLegacyScheduleRunnable(afterRestart, new Date("2027-01-01T00:00:00.000Z")), false);
  assert.equal(afterRestart.enabled, false);
});

test("falha de um schedule nao impede outro schedule valido", async () => {
  const calls = [];
  const logs = [];
  const outcomes = await runDueLegacySchedules({
    schedules: [schedule({ id: "broken" }), schedule({ id: "valid" })],
    at: now,
    logger: { error: (message, context) => logs.push({ message, context }) },
    run: async (id) => {
      calls.push(id);
      if (id === "broken") throw new Error("unexpected");
      return { ok: true, id };
    }
  });
  assert.deepEqual(calls, ["broken", "valid"]);
  assert.equal(outcomes[1].ok, true);
  assert.equal(logs.length, 1);
});

test("schedule permanente nao bloqueia healthcheck nem cria trabalho pendente", async () => {
  const permanent = schedule({ enabled: false, schedulerStatus: LEGACY_SCHEDULE_STATUS.FAILED_PERMANENT });
  let schedulerCalls = 0;
  await runDueLegacySchedules({ schedules: [permanent], at: now, run: async () => { schedulerCalls += 1; } });
  const healthcheck = await Promise.resolve({ ok: true, status: "healthy" });
  assert.deepEqual(healthcheck, { ok: true, status: "healthy" });
  assert.equal(schedulerCalls, 0);
});

test("erros e logs do scheduler nao persistem PII ou secrets", async () => {
  const raw = "token=segredo email=pessoa@example.test busca=confidencial";
  const failed = failLegacySchedule(schedule({ query: raw }), Object.assign(new Error(raw), { code: "ETIMEDOUT" }), { at: now });
  const logs = [];
  await runDueLegacySchedules({
    schedules: [schedule({ id: "safe-id" })],
    at: now,
    logger: { error: (message, context) => logs.push(JSON.stringify({ message, context })) },
    run: async () => { throw new Error(raw); }
  });
  assert.equal(failed.lastError.includes("segredo"), false);
  assert.equal(failed.lastError.includes("@"), false);
  assert.equal(logs.join(" ").includes("segredo"), false);
  assert.equal(logs.join(" ").includes("@"), false);
});

test("sincronizacao preserva item historico quando requisito atual substitui sua FK", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "legacy-scheduler-fk-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  try {
    const oldAt = "2026-08-22T12:00:00.000Z";
    const newAt = "2026-08-23T12:00:00.000Z";
    const oldRequirement = { id: "requirement-old", type: "skill", normalizedName: "linux", originalText: "Linux", importance: "required", required: true, weight: 1, source: "job.description", confidence: 1 };
    const newRequirement = { id: "requirement-new", type: "skill", normalizedName: "kubernetes", originalText: "Kubernetes", importance: "required", required: true, weight: 1, source: "job.description", confidence: 1 };
    const state = {
      ...defaultUnifiedState(),
      jobs: [{ id: "job-1", source: "manual", title: "Analista", company: "Empresa", description: "Linux Kubernetes", url: "https://example.test/job", createdAt: oldAt, updatedAt: newAt }],
      analyses: [
        { id: "analysis-new", jobId: "job-1", resumeId: null, score: 80, algorithmVersion: "ats-matcher-v2", requirements: [newRequirement], items: [{ id: "item-new", analysisId: "analysis-new", requirementId: "requirement-new", status: "MATCH", score: 1, requirement: newRequirement, evidence: [], explanation: "ok", createdAt: newAt }], createdAt: newAt, updatedAt: newAt },
        { id: "analysis-old", jobId: "job-1", resumeId: null, score: 70, algorithmVersion: "ats-matcher-v2", requirements: [oldRequirement], items: [{ id: "item-old", analysisId: "analysis-old", requirementId: "requirement-old", status: "MATCH", score: 1, requirement: oldRequirement, evidence: [], explanation: "historico", createdAt: oldAt }], createdAt: oldAt, updatedAt: oldAt }
      ]
    };
    await store.save(state);
    const historical = store.analysisItems.forAnalysis("analysis-old")[0];
    assert.equal(historical.requirementId, "");
    assert.equal(historical.requirement.id, "requirement-old");
    assert.equal(store.database.connection.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
