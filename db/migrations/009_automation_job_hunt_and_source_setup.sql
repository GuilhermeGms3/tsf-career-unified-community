CREATE TABLE job_hunt_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  queries_json TEXT NOT NULL DEFAULT '[]',
  locations_json TEXT NOT NULL DEFAULT '[]',
  remote_policy TEXT NOT NULL DEFAULT 'ANY' CHECK(remote_policy IN ('ANY','REMOTE_ONLY','ONSITE_OR_HYBRID')),
  providers_json TEXT NOT NULL DEFAULT '[]',
  company_watchlist_ids_json TEXT NOT NULL DEFAULT '[]',
  minimum_match_score INTEGER NOT NULL DEFAULT 70 CHECK(minimum_match_score BETWEEN 0 AND 100),
  allowed_eligibility_json TEXT NOT NULL DEFAULT '["ELIGIBLE","ELIGIBLE_WITH_WARNINGS"]',
  prepare_resume INTEGER NOT NULL DEFAULT 0 CHECK(prepare_resume IN (0,1)),
  notification_policy_json TEXT NOT NULL DEFAULT '{}',
  schedule_json TEXT NOT NULL DEFAULT '{}',
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX job_hunt_profiles_due_idx ON job_hunt_profiles(enabled,next_run_at);

CREATE TABLE job_hunt_runs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES job_hunt_profiles(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('MANUAL','SCHEDULED')),
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','PARTIAL','FAILED','SKIPPED')),
  discovery_run_ids_json TEXT NOT NULL DEFAULT '[]',
  discovered_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  alert_count INTEGER NOT NULL DEFAULT 0,
  digest_count INTEGER NOT NULL DEFAULT 0,
  resume_preparation_count INTEGER NOT NULL DEFAULT 0,
  report_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX job_hunt_runs_profile_idx ON job_hunt_runs(profile_id,started_at DESC);

CREATE TABLE job_alerts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES job_hunt_profiles(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES job_hunt_runs(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'WHATSAPP',
  notification_fingerprint TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('JOB_HIGH_MATCH','JOB_MATCH_DIGEST_READY','INTEGRATION_TEST')),
  status TEXT NOT NULL CHECK(status IN ('PENDING','QUEUED','SENT','RETRYABLE','FAILED','SUPPRESSED','QUIET_HOURS')),
  first_notified_at TEXT,
  last_notified_at TEXT,
  notification_count INTEGER NOT NULL DEFAULT 0 CHECK(notification_count >= 0),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(notification_fingerprint,channel)
);
CREATE INDEX job_alerts_run_status_idx ON job_alerts(run_id,status,created_at);

CREATE TABLE provider_configurations (
  provider_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  identity_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE provider_health_history (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  setup_status TEXT NOT NULL,
  health_status TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK(latency_ms >= 0),
  result_count INTEGER NOT NULL DEFAULT 0 CHECK(result_count >= 0),
  error_code TEXT,
  message TEXT NOT NULL DEFAULT '',
  checked_at TEXT NOT NULL
);
CREATE INDEX provider_health_provider_idx ON provider_health_history(provider_id,checked_at DESC);

CREATE TABLE automation_runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT '',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX automation_runs_type_created_idx ON automation_runs(run_type,created_at DESC);

CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  alert_id TEXT REFERENCES job_alerts(id) ON DELETE SET NULL,
  outbox_id TEXT REFERENCES integration_outbox(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  external_reference TEXT NOT NULL DEFAULT '',
  error_code TEXT,
  attempted_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX notification_deliveries_alert_idx ON notification_deliveries(alert_id,attempted_at DESC);
