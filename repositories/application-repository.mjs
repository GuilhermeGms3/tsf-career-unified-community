import { randomUUID } from "node:crypto";
import { BaseRepository, parseJson } from "./base-repository.mjs";
import { ApplicationStateError, assertApplicationTransition, normalizeApplicationStatus } from "../domain/application-status.mjs";

const applicationColumns = ["id", "job_id", "resume_id", "resume_version_id", "status", "applied_at", "next_action", "notes", "created_at", "updated_at"];

export class ApplicationRepository extends BaseRepository {
  constructor(connection, database) {
    super(connection, {
      table: "applications", columns: applicationColumns,
      toRow: (item) => ({ id: item.id, job_id: item.jobId, resume_id: item.resumeId || null, resume_version_id:item.resumeVersionId||null, status: normalizeApplicationStatus(item.status), applied_at: item.appliedAt || null, next_action: item.nextAction || "", notes: item.notes || "", created_at: item.createdAt, updated_at: item.updatedAt }),
      fromRow: (row) => ({ id: row.id, jobId: row.job_id, resumeId: row.resume_id || "", resumeVersionId:row.resume_version_id||"", status: row.status, appliedAt: row.applied_at || "", nextAction: row.next_action, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at })
    });
    this.database = database;
  }

  create(item, metadata = {}, { allowHistorical = false } = {}) {
    const normalized = { ...item, status: normalizeApplicationStatus(item.status) };
    if (!allowHistorical && !["DISCOVERED", "MATCHED", "PLANNED"].includes(normalized.status)) {
      throw new ApplicationStateError(`Uma candidatura nova nao pode iniciar em ${normalized.status}.`, "INVALID_APPLICATION_INITIAL_STATUS");
    }
    return this.database.transaction(() => {
      this.upsert(normalized);
      this.appendEvent(normalized.id, null, normalized.status, { reason: "created", ...metadata }, normalized.createdAt);
      return this.findById(normalized.id);
    });
  }

  updateDetails(item) {
    const current = this.findById(item.id);
    if (!current) throw new Error("Candidatura nao encontrada.");
    if (normalizeApplicationStatus(item.status) !== current.status) {
      throw new Error("Use transitionApplication para alterar o status.");
    }
    return this.upsert({ ...current, ...item, status: current.status });
  }

  transitionApplication(applicationId, targetStatus, metadata = {}) {
    return this.database.transaction(() => {
      const current = this.findById(applicationId);
      if (!current) throw new Error("Candidatura nao encontrada.");
      const { from, to } = assertApplicationTransition(current.status, targetStatus);
      if (from === to) return current;
      const now = new Date().toISOString();
      this.connection.prepare("UPDATE applications SET status = ?, applied_at = CASE WHEN ?='SUBMITTED' THEN COALESCE(applied_at,?) ELSE applied_at END, updated_at = ? WHERE id = ?").run(to,to,now,now,applicationId);
      this.appendEvent(applicationId, from, to, metadata, now);
      return this.findById(applicationId);
    });
  }

  appendEvent(applicationId, fromStatus, toStatus, metadata = {}, createdAt = new Date().toISOString(), eventType = "STATUS_TRANSITION") {
    this.connection.prepare(`INSERT INTO application_events(id, application_id, from_status, to_status, metadata_json, created_at, event_type) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(`event-${randomUUID()}`, applicationId, fromStatus, toStatus, JSON.stringify(metadata || {}), createdAt, eventType);
  }

  recordEvent(applicationId, eventType, metadata = {}) {
    const current = this.findById(applicationId);
    if (!current) throw new Error("Candidatura nao encontrada.");
    this.appendEvent(applicationId, current.status, current.status, metadata, new Date().toISOString(), eventType);
  }

  events(applicationId) {
    return this.connection.prepare("SELECT * FROM application_events WHERE application_id = ? ORDER BY created_at, rowid").all(applicationId).map((row) => ({ id: row.id, applicationId: row.application_id, eventType: row.event_type || "STATUS_TRANSITION", fromStatus: row.from_status, toStatus: row.to_status, metadata: parseJson(row.metadata_json, {}), createdAt: row.created_at }));
  }

  insertLegacyIfMissing(item) {
    const normalized = { ...item, status: normalizeApplicationStatus(item.status) };
    const current = this.findById(item.id);
    if (!current) {
      this.create(normalized, { reason: "legacy-import" }, { allowHistorical: true });
      return "inserted";
    }
    if (Date.parse(normalized.updatedAt || 0) <= Date.parse(current.updatedAt || 0)) return "unchanged";
    this.database.transaction(() => {
      this.upsert(normalized);
      if (current.status !== normalized.status) {
        this.appendEvent(item.id, current.status, normalized.status, { reason: "legacy-reconciliation" }, normalized.updatedAt);
      }
    });
    return "updated";
  }

  sync(items) {
    const ids = items.map((item) => item.id);
    for (const item of items) {
      const current = this.findById(item.id);
      if (!current) this.create(item, { reason: "state-sync" }, { allowHistorical: true });
      else this.upsert({ ...item, status: current.status });
    }
    if (!ids.length) this.connection.prepare("DELETE FROM applications").run();
    else this.connection.prepare(`DELETE FROM applications WHERE id NOT IN (${ids.map(() => "?").join(", ")})`).run(...ids);
  }
}

export class ApplicationAttemptRepository extends BaseRepository {
  constructor(connection) {
    super(connection, {
      table: "application_attempts",
      columns: ["id", "application_id", "attempt_number", "started_at", "finished_at", "status", "error_code", "error_message", "adapter_type", "adapter_version", "mode", "evidence_path", "created_at"],
      toRow: (item) => ({ id: item.id, application_id: item.applicationId, attempt_number: item.attemptNumber, started_at: item.startedAt, finished_at: item.finishedAt || null, status: item.status, error_code: item.errorCode || null, error_message: item.errorMessage || null, adapter_type:item.adapterType||null, adapter_version:item.adapterVersion||null, mode:item.mode||null, evidence_path:item.evidencePath||null, created_at: item.createdAt }),
      fromRow: (row) => ({ id: row.id, applicationId: row.application_id, attemptNumber: row.attempt_number, startedAt: row.started_at, finishedAt: row.finished_at || "", status: row.status, errorCode: row.error_code || "", errorMessage: row.error_message || "", adapterType:row.adapter_type||"", adapterVersion:row.adapter_version||"", mode:row.mode||"", evidencePath:row.evidence_path||"", createdAt: row.created_at })
    });
  }
  nextNumber(applicationId){return this.connection.prepare("SELECT COALESCE(MAX(attempt_number),0)+1 AS value FROM application_attempts WHERE application_id=?").get(applicationId).value;}
  forApplication(applicationId){return this.connection.prepare("SELECT * FROM application_attempts WHERE application_id=? ORDER BY attempt_number DESC").all(applicationId).map(this.fromRow);}
}
