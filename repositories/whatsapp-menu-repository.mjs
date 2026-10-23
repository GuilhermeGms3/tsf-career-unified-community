const filters = {
  pending: "decision='AWAITING_APPROVAL' AND status='PLANNED'",
  results: "status IN ('SUBMITTED','SUBMISSION_UNCERTAIN','CANCELLED') OR manualSent=1",
  automatic: "receiptId IS NOT NULL AND automatic=1",
  attention: "status IN ('WAITING_USER','BLOCKED','FAILED','RETRYABLE','READY_TO_SUBMIT','SUBMISSION_UNCERTAIN') OR (status NOT IN ('CANCELLED','SUBMITTED') AND (questionToken IS NOT NULL OR runStatus IN ('FAILED','WAITING_USER','BLOCKED')))",
  running: "status IN ('APPROVED','QUEUED','OPENING_PAGE','FILLING','VALIDATING','SUBMITTING') AND COALESCE(runStatus,'') NOT IN ('FAILED','WAITING_USER','BLOCKED')",
  history: "1=1",
};

export class WhatsappMenuRepository {
  constructor(connection) { this.connection = connection; }
  claim(messageHash) {
    this.connection.prepare("DELETE FROM whatsapp_menu_receipts WHERE created_at<?").run(new Date(Date.now()-7*86400000).toISOString());
    return this.connection.prepare("INSERT INTO whatsapp_menu_receipts(message_hash,created_at) VALUES(?,?) ON CONFLICT DO NOTHING").run(messageHash,new Date().toISOString()).changes>0;
  }
  release(messageHash) { this.connection.prepare("DELETE FROM whatsapp_menu_receipts WHERE message_hash=?").run(messageHash); }
  list({category, targetHash, offset = 0}) {
    if (!Object.hasOwn(filters, category)) throw new Error("Categoria de menu invalida.");
    const start = Math.max(0, Math.min(10000, Math.floor(Number(offset) || 0)));
    const cte = `WITH entries AS (
      SELECT a.id AS applicationId,a.job_id AS jobId,a.status,a.next_action AS nextAction,a.updated_at AS updatedAt,
        j.title,j.company,r.command_token AS token,r.status AS decision,
        (SELECT id FROM submission_receipts s WHERE s.application_id=a.id ORDER BY s.rowid DESC LIMIT 1) AS receiptId,
        EXISTS(SELECT 1 FROM application_events e WHERE e.application_id=a.id AND e.event_type='AUTOAPPLY_ATS_THRESHOLD_MATCHED') AS automatic,
        EXISTS(SELECT 1 FROM application_events e WHERE e.application_id=a.id AND e.event_type='WHATSAPP_MANUAL_SUBMISSION_REPORTED') AS manualSent,
        (SELECT json_extract(ar.result_json,'$.status') FROM auto_apply_runs ar WHERE ar.application_id=a.id ORDER BY ar.updated_at DESC,ar.rowid DESC LIMIT 1) AS runStatus,
        (SELECT q.command_token FROM whatsapp_question_requests q WHERE q.application_id=a.id AND q.target_hash=? AND q.status='AWAITING_ANSWER' ORDER BY q.rowid LIMIT 1) AS questionToken
      FROM applications a JOIN jobs j ON j.id=a.job_id
      LEFT JOIN whatsapp_approval_requests r ON r.rowid=(SELECT MAX(r2.rowid) FROM whatsapp_approval_requests r2 WHERE r2.application_id=a.id)
      WHERE r.id IS NULL OR r.target_hash=?
    )`;
    const params = [targetHash, targetHash];
    const total = this.connection.prepare(`${cte} SELECT COUNT(*) AS total FROM entries WHERE ${filters[category]}`).get(...params).total;
    const items = this.connection.prepare(`${cte} SELECT * FROM entries WHERE ${filters[category]} ORDER BY updatedAt DESC,applicationId LIMIT 5 OFFSET ?`).all(...params, start);
    return {items, total, offset: start};
  }
}
