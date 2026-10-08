CREATE TABLE career_entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('EXPERIENCE','PROJECT','EDUCATION','COURSE','LAB','CERTIFICATION')),
  title TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  end_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0,1)),
  location TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  verification_status TEXT NOT NULL DEFAULT 'USER_CONFIRMED' CHECK(verification_status IN ('SYSTEM_EXTRACTED','USER_CONFIRMED','IMPORTED_CONFIRMED','REVIEW_REQUIRED','REJECTED')),
  lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle_status IN ('ACTIVE','ARCHIVED','REJECTED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE knowledge_evidence (
  id TEXT PRIMARY KEY,
  fact_key TEXT NOT NULL REFERENCES candidate_facts(key) ON UPDATE CASCADE ON DELETE RESTRICT,
  entity_id TEXT REFERENCES career_entities(id) ON DELETE SET NULL,
  context_type TEXT NOT NULL CHECK(context_type IN ('PROFESSIONAL','PERSONAL_PROJECT','ACADEMIC_PROJECT','FREELANCE','VOLUNTEER','LAB','COURSE','CERTIFICATION','SELF_STUDY','OPEN_SOURCE','OTHER','LEGACY','UNKNOWN')),
  usage_description TEXT NOT NULL DEFAULT '',
  activities_json TEXT NOT NULL DEFAULT '[]',
  depth TEXT NOT NULL CHECK(depth IN ('UNKNOWN','AWARENESS','USED','PRACTICED','PRODUCTION','DELIVERED','OWNED','LED')),
  verification_status TEXT NOT NULL CHECK(verification_status IN ('SYSTEM_EXTRACTED','USER_CONFIRMED','IMPORTED_CONFIRMED','REVIEW_REQUIRED','REJECTED')),
  confidence REAL NOT NULL DEFAULT 1 CHECK(confidence >= 0 AND confidence <= 1),
  reuse_policy TEXT NOT NULL CHECK(reuse_policy IN ('REUSABLE','REUSABLE_WITH_CONFIRMATION','APPLICATION_SPECIFIC','SENSITIVE_CONFIRM_EACH_TIME','NEVER_AUTO_REUSE')),
  source_type TEXT NOT NULL DEFAULT 'USER_ENTERED',
  source_id TEXT,
  start_date TEXT,
  end_date TEXT,
  last_used_at TEXT,
  negative INTEGER NOT NULL DEFAULT 0 CHECK(negative IN (0,1)),
  lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(lifecycle_status IN ('ACTIVE','ARCHIVED','REJECTED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE evidence_claims (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES knowledge_evidence(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  claim_type TEXT NOT NULL DEFAULT 'SKILL_USAGE',
  requested_depth TEXT NOT NULL DEFAULT 'UNKNOWN',
  status TEXT NOT NULL CHECK(status IN ('SUPPORTED','PARTIALLY_SUPPORTED','UNSUPPORTED','OVERSTATED','REVIEW_REQUIRED')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE experience_enrichment_proposals (
  id TEXT PRIMARY KEY,
  entity_id TEXT REFERENCES career_entities(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,
  narrative TEXT NOT NULL,
  proposed_items_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK(status IN ('REVIEW_REQUIRED','PARTIALLY_CONFIRMED','CONFIRMED','REJECTED')),
  source_type TEXT NOT NULL DEFAULT 'USER_ENTERED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE evidence_gaps (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  analysis_id TEXT NOT NULL REFERENCES ats_analyses(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL,
  canonical_skill TEXT NOT NULL,
  requirement_label TEXT NOT NULL,
  importance TEXT NOT NULL DEFAULT 'OPTIONAL',
  impact_weight REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PROPOSAL_REVIEW','RESOLVED','SKILL_GAP','DISMISSED')),
  answer_type TEXT,
  answer_description TEXT NOT NULL DEFAULT '',
  resolved_evidence_id TEXT REFERENCES knowledge_evidence(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(analysis_id, requirement_id)
);

CREATE TABLE knowledge_audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  actor TEXT NOT NULL DEFAULT 'USER',
  created_at TEXT NOT NULL
);

CREATE INDEX career_entities_type_status_idx ON career_entities(entity_type,lifecycle_status,updated_at);
CREATE INDEX knowledge_evidence_fact_idx ON knowledge_evidence(fact_key,lifecycle_status,verification_status);
CREATE INDEX knowledge_evidence_entity_idx ON knowledge_evidence(entity_id,context_type,depth);
CREATE INDEX knowledge_evidence_context_idx ON knowledge_evidence(context_type,verification_status,depth);
CREATE INDEX evidence_claims_evidence_idx ON evidence_claims(evidence_id,status);
CREATE INDEX enrichment_proposals_status_idx ON experience_enrichment_proposals(status,updated_at);
CREATE INDEX evidence_gaps_job_status_idx ON evidence_gaps(job_id,status,impact_weight DESC);
CREATE INDEX knowledge_audit_events_entity_idx ON knowledge_audit_events(entity_type,entity_id,created_at);

INSERT OR IGNORE INTO career_entities(
  id,entity_type,title,organization,role,start_date,end_date,is_current,
  location,summary,details_json,verification_status,lifecycle_status,created_at,updated_at
)
SELECT
  'legacy-entity-' || replace(replace(key,'.','-'),'_','-'),
  CASE unit_type WHEN 'WORK_EXPERIENCE' THEN 'EXPERIENCE' WHEN 'PROJECT' THEN 'PROJECT' ELSE 'EDUCATION' END,
  COALESCE(
    NULLIF(json_extract(value_json,'$.role'),''),
    NULLIF(json_extract(value_json,'$.title'),''),
    NULLIF(json_extract(value_json,'$.name'),''),
    NULLIF(json_extract(value_json,'$.course'),''),
    NULLIF(json_extract(value_json,'$.degree'),''),
    NULLIF(json_extract(value_json,'$.company'),''),
    NULLIF(json_extract(value_json,'$.institution'),''),
    'Registro legado'
  ),
  COALESCE(json_extract(value_json,'$.company'),json_extract(value_json,'$.institution'),''),
  COALESCE(json_extract(value_json,'$.role'),json_extract(value_json,'$.title'),''),
  NULLIF(COALESCE(json_extract(value_json,'$.startDate'),''),''),
  NULLIF(COALESCE(json_extract(value_json,'$.endDate'),''),''),
  CASE WHEN lower(COALESCE(json_extract(value_json,'$.endDate'),'')) IN ('atual','current','presente','present') THEN 1 ELSE 0 END,
  '',COALESCE(json_extract(value_json,'$.description'),json_extract(value_json,'$.rawText'),raw_text,''),
  CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END,
  verification_status,
  CASE WHEN lifecycle_status='ACTIVE' THEN 'ACTIVE' ELSE 'ARCHIVED' END,
  COALESCE(created_at,updated_at),updated_at
FROM candidate_facts
WHERE unit_type IN ('WORK_EXPERIENCE','PROJECT','EDUCATION')
  AND lifecycle_status <> 'REJECTED'
  AND json_valid(value_json);

INSERT OR IGNORE INTO knowledge_evidence(
  id,fact_key,context_type,usage_description,activities_json,depth,
  verification_status,confidence,reuse_policy,source_type,source_id,
  last_used_at,negative,lifecycle_status,created_at,updated_at
)
SELECT
  'legacy-evidence-' || replace(replace(key,'.','-'),'_','-'),
  key,'LEGACY','Contexto ainda não informado','[]','UNKNOWN',
  verification_status,confidence,reuse_policy,'LEGACY',source_id,
  last_used_at,0,
  CASE WHEN lifecycle_status='ACTIVE' THEN 'ACTIVE' ELSE 'ARCHIVED' END,
  COALESCE(created_at,updated_at),updated_at
FROM candidate_facts
WHERE unit_type IN ('SKILL','TOOL','TECHNOLOGY','CERTIFICATION','LANGUAGE')
  AND lifecycle_status <> 'REJECTED';
