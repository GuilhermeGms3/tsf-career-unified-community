ALTER TABLE resumes ADD COLUMN archived_at TEXT;
CREATE INDEX resumes_active_created_idx ON resumes(archived_at, created_at DESC);
