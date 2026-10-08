ALTER TABLE application_drafts ADD COLUMN canonical_identity_key TEXT;
ALTER TABLE application_drafts ADD COLUMN attempt_no INTEGER NOT NULL DEFAULT 1 CHECK(attempt_no >= 1);
ALTER TABLE application_drafts ADD COLUMN state_revision INTEGER NOT NULL DEFAULT 0 CHECK(state_revision >= 0);
UPDATE application_drafts SET canonical_identity_key=identity_key;
CREATE UNIQUE INDEX application_drafts_attempt ON application_drafts(canonical_identity_key,attempt_no);
CREATE UNIQUE INDEX application_drafts_active_operation ON application_drafts(canonical_identity_key) WHERE status <> 'CANCELLED';
CREATE INDEX application_drafts_submission_identity ON application_drafts(provider,canonical_identity,status);
