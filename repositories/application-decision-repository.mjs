import { randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

export class ApplicationDecisionRepository {
  constructor(connection) { this.connection = connection; }
  findById(id) { return this.map(this.connection.prepare("SELECT * FROM application_decisions WHERE id=?").get(id)); }
  latest(applicationId, versionId) { return this.map(this.connection.prepare("SELECT * FROM application_decisions WHERE application_id=? AND resume_version_id=? ORDER BY revision DESC LIMIT 1").get(applicationId, versionId)); }
  create(input) {
    const id = `decision-${randomUUID()}`, revision = (this.latest(input.applicationId, input.resumeVersionId)?.revision || 0) + 1;
    this.connection.prepare("INSERT INTO application_decisions(id,application_id,resume_version_id,decision,mode,actor_hash,channel,snapshot_hash,revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, input.applicationId, input.resumeVersionId, input.decision, input.mode, input.actorHash, input.channel, input.snapshotHash, revision, new Date().toISOString());
    return this.findById(id);
  }
  command(key) {
    const row = this.connection.prepare("SELECT * FROM application_decision_commands WHERE idempotency_key=?").get(key);
    return row ? { applicationId: row.application_id, actorHash: row.actor_hash, kind: row.kind, payloadHash: row.payload_hash, result: parseJson(row.result_json, {}) } : null;
  }
  recordCommand(input, result) {
    this.connection.prepare("INSERT INTO application_decision_commands(idempotency_key,application_id,actor_hash,kind,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(input.idempotencyKey, input.applicationId, input.actorHash, input.kind, input.payloadHash, JSON.stringify(result), new Date().toISOString());
  }
  map(row) { return row ? { id: row.id, applicationId: row.application_id, resumeVersionId: row.resume_version_id, decision: row.decision, mode: row.mode, actorHash: row.actor_hash, channel: row.channel, snapshotHash: row.snapshot_hash, revision: row.revision, createdAt: row.created_at } : null; }
}
