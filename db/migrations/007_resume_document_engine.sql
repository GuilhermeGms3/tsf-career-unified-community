ALTER TABLE resumes ADD COLUMN resume_kind TEXT NOT NULL DEFAULT 'BASE' CHECK(resume_kind IN ('BASE','DERIVED'));
ALTER TABLE resumes ADD COLUMN language TEXT NOT NULL DEFAULT 'pt-BR';
ALTER TABLE applications ADD COLUMN resume_version_id TEXT REFERENCES resume_versions(id) ON DELETE RESTRICT;
ALTER TABLE application_plans ADD COLUMN selected_resume_version_id TEXT REFERENCES resume_versions(id) ON DELETE RESTRICT;
ALTER TABLE resume_tailoring_runs ADD COLUMN approved_resume_version_id TEXT REFERENCES resume_versions(id) ON DELETE SET NULL;

CREATE TABLE resume_templates (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  supported_languages_json TEXT NOT NULL DEFAULT '[]',
  ats_optimized INTEGER NOT NULL DEFAULT 0 CHECK(ats_optimized IN (0,1)),
  layout_type TEXT NOT NULL,
  max_recommended_pages INTEGER NOT NULL DEFAULT 2 CHECK(max_recommended_pages BETWEEN 1 AND 10),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(id, version)
);

CREATE TABLE resume_versions (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE RESTRICT,
  parent_version_id TEXT REFERENCES resume_versions(id) ON DELETE RESTRICT,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  application_id TEXT REFERENCES applications(id) ON DELETE SET NULL,
  template_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('pt-BR','en')),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','REVIEW_REQUIRED','APPROVED','REJECTED','RENDERING','READY','FAILED','ARCHIVED')),
  content_hash TEXT NOT NULL,
  resume_spec_json TEXT NOT NULL,
  tailoring_run_id TEXT REFERENCES resume_tailoring_runs(id) ON DELETE SET NULL,
  changeset_json TEXT NOT NULL DEFAULT '{}',
  ats_before_json TEXT NOT NULL DEFAULT '{}',
  ats_after_json TEXT NOT NULL DEFAULT '{}',
  parseability_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'USER',
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(template_id,template_version) REFERENCES resume_templates(id,version)
);
CREATE INDEX resume_versions_resume_created_idx ON resume_versions(resume_id,created_at DESC);
CREATE INDEX resume_versions_job_status_idx ON resume_versions(job_id,status,created_at DESC);
CREATE UNIQUE INDEX resume_versions_content_unique ON resume_versions(resume_id,content_hash,template_id,template_version,language);

CREATE TABLE resume_artifacts (
  id TEXT PRIMARY KEY,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id) ON DELETE RESTRICT,
  artifact_type TEXT NOT NULL CHECK(artifact_type IN ('LATEX_SOURCE','PDF','EXTRACTED_TEXT','EXPORT_BUNDLE')),
  storage_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  mime_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('READY','UNAVAILABLE','INVALID','FAILED')),
  validation_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(resume_version_id,artifact_type,content_hash)
);
CREATE INDEX resume_artifacts_version_idx ON resume_artifacts(resume_version_id,artifact_type,created_at DESC);

CREATE TABLE resume_render_runs (
  id TEXT PRIMARY KEY,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id) ON DELETE RESTRICT,
  compiler TEXT NOT NULL,
  compiler_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('RUNNING','COMPLETED','FAILED','UNAVAILABLE')),
  error_code TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
  manifest_json TEXT NOT NULL DEFAULT '{}',
  log_excerpt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX resume_render_runs_version_idx ON resume_render_runs(resume_version_id,created_at DESC);

CREATE TABLE document_exports (
  id TEXT PRIMARY KEY,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id) ON DELETE RESTRICT,
  destination TEXT NOT NULL CHECK(destination IN ('LOCAL','N8N','OVERLEAF','GOOGLE_DRIVE')),
  status TEXT NOT NULL CHECK(status IN ('PENDING','COMPLETED','FAILED','OVERLEAF_EXPORT_READY','NOT_CONFIGURED')),
  artifact_id TEXT REFERENCES resume_artifacts(id) ON DELETE RESTRICT,
  destination_reference TEXT NOT NULL DEFAULT '',
  error_code TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX document_exports_version_idx ON document_exports(resume_version_id,created_at DESC);

CREATE TABLE document_destination_settings (
  destination TEXT PRIMARY KEY CHECK(destination IN ('LOCAL','N8N','OVERLEAF','GOOGLE_DRIVE')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE resume_document_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK(job_type IN ('BUILD_SPEC','RENDER','EXPORT')),
  status TEXT NOT NULL CHECK(status IN ('QUEUED','RUNNING','REVIEW_REQUIRED','COMPLETED','FAILED','CANCELLED')),
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
CREATE INDEX resume_document_jobs_claim_idx ON resume_document_jobs(status,available_at,created_at);

CREATE TABLE resume_upload_audits (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  resume_version_id TEXT NOT NULL REFERENCES resume_versions(id) ON DELETE RESTRICT,
  artifact_id TEXT NOT NULL REFERENCES resume_artifacts(id) ON DELETE RESTRICT,
  adapter_type TEXT NOT NULL,
  attempt_id TEXT REFERENCES application_attempts(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX resume_upload_audits_application_idx ON resume_upload_audits(application_id,created_at DESC);

CREATE TABLE automation_request_nonces (
  nonce TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX automation_request_nonces_expiry_idx ON automation_request_nonces(expires_at);

INSERT INTO resume_templates(id,version,name,purpose,supported_languages_json,ats_optimized,layout_type,max_recommended_pages,enabled,metadata_json,created_at) VALUES
('ATS_CLEAN','ats-clean-v1','ATS Clean','Candidaturas e leitura linear por parsers','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{}',CURRENT_TIMESTAMP),
('PROFESSIONAL','professional-v1','Professional','Compartilhamento profissional com hierarquia discreta','["pt-BR","en"]',0,'ONE_COLUMN',2,1,'{}',CURRENT_TIMESTAMP),
('COMPACT','compact-v1','Compact','Conteudo denso preservando leitura linear','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{}',CURRENT_TIMESTAMP);

INSERT INTO document_destination_settings(destination,enabled,status,settings_json,updated_at) VALUES
('LOCAL',1,'READY','{}',CURRENT_TIMESTAMP),
('N8N',0,'NOT_CONFIGURED','{}',CURRENT_TIMESTAMP),
('OVERLEAF',0,'EXPORT_ONLY','{}',CURRENT_TIMESTAMP),
('GOOGLE_DRIVE',0,'NOT_IMPLEMENTED','{}',CURRENT_TIMESTAMP);
