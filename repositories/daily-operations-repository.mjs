import { randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now = () => new Date().toISOString();

export class DailyInboxSnapshotRepository {
  constructor(connection) { this.connection = connection; }

  get() {
    const row = this.connection.prepare("SELECT * FROM daily_inbox_snapshots WHERE id=1").get();
    return row ? { inbox: parseJson(row.snapshot_json, null), generatedAt: row.generated_at, updatedAt: row.updated_at } : null;
  }

  save(inbox) {
    const timestamp = now();
    this.connection.prepare(`INSERT INTO daily_inbox_snapshots(id,snapshot_json,generated_at,updated_at)
      VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json,generated_at=excluded.generated_at,updated_at=excluded.updated_at`)
      .run(JSON.stringify(inbox), inbox.generatedAt || timestamp, timestamp);
    return this.get();
  }
}

export class DailyRefreshRunRepository {
  constructor(connection) { this.connection = connection; }

  start(profileId = "", stage = "SEARCHING") {
    const id = `daily-refresh-${randomUUID()}`;
    this.connection.prepare(`INSERT INTO daily_refresh_runs(id,profile_id,status,stage,started_at)
      VALUES(?,?,'RUNNING',?,?)`).run(id, profileId || null, stage, now());
    return this.findById(id);
  }

  update(id, changes = {}) {
    const current = this.findById(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    this.connection.prepare(`UPDATE daily_refresh_runs SET profile_id=?,search_run_id=?,status=?,stage=?,verification_total=?,verification_checked=?,available_count=?,closed_count=?,inconclusive_count=?,remaining_count=?,result_json=?,error_code=?,completed_at=? WHERE id=?`)
      .run(next.profileId || null, next.searchRunId || null, next.status, next.stage, Number(next.verificationTotal || 0), Number(next.verificationChecked || 0), Number(next.availableCount || 0), Number(next.closedCount || 0), Number(next.inconclusiveCount || 0), Number(next.remainingCount || 0), JSON.stringify(next.result || {}), next.errorCode || null, next.completedAt || null, id);
    return this.findById(id);
  }

  active() {
    const row = this.connection.prepare("SELECT * FROM daily_refresh_runs WHERE status='RUNNING' ORDER BY started_at DESC LIMIT 1").get();
    return row ? this.map(row) : null;
  }

  latest() {
    const row = this.connection.prepare("SELECT * FROM daily_refresh_runs ORDER BY started_at DESC,rowid DESC LIMIT 1").get();
    return row ? this.map(row) : null;
  }

  list(limit = 20) {
    return this.connection
      .prepare("SELECT * FROM daily_refresh_runs ORDER BY started_at DESC,rowid DESC LIMIT ?")
      .all(Math.min(100, Math.max(1, Number(limit) || 20)))
      .map((row) => this.map(row));
  }

  recover() {
    const completedAt = now();
    this.connection.prepare(`UPDATE daily_refresh_runs SET status='PARTIAL',stage='FAILED',error_code='PROCESS_INTERRUPTED',completed_at=? WHERE status='RUNNING'`).run(completedAt);
  }

  findById(id) {
    const row = this.connection.prepare("SELECT * FROM daily_refresh_runs WHERE id=?").get(id);
    return row ? this.map(row) : null;
  }

  map(row) {
    return {
      id: row.id, profileId: row.profile_id || "", searchRunId: row.search_run_id || "",
      status: row.status, stage: row.stage, verificationTotal: row.verification_total,
      verificationChecked: row.verification_checked, availableCount: row.available_count,
      closedCount: row.closed_count, inconclusiveCount: row.inconclusive_count,
      remainingCount: row.remaining_count, result: parseJson(row.result_json, {}),
      errorCode: row.error_code || "", startedAt: row.started_at, completedAt: row.completed_at || "",
    };
  }
}
