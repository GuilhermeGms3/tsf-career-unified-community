-- Discovery Relevance R2 is additive. Existing expanded queries remain valid.
ALTER TABLE expanded_queries ADD COLUMN query_tier TEXT NOT NULL DEFAULT 'TIER_2'
  CHECK(query_tier IN ('TIER_1','TIER_2','TIER_3'));
