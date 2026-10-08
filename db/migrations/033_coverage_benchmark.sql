CREATE TABLE coverage_reference_jobs (
  id TEXT PRIMARY KEY,
  original_url TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  perceived_source TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  work_model TEXT NOT NULL DEFAULT '',
  source_page INTEGER CHECK(source_page IS NULL OR source_page > 0),
  provider_position INTEGER CHECK(provider_position IS NULL OR provider_position > 0),
  found_at TEXT NOT NULL,
  interest TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source_text TEXT NOT NULL DEFAULT '',
  imported_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX coverage_reference_canonical_url_unique
  ON coverage_reference_jobs(canonical_url)
  WHERE canonical_url <> '';

CREATE INDEX coverage_reference_source_idx
  ON coverage_reference_jobs(perceived_source, found_at DESC);

CREATE TABLE coverage_benchmark_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED')),
  summary_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE coverage_benchmark_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES coverage_benchmark_runs(id) ON DELETE CASCADE,
  reference_job_id TEXT NOT NULL REFERENCES coverage_reference_jobs(id) ON DELETE CASCADE,
  coverage_status TEXT NOT NULL CHECK(coverage_status IN (
    'FOUND_AUTOMATICALLY','FOUND_BY_OTHER_SOURCE','FOUND_BUT_FILTERED','FOUND_BUT_RANKED_LOW',
    'MISSED_QUERY','MISSED_PLANNER_BUDGET','MISSED_PAGINATION','MISSED_PROVIDER_LIMIT',
    'MISSED_PARSER','MISSED_LOCATION','MISSED_DEDUPLICATION','MISSED_SOURCE',
    'SOURCE_BLOCKED','SOURCE_NOT_CONFIGURED','SOURCE_NOT_IMPLEMENTED','UNKNOWN'
  )),
  matched_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  ranking_position INTEGER,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  timeline_json TEXT NOT NULL DEFAULT '[]',
  diagnostic_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(run_id, reference_job_id)
);

CREATE INDEX coverage_benchmark_items_run_idx
  ON coverage_benchmark_items(run_id, coverage_status);

CREATE TRIGGER coverage_benchmark_items_no_update
BEFORE UPDATE ON coverage_benchmark_items
BEGIN
  SELECT RAISE(ABORT, 'coverage_benchmark_items are append-only');
END;

CREATE TRIGGER coverage_benchmark_items_no_delete
BEFORE DELETE ON coverage_benchmark_items
WHEN EXISTS (SELECT 1 FROM coverage_benchmark_runs WHERE id = OLD.run_id)
BEGIN
  SELECT RAISE(ABORT, 'coverage_benchmark_items are append-only');
END;
