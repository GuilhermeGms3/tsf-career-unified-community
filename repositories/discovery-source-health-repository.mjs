import { randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now = () => new Date().toISOString();
const count = (value) => Math.max(0, Number(value || 0));

export class DiscoverySourceHealthRepository {
  constructor(connection) {
    this.connection = connection;
  }

  record(item) {
    const previous = this.latest(item.surfaceId);
    const failed = ["DEGRADED", "BLOCKED"].includes(item.status);
    const consecutiveFailures = failed ? Number(previous?.consecutiveFailures || 0) + 1 : 0;
    const createdAt = item.finishedAt || now();
    const lastSuccessAt = item.lastSuccessAt || previous?.lastSuccessAt || null;
    const lastRealQueryAt = item.lastRealQueryAt || previous?.lastRealQueryAt || null;
    const lastErrorAt = item.lastErrorAt || previous?.lastErrorAt || null;
    const lastErrorCode = item.lastErrorCode || previous?.lastErrorCode || null;
    const lastNewJobAt = item.lastNewJobAt || previous?.lastNewJobAt || null;
    const latestJobPublishedAt = item.latestJobPublishedAt || previous?.latestJobPublishedAt || null;
    const oldestJobPublishedAt = item.oldestJobPublishedAt || previous?.oldestJobPublishedAt || null;
    const id = item.id || `source-health-${randomUUID()}`;
    this.connection.prepare(`INSERT INTO discovery_source_health_history(
      id,run_id,source_id,provider_id,surface_id,status,real_query,query,location,started_at,finished_at,
      last_success_at,last_real_query_at,last_error_at,last_error_code,consecutive_failures,
      raw_count,parsed_count,valid_count,new_count,duplicate_count,discarded_count,pages_scanned,results_limit,query_count,
      latest_job_published_at,oldest_job_published_at,last_new_job_at,latency_ms,duration_ms,
      authentication_state,configuration_state,errors_json,rate_limits_json,sample_urls_json,metadata_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, item.runId || null, item.sourceId || item.providerId, item.providerId, item.surfaceId, item.status,
      item.realQuery ? 1 : 0, String(item.query || "").slice(0, 240), String(item.location || "").slice(0, 160), item.startedAt || createdAt, createdAt,
      lastSuccessAt, lastRealQueryAt, lastErrorAt, lastErrorCode, consecutiveFailures,
      count(item.rawCount), count(item.parsedCount), count(item.validCount), count(item.newCount), count(item.duplicateCount), count(item.discardedCount), count(item.pagesScanned), count(item.resultsLimit), count(item.queryCount),
      latestJobPublishedAt, oldestJobPublishedAt, lastNewJobAt, count(item.latencyMs), count(item.durationMs),
      item.authenticationState || "UNKNOWN", item.configurationState || "UNKNOWN", JSON.stringify(item.errors || []), JSON.stringify(item.rateLimits || []), JSON.stringify((item.sampleUrls || []).slice(0, 5)), JSON.stringify(item.metadata || {}), createdAt,
    );
    return this.findById(id);
  }

  findById(id) {
    const row = this.connection.prepare("SELECT * FROM discovery_source_health_history WHERE id=?").get(id);
    return row ? this.map(row) : null;
  }

  latest(surfaceId) {
    const row = this.connection.prepare("SELECT * FROM discovery_source_health_history WHERE surface_id=? ORDER BY finished_at DESC,rowid DESC LIMIT 1").get(surfaceId);
    return row ? this.map(row) : null;
  }

  latestAll() {
    return this.connection.prepare("SELECT DISTINCT surface_id FROM discovery_source_health_history ORDER BY surface_id").all().map((row) => this.latest(row.surface_id));
  }

  history(surfaceId, limit = 10) {
    return this.connection.prepare("SELECT * FROM discovery_source_health_history WHERE surface_id=? ORDER BY finished_at DESC,rowid DESC LIMIT ?").all(surfaceId, Math.max(1, Math.min(50, Number(limit) || 10))).map((row) => this.map(row));
  }

  forRun(runId) {
    return this.connection.prepare("SELECT * FROM discovery_source_health_history WHERE run_id=? ORDER BY finished_at,surface_id").all(runId).map((row) => this.map(row));
  }

  map(row) {
    return {
      id: row.id, runId: row.run_id || "", sourceId: row.source_id, providerId: row.provider_id, surfaceId: row.surface_id,
      status: row.status, realQuery: Boolean(row.real_query), query: row.query, location: row.location,
      startedAt: row.started_at, finishedAt: row.finished_at, lastSuccessAt: row.last_success_at || "", lastRealQueryAt: row.last_real_query_at || "",
      lastErrorAt: row.last_error_at || "", lastErrorCode: row.last_error_code || "", consecutiveFailures: row.consecutive_failures,
      lastRawCount: row.raw_count, lastParsedCount: row.parsed_count, lastValidCount: row.valid_count, lastNewCount: row.new_count,
      lastDuplicateCount: row.duplicate_count, lastDiscardedCount: row.discarded_count, pagesScanned: row.pages_scanned,
      resultsLimit: row.results_limit, queryCount: row.query_count, latestJobPublishedAt: row.latest_job_published_at || "",
      oldestJobPublishedAt: row.oldest_job_published_at || "", lastNewJobAt: row.last_new_job_at || "", latencyMs: row.latency_ms,
      durationMs: row.duration_ms, authenticationState: row.authentication_state, configurationState: row.configuration_state,
      errors: parseJson(row.errors_json, []), rateLimits: parseJson(row.rate_limits_json, []), sampleUrls: parseJson(row.sample_urls_json, []),
      metadata: parseJson(row.metadata_json, {}), createdAt: row.created_at,
    };
  }
}
