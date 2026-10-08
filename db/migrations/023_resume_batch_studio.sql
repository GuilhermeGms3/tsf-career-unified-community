ALTER TABLE resume_versions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'GENERIC' CHECK(purpose IN ('GENERIC','JOB_SPECIFIC'));
ALTER TABLE resume_versions ADD COLUMN batch_run_id TEXT;
ALTER TABLE resume_versions ADD COLUMN batch_item_id TEXT;
ALTER TABLE resume_versions ADD COLUMN algorithm_metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE resume_versions ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';

UPDATE resume_versions SET purpose='JOB_SPECIFIC' WHERE job_id IS NOT NULL AND job_id<>'';

DROP INDEX resume_versions_content_unique;
CREATE UNIQUE INDEX resume_versions_generic_identity_unique
  ON resume_versions(resume_id,content_hash,template_id,template_version,language)
  WHERE purpose='GENERIC';
CREATE UNIQUE INDEX resume_versions_job_identity_unique
  ON resume_versions(resume_id,job_id,content_hash,template_id,template_version,language)
  WHERE purpose='JOB_SPECIFIC';
CREATE INDEX resume_versions_purpose_created_idx ON resume_versions(purpose,created_at DESC);

CREATE TABLE resume_batch_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','ANALYZING','AWAITING_SELECTION','TAILORING','AWAITING_REVIEW','GENERATING','PARTIAL_SUCCESS','COMPLETED','FAILED','CANCELLED')),
  source TEXT NOT NULL DEFAULT 'USER',
  base_resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE RESTRICT,
  comparison_resume_ids_json TEXT NOT NULL DEFAULT '[]',
  requested_outputs_json TEXT NOT NULL DEFAULT '{}',
  comparison_strategy TEXT NOT NULL DEFAULT 'BEST_EVIDENCE',
  tailoring_policy_version TEXT NOT NULL DEFAULT 'resume-tailoring-v1',
  document_template_id TEXT NOT NULL DEFAULT 'ATS_CLEAN',
  document_template_version TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'pt-BR' CHECK(language IN ('pt-BR','en')),
  total_items INTEGER NOT NULL DEFAULT 0 CHECK(total_items>=0),
  completed_items INTEGER NOT NULL DEFAULT 0 CHECK(completed_items>=0),
  failed_items INTEGER NOT NULL DEFAULT 0 CHECK(failed_items>=0),
  review_required_items INTEGER NOT NULL DEFAULT 0 CHECK(review_required_items>=0),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX resume_batch_runs_status_created_idx ON resume_batch_runs(status,created_at DESC);

CREATE TABLE resume_batch_items (
  id TEXT PRIMARY KEY,
  batch_run_id TEXT NOT NULL REFERENCES resume_batch_runs(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  selected_base_resume_id TEXT REFERENCES resumes(id) ON DELETE RESTRICT,
  recommended_resume_id TEXT REFERENCES resumes(id) ON DELETE RESTRICT,
  final_resume_id TEXT REFERENCES resumes(id) ON DELETE RESTRICT,
  analysis_id TEXT REFERENCES ats_analyses(id) ON DELETE SET NULL,
  tailoring_run_id TEXT REFERENCES resume_tailoring_runs(id) ON DELETE SET NULL,
  resume_version_id TEXT REFERENCES resume_versions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('SELECTED','ANALYZING','ANALYZED','BASE_SELECTED','TAILORING','TAILORING_REVIEW_REQUIRED','TAILORING_APPROVED','BUILDING_VERSION','VERSION_REVIEW_REQUIRED','VERSION_APPROVED','RENDERING','READY','FAILED','CANCELLED','BLOCKED')),
  review_state TEXT NOT NULL DEFAULT 'PENDING' CHECK(review_state IN ('PENDING','REVIEW_REQUIRED','APPROVED','REJECTED','NOT_REQUIRED')),
  output_status_json TEXT NOT NULL DEFAULT '{}',
  failure_code TEXT,
  failure_message TEXT,
  locked_at TEXT,
  locked_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(batch_run_id,job_id)
);
CREATE INDEX resume_batch_items_claim_idx ON resume_batch_items(status,locked_at,created_at);
CREATE INDEX resume_batch_items_run_status_idx ON resume_batch_items(batch_run_id,status,created_at);
CREATE INDEX resume_batch_items_job_idx ON resume_batch_items(job_id,created_at DESC);

CREATE TABLE resume_batch_comparisons (
  id TEXT PRIMARY KEY,
  batch_run_id TEXT NOT NULL REFERENCES resume_batch_runs(id) ON DELETE CASCADE,
  batch_item_id TEXT NOT NULL REFERENCES resume_batch_items(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE RESTRICT,
  identity_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  analysis_id TEXT REFERENCES ats_analyses(id) ON DELETE SET NULL,
  score REAL,
  result_json TEXT NOT NULL DEFAULT '{}',
  reused INTEGER NOT NULL DEFAULT 0 CHECK(reused IN (0,1)),
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(batch_run_id,job_id,resume_id)
);
CREATE INDEX resume_batch_comparisons_identity_idx ON resume_batch_comparisons(identity_key,status,created_at DESC);
CREATE INDEX resume_batch_comparisons_item_idx ON resume_batch_comparisons(batch_item_id,status);

CREATE INDEX resume_versions_batch_run_idx ON resume_versions(batch_run_id,created_at DESC);
CREATE INDEX resume_versions_batch_item_idx ON resume_versions(batch_item_id,created_at DESC);

ALTER TABLE structured_log_events ADD COLUMN batch_run_id TEXT;
ALTER TABLE structured_log_events ADD COLUMN batch_item_id TEXT;
ALTER TABLE structured_log_events ADD COLUMN resume_id TEXT;
CREATE INDEX structured_log_events_batch_idx ON structured_log_events(batch_run_id,batch_item_id,timestamp DESC);
