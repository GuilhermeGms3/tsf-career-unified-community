ALTER TABLE ats_analyses ADD COLUMN overall_score REAL;
ALTER TABLE ats_analyses ADD COLUMN eligibility TEXT;
ALTER TABLE ats_analyses ADD COLUMN dimension_scores_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ats_analyses ADD COLUMN blocking_issues_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ats_analyses ADD COLUMN warnings_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ats_analyses ADD COLUMN unknown_requirements_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ats_analyses ADD COLUMN resume_parseability_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ats_analyses ADD COLUMN candidate_evidence_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ats_analyses ADD COLUMN algorithm_version TEXT NOT NULL DEFAULT 'ats-matcher-v1';

CREATE TABLE job_requirements (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  original_text TEXT NOT NULL,
  importance TEXT NOT NULL CHECK (importance IN ('required', 'preferred', 'unspecified')),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  weight REAL NOT NULL CHECK (weight >= 0),
  source TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX job_requirements_job_idx ON job_requirements(job_id, required, type);
CREATE INDEX job_requirements_normalized_idx ON job_requirements(normalized_name, type);
CREATE UNIQUE INDEX job_requirements_job_type_name_unique ON job_requirements(job_id, type, normalized_name);

CREATE TABLE ats_analysis_items (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES ats_analyses(id) ON DELETE CASCADE,
  requirement_id TEXT REFERENCES job_requirements(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('MATCH', 'PARTIAL_MATCH', 'NO_MATCH', 'UNKNOWN')),
  score REAL CHECK (score IS NULL OR (score >= 0 AND score <= 1)),
  requirement_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  explanation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX ats_analysis_items_analysis_idx ON ats_analysis_items(analysis_id, status);
CREATE INDEX ats_analysis_items_requirement_idx ON ats_analysis_items(requirement_id);

CREATE TRIGGER ats_analyses_v2_validate_insert
BEFORE INSERT ON ats_analyses
WHEN (NEW.overall_score IS NOT NULL AND (NEW.overall_score < 0 OR NEW.overall_score > 100))
  OR (NEW.eligibility IS NOT NULL AND NEW.eligibility NOT IN ('ELIGIBLE', 'ELIGIBLE_WITH_WARNINGS', 'REVIEW_REQUIRED', 'NOT_ELIGIBLE'))
BEGIN
  SELECT RAISE(ABORT, 'invalid ATS V2 analysis');
END;

CREATE TRIGGER ats_analyses_v2_validate_update
BEFORE UPDATE OF overall_score, eligibility ON ats_analyses
WHEN (NEW.overall_score IS NOT NULL AND (NEW.overall_score < 0 OR NEW.overall_score > 100))
  OR (NEW.eligibility IS NOT NULL AND NEW.eligibility NOT IN ('ELIGIBLE', 'ELIGIBLE_WITH_WARNINGS', 'REVIEW_REQUIRED', 'NOT_ELIGIBLE'))
BEGIN
  SELECT RAISE(ABORT, 'invalid ATS V2 analysis');
END;
