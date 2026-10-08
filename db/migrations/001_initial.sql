CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  work_model TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  salary_min REAL,
  salary_max REAL,
  salary_currency TEXT NOT NULL DEFAULT '',
  salary_interval TEXT NOT NULL DEFAULT '',
  date_posted TEXT,
  job_type TEXT NOT NULL DEFAULT '',
  seniority TEXT NOT NULL DEFAULT '',
  fit_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'salva',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX jobs_external_id_unique ON jobs(external_id) WHERE external_id IS NOT NULL AND external_id <> '';
CREATE INDEX jobs_status_idx ON jobs(status);
CREATE INDEX jobs_company_title_idx ON jobs(company, title);

CREATE TABLE resumes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  stored_path TEXT NOT NULL DEFAULT '',
  focus TEXT NOT NULL DEFAULT '',
  sections_json TEXT NOT NULL DEFAULT '{}',
  extraction_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  applied_at TEXT,
  next_action TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX applications_job_id_idx ON applications(job_id);
CREATE INDEX applications_status_idx ON applications(status);

CREATE TABLE application_attempts (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(application_id, attempt_number)
);

CREATE INDEX application_attempts_application_id_idx ON application_attempts(application_id);

CREATE TABLE application_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX application_events_application_id_idx ON application_events(application_id, created_at);

CREATE TRIGGER application_events_no_update
BEFORE UPDATE ON application_events
BEGIN
  SELECT RAISE(ABORT, 'application_events are append-only');
END;

CREATE TRIGGER application_events_no_delete
BEFORE DELETE ON application_events
WHEN EXISTS (SELECT 1 FROM applications WHERE id = OLD.application_id)
BEGIN
  SELECT RAISE(ABORT, 'application_events are append-only');
END;

CREATE TABLE ats_analyses (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  matched_json TEXT NOT NULL DEFAULT '[]',
  missing_json TEXT NOT NULL DEFAULT '[]',
  suggestions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ats_analyses_job_resume_idx ON ats_analyses(job_id, resume_id);

CREATE TABLE search_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  next_run_at TEXT,
  last_run_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX search_schedules_due_idx ON search_schedules(enabled, next_run_at);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  schedule_id TEXT REFERENCES search_schedules(id) ON DELETE SET NULL,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX alerts_unread_idx ON alerts(is_read, created_at);
