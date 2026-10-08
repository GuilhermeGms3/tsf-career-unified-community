CREATE INDEX ats_analyses_job_updated_idx
  ON ats_analyses(job_id, updated_at DESC);
