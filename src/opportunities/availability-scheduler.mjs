const KEY = "opportunity_availability_schedule_v1";
const defaults = { enabled: false, everyHours: 24, batchSize: 100, nextRunAt: "", lastRunId: "", lastStartedAt: "", lastError: "" };

export class AvailabilityScheduler {
  constructor({ store, refreshService, clock = () => new Date() } = {}) {
    Object.assign(this, { store, refreshService, clock });
  }

  policy() {
    try { return { ...defaults, ...JSON.parse(this.store.database.getMetadata(KEY, "{}")) }; }
    catch { return { ...defaults }; }
  }

  save(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.enabled !== "boolean" ||
      !Number.isInteger(input.everyHours) || input.everyHours < 1 || input.everyHours > 168 ||
      !Number.isInteger(input.batchSize) || input.batchSize < 10 || input.batchSize > 300)
      throw Object.assign(new Error("Informe ativação, intervalo de 1 a 168 horas e lote de 10 a 300 vagas."), { status: 400, code: "INVALID_AVAILABILITY_SCHEDULE" });
    const current = this.policy();
    const next = { ...current, enabled: input.enabled, everyHours: input.everyHours, batchSize: input.batchSize,
      nextRunAt: input.enabled ? new Date(this.clock().getTime() + input.everyHours * 3_600_000).toISOString() : "" };
    this.store.database.setMetadata(KEY, JSON.stringify(next));
    return this.status();
  }

  status() {
    const policy = this.policy(), run = this.refreshService.status();
    const previous = policy.lastRunId ? this.store.dailyRefreshRuns.findById?.(policy.lastRunId) : null;
    return { policy, run, continuingSweep: policy.enabled && ["COMPLETED", "PARTIAL"].includes(previous?.status) && previous.remainingCount > 0, runs: this.store.dailyRefreshRuns.list(8) };
  }

  tick() {
    const policy = this.policy();
    if (!policy.enabled) return null;
    if (this.store.dailyRefreshRuns.active()) return null;
    const previous = policy.lastRunId ? this.store.dailyRefreshRuns.findById?.(policy.lastRunId) : null;
    const continueSweep = ["COMPLETED", "PARTIAL"].includes(previous?.status) && previous.remainingCount > 0;
    if (!continueSweep && Date.parse(policy.nextRunAt) > this.clock().getTime()) return null;
    try {
      const run = this.refreshService.start({ skipSearch: true, catalog: true, batchSize: policy.batchSize, trigger: "SCHEDULED",
        dueBefore: new Date(this.clock().getTime() - policy.everyHours * 3_600_000).toISOString() });
      this.store.database.setMetadata(KEY, JSON.stringify({ ...policy, lastRunId: run.id, lastStartedAt: this.clock().toISOString(), lastError: "",
        nextRunAt: new Date(this.clock().getTime() + policy.everyHours * 3_600_000).toISOString() }));
      return run;
    } catch (error) {
      this.store.database.setMetadata(KEY, JSON.stringify({ ...policy, lastError: error.code || "VERIFICATION_START_FAILED",
        nextRunAt: new Date(this.clock().getTime() + policy.everyHours * 3_600_000).toISOString() }));
      return null;
    }
  }
}
