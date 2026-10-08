import { BaseRepository, parseJson } from "./base-repository.mjs";

export class JobRequirementRepository extends BaseRepository {
  constructor(connection) {
    super(connection, {
      table: "job_requirements",
      columns: ["id", "job_id", "type", "normalized_name", "original_text", "importance", "required", "weight", "source", "confidence", "metadata_json", "created_at", "updated_at"],
      toRow: (item) => ({ id: item.id, job_id: item.jobId, type: item.type, normalized_name: item.normalizedName, original_text: item.originalText, importance: item.importance || "unspecified", required: item.required ? 1 : 0, weight: Number(item.weight ?? 1), source: item.source || "job.description", confidence: Number(item.confidence ?? 0.7), metadata_json: JSON.stringify(item.metadata || {}), created_at: item.createdAt, updated_at: item.updatedAt }),
      fromRow: (row) => ({ id: row.id, jobId: row.job_id, type: row.type, normalizedName: row.normalized_name, originalText: row.original_text, importance: row.importance, required: Boolean(row.required), weight: row.weight, source: row.source, confidence: row.confidence, metadata: parseJson(row.metadata_json, {}), createdAt: row.created_at, updatedAt: row.updated_at })
    });
  }

  forJob(jobId) {
    return this.connection.prepare("SELECT * FROM job_requirements WHERE job_id = ? ORDER BY required DESC, weight DESC, type, normalized_name").all(jobId).map(this.fromRow);
  }

  syncForJob(jobId, requirements, timestamp = new Date().toISOString()) {
    const items = requirements.map((item) => ({ ...item, jobId, createdAt: item.createdAt || timestamp, updatedAt: item.updatedAt || timestamp }));
    const ids = items.map((item) => item.id);
    if (!ids.length) this.connection.prepare("DELETE FROM job_requirements WHERE job_id = ?").run(jobId);
    else this.connection.prepare(`DELETE FROM job_requirements WHERE job_id = ? AND id NOT IN (${ids.map(() => "?").join(", ")})`).run(jobId, ...ids);
    for (const item of items) this.upsert(item);
  }
}
