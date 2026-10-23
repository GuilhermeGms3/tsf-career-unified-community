-- Homologacao local de envio: cada instalacao registra a propria evidencia de que um
-- portal/cenario/versao de adapter entregou uma candidatura real com recibo confirmado.
CREATE TABLE submit_homologations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  form_engine_version TEXT NOT NULL,
  scenario TEXT NOT NULL CHECK(length(scenario) > 0),
  status TEXT NOT NULL CHECK(status IN ('APPROVED','REVOKED')),
  result TEXT NOT NULL CHECK(result IN ('EXTERNALLY_CONFIRMED')),
  external_confirmation TEXT NOT NULL CHECK(external_confirmation IN ('PORTAL_APPLICATION_LIST','CONFIRMATION_EMAIL','RECRUITER_CONTACT')),
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  submission_receipt_id TEXT NOT NULL UNIQUE,
  receipt_hash TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX submit_homologations_provider_idx ON submit_homologations(provider,status,valid_until DESC);
