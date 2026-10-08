CREATE TABLE discovery_source_health_history (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  source_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  surface_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPERATIONAL_REAL','DEGRADED','SUCCESS_EMPTY','BLOCKED','NOT_CONFIGURED','NOT_IMPLEMENTED','MANUAL_ONLY','DISABLED','UNKNOWN')),
  real_query INTEGER NOT NULL DEFAULT 0 CHECK(real_query IN (0,1)),
  query TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  last_success_at TEXT,
  last_real_query_at TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  raw_count INTEGER NOT NULL DEFAULT 0,
  parsed_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  discarded_count INTEGER NOT NULL DEFAULT 0,
  pages_scanned INTEGER NOT NULL DEFAULT 0,
  results_limit INTEGER NOT NULL DEFAULT 0,
  query_count INTEGER NOT NULL DEFAULT 0,
  latest_job_published_at TEXT,
  oldest_job_published_at TEXT,
  last_new_job_at TEXT,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  authentication_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  configuration_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  errors_json TEXT NOT NULL DEFAULT '[]',
  rate_limits_json TEXT NOT NULL DEFAULT '[]',
  sample_urls_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX discovery_source_health_surface_time_idx
  ON discovery_source_health_history(surface_id, finished_at DESC);

CREATE INDEX discovery_source_health_run_idx
  ON discovery_source_health_history(run_id, surface_id);

CREATE TRIGGER discovery_source_health_history_no_update
BEFORE UPDATE ON discovery_source_health_history
BEGIN
  SELECT RAISE(ABORT, 'discovery_source_health_history is append-only');
END;

CREATE TRIGGER discovery_source_health_history_no_delete
BEFORE DELETE ON discovery_source_health_history
BEGIN
  SELECT RAISE(ABORT, 'discovery_source_health_history is append-only');
END;
