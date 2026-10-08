CREATE TABLE discovery_provider_checkpoints (
  provider_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor >= 0),
  cycle INTEGER NOT NULL DEFAULT 0 CHECK(cycle >= 0),
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(provider_id, scope_key)
);

CREATE TABLE discovery_provider_checkpoint_items (
  provider_id TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  item_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  PRIMARY KEY(provider_id, scope_key, item_key),
  FOREIGN KEY(provider_id, scope_key)
    REFERENCES discovery_provider_checkpoints(provider_id, scope_key)
    ON DELETE CASCADE
);

CREATE INDEX discovery_provider_checkpoint_items_processed_idx
  ON discovery_provider_checkpoint_items(provider_id, scope_key, processed_at DESC);
