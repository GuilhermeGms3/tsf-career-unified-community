import { randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now = () => new Date().toISOString();

export class CoverageBenchmarkRepository {
  constructor(connection, database) {
    Object.assign(this, { connection, database });
  }

  saveReference(input = {}) {
    const timestamp = now();
    const existing = input.canonicalUrl
      ? this.connection.prepare("SELECT id FROM coverage_reference_jobs WHERE canonical_url=?").get(input.canonicalUrl)
      : null;
    const id = existing?.id || input.id || `coverage-reference-${randomUUID()}`;
    this.connection.prepare(`INSERT INTO coverage_reference_jobs(
      id,original_url,canonical_url,title,company,perceived_source,location,work_model,
      source_page,provider_position,found_at,interest,notes,source_text,imported_job_id,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      original_url=excluded.original_url,canonical_url=excluded.canonical_url,
      title=excluded.title,company=excluded.company,perceived_source=excluded.perceived_source,
      location=excluded.location,work_model=excluded.work_model,source_page=excluded.source_page,
      provider_position=excluded.provider_position,found_at=excluded.found_at,
      interest=excluded.interest,notes=excluded.notes,source_text=excluded.source_text,
      updated_at=excluded.updated_at`).run(
      id, input.originalUrl || "", input.canonicalUrl || "", input.title || "",
      input.company || "", input.perceivedSource || "", input.location || "",
      input.workModel || "", Number(input.sourcePage) || null, Number(input.providerPosition) || null,
      input.foundAt || timestamp, input.interest || "",
      input.notes || "", input.sourceText || "", input.importedJobId || null,
      input.createdAt || timestamp, timestamp,
    );
    return this.findReference(id);
  }

  markImported(id, jobId) {
    this.connection.prepare("UPDATE coverage_reference_jobs SET imported_job_id=?,updated_at=? WHERE id=?").run(jobId, now(), id);
    return this.findReference(id);
  }

  findReference(id) {
    const row = this.connection.prepare("SELECT * FROM coverage_reference_jobs WHERE id=?").get(id);
    return row ? this.mapReference(row) : null;
  }

  references() {
    return this.connection.prepare("SELECT * FROM coverage_reference_jobs ORDER BY found_at DESC,created_at DESC").all().map((row) => this.mapReference(row));
  }

  startRun() {
    const item = { id: `coverage-run-${randomUUID()}`, status: "RUNNING", startedAt: now() };
    this.connection.prepare("INSERT INTO coverage_benchmark_runs(id,status,started_at) VALUES(?,?,?)").run(item.id, item.status, item.startedAt);
    return item;
  }

  finishRun(id, summary) {
    this.connection.prepare("UPDATE coverage_benchmark_runs SET status='COMPLETED',summary_json=?,completed_at=? WHERE id=?").run(JSON.stringify(summary || {}), now(), id);
    return this.findRun(id);
  }

  failRun(id, errorCode) {
    this.connection.prepare("UPDATE coverage_benchmark_runs SET status='FAILED',summary_json=?,completed_at=? WHERE id=?").run(JSON.stringify({ errorCode }), now(), id);
    return this.findRun(id);
  }

  recordItem(runId, referenceJobId, diagnostic) {
    const id = `coverage-item-${randomUUID()}`;
    this.connection.prepare(`INSERT INTO coverage_benchmark_items(
      id,run_id,reference_job_id,coverage_status,matched_job_id,ranking_position,
      evidence_json,timeline_json,diagnostic_json,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      id, runId, referenceJobId, diagnostic.status,
      diagnostic.matchedJob?.id || null,
      Number.isInteger(diagnostic.rankingPosition) ? diagnostic.rankingPosition : null,
      JSON.stringify(diagnostic.evidence || []), JSON.stringify(diagnostic.timeline || []),
      JSON.stringify(diagnostic), now(),
    );
    return this.findItem(id);
  }

  findRun(id) {
    const row = this.connection.prepare("SELECT * FROM coverage_benchmark_runs WHERE id=?").get(id);
    if (!row) return null;
    return {
      id: row.id, status: row.status, summary: parseJson(row.summary_json, {}),
      startedAt: row.started_at, completedAt: row.completed_at || "",
      items: this.connection.prepare("SELECT * FROM coverage_benchmark_items WHERE run_id=? ORDER BY rowid").all(id).map((item) => this.mapItem(item)),
    };
  }

  latestRun() {
    const row = this.connection.prepare("SELECT id FROM coverage_benchmark_runs ORDER BY started_at DESC LIMIT 1").get();
    return row ? this.findRun(row.id) : null;
  }

  findItem(id) {
    const row = this.connection.prepare("SELECT * FROM coverage_benchmark_items WHERE id=?").get(id);
    return row ? this.mapItem(row) : null;
  }

  mapReference(row) {
    return {
      id: row.id, originalUrl: row.original_url, canonicalUrl: row.canonical_url,
      title: row.title, company: row.company, perceivedSource: row.perceived_source,
      location: row.location, workModel: row.work_model, foundAt: row.found_at,
      sourcePage: row.source_page, providerPosition: row.provider_position,
      interest: row.interest, notes: row.notes, sourceText: row.source_text,
      importedJobId: row.imported_job_id || "", createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  mapItem(row) {
    return {
      id: row.id, runId: row.run_id, referenceJobId: row.reference_job_id,
      status: row.coverage_status, matchedJobId: row.matched_job_id || "",
      rankingPosition: row.ranking_position,
      evidence: parseJson(row.evidence_json, []), timeline: parseJson(row.timeline_json, []),
      diagnostic: parseJson(row.diagnostic_json, {}), createdAt: row.created_at,
    };
  }
}
