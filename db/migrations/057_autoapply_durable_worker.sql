ALTER TABLE auto_apply_runs ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(context_json));
ALTER TABLE auto_apply_runs ADD COLUMN locked_by TEXT;
ALTER TABLE auto_apply_runs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE auto_apply_runs ADD COLUMN generation INTEGER NOT NULL DEFAULT 0 CHECK(generation >= 0);
ALTER TABLE auto_apply_runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0);
ALTER TABLE auto_apply_runs ADD COLUMN available_at TEXT NOT NULL DEFAULT '';

CREATE INDEX auto_apply_runs_recovery_idx ON auto_apply_runs(status,available_at,lease_expires_at);
-- Upgrade under the exclusive database owner: legacy RUNNING rows have no
-- lease/context and may contain concurrent requests for the same application.
UPDATE auto_apply_runs SET status='RETRYABLE',error_code='AUTOAPPLY_MIGRATION_RECOVERY_REQUIRED'
WHERE status='RUNNING';
CREATE UNIQUE INDEX auto_apply_runs_active_application_unique ON auto_apply_runs(application_id) WHERE status='RUNNING';
