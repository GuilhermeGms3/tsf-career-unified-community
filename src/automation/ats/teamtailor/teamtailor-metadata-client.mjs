export class TeamtailorMetadataClient {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 10000, clock = () => new Date() } = {}) {
    Object.assign(this, { fetchImpl, timeoutMs, clock });
  }

  async checkJob(identity) {
    const url = identity.canonicalUrl, controller = new AbortController(), timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { accept: "text/html,application/xhtml+xml" },
        redirect: "error",
        signal: controller.signal,
      }), checkedAt = this.clock().toISOString();
      if ([404, 410].includes(response.status))
        return { status: "CLOSED", checkedAt, authority: "teamtailor-public-job-page", reference: url, code: "TEAMTAILOR_JOB_NOT_FOUND" };
      if (!response.ok)
        return { status: "ERROR", checkedAt, authority: "teamtailor-public-job-page", reference: url, code: `TEAMTAILOR_JOB_HTTP_${response.status}` };
      const html = await response.text();
      if (/job (?:is )?no longer available|position has been filled|vacancy (?:is )?closed/i.test(html))
        return { status: "CLOSED", checkedAt, authority: "teamtailor-public-job-page", reference: url, code: "TEAMTAILOR_JOB_CLOSED" };
      if (!/JobPosting/i.test(html) || !/\/applications/i.test(html))
        return { status: "ERROR", checkedAt, authority: "teamtailor-public-job-page", reference: url, code: "TEAMTAILOR_JOB_MARKERS_MISSING" };
      return { status: "OPEN", checkedAt, authority: "teamtailor-public-job-page", reference: url };
    } catch (error) {
      return {
        status: "ERROR",
        checkedAt: this.clock().toISOString(),
        authority: "teamtailor-public-job-page",
        reference: url,
        code: error?.name === "AbortError" ? "TEAMTAILOR_JOB_TIMEOUT" : "TEAMTAILOR_JOB_UNAVAILABLE",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
