ALTER TABLE whatsapp_approval_requests ADD COLUMN expires_at TEXT;

CREATE TABLE application_decisions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK(decision IN ('APPROVE','REJECT')),
  mode TEXT NOT NULL CHECK(mode IN ('AUTO_APPLY','REVIEW_ONLY')),
  actor_hash TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('WHATSAPP','MOBILE','PLATFORM')),
  snapshot_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  created_at TEXT NOT NULL,
  UNIQUE(application_id,resume_version_id,revision)
);
CREATE INDEX application_decisions_current_idx ON application_decisions(application_id,resume_version_id,revision DESC);

CREATE TABLE application_decision_commands (
  idempotency_key TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  created_at TEXT NOT NULL
);
