ALTER TABLE application_attempts ADD COLUMN adapter_type TEXT;
ALTER TABLE application_attempts ADD COLUMN adapter_version TEXT;
ALTER TABLE application_attempts ADD COLUMN mode TEXT CHECK (mode IS NULL OR mode IN ('DRY_RUN', 'FILL_ONLY'));
ALTER TABLE application_attempts ADD COLUMN evidence_path TEXT;
ALTER TABLE application_events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'STATUS_TRANSITION';

CREATE TABLE application_plans (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  analysis_id TEXT REFERENCES ats_analyses(id) ON DELETE SET NULL,
  selected_resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  ats_type TEXT NOT NULL DEFAULT 'unknown',
  decision TEXT NOT NULL CHECK (decision IN ('APPLY', 'REVIEW', 'SKIP', 'BLOCKED')),
  match_score REAL NOT NULL CHECK (match_score >= 0 AND match_score <= 100),
  eligibility TEXT NOT NULL,
  requires_review INTEGER NOT NULL CHECK (requires_review = 1),
  blocking_issues_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  unknown_requirements_json TEXT NOT NULL DEFAULT '[]',
  reasons_json TEXT NOT NULL DEFAULT '[]',
  policy_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX application_plans_application_unique ON application_plans(application_id);

CREATE TABLE candidate_facts (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  verified INTEGER NOT NULL CHECK (verified IN (0, 1)),
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE application_questions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  external_key TEXT NOT NULL,
  semantic_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL,
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  options_json TEXT NOT NULL DEFAULT '[]',
  answer_value_json TEXT,
  answer_source TEXT,
  answer_status TEXT NOT NULL CHECK (answer_status IN ('KNOWN', 'DERIVED', 'UNKNOWN', 'USER_REQUIRED')),
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(application_id, external_key)
);
CREATE INDEX application_questions_application_idx ON application_questions(application_id, answer_status);

CREATE TABLE application_queue (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL UNIQUE REFERENCES applications(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('DRY_RUN', 'FILL_ONLY')),
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
  available_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  run_count INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX application_queue_claim_idx ON application_queue(status, available_at, created_at);
