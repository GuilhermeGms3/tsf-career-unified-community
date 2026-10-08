export class IntelligenceWorker {
  constructor({
    repository,
    handlers = {},
    workerId = `intelligence-worker-${process.pid}`,
    concurrency = 1,
    pollIntervalMs = 1000,
  } = {}) {
    this.repository = repository;
    this.handlers = handlers;
    this.workerId = workerId;
    this.concurrency = Math.max(1, Number(concurrency));
    this.running = 0;
    this.pollIntervalMs = pollIntervalMs;
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
    setImmediate(() => this.pump());
  }
  async pump() {
    if (this.pumping || this.stopped) return;
    this.pumping = true;
    try {
      while (this.running < this.concurrency) {
        const job = this.repository.claim(
          `${this.workerId}-${this.running + 1}`,
        );
        if (!job) break;
        this.running++;
        void this.execute(job);
      }
    } finally {
      this.pumping = false;
    }
  }
  async runOne() {
    if (this.running >= this.concurrency) return null;
    const job = this.repository.claim(`${this.workerId}-${this.running + 1}`);
    if (!job) return null;
    this.running++;
    return this.execute(job);
  }
  async execute(job) {
    try {
      const handler = this.handlers[job.task];
      if (!handler)
        throw Object.assign(new Error(`Handler ausente para ${job.task}.`), {
          code: "INTELLIGENCE_HANDLER_MISSING",
        });
      const result = await handler(job.payload);
      return this.repository.complete(job.id, result);
    } catch (error) {
      return this.repository.fail(job.id, error);
    } finally {
      this.running--;
      if (this.autoPump) this.schedule();
    }
  }
}
