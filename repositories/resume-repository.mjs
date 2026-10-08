import { BaseRepository, parseJson } from "./base-repository.mjs";

export class ResumeRepository extends BaseRepository {
  constructor(connection) {
    super(connection, {
      table: "resumes",
      columns: ["id", "title", "text", "file_name", "stored_path", "focus", "sections_json", "extraction_json", "resume_kind", "language", "archived_at", "created_at", "updated_at"],
      toRow: (item) => ({ id: item.id, title: item.title, text: item.text, file_name: item.fileName || "", stored_path: item.storedPath || "", focus: item.focus || "", sections_json: JSON.stringify(item.sections || {}), extraction_json: JSON.stringify({...item.extraction,importStatus:item.importStatus||item.extraction?.importStatus||"IMPORTED"}), resume_kind:item.resumeKind||"BASE",language:item.language||"pt-BR",archived_at:item.archivedAt||null, created_at: item.createdAt, updated_at: item.updatedAt }),
      fromRow: (row) => {const extraction=parseJson(row.extraction_json, {});return { id: row.id, title: row.title, text: row.text, fileName: row.file_name, storedPath: row.stored_path, focus: row.focus, sections: parseJson(row.sections_json, {}), extraction,importStatus:extraction.importStatus||"IMPORTED",resumeKind:row.resume_kind||"BASE",language:row.language||"pt-BR",archivedAt:row.archived_at||"", createdAt: row.created_at, updatedAt: row.updated_at };}
    });
  }
  allActive() {
    return this.connection
      .prepare("SELECT * FROM resumes WHERE archived_at IS NULL ORDER BY created_at DESC")
      .all()
      .map(this.fromRow);
  }
  archive(id, archivedAt = new Date().toISOString()) {
    this.connection
      .prepare("UPDATE resumes SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(archivedAt, archivedAt, id);
    return this.findById(id);
  }
}
