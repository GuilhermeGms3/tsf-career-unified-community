CREATE TABLE whatsapp_approval_requests (
  id TEXT PRIMARY KEY,
  command_token TEXT NOT NULL UNIQUE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id) ON DELETE RESTRICT,
  artifact_id TEXT NOT NULL REFERENCES resume_artifacts(id) ON DELETE RESTRICT,
  target_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PREPARED','AWAITING_APPROVAL','APPROVED','DENIED')),
  sent_at TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX whatsapp_approval_requests_status_created_idx
  ON whatsapp_approval_requests(status, created_at DESC);

CREATE TABLE whatsapp_approval_receipts (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES whatsapp_approval_requests(id) ON DELETE SET NULL,
  message_hash TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL CHECK(action IN ('APROVAR','NEGAR','ANALISAR','REJEITADO')),
  outcome TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX whatsapp_approval_receipts_request_created_idx
  ON whatsapp_approval_receipts(request_id, created_at DESC);

CREATE TRIGGER whatsapp_approval_receipts_no_update
BEFORE UPDATE ON whatsapp_approval_receipts
BEGIN
  SELECT RAISE(ABORT, 'whatsapp_approval_receipts are append-only');
END;
