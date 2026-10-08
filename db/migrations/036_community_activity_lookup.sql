CREATE INDEX community_receipts_group_created_idx
  ON community_webhook_receipts(group_key_hash, created_at DESC);
