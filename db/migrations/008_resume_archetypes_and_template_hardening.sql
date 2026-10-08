CREATE TABLE resume_archetypes (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  target_domains_json TEXT NOT NULL DEFAULT '[]',
  target_titles_json TEXT NOT NULL DEFAULT '[]',
  priority_skills_json TEXT NOT NULL DEFAULT '[]',
  preferred_sections_json TEXT NOT NULL DEFAULT '[]',
  section_order_json TEXT NOT NULL DEFAULT '[]',
  summary_strategy TEXT NOT NULL,
  project_strategy TEXT NOT NULL,
  skill_grouping_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(id,version)
);

CREATE TABLE resume_archetype_assignments (
  id TEXT PRIMARY KEY,
  archetype_id TEXT NOT NULL,
  archetype_version TEXT NOT NULL,
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('REVIEW_REQUIRED','APPROVED','REJECTED','ARCHIVED')),
  evidence_coverage REAL NOT NULL DEFAULT 0 CHECK(evidence_coverage BETWEEN 0 AND 1),
  evidence_ids_json TEXT NOT NULL DEFAULT '[]',
  reasons_json TEXT NOT NULL DEFAULT '[]',
  content_selection_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  approved_at TEXT,
  FOREIGN KEY(archetype_id,archetype_version) REFERENCES resume_archetypes(id,version),
  UNIQUE(archetype_id,archetype_version,resume_id)
);
CREATE INDEX resume_archetype_assignments_status_idx ON resume_archetype_assignments(archetype_id,status,evidence_coverage DESC);

CREATE TABLE resume_normalization_reviews (
  id TEXT PRIMARY KEY,
  resume_id TEXT REFERENCES resumes(id) ON DELETE CASCADE,
  resume_version_id TEXT REFERENCES resume_versions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('REVIEW_REQUIRED','APPROVED','REJECTED')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  warnings_json TEXT NOT NULL DEFAULT '[]',
  normalized_snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX resume_normalization_reviews_resume_idx ON resume_normalization_reviews(resume_id,status,created_at DESC);

CREATE TABLE template_benchmarks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  template_version TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('pt-BR','en')),
  compiler TEXT NOT NULL,
  compiler_version TEXT NOT NULL,
  parseability_score REAL NOT NULL CHECK(parseability_score BETWEEN 0 AND 100),
  page_count INTEGER NOT NULL CHECK(page_count >= 0),
  missing_facts_json TEXT NOT NULL DEFAULT '[]',
  detected_sections_json TEXT NOT NULL DEFAULT '[]',
  character_checks_json TEXT NOT NULL DEFAULT '{}',
  pdf_hash TEXT NOT NULL,
  measured_at TEXT NOT NULL,
  UNIQUE(template_id,template_version,language,compiler_version,pdf_hash)
);
CREATE INDEX template_benchmarks_template_idx ON template_benchmarks(template_id,template_version,measured_at DESC);

ALTER TABLE resume_versions ADD COLUMN archetype_id TEXT;
ALTER TABLE resume_versions ADD COLUMN archetype_version TEXT;
ALTER TABLE application_plans ADD COLUMN selected_archetype_id TEXT;

INSERT INTO resume_archetypes(id,version,name,target_domains_json,target_titles_json,priority_skills_json,preferred_sections_json,section_order_json,summary_strategy,project_strategy,skill_grouping_json,enabled,created_at) VALUES
('INFRA_NOC','infra-noc-v1','Infra / NOC','["infrastructure","networking","noc","service desk"]','["analista de infraestrutura","analista de redes","noc","service desk","support"]','["Active Directory","TCP/IP","DNS","DHCP","Troubleshooting","Service Desk N2","Monitoring","Linux","Microsoft Azure","PowerShell"]','["summary","experience","skills","projects","education","certifications","languages"]','["summary","experience","skills","projects","education","certifications","languages"]','EXPERIENCE_AND_OPERATIONAL_EVIDENCE','EVIDENCE_RELEVANCE','{"Infrastructure":["Active Directory","Linux","Windows Server","Proxmox"],"Networking":["TCP/IP","DNS","DHCP","Troubleshooting"],"Cloud":["Microsoft Azure","AWS"],"Observability":["Zabbix","Grafana","Prometheus","Monitoring"],"Automation":["PowerShell","Python"]}',1,CURRENT_TIMESTAMP),
('CLOUD_DEVOPS','cloud-devops-v1','Cloud / DevOps','["cloud","devops","platform","infrastructure"]','["devops","cloud engineer","platform engineer","sre","infrastructure engineer"]','["AWS","Microsoft Azure","Linux","Docker","Docker Compose","Proxmox","CI/CD","GitHub Actions","Nginx","Cloudflare Tunnel","Grafana","Prometheus","Zabbix","TrueNAS","Automation"]','["summary","skills","experience","projects","education","certifications","languages"]','["summary","skills","experience","projects","education","certifications","languages"]','TECHNICAL_EVIDENCE','PROJECT_AND_AUTOMATION_EVIDENCE','{"Cloud":["AWS","Microsoft Azure"],"Containers":["Docker","Docker Compose"],"Infrastructure":["Linux","Proxmox","TrueNAS","Nginx","Cloudflare Tunnel"],"Observability":["Zabbix","Grafana","Prometheus"],"Delivery":["CI/CD","GitHub Actions"],"Automation":["Python","PowerShell"]}',1,CURRENT_TIMESTAMP),
('CYBER_SOC','cyber-soc-v1','Cyber / SOC','["cybersecurity","security","soc","blue team"]','["soc analyst","security analyst","cybersecurity analyst","blue team"]','["Information Security","Active Directory","Access Control","Networking","Linux","Monitoring","Incident Handling","Cloud Security","SOC","Observability","Hardening"]','["summary","experience","skills","projects","education","certifications","languages"]','["summary","experience","skills","projects","education","certifications","languages"]','SECURITY_EVIDENCE_WITHOUT_ROLE_PROMOTION','SECURITY_RELEVANCE','{"Security":["Information Security","Access Control","Hardening","Cloud Security"],"Identity":["Active Directory"],"Systems":["Linux"],"Networking":["Networking","TCP/IP","DNS"],"Detection":["Monitoring","Incident Handling","SOC","Observability"]}',1,CURRENT_TIMESTAMP),
('BACKEND_PYTHON','backend-python-v1','Backend Python','["backend","software","automation","web development"]','["backend developer","python developer","software engineer","automation developer"]','["Python","REST APIs","Backend","Automation","Web Scraping","Playwright","BeautifulSoup","Databases","Git"]','["summary","skills","projects","experience","education","certifications","languages"]','["summary","skills","projects","experience","education","certifications","languages"]','PROJECT_AWARE_TECHNICAL_EVIDENCE','SOFTWARE_PROJECTS_FIRST','{"Languages":["Python","JavaScript","Node.js"],"Backend":["REST APIs","Backend","Databases"],"Automation":["Automation","Playwright","BeautifulSoup","Web Scraping"],"Delivery":["Git","GitHub Actions","CI/CD"]}',1,CURRENT_TIMESTAMP),
('GENERAL','general-v1','General','["general"]','[]','[]','["summary","experience","skills","projects","education","certifications","languages"]','["summary","experience","skills","projects","education","certifications","languages"]','CONSERVATIVE_STRONGEST_EVIDENCE','CONSERVATIVE','{}',1,CURRENT_TIMESTAMP);

INSERT INTO resume_templates(id,version,name,purpose,supported_languages_json,ats_optimized,layout_type,max_recommended_pages,enabled,metadata_json,created_at) VALUES
('ATS_STRICT','ats-strict-v1','ATS Strict','Maxima simplicidade e leitura linear por parsers','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{"icons":false,"images":false,"columns":1,"defaultForAts":true}',CURRENT_TIMESTAMP),
('ATS_TECH','ats-tech-v1','ATS Tech','Candidaturas tecnicas com skills comprovadas em destaque','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{"icons":false,"images":false,"columns":1,"technicalSkillsFirst":true}',CURRENT_TIMESTAMP),
('PROFESSIONAL','professional-v2','Professional','Envio direto e networking com hierarquia discreta','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{"icons":false,"images":false,"columns":1}',CURRENT_TIMESTAMP),
('COMPACT','compact-v2','Compact','Conteudo comprovado com spacing reduzido e fonte legivel','["pt-BR","en"]',1,'ONE_COLUMN',1,1,'{"icons":false,"images":false,"columns":1,"minimumFontPt":10}',CURRENT_TIMESTAMP);
