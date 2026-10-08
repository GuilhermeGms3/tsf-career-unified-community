ALTER TABLE job_hunt_profiles ADD COLUMN consider_threshold INTEGER NOT NULL DEFAULT 70
  CHECK(consider_threshold BETWEEN 0 AND 100);
ALTER TABLE job_hunt_profiles ADD COLUMN prepare_resume_threshold INTEGER NOT NULL DEFAULT 82
  CHECK(prepare_resume_threshold BETWEEN 0 AND 100);
ALTER TABLE job_hunt_profiles ADD COLUMN notify_threshold INTEGER NOT NULL DEFAULT 90
  CHECK(notify_threshold BETWEEN 0 AND 100);
ALTER TABLE job_hunt_profiles ADD COLUMN source_preferences_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE job_hunt_profiles ADD COLUMN work_models_json TEXT NOT NULL DEFAULT '[]';

-- Existing profiles keep their exact previous cutoff for all three decisions.
-- The legacy column remains populated for compatibility with older binaries.
UPDATE job_hunt_profiles
SET consider_threshold = minimum_match_score,
    prepare_resume_threshold = minimum_match_score,
    notify_threshold = minimum_match_score,
    source_preferences_json = CASE
      WHEN providers_json LIKE '%"jobspy"%' THEN '["indeed","linkedin","glassdoor","google"]'
      ELSE providers_json
    END,
    work_models_json = CASE remote_policy
      WHEN 'REMOTE_ONLY' THEN '["REMOTE"]'
      WHEN 'ONSITE_OR_HYBRID' THEN '["HYBRID","ONSITE"]'
      ELSE '["REMOTE","HYBRID","ONSITE"]'
    END;
