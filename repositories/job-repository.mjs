import { BaseRepository, parseJson } from "./base-repository.mjs";

const columns = ["id", "external_id", "source", "provider", "provider_job_id", "canonical_key", "canonical_url", "application_url", "ats_type", "lifecycle_status", "first_seen_at", "last_seen_at", "last_checked_at", "closed_at", "content_hash", "application_method", "application_email", "application_instructions", "application_subject_hint", "application_method_evidence_json", "discovery_v4_application_method", "source_trust_tier", "risk_state", "title", "company", "location", "work_model", "description", "url", "salary_min", "salary_max", "salary_currency", "salary_interval", "date_posted", "job_type", "seniority", "fit_score", "status", "payload_json", "created_at", "updated_at"];

export class JobRepository extends BaseRepository {
  constructor(connection) {
    super(connection, {
      table: "jobs", columns,
      toRow: (item) => ({
        id: item.id, external_id: item.externalId || null, source: item.source || "manual",
        provider:item.provider||"",provider_job_id:item.providerJobId||"",canonical_key:item.canonicalKey||"",canonical_url:item.canonicalUrl||"",application_url:item.applicationUrl||"",ats_type:item.atsType||"",lifecycle_status:item.lifecycleStatus||"UNKNOWN",first_seen_at:item.firstSeenAt||null,last_seen_at:item.lastSeenAt||null,last_checked_at:item.lastCheckedAt||null,closed_at:item.closedAt||null,content_hash:item.contentHash||"",application_method:item.applicationMethod||"UNKNOWN",application_email:item.applicationEmail||"",application_instructions:item.applicationInstructions||"",application_subject_hint:item.applicationSubjectHint||"",application_method_evidence_json:JSON.stringify(item.applicationMethodEvidence||{}),discovery_v4_application_method:item.discoveryV4ApplicationMethod||item.applicationMethod||"UNKNOWN",source_trust_tier:item.sourceTrustTier||"D",risk_state:item.riskState||"UNVERIFIED", title: item.title || "",
        company: item.company || "", location: item.location || "", work_model: item.workModel || "",
        description: item.description || "", url: item.url || "", salary_min: item.salaryMin ?? null,
        salary_max: item.salaryMax ?? null, salary_currency: item.salaryCurrency || "", salary_interval: item.salaryInterval || "",
        date_posted: item.datePosted || null, job_type: item.jobType || "", seniority: item.seniority || "",
        fit_score: Number(item.fitScore || 0), status: item.status || "salva", payload_json: JSON.stringify(item),
        created_at: item.createdAt, updated_at: item.updatedAt
      }),
      fromRow: (row) => ({
        ...parseJson(row.payload_json, {}), id: row.id, externalId: row.external_id || "", source: row.source,
        provider:row.provider||"",providerJobId:row.provider_job_id||"",canonicalKey:row.canonical_key||"",canonicalUrl:row.canonical_url||"",applicationUrl:row.application_url||"",atsType:row.ats_type||"",lifecycleStatus:row.lifecycle_status||"UNKNOWN",firstSeenAt:row.first_seen_at||"",lastSeenAt:row.last_seen_at||"",lastCheckedAt:row.last_checked_at||"",closedAt:row.closed_at||"",contentHash:row.content_hash||"",applicationMethod:row.discovery_v4_application_method||row.application_method||"UNKNOWN",legacyApplicationMethod:row.application_method||"UNKNOWN",applicationEmail:row.application_email||"",applicationInstructions:row.application_instructions||"",applicationSubjectHint:row.application_subject_hint||"",applicationMethodEvidence:parseJson(row.application_method_evidence_json,{}),sourceTrustTier:row.source_trust_tier||"D",riskState:row.risk_state||"UNVERIFIED",
        title: row.title, company: row.company, location: row.location, workModel: row.work_model,
        description: row.description, url: row.url, salaryMin: row.salary_min ?? 0, salaryMax: row.salary_max ?? 0,
        salaryCurrency: row.salary_currency, salaryInterval: row.salary_interval, datePosted: row.date_posted || "",
        jobType: row.job_type, seniority: row.seniority, fitScore: row.fit_score, status: row.status,
        createdAt: row.created_at, updatedAt: row.updated_at
      })
    });
  }

  findByIdentity({ id = "", externalId = "", url = "", canonicalUrl = "", canonicalKey = "" } = {}) {
    const candidates = [
      ["id", id],
      ["external_id", externalId],
      ["url", url],
      ["canonical_url", canonicalUrl],
      ["canonical_url", url],
      ["url", canonicalUrl],
      ["canonical_key", canonicalKey],
    ];
    for (const [column, value] of candidates) {
      if (!value) continue;
      const row = this.connection
        .prepare(`SELECT * FROM jobs WHERE ${column} = ? LIMIT 1`)
        .get(value);
      if (row) return this.fromRow(row);
    }
    return null;
  }
}
