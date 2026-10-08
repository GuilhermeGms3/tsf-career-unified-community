CREATE TABLE application_drafts (
 id TEXT PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES jobs(id),
 provider TEXT NOT NULL,
 application_url TEXT NOT NULL,
 canonical_identity TEXT NOT NULL,
 resume_version_id TEXT REFERENCES resume_versions(id),
 adapter_version TEXT NOT NULL,
 identity_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('DRY_RUN','FILL_ONLY')),
 payload_json TEXT NOT NULL DEFAULT '{}',
 application_id TEXT REFERENCES applications(id),
 locked_by TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX application_drafts_queue ON application_drafts(status,locked_by,created_at);
CREATE TABLE application_batch_runs (
 id TEXT PRIMARY KEY, identity_key TEXT NOT NULL UNIQUE,
 policy_mode TEXT NOT NULL DEFAULT 'OFF', created_at TEXT NOT NULL
);
CREATE TABLE application_batch_items (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES application_batch_runs(id),
 draft_id TEXT NOT NULL REFERENCES application_drafts(id),
 UNIQUE(batch_id,draft_id)
);
CREATE TABLE application_answer_library (
 question_identity TEXT PRIMARY KEY,
 semantic TEXT NOT NULL,
 value_json TEXT NOT NULL,
 scope_json TEXT NOT NULL,
 provenance TEXT NOT NULL CHECK(provenance='USER_CONFIRMED'),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
