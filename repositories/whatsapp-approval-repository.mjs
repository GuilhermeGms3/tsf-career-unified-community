import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();

export class WhatsappApprovalRepository {
  constructor(connection, database) {
    Object.assign(this, { connection, database });
  }

  prepare(item) {
    const timestamp = now();
    this.connection.prepare(`
      INSERT INTO whatsapp_approval_requests(
        id,command_token,application_id,job_id,resume_version_id,artifact_id,
        target_hash,status,created_at,updated_at,expires_at
      ) VALUES(?,?,?,?,?,?,?,'PREPARED',?,?,?)
    `).run(
      item.id || `whatsapp-approval-${randomUUID()}`,
      item.commandToken,
      item.applicationId,
      item.jobId,
      item.resumeVersionId,
      item.artifactId,
      item.targetHash,
      timestamp,
      timestamp,
      item.expiresAt || new Date(Date.now()+7*24*60*60*1000).toISOString(),
    );
    return this.findByToken(item.commandToken);
  }

  findById(id) {
    return this.map(this.connection.prepare("SELECT * FROM whatsapp_approval_requests WHERE id=?").get(id));
  }

  findByToken(token) {
    return this.map(this.connection.prepare("SELECT * FROM whatsapp_approval_requests WHERE command_token=?").get(String(token || "").toUpperCase()));
  }

  latest() {
    return this.map(this.connection.prepare("SELECT * FROM whatsapp_approval_requests ORDER BY created_at DESC,rowid DESC LIMIT 1").get());
  }

  active(applicationId, resumeVersionId) {
    return this.map(this.connection.prepare("SELECT * FROM whatsapp_approval_requests WHERE application_id=? AND resume_version_id=? AND status IN ('PREPARED','AWAITING_APPROVAL') ORDER BY created_at DESC,rowid DESC LIMIT 1").get(applicationId, resumeVersionId));
  }

  supersedeActive(jobId, resumeVersionId) {
    const rows = this.connection.prepare(`
      SELECT * FROM whatsapp_approval_requests
      WHERE job_id=? AND resume_version_id<>? AND status IN ('PREPARED','AWAITING_APPROVAL')
      ORDER BY created_at DESC,rowid DESC
    `).all(jobId, resumeVersionId);
    if (!rows.length) return [];
    const timestamp = now();
    this.connection.prepare(`
      UPDATE whatsapp_approval_requests
      SET status='DENIED',decided_at=?,updated_at=?
      WHERE job_id=? AND resume_version_id<>? AND status IN ('PREPARED','AWAITING_APPROVAL')
    `).run(timestamp, timestamp, jobId, resumeVersionId);
    return rows.map((row) => this.findById(row.id));
  }

  markSent(id) {
    const timestamp = now();
    this.connection.prepare("UPDATE whatsapp_approval_requests SET status='AWAITING_APPROVAL',sent_at=?,updated_at=? WHERE id=? AND status='PREPARED'").run(timestamp, timestamp, id);
    return this.findById(id);
  }

  decide(id, status) {
    if (!["APPROVED", "DENIED"].includes(status)) throw new Error("Decisão de aprovação inválida.");
    const timestamp = now();
    this.connection.prepare("UPDATE whatsapp_approval_requests SET status=?,decided_at=?,updated_at=? WHERE id=? AND status='AWAITING_APPROVAL'").run(status, timestamp, timestamp, id);
    return this.findById(id);
  }

  hasReceipt(messageHash) {
    return Boolean(this.connection.prepare("SELECT 1 FROM whatsapp_approval_receipts WHERE message_hash=?").get(messageHash));
  }

  recordReceipt({ requestId = null, messageHash, action, outcome }) {
    this.connection.prepare("INSERT INTO whatsapp_approval_receipts(id,request_id,message_hash,action,outcome,created_at) VALUES(?,?,?,?,?,?)")
      .run(`whatsapp-receipt-${randomUUID()}`, requestId, messageHash, action, outcome, now());
  }

  map(row) {
    return row ? {
      id: row.id,
      commandToken: row.command_token,
      applicationId: row.application_id,
      jobId: row.job_id,
      resumeVersionId: row.resume_version_id,
      artifactId: row.artifact_id,
      targetHash: row.target_hash,
      status: row.status,
      sentAt: row.sent_at || "",
      decidedAt: row.decided_at || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at || "",
    } : null;
  }
}
