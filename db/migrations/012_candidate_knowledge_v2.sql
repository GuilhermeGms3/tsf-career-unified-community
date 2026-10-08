ALTER TABLE candidate_facts ADD COLUMN unit_type TEXT NOT NULL DEFAULT 'APPLICATION_FACT';
ALTER TABLE candidate_facts ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'SYSTEM_EXTRACTED';
ALTER TABLE candidate_facts ADD COLUMN reuse_policy TEXT NOT NULL DEFAULT 'REUSABLE';
ALTER TABLE candidate_facts ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE candidate_facts ADD COLUMN raw_text TEXT NOT NULL DEFAULT '';
ALTER TABLE candidate_facts ADD COLUMN source_type TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE candidate_facts ADD COLUMN source_id TEXT;
ALTER TABLE candidate_facts ADD COLUMN source_version_id TEXT;
ALTER TABLE candidate_facts ADD COLUMN legacy_key TEXT;
ALTER TABLE candidate_facts ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE candidate_facts ADD COLUMN created_at TEXT;
ALTER TABLE candidate_facts ADD COLUMN confirmed_at TEXT;

UPDATE candidate_facts
SET verification_status = CASE
      WHEN verified = 1 AND source = 'USER_CONFIRMED' THEN 'USER_CONFIRMED'
      WHEN verified = 1 THEN 'IMPORTED_CONFIRMED'
      ELSE 'SYSTEM_EXTRACTED'
    END,
    reuse_policy = CASE
      WHEN sensitive = 1 THEN 'SENSITIVE_CONFIRM_EACH_TIME'
      WHEN requires_confirmation = 1 THEN 'REUSABLE_WITH_CONFIRMATION'
      WHEN reusable = 1 THEN 'REUSABLE'
      ELSE 'NEVER_AUTO_REUSE'
    END,
    source_type = CASE
      WHEN source = 'USER_CONFIRMED' THEN 'CANDIDATE_PROFILE'
      WHEN source LIKE '%resume%' THEN 'RESUME_IMPORT'
      ELSE 'LEGACY'
    END,
    created_at = COALESCE(created_at, updated_at),
    confirmed_at = CASE WHEN verified = 1 THEN COALESCE(confirmed_at, updated_at) ELSE confirmed_at END;

CREATE TABLE candidate_fact_history (
  id TEXT PRIMARY KEY,
  fact_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('CREATED','UPDATED','REJECTED','ARCHIVED','RESTORED','USED')),
  snapshot_json TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'SYSTEM',
  created_at TEXT NOT NULL
);
CREATE INDEX candidate_fact_history_key_idx ON candidate_fact_history(fact_key, created_at);

CREATE TABLE candidate_fact_conflicts (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  existing_fact_key TEXT NOT NULL,
  incoming_value_json TEXT NOT NULL,
  incoming_source_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK(status IN ('REVIEW_REQUIRED','RESOLVED','DISMISSED')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX candidate_fact_conflicts_open_unique
ON candidate_fact_conflicts(canonical_key, incoming_value_json)
WHERE status = 'REVIEW_REQUIRED';

CREATE TABLE candidate_fact_usage (
  id TEXT PRIMARY KEY,
  fact_key TEXT NOT NULL,
  consumer TEXT NOT NULL CHECK(consumer IN ('APPLICATION','ANSWER_REUSE','RESUME_TAILORING','MATCHER','EVIDENCE')),
  context_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(fact_key, consumer, context_id)
);
CREATE INDEX candidate_fact_usage_key_idx ON candidate_fact_usage(fact_key, created_at);

CREATE INDEX candidate_facts_v2_section_idx
ON candidate_facts(lifecycle_status, unit_type, updated_at);
