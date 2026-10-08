ALTER TABLE discovery_query_planner_state ADD COLUMN combination_cursor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_query_planner_state ADD COLUMN combination_selection_counts_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE structured_log_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('DEBUG','INFO','WARN','ERROR')),
  category TEXT NOT NULL,
  event TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  run_id TEXT,
  profile_id TEXT,
  provider TEXT,
  source TEXT,
  query TEXT,
  job_id TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  reason_code TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_structured_logs_timestamp ON structured_log_events(timestamp DESC);
CREATE INDEX idx_structured_logs_category ON structured_log_events(category,timestamp DESC);
CREATE INDEX idx_structured_logs_run ON structured_log_events(run_id,timestamp);
CREATE INDEX idx_structured_logs_provider ON structured_log_events(provider,timestamp DESC);
