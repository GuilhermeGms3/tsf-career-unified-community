ALTER TABLE structured_log_events ADD COLUMN severity TEXT;
ALTER TABLE structured_log_events ADD COLUMN operation TEXT;
ALTER TABLE structured_log_events ADD COLUMN correlation_id TEXT;
ALTER TABLE structured_log_events ADD COLUMN resume_version_id TEXT;
ALTER TABLE structured_log_events ADD COLUMN application_batch_id TEXT;
ALTER TABLE structured_log_events ADD COLUMN application_item_id TEXT;
ALTER TABLE structured_log_events ADD COLUMN application_id TEXT;
CREATE INDEX idx_logs_correlation ON structured_log_events(correlation_id,timestamp);
CREATE TABLE operational_problems (
 id TEXT PRIMARY KEY, category TEXT NOT NULL, provider TEXT NOT NULL,
 error_code TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL,
 first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, occurrences INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('OPEN','RESOLVED','ACKNOWLEDGED','IGNORED')),
 correlation_id TEXT, resolved_at TEXT
);
CREATE TABLE provider_sessions (
 provider TEXT NOT NULL, tenant TEXT NOT NULL, status TEXT NOT NULL,
 credential_ref TEXT, verified_at TEXT, expires_at TEXT,
 PRIMARY KEY(provider,tenant)
);
CREATE TABLE source_auth_requests (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL, tenant TEXT NOT NULL DEFAULT '',
 intent TEXT NOT NULL, status TEXT NOT NULL, ticket_hash TEXT,
 payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
