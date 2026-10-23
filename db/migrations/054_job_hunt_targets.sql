ALTER TABLE job_hunt_profiles ADD COLUMN provider_targets_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE job_alerts ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK(delivery_attempts >= 0);
ALTER TABLE job_alerts ADD COLUMN next_delivery_at TEXT;
CREATE INDEX job_alerts_delivery_idx ON job_alerts(status,next_delivery_at,created_at);
