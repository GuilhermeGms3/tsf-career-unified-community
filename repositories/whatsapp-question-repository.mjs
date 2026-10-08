import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();

export class WhatsappQuestionRepository {
  constructor(connection) {
    this.connection = connection;
  }

  prepare(item) {
    const timestamp = now();
    this.connection.prepare(`
      INSERT INTO whatsapp_question_requests(
        id,command_token,application_id,question_id,generated_content_id,
        target_hash,status,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,'PREPARED',?,?)
      ON CONFLICT(application_id,question_id) DO UPDATE SET
        command_token=excluded.command_token,
        generated_content_id=COALESCE(excluded.generated_content_id,whatsapp_question_requests.generated_content_id),
        target_hash=excluded.target_hash,
        status='PREPARED',
        sent_at=NULL,
        answered_at=NULL,
        updated_at=excluded.updated_at
    `).run(
      item.id || `whatsapp-question-${randomUUID()}`,
      item.commandToken,
      item.applicationId,
      item.questionId,
      item.generatedContentId || null,
      item.targetHash,
      timestamp,
      timestamp,
    );
    return this.forQuestion(item.applicationId, item.questionId);
  }

  findById(id) {
    return this.map(this.connection.prepare("SELECT * FROM whatsapp_question_requests WHERE id=?").get(id));
  }

  findByToken(token) {
    return this.map(this.connection.prepare("SELECT * FROM whatsapp_question_requests WHERE command_token=?").get(String(token || "").toUpperCase()));
  }

  forQuestion(applicationId, questionId) {
    return this.map(this.connection.prepare("SELECT * FROM whatsapp_question_requests WHERE application_id=? AND question_id=?").get(applicationId, questionId));
  }

  active(applicationId) {
    return this.map(this.connection.prepare("SELECT * FROM whatsapp_question_requests WHERE application_id=? AND status IN ('PREPARED','AWAITING_ANSWER') ORDER BY created_at,rowid LIMIT 1").get(applicationId));
  }

  markSent(id) {
    const timestamp = now();
    this.connection.prepare("UPDATE whatsapp_question_requests SET status='AWAITING_ANSWER',sent_at=?,updated_at=? WHERE id=? AND status='PREPARED'").run(timestamp, timestamp, id);
    return this.findById(id);
  }

  resolve(id, status) {
    if (!['ANSWERED', 'DEFERRED'].includes(status)) throw new Error("Estado de pergunta WhatsApp inválido.");
    const timestamp = now();
    this.connection.prepare("UPDATE whatsapp_question_requests SET status=?,answered_at=?,updated_at=? WHERE id=? AND status='AWAITING_ANSWER'").run(status, timestamp, timestamp, id);
    return this.findById(id);
  }

  hasReceipt(messageHash) {
    return Boolean(this.connection.prepare("SELECT 1 FROM whatsapp_question_receipts WHERE message_hash=?").get(messageHash));
  }

  recordReceipt({ requestId = null, messageHash, action, outcome }) {
    this.connection.prepare("INSERT INTO whatsapp_question_receipts(id,request_id,message_hash,action,outcome,created_at) VALUES(?,?,?,?,?,?)")
      .run(`whatsapp-question-receipt-${randomUUID()}`, requestId, messageHash, action, outcome, now());
  }

  map(row) {
    return row ? {
      id: row.id,
      commandToken: row.command_token,
      applicationId: row.application_id,
      questionId: row.question_id,
      generatedContentId: row.generated_content_id || "",
      targetHash: row.target_hash,
      status: row.status,
      sentAt: row.sent_at || "",
      answeredAt: row.answered_at || "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null;
  }
}
