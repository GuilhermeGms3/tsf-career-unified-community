ALTER TABLE jobs ADD COLUMN provider TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN provider_job_id TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN canonical_key TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN canonical_url TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN application_url TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN ats_type TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (lifecycle_status IN ('OPEN','CLOSED','STALE','UNKNOWN'));
ALTER TABLE jobs ADD COLUMN first_seen_at TEXT;
ALTER TABLE jobs ADD COLUMN last_seen_at TEXT;
ALTER TABLE jobs ADD COLUMN last_checked_at TEXT;
ALTER TABLE jobs ADD COLUMN closed_at TEXT;
ALTER TABLE jobs ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX jobs_canonical_key_unique ON jobs(canonical_key) WHERE canonical_key <> '';
CREATE INDEX jobs_lifecycle_last_seen_idx ON jobs(lifecycle_status, last_seen_at);

CREATE TABLE job_sources (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, provider_category TEXT NOT NULL, provider_job_id TEXT NOT NULL DEFAULT '',
  discovered_via TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '', canonical_url TEXT NOT NULL DEFAULT '',
  provenance_json TEXT NOT NULL DEFAULT '{}', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
  UNIQUE(job_id, provider, provider_job_id, source_url)
);
CREATE INDEX job_sources_job_idx ON job_sources(job_id, last_seen_at);

CREATE TABLE job_snapshots (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, change_type TEXT NOT NULL CHECK(change_type IN ('DISCOVERED','UPDATED','CLOSED','REPOSTED')),
  created_at TEXT NOT NULL, UNIQUE(job_id, content_hash, change_type)
);

CREATE TABLE discovery_runs (
  id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','PARTIAL','FAILED')),
  query_json TEXT NOT NULL DEFAULT '{}', providers_json TEXT NOT NULL DEFAULT '[]', discovered_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0, closed_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL, completed_at TEXT, report_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE discovery_run_sources (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE, provider TEXT NOT NULL,
  status TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT, report_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);

CREATE TABLE company_watchlists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, career_url TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 50,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE company_ats_boards (
  id TEXT PRIMARY KEY, watchlist_id TEXT REFERENCES company_watchlists(id) ON DELETE SET NULL,
  company TEXT NOT NULL, provider TEXT NOT NULL, organization_key TEXT NOT NULL, career_url TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual', confidence REAL NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  validated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(provider, organization_key)
);

CREATE TABLE provider_settings (
  provider TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  settings_json TEXT NOT NULL DEFAULT '{}', configured_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED', updated_at TEXT NOT NULL
);

CREATE TABLE integration_outbox (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','RETRYABLE','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, locked_at TEXT, last_error_code TEXT,
  created_at TEXT NOT NULL, sent_at TEXT, UNIQUE(event_type, aggregate_type, aggregate_id, created_at)
);
CREATE INDEX integration_outbox_claim_idx ON integration_outbox(status, available_at, created_at);
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY, outbox_id TEXT NOT NULL REFERENCES integration_outbox(id) ON DELETE CASCADE,
  endpoint_origin TEXT NOT NULL, status TEXT NOT NULL, http_status INTEGER, error_code TEXT,
  attempted_at TEXT NOT NULL, duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE integration_settings (
  id TEXT PRIMARY KEY CHECK(id = 'n8n'), enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  webhook_url TEXT NOT NULL DEFAULT '', secret_env_name TEXT NOT NULL DEFAULT 'CAREER_N8N_WEBHOOK_SECRET',
  event_allowlist_json TEXT NOT NULL DEFAULT '[]', timeout_ms INTEGER NOT NULL DEFAULT 5000,
  updated_at TEXT NOT NULL
);
