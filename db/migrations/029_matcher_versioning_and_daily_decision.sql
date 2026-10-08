ALTER TABLE ats_analyses ADD COLUMN matcher_version TEXT;
ALTER TABLE ats_analyses ADD COLUMN scoring_model_version TEXT;
ALTER TABLE ats_analyses ADD COLUMN requirement_extractor_version TEXT;

ALTER TABLE job_feedback ADD COLUMN user_decision TEXT
  CHECK(user_decision IS NULL OR user_decision IN ('APPLY','SAVE','REJECT','REVIEW'));
ALTER TABLE job_feedback ADD COLUMN rejection_reason TEXT
  CHECK(rejection_reason IS NULL OR rejection_reason IN ('BAD_ROLE','BAD_SENIORITY','BAD_LOCATION','LOW_PAY','BAD_COMPANY','MISSING_REQUIREMENT','NOT_INTERESTED','OTHER'));

CREATE TABLE daily_review_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_triage_at TEXT,
  last_daily_review_at TEXT,
  updated_at TEXT NOT NULL
);
