import { CURRENT_MATCHER_VERSION } from "./analysis-version.mjs";

export const ATS_ALGORITHM_VERSION = CURRENT_MATCHER_VERSION;

export const MATCH_STATUS = Object.freeze({
  MATCH: "MATCH",
  PARTIAL_MATCH: "PARTIAL_MATCH",
  NO_MATCH: "NO_MATCH",
  UNKNOWN: "UNKNOWN"
});

export const EVIDENCE_STRENGTH = Object.freeze({
  MENTION: { name: "MENTION", score: 0.4 },
  CONTEXTUAL: { name: "CONTEXTUAL", score: 0.65 },
  PROFESSIONAL_EXPERIENCE: { name: "PROFESSIONAL_EXPERIENCE", score: 0.95 },
  CERTIFIED: { name: "CERTIFIED", score: 1 },
  EDUCATION: { name: "EDUCATION", score: 0.85 }
});

export const SCORING_WEIGHTS = Object.freeze({
  skills: 20,
  experience: 20,
  seniority: 10,
  educationAndCertifications: 10,
  languages: 5,
  location: 5
});

export const ELIGIBILITY_RULES = Object.freeze({
  hardRequirementsAreScoringDimension: false,
  hardRequirementsAuthority: "eligibility-engine",
});

export const DIMENSION_DEFINITIONS = Object.freeze({
  hardRequirements: { label: "Requisitos obrigatorios" },
  skills: { label: "Skills" },
  experience: { label: "Experiencia" },
  seniority: { label: "Senioridade" },
  education: { label: "Formacao" },
  certifications: { label: "Certificacoes" },
  languages: { label: "Idiomas" },
  location: { label: "Localizacao e modalidade" },
  resumeAts: { label: "Compatibilidade ATS generica" }
});

export const SKILL_DEFINITIONS = Object.freeze([
  { name: "aws", type: "cloud", aliases: ["aws", "amazon web services", "amazon cloud"] },
  { name: "azure", type: "cloud", aliases: ["azure", "microsoft azure", "ms azure", "azure cloud"] },
  { name: "gcp", type: "cloud", aliases: ["gcp", "google cloud", "google cloud platform"] },
  { name: "docker", type: "tool", aliases: ["docker", "docker containers", "containers docker"] },
  { name: "kubernetes", type: "platform", aliases: ["kubernetes", "k8s"] },
  { name: "terraform", type: "tool", aliases: ["terraform"] },
  { name: "ansible", type: "tool", aliases: ["ansible"] },
  { name: "linux", type: "operating_system", aliases: ["linux", "gnu/linux"] },
  { name: "windows-server", type: "operating_system", aliases: ["windows server"] },
  { name: "active-directory", type: "platform", aliases: ["active directory", "microsoft active directory"], ambiguousAliases: ["ad"] },
  { name: "nodejs", type: "framework", aliases: ["node.js", "nodejs", "node js"] },
  { name: "javascript", type: "skill", aliases: ["javascript", "ecmascript"] },
  { name: "typescript", type: "skill", aliases: ["typescript"] },
  { name: "java", type: "skill", aliases: ["java"] },
  { name: "spring", type: "framework", aliases: ["spring", "spring boot"] },
  { name: "rest-api", type: "skill", aliases: ["rest api", "rest apis", "restful api", "restful apis"] },
  { name: "react", type: "framework", aliases: ["react", "reactjs", "react.js"] },
  { name: "nextjs", type: "framework", aliases: ["next.js", "nextjs", "next js"] },
  { name: "python", type: "skill", aliases: ["python"] },
  { name: "powershell", type: "tool", aliases: ["powershell"] },
  { name: "sql", type: "skill", aliases: ["sql"] },
  { name: "postgresql", type: "platform", aliases: ["postgresql", "postgres"] },
  { name: "mysql", type: "platform", aliases: ["mysql"] },
  { name: "git", type: "tool", aliases: ["git"] },
  { name: "github-actions", type: "tool", aliases: ["github actions"] },
  { name: "ci-cd", type: "methodology", aliases: ["ci/cd", "ci-cd", "continuous integration", "continuous delivery"] },
  { name: "infrastructure-as-code", type: "methodology", aliases: ["infrastructure as code", "infra as code", "iac"] },
  { name: "zabbix", type: "tool", aliases: ["zabbix"] },
  { name: "grafana", type: "tool", aliases: ["grafana"] },
  { name: "prometheus", type: "tool", aliases: ["prometheus"] },
  { name: "splunk", type: "tool", aliases: ["splunk"] },
  { name: "microsoft-sentinel", type: "tool", aliases: ["microsoft sentinel", "azure sentinel"] },
  { name: "elastic-stack", type: "platform", aliases: ["elastic stack", "elk", "elasticsearch"] },
  { name: "wazuh", type: "tool", aliases: ["wazuh"] },
  { name: "service-desk", type: "methodology", aliases: ["service desk", "help desk", "helpdesk"] },
  { name: "networking", type: "skill", aliases: ["networking", "redes", "network infrastructure"] },
  { name: "dns", type: "skill", aliases: ["dns", "domain name system"] },
  { name: "dhcp", type: "skill", aliases: ["dhcp"] },
  { name: "tcp-ip", type: "skill", aliases: ["tcp/ip", "tcp-ip", "tcp ip"] },
  { name: "vpn", type: "skill", aliases: ["vpn", "virtual private network"] },
  { name: "firewall", type: "skill", aliases: ["firewall", "firewalls"] },
  { name: "cisco", type: "platform", aliases: ["cisco", "cisco ios"] },
  { name: "fortinet", type: "platform", aliases: ["fortinet", "fortigate"] },
  { name: "vmware", type: "platform", aliases: ["vmware", "vsphere"] },
  { name: "itil", type: "methodology", aliases: ["itil"] },
  { name: "agile", type: "methodology", aliases: ["agile", "metodologias ageis", "agile methodologies"] },
  { name: "scrum", type: "methodology", aliases: ["scrum"] }
]);

export const CERTIFICATION_DEFINITIONS = Object.freeze([
  { name: "aws-certified", aliases: ["aws certified", "certificacao aws", "certificação aws"] },
  { name: "azure-certified", aliases: ["azure certified", "certificacao azure", "certificação azure", "az-900", "az-104"] },
  { name: "ccna", aliases: ["ccna", "cisco certified network associate"] },
  { name: "itil-certified", aliases: ["itil foundation", "certificacao itil", "certificação itil"] },
  { name: "comptia-security-plus", aliases: ["security+", "comptia security+"] }
]);

export const LANGUAGE_DEFINITIONS = Object.freeze([
  { name: "english", aliases: ["ingles", "inglês", "english"] },
  { name: "portuguese", aliases: ["portugues", "português", "portuguese"] },
  { name: "spanish", aliases: ["espanhol", "spanish"] },
  { name: "german", aliases: ["alemao", "alemão", "german", "deutsch"] }
]);
