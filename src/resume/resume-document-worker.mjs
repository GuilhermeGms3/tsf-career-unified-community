export class ResumeDocumentWorker {
  constructor({
    repository,
    handlers = {},
    concurrency = 1,
    pollIntervalMs = 1000,
    claimOptions = {},
  } = {}) {
    Object.assign(this, { repository, handlers, pollIntervalMs, claimOptions });
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.running = 0;
    this.pumping = false;
    this.timer = null;
    this.autoPump = false;
  }
  start() {
    this.stopped = false;
    this.autoPump = true;
    if (!this.timer) {
      this.timer = setInterval(() => this.pump(), this.pollIntervalMs);
      this.timer.unref?.();
    }
    this.pump();
    return this;
  }
  stop() {
    this.stopped = true;
    this.autoPump = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  schedule() {
    if (this.stopped) return;
    this.autoPump = true;
    queueMicrotask(() => this.pump());
  }
  async drain() {
    this.schedule();
  }
  async pump() {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      while (this.running < this.concurrency) {
        const job = this.repository.claim(
          `resume-worker-${process.pid}-${this.running + 1}`, this.claimOptions,
        );
        if (!job) break;
        this.running++;
        void this.execute(job);
      }
    } finally {
      this.pumping = false;
    }
  }
  async execute(job) {
    try {
      const handler = this.handlers[job.jobType];
      if (!handler)
        throw Object.assign(
          new Error("Tipo de job de documento desconhecido."),
          { code: "RESUME_JOB_HANDLER_MISSING" },
        );
      const result = await handler(job.payload),
        status = result?.errorCode
          ? "FAILED"
          : result?.version?.status === "REVIEW_REQUIRED"
            ? "REVIEW_REQUIRED"
            : "COMPLETED";
      this.repository.finish(
        job.id,
        status,
        result,
        result?.errorCode
          ? Object.assign(new Error(result.errorCode), {
              code: result.errorCode,
            })
          : null,
      );
    } catch (error) {
      this.repository.finish(job.id, "FAILED", null, error);
    } finally {
      this.running--;
      if (this.autoPump) this.schedule();
    }
  }
}
