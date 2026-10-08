CREATE INDEX ats_analyses_projection_idx ON ats_analyses(
  job_id,
  updated_at DESC,
  created_at,
  id,
  resume_id,
  score,
  overall_score,
  eligibility,
  algorithm_version,
  matcher_version,
  scoring_model_version,
  requirement_extractor_version
);
