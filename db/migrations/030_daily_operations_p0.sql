CREATE TABLE daily_inbox_snapshots (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  snapshot_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE daily_refresh_runs (
  id TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES job_hunt_profiles(id) ON DELETE SET NULL,
  search_run_id TEXT REFERENCES job_hunt_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','PARTIAL','FAILED')),
  stage TEXT NOT NULL CHECK(stage IN ('SEARCHING','VERIFYING','REBUILDING','COMPLETED','FAILED')),
  verification_total INTEGER NOT NULL DEFAULT 0,
  verification_checked INTEGER NOT NULL DEFAULT 0,
  available_count INTEGER NOT NULL DEFAULT 0,
  closed_count INTEGER NOT NULL DEFAULT 0,
  inconclusive_count INTEGER NOT NULL DEFAULT 0,
  remaining_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX daily_refresh_runs_started_idx
  ON daily_refresh_runs(started_at DESC);
