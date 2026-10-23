CREATE TABLE whatsapp_process_commands (
  message_hash TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES whatsapp_approval_requests(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('STATUS','CURRICULO','VERIFICAR','MANUAL','JA_ENVIEI','CONTINUAR','CANCELAR')),
  status TEXT NOT NULL CHECK(status IN ('PROCESSING','COMPLETED','FAILED')),
  outcome TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX whatsapp_process_commands_application_idx ON whatsapp_process_commands(application_id,created_at DESC);
