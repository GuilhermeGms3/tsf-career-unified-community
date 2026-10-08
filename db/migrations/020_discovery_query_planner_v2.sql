CREATE TABLE discovery_query_planner_state (
  profile_id TEXT PRIMARY KEY REFERENCES job_hunt_profiles(id) ON DELETE CASCADE,
  intent_version INTEGER NOT NULL CHECK(intent_version > 0),
  round INTEGER NOT NULL DEFAULT 0 CHECK(round >= 0),
  family_cursor INTEGER NOT NULL DEFAULT 0 CHECK(family_cursor >= 0),
  family_offsets_json TEXT NOT NULL DEFAULT '{}',
  family_selection_counts_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
