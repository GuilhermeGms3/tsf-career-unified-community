import { BaseRepository, parseJson } from "./base-repository.mjs";

export class AtsAnalysisItemRepository extends BaseRepository {
  constructor(connection) {
    super(connection, {
      table: "ats_analysis_items",
      columns: ["id", "analysis_id", "requirement_id", "status", "score", "requirement_json", "evidence_json", "explanation", "resolution_reason", "providers_checked_json", "created_at"],
      toRow: (item) => ({ id: item.id, analysis_id: item.analysisId, requirement_id: item.requirementId || null, status: item.status, score: item.score ?? null, requirement_json: JSON.stringify(item.requirement || {}), evidence_json: JSON.stringify(item.evidence || []), explanation: item.explanation || "", resolution_reason: item.resolution?.reason || "", providers_checked_json: JSON.stringify(item.resolution?.providersChecked || []), created_at: item.createdAt }),
      fromRow: (row) => ({ id: row.id, analysisId: row.analysis_id, requirementId: row.requirement_id || "", status: row.status, score: row.score, requirement: parseJson(row.requirement_json, {}), evidence: parseJson(row.evidence_json, []), explanation: row.explanation, resolution: { reason: row.resolution_reason || "", providersChecked: parseJson(row.providers_checked_json, []) }, createdAt: row.created_at })
    });
  }

  forAnalysis(analysisId) {
    return this.connection.prepare("SELECT * FROM ats_analysis_items WHERE analysis_id = ? ORDER BY rowid").all(analysisId).map(this.fromRow);
  }

  forAnalyses(analysisIds = []) {
    const ids = [...new Set(analysisIds.filter(Boolean))];
    if (!ids.length) return [];
    return this.connection
      .prepare(
        `SELECT * FROM ats_analysis_items WHERE analysis_id IN (${ids.map(() => "?").join(", ")}) ORDER BY rowid`,
      )
      .all(...ids)
      .map(this.fromRow);
  }

  syncForAnalysis(analysisId, items, timestamp = new Date().toISOString()) {
    const persisted = items.map((item, index) => ({ ...item, id: item.id || `analysis-item-${analysisId}-${index + 1}`, analysisId, createdAt: item.createdAt || timestamp }));
    for (const item of persisted) this.upsert(item);
    const ids = persisted.map((item) => item.id);
    if (!ids.length) this.connection.prepare("DELETE FROM ats_analysis_items WHERE analysis_id = ?").run(analysisId);
    else this.connection.prepare(`DELETE FROM ats_analysis_items WHERE analysis_id = ? AND id NOT IN (${ids.map(() => "?").join(", ")})`).run(analysisId, ...ids);
  }
}
