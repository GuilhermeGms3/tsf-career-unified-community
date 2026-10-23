ALTER TABLE submission_consents ADD COLUMN authorization_source TEXT NOT NULL DEFAULT 'DIRECT_USER_CONFIRMATION';
ALTER TABLE submission_consents ADD COLUMN authorization_reference TEXT NOT NULL DEFAULT '';
ALTER TABLE submission_consents ADD COLUMN authorization_snapshot_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE auto_apply_runs (
  request_id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','RETRYABLE','COMPLETED')),
  result_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX auto_apply_runs_application_idx
  ON auto_apply_runs(application_id,updated_at DESC);
