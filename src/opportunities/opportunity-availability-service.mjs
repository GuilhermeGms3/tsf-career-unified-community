import { SafeHttpClient } from "../discovery/safe-http-client.mjs";
import { publicJobEndpoint, checkPublicJobApi, inspectJobPage } from "./availability-detector.mjs";

function verificationUrl(job = {}) {
  // Nerdin's candidature URL is a login/form page, not the public vacancy.
  if (/nerdin\.com\.br\/vaga_candidatura\.php/i.test(job.applicationUrl || "") && /nerdin\.com\.br\/vaga_emprego\//i.test(job.canonicalUrl || "")) return job.canonicalUrl;
  return job.applicationUrl || job.canonicalUrl || job.url || "";
}

export class OpportunityAvailabilityService {
  constructor({ store, client = new SafeHttpClient({ timeoutMs: 8000, retries: 0, cacheTtlMs: 0 }), onChange = null } = {}) {
    Object.assign(this, { store, client, onChange });
    this.inFlight = new Map();
  }

  async verify(jobId, { notify = true } = {}) {
    if (this.inFlight.has(jobId)) return this.inFlight.get(jobId);
    const task = this.check(jobId, notify).finally(() => this.inFlight.delete(jobId));
    this.inFlight.set(jobId, task);
    return task;
  }

  async check(jobId, notify) {
    const job = this.store.jobs.findById(jobId);
    if (!job) throw Object.assign(new Error("Vaga não encontrada."), { code: "JOB_NOT_FOUND", status: 404 });
    const url = verificationUrl(job);
    const persist = result => this.persist(job, result, notify);
    if (!url) return persist({ status: "INCONCLUSIVE", reason: "MISSING_PUBLIC_URL" });
    try {
      const endpoint = publicJobEndpoint(url);
      if (endpoint) return persist(await checkPublicJobApi(endpoint, this.client));
      const result = await this.client.getText(url, { cache: false, maxBytes: 600_000 });
      return persist(inspectJobPage({ ...job, applicationUrl: url }, result));
    } catch (error) {
      if (error.finalUrl && inspectJobPage({ ...job, applicationUrl: url }, { data: "", url: error.finalUrl }).reason === "JOB_PAGE_REDIRECTED")
        return persist({ status: "INCONCLUSIVE", reason: "JOB_PAGE_REDIRECTED", finalUrl: error.finalUrl, httpStatus: Number(error.status || 0) });
      if ([404, 410].includes(Number(error.status))) {
        return persist({
          status: "CLOSED",
          reason: `HTTP_${error.status}`,
          httpStatus: Number(error.status),
          finalUrl: url,
        });
      }
      return persist({
        status: "INCONCLUSIVE",
        reason: error.code || "PUBLIC_PAGE_CHECK_FAILED",
        httpStatus: Number(error.status || 0),
        finalUrl: url,
      });
    }
  }

  persist(job, result, notify = true) {
    job = this.store.jobs.findById(job.id) || job;
    const checkedAt = new Date().toISOString();
    const closed = result.status === "CLOSED";
    const updated = this.store.jobs.upsert({
      ...job,
      lifecycleStatus: closed ? "CLOSED" : result.status === "AVAILABLE" ? "OPEN" : job.lifecycleStatus,
      lastCheckedAt: checkedAt,
      lastSeenAt: result.status === "AVAILABLE" ? checkedAt : job.lastSeenAt,
      closedAt: closed ? checkedAt : result.status === "AVAILABLE" ? "" : job.closedAt,
      availability: { ...result, checkedAt },
      availabilityHistory: [...(job.availabilityHistory || []), { ...result, checkedAt }].slice(-10),
      updatedAt: checkedAt,
    });
    if (notify) this.onChange?.(updated);
    return { job: updated, availability: updated.availability };
  }
}
