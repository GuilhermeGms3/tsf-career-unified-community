-- Discovery V4: opt-in community sources, minimized webhook receipts, leads and hiring signals.
CREATE TABLE community_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('WHATSAPP_GROUP')),
  external_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  filters_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE community_webhook_receipts (
  id TEXT PRIMARY KEY,
  instance_name TEXT NOT NULL,
  message_id_hash TEXT NOT NULL,
  group_key_hash TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('IGNORED','LEAD_CREATED','DUPLICATE','REJECTED')),
  created_at TEXT NOT NULL,
  UNIQUE(instance_name, message_id_hash)
);
CREATE INDEX community_receipts_created_idx ON community_webhook_receipts(created_at);

CREATE TABLE opportunity_leads (
  id TEXT PRIMARY KEY,
  source_class TEXT NOT NULL,
  source_ref TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  work_model TEXT NOT NULL DEFAULT '',
  application_method TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK(application_method IN ('ATS','EMAIL','WHATSAPP','DIRECT_MESSAGE','EXTERNAL_FORM','CAREER_PAGE','MANUAL','UNKNOWN')),
  application_contact TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL UNIQUE,
  trust_tier TEXT NOT NULL DEFAULT 'D' CHECK(trust_tier IN ('A','B','C','D','E')),
  risk_state TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK(risk_state IN ('VERIFIED','LIKELY_LEGITIMATE','UNVERIFIED','REVIEW_REQUIRED','RISKY')),
  review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW'
    CHECK(review_status IN ('NEEDS_REVIEW','PROMOTABLE','PROMOTED','DISMISSED')),
  facts_json TEXT NOT NULL DEFAULT '{}',
  provenance_json TEXT NOT NULL DEFAULT '{}',
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX opportunity_leads_review_idx ON opportunity_leads(review_status, created_at DESC);

CREATE TABLE hiring_signals (
  id TEXT PRIMARY KEY,
  lead_id TEXT REFERENCES opportunity_leads(id) ON DELETE SET NULL,
  signal_type TEXT NOT NULL,
  source_class TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  observed_at TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX hiring_signals_company_idx ON hiring_signals(company, observed_at DESC);

ALTER TABLE jobs ADD COLUMN discovery_v4_application_method TEXT NOT NULL DEFAULT 'UNKNOWN'
  CHECK(discovery_v4_application_method IN ('ATS','EMAIL','WHATSAPP','DIRECT_MESSAGE','EXTERNAL_FORM','CAREER_PAGE','MANUAL','UNKNOWN'));
ALTER TABLE jobs ADD COLUMN source_trust_tier TEXT NOT NULL DEFAULT 'D' CHECK(source_trust_tier IN ('A','B','C','D','E'));
ALTER TABLE jobs ADD COLUMN risk_state TEXT NOT NULL DEFAULT 'UNVERIFIED'
  CHECK(risk_state IN ('VERIFIED','LIKELY_LEGITIMATE','UNVERIFIED','REVIEW_REQUIRED','RISKY'));
