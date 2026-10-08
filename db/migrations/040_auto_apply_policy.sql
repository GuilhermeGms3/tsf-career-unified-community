CREATE TABLE auto_apply_policy (
  id TEXT PRIMARY KEY CHECK(id = 'default'),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  minimum_ats_score INTEGER NOT NULL DEFAULT 95 CHECK(minimum_ats_score BETWEEN 0 AND 100),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO auto_apply_policy(id, enabled, minimum_ats_score, created_at, updated_at)
VALUES('default', 0, 95, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
