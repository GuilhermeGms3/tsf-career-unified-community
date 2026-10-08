CREATE TABLE submission_preflight_evaluations (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  adapter_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('READY','REVIEW_REQUIRED','BLOCKED','WAITING_USER')),
  gates_json TEXT NOT NULL DEFAULT '[]',
  blocking_reasons_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  form_snapshot_json TEXT NOT NULL DEFAULT '[]',
  answer_snapshot_hash TEXT NOT NULL DEFAULT '',
  snapshot_hash TEXT NOT NULL,
  ready_for_preview INTEGER NOT NULL CHECK(ready_for_preview IN (0,1)),
  ready_for_consent INTEGER NOT NULL CHECK(ready_for_consent IN (0,1)),
  ready_for_submit INTEGER NOT NULL CHECK(ready_for_submit IN (0,1)),
  version TEXT NOT NULL,
  evaluated_at TEXT NOT NULL
);
CREATE INDEX submission_preflight_application_idx ON submission_preflight_evaluations(application_id,evaluated_at DESC);

CREATE TABLE submission_consents (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  preflight_id TEXT NOT NULL REFERENCES submission_preflight_evaluations(id) ON DELETE RESTRICT,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id) ON DELETE RESTRICT,
  answer_snapshot_hash TEXT NOT NULL,
  preflight_snapshot_hash TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope='CONTROLLED_SUBMIT'),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','CONSUMED','EXPIRED','REVOKED')),
  consented_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX submission_consents_application_idx ON submission_consents(application_id,status,expires_at DESC);

CREATE TABLE submission_attempts (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  consent_id TEXT NOT NULL REFERENCES submission_consents(id) ON DELETE RESTRICT,
  preflight_id TEXT NOT NULL REFERENCES submission_preflight_evaluations(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL UNIQUE,
  adapter_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','SUBMITTING','SUBMITTED','UNCERTAIN','FAILED','BLOCKED')),
  phase TEXT NOT NULL CHECK(phase IN ('PRE_ACTION','ACTION_TRIGGERED','CONFIRMATION')),
  failure_class TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX submission_attempts_active_application_unique ON submission_attempts(application_id)
WHERE status IN ('PENDING','SUBMITTING','UNCERTAIN');

CREATE TABLE submission_locks (
  application_id TEXT PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  submission_attempt_id TEXT NOT NULL REFERENCES submission_attempts(id) ON DELETE CASCADE,
  locked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE submission_receipts (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  submission_attempt_id TEXT NOT NULL UNIQUE REFERENCES submission_attempts(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  external_reference TEXT NOT NULL DEFAULT '',
  confirmation_url TEXT NOT NULL DEFAULT '',
  confirmation_text TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id) ON DELETE RESTRICT,
  answer_snapshot_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX submission_receipts_application_idx ON submission_receipts(application_id,submitted_at DESC);
