ALTER TABLE application_questions ADD COLUMN fingerprint TEXT;
ALTER TABLE application_questions ADD COLUMN normalized_question TEXT NOT NULL DEFAULT '';
ALTER TABLE application_questions ADD COLUMN question_class TEXT NOT NULL DEFAULT 'CUSTOM_UNKNOWN';
ALTER TABLE application_questions ADD COLUMN answer_category TEXT NOT NULL DEFAULT 'APPLICATION_SPECIFIC';
ALTER TABLE application_questions ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE application_questions ADD COLUMN multiple INTEGER NOT NULL DEFAULT 0 CHECK (multiple IN (0, 1));
ALTER TABLE application_questions ADD COLUMN confidence REAL NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1);
ALTER TABLE application_questions ADD COLUMN signals_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE application_questions ADD COLUMN consent_type TEXT;
ALTER TABLE application_questions ADD COLUMN reusable INTEGER NOT NULL DEFAULT 0 CHECK (reusable IN (0, 1));
ALTER TABLE application_questions ADD COLUMN reason_required TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX application_questions_fingerprint_unique
ON application_questions(application_id, fingerprint)
WHERE fingerprint IS NOT NULL AND fingerprint <> '';

ALTER TABLE application_plans ADD COLUMN greenhouse_identity_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE application_plans ADD COLUMN preflight_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE application_plans ADD COLUMN profile_completeness_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE candidate_answers (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  semantic_key TEXT NOT NULL,
  normalized_question TEXT NOT NULL,
  answer_value_json TEXT NOT NULL,
  answer_type TEXT NOT NULL,
  answer_category TEXT NOT NULL CHECK (answer_category IN ('FACT', 'PREFERENCE', 'APPLICATION_SPECIFIC', 'FREE_TEXT_CONTEXTUAL', 'CONSENT')),
  source TEXT NOT NULL CHECK (source IN ('USER_CONFIRMED', 'PROFILE_FACT', 'DERIVED_SAFE', 'UNKNOWN')),
  verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
  reusable INTEGER NOT NULL CHECK (reusable IN (0, 1)),
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
  scope_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX candidate_answers_semantic_idx ON candidate_answers(semantic_key, verified, reusable);

CREATE TABLE greenhouse_job_metadata (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  board_token TEXT NOT NULL DEFAULT '',
  job_post_id TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL DEFAULT '',
  aggregator_url TEXT NOT NULL DEFAULT '',
  board_name TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'dom',
  fetched_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX greenhouse_job_identity_unique ON greenhouse_job_metadata(board_token, job_post_id)
WHERE board_token <> '' AND job_post_id <> '';
CREATE INDEX greenhouse_job_canonical_idx ON greenhouse_job_metadata(canonical_url);

CREATE TABLE application_inspections (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  attempt_id TEXT REFERENCES application_attempts(id) ON DELETE SET NULL,
  adapter_type TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  detected_variant TEXT NOT NULL,
  compatibility_confidence REAL NOT NULL CHECK (compatibility_confidence >= 0 AND compatibility_confidence <= 1),
  health TEXT NOT NULL CHECK (health IN ('HEALTHY', 'DEGRADED', 'UNSUPPORTED')),
  dom_signature TEXT NOT NULL,
  fields_found INTEGER NOT NULL DEFAULT 0,
  required_fields INTEGER NOT NULL DEFAULT 0,
  known_fields INTEGER NOT NULL DEFAULT 0,
  unknown_fields INTEGER NOT NULL DEFAULT 0,
  validation_failures_json TEXT NOT NULL DEFAULT '[]',
  unsupported_signals_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  report_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX application_inspections_application_idx ON application_inspections(application_id, created_at);
CREATE INDEX application_inspections_signature_idx ON application_inspections(adapter_type, dom_signature);
