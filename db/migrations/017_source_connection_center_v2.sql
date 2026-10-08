CREATE TABLE source_credentials (
  credential_ref TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL UNIQUE,
  credential_kind TEXT NOT NULL CHECK(credential_kind IN ('API_KEY','TOKEN','OAUTH','ACCOUNT','PARTNER')),
  masked_hint TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('CONNECTED','ERROR','REMOVED')),
  validated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_connection_events (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_source_connection_events_provider_created
  ON source_connection_events(provider_id, created_at DESC);
