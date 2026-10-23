CREATE TABLE IF NOT EXISTS mobile_gateway_requests (
  idempotency_key TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  user_login TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PROCESSING', 'COMPLETED')),
  response_status INTEGER,
  response_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mobile_gateway_requests_expiry
  ON mobile_gateway_requests(expires_at);
