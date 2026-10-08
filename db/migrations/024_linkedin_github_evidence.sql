CREATE TABLE github_evidence_snapshots (
  id TEXT PRIMARY KEY,
  account_reference TEXT NOT NULL,
  provider_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SYNCING','READY','DEGRADED','ERROR')),
  started_at TEXT NOT NULL,
  synced_at TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX github_snapshots_time ON github_evidence_snapshots(started_at DESC);
CREATE TABLE linkedin_content_cache (
  identity_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('ENRICHMENT','CLASSIFICATION')),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
