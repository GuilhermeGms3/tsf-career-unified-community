import { isRefreshableOpportunity } from "./daily-decision-service.mjs";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sourceResults(run) {
  return (run?.report?.sourceReports || []).map((report) => ({
    provider: report.provider || report.providerId || "unknown",
    status: report.status || "UNKNOWN",
    found: Number(report.acceptedResults ?? report.resultCount ?? report.discoveredCount ?? 0),
    errorCode: report.errorCode || "",
    sites: (report.sites || []).map((site) => ({
      source: site.site || site.source || "unknown",
      status: site.status || "UNKNOWN",
      found: Number(site.acceptedResults ?? site.resultCount ?? 0),
      errorCode: site.errorCode || "",
    })),
  }));
}

export class DailyRefreshService {
  constructor({ store, jobHuntService, opportunityService, availabilityService, decisionInbox, maxVerifications = 30, verificationConcurrency = 3, searchPollMs = 500, searchTimeoutMs = 15 * 60 * 1000 } = {}) {
    Object.assign(this, { store, jobHuntService, opportunityService, availabilityService, decisionInbox, maxVerifications, verificationConcurrency, searchPollMs, searchTimeoutMs });
    this.running = new Map();
  }

  status(id = "") { return id ? this.store.dailyRefreshRuns.findById(id) : this.store.dailyRefreshRuns.active() || this.store.dailyRefreshRuns.latest(); }

  start({ skipSearch = false } = {}) {
    const active = this.store.dailyRefreshRuns.active();
    if (active) return active;
    const profiles = this.store.jobHuntProfiles.all();
    const profile = profiles.find((item) => item.enabled) || profiles[0] || null;
    const dailyRun = this.store.dailyRefreshRuns.start(profile?.id || "", skipSearch ? "VERIFYING" : "SEARCHING");
    const task = this.execute(dailyRun.id, profile, { skipSearch }).catch((error) => {
      this.store.dailyRefreshRuns.update(dailyRun.id, { status: "FAILED", stage: "FAILED", errorCode: error.code || "DAILY_REFRESH_FAILED", completedAt: new Date().toISOString(), result: { message: error.message } });
    }).finally(() => this.running.delete(dailyRun.id));
    this.running.set(dailyRun.id, task);
    return dailyRun;
  }

  async execute(id, profile, { skipSearch = false } = {}) {
    let searchRun = null;
    let searchFailed = false;
    if (profile && !skipSearch) {
      searchRun = this.jobHuntService.queue(profile.id, { triggerType: "MANUAL" });
      if (searchRun.reason === "ALREADY_RUNNING") searchRun = this.store.jobHuntRuns.list(profile.id).find((item) => item.status === "RUNNING") || null;
      this.store.dailyRefreshRuns.update(id, { searchRunId: searchRun?.id || "" });
      if (searchRun?.id) {
        const deadline = Date.now() + this.searchTimeoutMs;
        while (Date.now() < deadline) {
          searchRun = this.store.jobHuntRuns.findById(searchRun.id);
          if (searchRun?.status !== "RUNNING") break;
          await wait(this.searchPollMs);
        }
        if (searchRun?.status === "RUNNING") throw Object.assign(new Error("A busca diária excedeu o tempo máximo."), { code: "DAILY_SEARCH_TIMEOUT" });
        searchFailed = !searchRun || searchRun.status !== "COMPLETED";
      }
    }

    this.opportunityService.invalidate();
    const opportunities = await this.opportunityService.list();
    const locationPolicy = profile?.locationPolicy || {};
    const stale = opportunities.filter((item) => !item.application && item.job?.id && isRefreshableOpportunity(item, locationPolicy))
      .sort((left, right) => Number(right.priority?.score || 0) - Number(left.priority?.score || 0));
    const candidates = stale.slice(0, this.maxVerifications);
    const progress = { verificationTotal: candidates.length, verificationChecked: 0, availableCount: 0, closedCount: 0, inconclusiveCount: 0, remainingCount: Math.max(0, stale.length - candidates.length) };
    this.store.dailyRefreshRuns.update(id, { stage: "VERIFYING", ...progress });

    let cursor = 0;
    const worker = async () => {
      while (cursor < candidates.length) {
        const candidate = candidates[cursor++];
        let status = "INCONCLUSIVE";
        try { status = (await this.availabilityService.verify(candidate.job.id)).availability.status; } catch {}
        progress.verificationChecked++;
        if (status === "AVAILABLE") progress.availableCount++;
        else if (status === "CLOSED") progress.closedCount++;
        else progress.inconclusiveCount++;
        this.store.dailyRefreshRuns.update(id, progress);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.verificationConcurrency, candidates.length) }, worker));

    this.store.dailyRefreshRuns.update(id, { stage: "REBUILDING", ...progress });
    this.opportunityService.invalidate();
    await this.decisionInbox.build();
    const partial = searchFailed || progress.inconclusiveCount > 0 || progress.remainingCount > 0;
    return this.store.dailyRefreshRuns.update(id, {
      status: partial ? "PARTIAL" : "COMPLETED", stage: "COMPLETED", completedAt: new Date().toISOString(), ...progress,
      errorCode: searchFailed ? searchRun?.errorCode || "DAILY_SEARCH_FAILED" : "",
      result: {
        search: searchRun ? { id: searchRun.id, status: searchRun.status, found: searchRun.discoveredCount, newJobs: searchRun.canonicalCount, duplicates: searchRun.duplicateCount, closed: searchRun.closedCount, sources: sourceResults(searchRun) } : { status: skipSearch ? "NOT_REQUESTED" : profile ? "NOT_STARTED" : "NOT_CONFIGURED", sources: [] },
        verification: { ...progress },
      },
    });
  }
}
