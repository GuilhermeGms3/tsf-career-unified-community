import { SafeHttpClient } from "../discovery/safe-http-client.mjs";

const CLOSED_TEXT = [
  /vaga (?:foi )?(?:encerrada|fechada|expirada)/i,
  /(?:job|position|opportunity) (?:is |has been )?(?:closed|expired|no longer available)/i,
  /(?:não|nao) (?:está|esta) mais (?:aceitando|disponível|disponivel)/i,
  /applications? (?:are )?closed/i,
];

function verificationUrl(job = {}) {
  return job.applicationUrl || job.canonicalUrl || job.url || "";
}

export class OpportunityAvailabilityService {
  constructor({ store, client = new SafeHttpClient({ timeoutMs: 8000, retries: 0, cacheTtlMs: 0 }) } = {}) {
    Object.assign(this, { store, client });
  }

  async verify(jobId) {
    const job = this.store.jobs.findById(jobId);
    if (!job) throw Object.assign(new Error("Vaga não encontrada."), { code: "JOB_NOT_FOUND", status: 404 });
    const url = verificationUrl(job);
    if (!url) return this.persist(job, { status: "INCONCLUSIVE", reason: "MISSING_PUBLIC_URL" });
    try {
      const result = await this.client.getText(url, { cache: false, maxBytes: 600_000 });
      const closedByContent = CLOSED_TEXT.some((pattern) => pattern.test(result.data.slice(0, 600_000)));
      return this.persist(job, {
        status: closedByContent ? "CLOSED" : "AVAILABLE",
        reason: closedByContent ? "CLOSED_PAGE_CONTENT" : "PUBLIC_PAGE_AVAILABLE",
        httpStatus: result.response.status,
        finalUrl: result.url,
      });
    } catch (error) {
      if ([404, 410].includes(Number(error.status))) {
        return this.persist(job, {
          status: "CLOSED",
          reason: `HTTP_${error.status}`,
          httpStatus: Number(error.status),
          finalUrl: url,
        });
      }
      return this.persist(job, {
        status: "INCONCLUSIVE",
        reason: error.code || "PUBLIC_PAGE_CHECK_FAILED",
        httpStatus: Number(error.status || 0),
        finalUrl: url,
      });
    }
  }

  persist(job, result) {
    const checkedAt = new Date().toISOString();
    const closed = result.status === "CLOSED";
    const updated = this.store.jobs.upsert({
      ...job,
      lifecycleStatus: closed ? "CLOSED" : result.status === "AVAILABLE" ? "OPEN" : job.lifecycleStatus,
      lastCheckedAt: checkedAt,
      lastSeenAt: result.status === "AVAILABLE" ? checkedAt : job.lastSeenAt,
      closedAt: closed ? checkedAt : job.closedAt,
      canonicalUrl: result.finalUrl || job.canonicalUrl,
      availability: { ...result, checkedAt },
      updatedAt: checkedAt,
    });
    return { job: updated, availability: updated.availability };
  }
}
