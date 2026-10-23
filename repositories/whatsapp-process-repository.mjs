export class WhatsappProcessRepository {
  constructor(connection) { this.connection = connection; }
  recover() { this.connection.prepare("UPDATE whatsapp_process_commands SET status='FAILED',outcome='PROCESS_INTERRUPTED',completed_at=? WHERE status='PROCESSING'").run(new Date().toISOString()); }
  claim({ messageHash, requestId, applicationId, action }) {
    return this.connection.prepare("INSERT INTO whatsapp_process_commands(message_hash,request_id,application_id,action,status,created_at) VALUES(?,?,?,?,'PROCESSING',?) ON CONFLICT(message_hash) DO NOTHING")
      .run(messageHash, requestId, applicationId, action, new Date().toISOString()).changes > 0;
  }
  finish(hash, outcome, failed = false) {
    this.connection.prepare("UPDATE whatsapp_process_commands SET status=?,outcome=?,completed_at=? WHERE message_hash=? AND status='PROCESSING'")
      .run(failed ? "FAILED" : "COMPLETED", outcome, new Date().toISOString(), hash);
  }
  list({ offset = 0, limit = 20, query = "" } = {}) {
    offset = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0;
    limit = Math.min(50, Math.max(1, Math.floor(Number(limit) || 20)));
    const params = [`%${String(query).slice(0, 100)}%`];
    const where = "r.rowid=(SELECT MAX(r2.rowid) FROM whatsapp_approval_requests r2 WHERE r2.job_id=r.job_id) AND (j.title LIKE ? OR j.company LIKE ?)";
    const total = this.connection.prepare(`SELECT COUNT(*) AS total FROM whatsapp_approval_requests r JOIN jobs j ON j.id=r.job_id WHERE ${where}`).get(params[0], params[0]).total;
    const rows = this.connection.prepare(`SELECT r.job_id AS jobId,r.command_token AS token,r.status AS decision,r.application_id AS applicationId,r.resume_version_id AS resumeVersionId,j.title,j.company,a.status,a.next_action AS nextAction,
      MAX(r.updated_at,a.updated_at,COALESCE((SELECT MAX(e.created_at) FROM application_events e WHERE e.application_id=a.id),r.updated_at)) AS updatedAt
      FROM whatsapp_approval_requests r JOIN jobs j ON j.id=r.job_id JOIN applications a ON a.id=r.application_id WHERE ${where}
      ORDER BY updatedAt DESC,r.rowid DESC LIMIT ? OFFSET ?`).all(params[0], params[0], limit, offset);
    return { items: rows, total, offset, limit };
  }
  requests(jobId) { return this.connection.prepare("SELECT id,application_id AS applicationId,command_token AS token,status,resume_version_id AS resumeVersionId,created_at AS createdAt FROM whatsapp_approval_requests WHERE job_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50").all(jobId); }
}
