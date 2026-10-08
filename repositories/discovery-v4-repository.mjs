import { createHash, randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";
const now = () => new Date().toISOString(),
  hash = (value) => createHash("sha256").update(String(value)).digest("hex"),
  filterKeys = [
    "jobFamilies",
    "seniorities",
    "locationHints",
    "includeTerms",
    "excludeTerms",
  ],
  normalizeFilters = (filters = {}) =>
    Object.fromEntries(
      filterKeys.map((key) => [
        key,
        [...new Set((Array.isArray(filters[key]) ? filters[key] : [])
          .map((item) => String(item || "").trim().slice(0, 80))
          .filter(Boolean))].slice(0, 30),
      ]),
    );
const fold = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const titleSimilarity = (left, right) => {
  const a = new Set(
      fold(left)
        .split(" ")
        .filter((x) => x.length > 2),
    ),
    b = new Set(
      fold(right)
        .split(" ")
        .filter((x) => x.length > 2),
    );
  if (!a.size || !b.size) return 0;
  const common = [...a].filter((x) => b.has(x)).length;
  return common / Math.max(a.size, b.size);
};
const mapSource = (row) =>
  row && {
    id: row.id,
    kind: row.kind,
    provider: "EVOLUTION_WHATSAPP",
    externalId: row.external_key,
    groupJid: row.external_key,
    displayName: row.display_name,
    enabled: Boolean(row.enabled),
    filters: parseJson(row.filters_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
const mapLead = (row) =>
  row && {
    id: row.id,
    sourceClass: row.source_class,
    sourceRef: row.source_ref,
    title: row.title,
    company: row.company,
    location: row.location,
    workModel: row.work_model,
    applicationMethod: row.application_method,
    applicationContact: row.application_contact,
    sourceUrl: row.source_url,
    excerpt: row.excerpt,
    contentHash: row.content_hash,
    trustTier: row.trust_tier,
    riskState: row.risk_state,
    reviewStatus: row.review_status,
    facts: parseJson(row.facts_json, {}),
    provenance: parseJson(row.provenance_json, {}),
    jobId: row.job_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
export class DiscoveryV4Repository {
  constructor(connection, database) {
    this.connection = connection;
    this.database = database;
  }
  listCommunitySources() {
    return this.connection
      .prepare(
        "SELECT * FROM community_sources ORDER BY enabled DESC,display_name",
      )
      .all()
      .map(mapSource)
      .map((source) => {
        const lastEvent = this.connection
            .prepare(
              "SELECT MAX(created_at) AS occurred_at FROM community_webhook_receipts WHERE group_key_hash=?",
            )
            .get(hash(source.groupJid)),
          lastLead = this.connection
            .prepare(
              "SELECT MAX(created_at) AS occurred_at FROM opportunity_leads WHERE json_extract(provenance_json,'$.communitySourceId')=?",
            )
            .get(source.id),
          lastSignal = this.connection
            .prepare(
              "SELECT MAX(hiring_signals.observed_at) AS occurred_at FROM hiring_signals JOIN opportunity_leads ON opportunity_leads.id=hiring_signals.lead_id WHERE json_extract(opportunity_leads.provenance_json,'$.communitySourceId')=?",
            )
            .get(source.id);
        return {
          ...source,
          lastEventReceivedAt: lastEvent?.occurred_at || "",
          lastSignalAt: lastSignal?.occurred_at || "",
          lastOpportunityGeneratedAt: lastLead?.occurred_at || "",
        };
      });
  }
  saveCommunitySources(items = []) {
    if (!Array.isArray(items) || items.length > 500)
      throw Object.assign(new Error("Seleção de grupos inválida."), {
        code: "COMMUNITY_GROUP_SELECTION_INVALID",
      });
    return this.database.transaction(() =>
      items.map((item) => this.saveCommunitySource(item)),
    );
  }
  saveCommunitySource(item = {}) {
    const key = String(item.groupJid || "").trim();
    if (!/^\d+@g\.us$/.test(key))
      throw Object.assign(new Error("JID de grupo inválido."), {
        code: "COMMUNITY_GROUP_INVALID",
      });
    const current = this.connection
        .prepare("SELECT * FROM community_sources WHERE external_key=?")
        .get(key),
      timestamp = now(),
      id = current?.id || `community-${randomUUID()}`;
    this.connection
      .prepare(
        `INSERT INTO community_sources(id,kind,external_key,display_name,enabled,filters_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(external_key) DO UPDATE SET display_name=excluded.display_name,enabled=excluded.enabled,filters_json=excluded.filters_json,updated_at=excluded.updated_at`,
      )
      .run(
        id,
        "WHATSAPP_GROUP",
        key,
        String(
          item.displayName || current?.display_name || "Grupo sem nome",
        ).slice(0, 160),
        item.enabled === true ? 1 : 0,
        JSON.stringify(normalizeFilters(item.filters)),
        current?.created_at || timestamp,
        timestamp,
      );
    return mapSource(
      this.connection
        .prepare("SELECT * FROM community_sources WHERE external_key=?")
        .get(key),
    );
  }
  enabledGroup(groupJid) {
    return mapSource(
      this.connection
        .prepare(
          "SELECT * FROM community_sources WHERE external_key=? AND enabled=1",
        )
        .get(groupJid),
    );
  }
  hasReceipt(instance, messageId) {
    return Boolean(
      this.connection
        .prepare(
          "SELECT 1 FROM community_webhook_receipts WHERE instance_name=? AND message_id_hash=?",
        )
        .get(instance, hash(messageId)),
    );
  }
  receipt(instance, messageId, groupJid, outcome) {
    const messageHash = hash(messageId),
      existing = this.connection
        .prepare(
          "SELECT id FROM community_webhook_receipts WHERE instance_name=? AND message_id_hash=?",
        )
        .get(instance, messageHash);
    if (existing) return { duplicate: true };
    this.connection
      .prepare(
        "INSERT INTO community_webhook_receipts(id,instance_name,message_id_hash,group_key_hash,outcome,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        `receipt-${randomUUID()}`,
        instance,
        messageHash,
        hash(groupJid),
        outcome,
        now(),
      );
    return { duplicate: false };
  }
  createLead(item = {}) {
    const contentHash =
        item.contentHash ||
        hash(
          `${item.sourceClass}|${item.sourceRef}|${item.title}|${item.company}|${item.excerpt}`,
        ),
      existing = this.connection
        .prepare("SELECT * FROM opportunity_leads WHERE content_hash=?")
        .get(contentHash);
    if (existing) return { ...mapLead(existing), duplicate: true };
    const timestamp = now(),
      id = `lead-${randomUUID()}`;
    this.connection
      .prepare(
        `INSERT INTO opportunity_leads(id,source_class,source_ref,title,company,location,work_model,application_method,application_contact,source_url,excerpt,content_hash,trust_tier,risk_state,review_status,facts_json,provenance_json,job_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        item.sourceClass || "MANUAL_LEAD_CAPTURE",
        String(item.sourceRef || "").slice(0, 240),
        String(item.title || "").slice(0, 240),
        String(item.company || "").slice(0, 200),
        String(item.location || "").slice(0, 200),
        String(item.workModel || "").slice(0, 40),
        item.applicationMethod || "UNKNOWN",
        String(item.applicationContact || "").slice(0, 240),
        String(item.sourceUrl || "").slice(0, 1000),
        String(item.excerpt || "").slice(0, 500),
        contentHash,
        item.trustTier || "D",
        item.riskState || "UNVERIFIED",
        item.reviewStatus || "NEEDS_REVIEW",
        JSON.stringify(item.facts || {}),
        JSON.stringify(item.provenance || {}),
        item.jobId || null,
        timestamp,
        timestamp,
      );
    return mapLead(
      this.connection
        .prepare("SELECT * FROM opportunity_leads WHERE id=?")
        .get(id),
    );
  }
  listLeads(status = "") {
    const rows = status
      ? this.connection
          .prepare(
            "SELECT * FROM opportunity_leads WHERE review_status=? ORDER BY created_at DESC",
          )
          .all(status)
      : this.connection
          .prepare("SELECT * FROM opportunity_leads ORDER BY created_at DESC")
          .all();
    return rows.map(mapLead);
  }
  updateLead(id, patch = {}) {
    const current = mapLead(
      this.connection
        .prepare("SELECT * FROM opportunity_leads WHERE id=?")
        .get(id),
    );
    if (!current) return null;
    const next = { ...current, ...patch };
    this.connection
      .prepare(
        "UPDATE opportunity_leads SET title=?,company=?,location=?,work_model=?,application_method=?,application_contact=?,source_url=?,review_status=?,job_id=?,facts_json=?,provenance_json=?,updated_at=? WHERE id=?",
      )
      .run(
        next.title,
        next.company,
        next.location,
        next.workModel,
        next.applicationMethod,
        next.applicationContact,
        next.sourceUrl,
        next.reviewStatus,
        next.jobId || null,
        JSON.stringify(next.facts || {}),
        JSON.stringify(next.provenance || {}),
        now(),
        id,
      );
    return mapLead(
      this.connection
        .prepare("SELECT * FROM opportunity_leads WHERE id=?")
        .get(id),
    );
  }
  reconcileOfficialJob(job = {}) {
    const matches = [];
    for (const lead of this.listLeads().filter((item) => !item.jobId)) {
      const sameCompany = Boolean(
          fold(lead.company) && fold(lead.company) === fold(job.company),
        ),
        similarity = titleSimilarity(lead.title, job.title),
        sameLocation =
          !lead.location ||
          !job.location ||
          fold(lead.location) === fold(job.location),
        sameTarget = Boolean(
          lead.sourceUrl &&
            [job.applicationUrl, job.canonicalUrl, job.url].some(
              (url) =>
                String(url || "").replace(/\/$/, "") ===
                lead.sourceUrl.replace(/\/$/, ""),
            ),
        ),
        descriptionSimilarity = titleSimilarity(lead.excerpt, job.description),
        confidence = sameTarget
          ? 1
          : sameCompany && similarity >= 0.5 && sameLocation
            ? 0.9
            : sameCompany && similarity >= 0.45 && descriptionSimilarity >= 0.35
              ? 0.78
              : 0,
        strategy = sameTarget
          ? "APPLICATION_TARGET"
          : confidence >= 0.85
            ? "COMPANY_TITLE_LOCATION"
            : "POSSIBLE_DUPLICATE";
      if (confidence >= 0.85) {
        const updated = this.updateLead(lead.id, {
          reviewStatus: "PROMOTED",
          jobId: job.id,
          facts: {
            ...lead.facts,
            reconciliation: {
              confidence,
              strategy,
              officialProvider: job.provider,
            },
          },
          provenance: {
            ...lead.provenance,
            reconciledAt: now(),
            officialJobId: job.id,
          },
        });
        matches.push({ ...updated, reconciliationConfidence: confidence });
      } else if (confidence >= 0.6)
        this.updateLead(lead.id, {
          facts: {
            ...lead.facts,
            possibleDuplicate: { confidence, strategy, officialJobId: job.id },
          },
          reviewStatus: "NEEDS_REVIEW",
        });
    }
    return matches;
  }
  createSignal(item = {}) {
    const id = `signal-${randomUUID()}`,
      timestamp = now();
    this.connection
      .prepare(
        "INSERT INTO hiring_signals(id,lead_id,signal_type,source_class,company,summary,confidence,observed_at,provenance_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        item.leadId || null,
        item.signalType || "HIRING_INTENT",
        item.sourceClass || "MANUAL_LEAD_CAPTURE",
        String(item.company || "").slice(0, 200),
        String(item.summary || "").slice(0, 500),
        Math.max(0, Math.min(1, Number(item.confidence) || 0)),
        item.observedAt || timestamp,
        JSON.stringify(item.provenance || {}),
        timestamp,
      );
    return { id, ...item, createdAt: timestamp };
  }
  listSignals() {
    return this.connection
      .prepare("SELECT * FROM hiring_signals ORDER BY observed_at DESC")
      .all()
      .map((row) => ({
        id: row.id,
        leadId: row.lead_id || "",
        signalType: row.signal_type,
        sourceClass: row.source_class,
        company: row.company,
        summary: row.summary,
        confidence: row.confidence,
        observedAt: row.observed_at,
        provenance: parseJson(row.provenance_json, {}),
        createdAt: row.created_at,
      }));
  }
}
