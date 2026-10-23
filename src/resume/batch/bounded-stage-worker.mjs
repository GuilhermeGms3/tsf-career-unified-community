export class BoundedStageWorker {
  constructor({
    repository,
    status,
    handler,
    concurrency = 1,
    workerId = `resume-batch-${process.pid}`,
    pollIntervalMs = 1000,
    onError = null,
    claimOptions = {},
  } = {}) {
    Object.assign(this, {
      repository,
      status,
      handler,
      workerId,
      pollIntervalMs,
      onError,
      claimOptions,
    });
    this.concurrency = Math.max(1, Math.min(8, Math.floor(Number(concurrency) || 1)));
    this.running = 0;
    this.pumping = false;
    this.timer = null;
    this.stopped = false;
  }
  start() {
    this.stopped = false;
    if (!this.timer) {
      this.timer = setInterval(() => this.pump(), this.pollIntervalMs);
      this.timer.unref?.();
    }
    this.pump();
    return this;
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  schedule() {
    if (this.stopped) return;
    queueMicrotask(() => this.pump());
  }
  async pump() {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      while (this.running < this.concurrency) {
        const item = this.repository.claim(
          this.status,
          `${this.workerId}-${this.status.toLowerCase()}-${this.running + 1}`, this.claimOptions,
        );
        if (!item) break;
        this.running += 1;
        void this.execute(item);
      }
    } finally {
      this.pumping = false;
    }
  }
  async execute(item) {
    try {
      await this.handler(item);
    } catch (error) {
      const current = this.repository.findItem(item.id);
      if (current && current.status === this.status && (item.stateRevision === undefined || item.stateRevision === current.stateRevision))
        this.repository.transitionItem(item.id, "FAILED", {
          failureCode: error.code || "RESUME_BATCH_STAGE_FAILED",
          failureMessage: error.message,
        }, {expectedStatus:item.status,expectedRevision:item.stateRevision});
      this.onError?.(item, error);
    } finally {
      this.repository.release(item.id, item.lockedBy);
      this.running -= 1;
      this.schedule();
    }
  }
}
