CREATE TABLE job_feedback (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK(verdict IN ('INTERESTED','NOT_FOR_ME')),
  reasons_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE decision_inbox_dismissals (
  item_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  dismissed_at TEXT NOT NULL
);

ALTER TABLE candidate_facts ADD COLUMN classification TEXT NOT NULL DEFAULT 'FACT'
  CHECK(classification IN ('FACT','PREFERENCE','SENSITIVE'));
ALTER TABLE candidate_facts ADD COLUMN reusable INTEGER NOT NULL DEFAULT 1 CHECK(reusable IN (0,1));
ALTER TABLE candidate_facts ADD COLUMN requires_confirmation INTEGER NOT NULL DEFAULT 0 CHECK(requires_confirmation IN (0,1));
ALTER TABLE candidate_facts ADD COLUMN last_used_at TEXT;
