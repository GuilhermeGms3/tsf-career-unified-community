CREATE TABLE intelligence_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  provider TEXT NOT NULL DEFAULT 'ollama',
  endpoint TEXT NOT NULL DEFAULT 'http://localhost:11434',
  fast_model TEXT NOT NULL DEFAULT '',
  balanced_model TEXT NOT NULL DEFAULT '',
  quality_model TEXT NOT NULL DEFAULT '',
  hardware_profile TEXT NOT NULL DEFAULT 'AUTO' CHECK (hardware_profile IN ('AUTO', 'LOW_VRAM', 'BALANCED', 'HIGH_MEMORY')),
  context_budget INTEGER NOT NULL DEFAULT 4096 CHECK (context_budget BETWEEN 512 AND 32768),
  policies_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE ats_analyses ADD COLUMN semantic_enhancement_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE intelligence_runs (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'FAILED', 'FALLBACK')),
  latency_ms INTEGER NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  cached INTEGER NOT NULL DEFAULT 0 CHECK (cached IN (0, 1)),
  fallback INTEGER NOT NULL DEFAULT 0 CHECK (fallback IN (0, 1)),
  error_code TEXT,
  context_hash TEXT NOT NULL DEFAULT '',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX intelligence_runs_task_created_idx ON intelligence_runs(task, created_at);
CREATE INDEX intelligence_runs_status_created_idx ON intelligence_runs(status, created_at);

CREATE TABLE intelligence_cache (
  cache_key TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0)
);
CREATE INDEX intelligence_cache_task_idx ON intelligence_cache(task, prompt_version, schema_version);

CREATE TABLE intelligence_benchmarks (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  hardware_profile TEXT NOT NULL,
  load_latency_ms INTEGER,
  first_response_latency_ms INTEGER,
  total_latency_ms INTEGER NOT NULL CHECK (total_latency_ms >= 0),
  throughput REAL,
  json_validity REAL NOT NULL CHECK (json_validity BETWEEN 0 AND 1),
  schema_validity REAL NOT NULL CHECK (schema_validity BETWEEN 0 AND 1),
  semantic_accuracy REAL NOT NULL CHECK (semantic_accuracy BETWEEN 0 AND 1),
  timeout_rate REAL NOT NULL CHECK (timeout_rate BETWEEN 0 AND 1),
  runtime_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX intelligence_benchmarks_model_idx ON intelligence_benchmarks(provider, model, created_at);

CREATE TABLE intelligence_jobs (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX intelligence_jobs_claim_idx ON intelligence_jobs(status, available_at, created_at);

CREATE TABLE generated_application_answers (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,
  question_id TEXT REFERENCES application_questions(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('ANSWER_DRAFT', 'COVER_LETTER')),
  state TEXT NOT NULL CHECK (state IN ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED')),
  draft TEXT NOT NULL,
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX generated_answers_application_idx ON generated_application_answers(application_id, state, created_at);

CREATE TABLE resume_tailoring_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  analysis_id TEXT REFERENCES ats_analyses(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('DRAFT', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED')),
  original_score REAL,
  tailored_score REAL,
  evidence_status TEXT NOT NULL DEFAULT 'PENDING',
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX resume_tailoring_job_idx ON resume_tailoring_runs(job_id, resume_id, created_at);

CREATE TABLE resume_tailoring_changes (
  id TEXT PRIMARY KEY,
  tailoring_run_id TEXT NOT NULL REFERENCES resume_tailoring_runs(id) ON DELETE CASCADE,
  change_type TEXT NOT NULL,
  source_evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  original_text TEXT NOT NULL,
  proposed_text TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  validation_status TEXT NOT NULL CHECK (validation_status IN ('VALID', 'EVIDENCE_VIOLATION', 'REJECTED')),
  created_at TEXT NOT NULL
);
CREATE INDEX resume_tailoring_changes_run_idx ON resume_tailoring_changes(tailoring_run_id);

CREATE TABLE skill_gap_snapshots (
  id TEXT PRIMARY KEY,
  analysis_count INTEGER NOT NULL CHECK (analysis_count >= 0),
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
