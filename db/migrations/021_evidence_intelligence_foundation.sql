ALTER TABLE ats_analysis_items ADD COLUMN resolution_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE ats_analysis_items ADD COLUMN providers_checked_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE knowledge_evidence ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE github_repositories (
  id TEXT PRIMARY KEY,
  provider_repository_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  owner_relation TEXT NOT NULL CHECK(owner_relation IN ('OWNED','CONTRIBUTED','ORGANIZATION','FORK')),
  visibility TEXT NOT NULL CHECK(visibility IN ('PUBLIC','PRIVATE')),
  is_fork INTEGER NOT NULL DEFAULT 0 CHECK(is_fork IN (0,1)),
  default_branch TEXT NOT NULL DEFAULT '',
  head_sha TEXT NOT NULL DEFAULT '',
  etag TEXT NOT NULL DEFAULT '',
  evidence_version TEXT NOT NULL DEFAULT 'github-evidence-v1',
  sync_status TEXT NOT NULL DEFAULT 'NOT_INDEXED' CHECK(sync_status IN ('NOT_INDEXED','SYNCING','INDEXED','DEGRADED','ERROR')),
  last_sync_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE github_repository_evidence (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES github_repositories(id) ON DELETE CASCADE,
  technology TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  detector_id TEXT NOT NULL,
  strength TEXT NOT NULL CHECK(strength IN ('WEAK','MEDIUM','STRONG','VERY_STRONG')),
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  snapshot_sha TEXT NOT NULL,
  contribution_relation TEXT NOT NULL CHECK(contribution_relation IN ('OWNER','CONTRIBUTOR','FORK_WITH_MEANINGFUL_CHANGES','FORK_UNMODIFIED','NO_ATTRIBUTABLE_CONTRIBUTION')),
  attributable INTEGER NOT NULL DEFAULT 0 CHECK(attributable IN (0,1)),
  is_private INTEGER NOT NULL DEFAULT 0 CHECK(is_private IN (0,1)),
  first_observed_at TEXT,
  latest_observed_at TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(repository_id, technology, artifact_path, detector_id)
);

CREATE INDEX github_repositories_sync_idx ON github_repositories(sync_status,last_sync_at);
CREATE INDEX github_evidence_technology_idx ON github_repository_evidence(technology,active,strength);
CREATE INDEX github_evidence_repository_idx ON github_repository_evidence(repository_id,active,artifact_path);
