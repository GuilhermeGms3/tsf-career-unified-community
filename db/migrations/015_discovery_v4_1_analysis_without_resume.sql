-- MIGRATION_FOREIGN_KEYS_OFF
-- Rebuild aditivo: preserva análises V1/V2 e torna o vínculo documental opcional.
DROP TRIGGER IF EXISTS ats_analyses_v2_validate_insert;
DROP TRIGGER IF EXISTS ats_analyses_v2_validate_update;
DROP INDEX IF EXISTS ats_analyses_job_resume_idx;

CREATE TABLE ats_analyses_v4_1 (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  resume_id TEXT REFERENCES resumes(id) ON DELETE CASCADE,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  matched_json TEXT NOT NULL DEFAULT '[]',
  missing_json TEXT NOT NULL DEFAULT '[]',
  suggestions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  overall_score REAL,
  eligibility TEXT,
  dimension_scores_json TEXT NOT NULL DEFAULT '{}',
  blocking_issues_json TEXT NOT NULL DEFAULT '[]',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  unknown_requirements_json TEXT NOT NULL DEFAULT '[]',
  resume_parseability_json TEXT NOT NULL DEFAULT '{}',
  candidate_evidence_json TEXT NOT NULL DEFAULT '[]',
  algorithm_version TEXT NOT NULL DEFAULT 'ats-matcher-v1',
  semantic_enhancement_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO ats_analyses_v4_1 SELECT id,job_id,resume_id,score,matched_json,missing_json,suggestions_json,created_at,updated_at,overall_score,eligibility,dimension_scores_json,blocking_issues_json,warnings_json,unknown_requirements_json,resume_parseability_json,candidate_evidence_json,algorithm_version,semantic_enhancement_json FROM ats_analyses;
DROP TABLE ats_analyses;
ALTER TABLE ats_analyses_v4_1 RENAME TO ats_analyses;

CREATE INDEX ats_analyses_job_resume_idx ON ats_analyses(job_id, resume_id);
CREATE TRIGGER ats_analyses_v2_validate_insert BEFORE INSERT ON ats_analyses
WHEN (NEW.overall_score IS NOT NULL AND (NEW.overall_score < 0 OR NEW.overall_score > 100)) OR (NEW.eligibility IS NOT NULL AND NEW.eligibility NOT IN ('ELIGIBLE','ELIGIBLE_WITH_WARNINGS','REVIEW_REQUIRED','NOT_ELIGIBLE'))
BEGIN SELECT RAISE(ABORT, 'invalid ATS V2 analysis'); END;
CREATE TRIGGER ats_analyses_v2_validate_update BEFORE UPDATE OF overall_score,eligibility ON ats_analyses
WHEN (NEW.overall_score IS NOT NULL AND (NEW.overall_score < 0 OR NEW.overall_score > 100)) OR (NEW.eligibility IS NOT NULL AND NEW.eligibility NOT IN ('ELIGIBLE','ELIGIBLE_WITH_WARNINGS','REVIEW_REQUIRED','NOT_ELIGIBLE'))
BEGIN SELECT RAISE(ABORT, 'invalid ATS V2 analysis'); END;
