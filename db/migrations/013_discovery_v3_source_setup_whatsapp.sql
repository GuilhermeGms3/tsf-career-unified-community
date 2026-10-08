-- Discovery Engine V3 is additive. Secrets, QR codes and message payloads are never stored here.
ALTER TABLE job_hunt_profiles ADD COLUMN search_intent_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE job_hunt_profiles ADD COLUMN job_families_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE job_hunt_profiles ADD COLUMN seniorities_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE job_hunt_profiles ADD COLUMN location_policy_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE job_hunt_profiles ADD COLUMN query_budget_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE job_hunt_profiles ADD COLUMN mass_hunt INTEGER NOT NULL DEFAULT 0 CHECK(mass_hunt IN (0,1));

CREATE TABLE search_intents (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL UNIQUE REFERENCES job_hunt_profiles(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  original_intent_json TEXT NOT NULL DEFAULT '{}',
  location_policy_json TEXT NOT NULL DEFAULT '{}',
  seniorities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE expanded_queries (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES search_intents(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('ORIGINAL','TAXONOMY','ALIAS','TRANSLATION','SEMANTIC')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  UNIQUE(intent_id, query, version)
);
CREATE INDEX expanded_queries_intent_idx ON expanded_queries(intent_id, version, created_at);

ALTER TABLE company_watchlists ADD COLUMN domain TEXT NOT NULL DEFAULT '';
ALTER TABLE company_watchlists ADD COLUMN provider_hint TEXT NOT NULL DEFAULT '';
ALTER TABLE company_watchlists ADD COLUMN detection_status TEXT NOT NULL DEFAULT 'PENDING'
  CHECK(detection_status IN ('PENDING','READY','MANUAL_PUBLIC','REVIEW_REQUIRED','INVALID'));
ALTER TABLE company_watchlists ADD COLUMN detection_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE jobs ADD COLUMN application_method TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK(application_method IN ('ATS','EMAIL','EXTERNAL_FORM','CAREER_PAGE','MANUAL','UNKNOWN'));
ALTER TABLE jobs ADD COLUMN application_email TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN application_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN application_subject_hint TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN application_method_evidence_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX jobs_application_method_idx ON jobs(application_method, lifecycle_status, last_seen_at);

CREATE TABLE source_capabilities (
  provider_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SUPPORTED','CONFIG_REQUIRED','CREDENTIAL_REQUIRED','PARTIAL','MANUAL_ONLY','UNSUPPORTED','UNKNOWN')),
  evidence_url TEXT NOT NULL DEFAULT '',
  verified_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(provider_id, capability)
);

CREATE TABLE source_setup_diagnostics (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK(latency_ms >= 0),
  jobs_found INTEGER NOT NULL DEFAULT 0 CHECK(jobs_found >= 0),
  error_code TEXT,
  human_message TEXT NOT NULL DEFAULT '',
  recommended_action TEXT NOT NULL DEFAULT '',
  technical_json TEXT NOT NULL DEFAULT '{}',
  tested_at TEXT NOT NULL
);
CREATE INDEX source_setup_diagnostics_provider_idx ON source_setup_diagnostics(provider_id, tested_at DESC);

CREATE TABLE whatsapp_connection_metadata (
  id TEXT PRIMARY KEY CHECK(id = 'evolution'),
  instance_name TEXT NOT NULL DEFAULT '',
  connection_state TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(connection_state IN ('CONNECTED','CONNECTING','DISCONNECTED','PAIRING_REQUIRED','ERROR','UNKNOWN')),
  masked_number TEXT NOT NULL DEFAULT '',
  last_error_code TEXT,
  last_checked_at TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE job_hunt_runs ADD COLUMN query_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_hunt_runs ADD COLUMN provider_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_hunt_runs ADD COLUMN request_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_hunt_runs ADD COLUMN raw_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_hunt_runs ADD COLUMN canonical_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_hunt_runs ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_hunt_runs ADD COLUMN closed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_hunt_runs ADD COLUMN potential_match_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_hunt_runs ADD COLUMN high_match_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_hunt_runs ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
