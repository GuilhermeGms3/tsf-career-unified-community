CREATE TABLE whatsapp_question_requests (
  id TEXT PRIMARY KEY,
  command_token TEXT NOT NULL UNIQUE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES application_questions(id) ON DELETE CASCADE,
  generated_content_id TEXT REFERENCES generated_application_answers(id) ON DELETE SET NULL,
  target_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PREPARED','AWAITING_ANSWER','ANSWERED','DEFERRED')),
  sent_at TEXT,
  answered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(application_id, question_id)
);

CREATE INDEX whatsapp_question_requests_status_created_idx
  ON whatsapp_question_requests(status, created_at DESC);

CREATE TABLE whatsapp_question_receipts (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES whatsapp_question_requests(id) ON DELETE SET NULL,
  message_hash TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL CHECK(action IN ('USAR','RESPONDER','PULAR','REJEITADO')),
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX whatsapp_question_receipts_request_created_idx
  ON whatsapp_question_receipts(request_id, created_at DESC);

CREATE TRIGGER whatsapp_question_receipts_no_update
BEFORE UPDATE ON whatsapp_question_receipts
BEGIN
  SELECT RAISE(ABORT, 'whatsapp_question_receipts are append-only');
END;
