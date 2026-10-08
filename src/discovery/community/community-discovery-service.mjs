import { createHash, timingSafeEqual } from "node:crypto";
import {
  detectHiringMessage,
  extractLeadFacts,
} from "./hiring-message-detector.mjs";
import { sourceTrust } from "../v4/source-trust.mjs";
import { assessDiscoveryRisk } from "../v4/risk-assessment.mjs";
import { LeadPromotionService } from "../v4/lead-promotion-service.mjs";
const digest = (value) =>
    createHash("sha256").update(String(value)).digest("hex"),
  clean = (value) => String(value || "").trim();
function messageText(data = {}) {
  const message = data.message || data.data?.message || {};
  return clean(
    message.conversation ||
      message.extendedTextMessage?.text ||
      message.imageMessage?.caption ||
      data.body ||
      data.text ||
      "",
  );
}
const fold = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
function matchesSourceFilters(text, facts, filters = {}) {
  const normalized = fold(text),
    include = (filters.includeTerms || []).map(fold).filter(Boolean),
    exclude = (filters.excludeTerms || []).map(fold).filter(Boolean),
    seniorities = (filters.seniorities || []).map((item) =>
      String(item).toUpperCase(),
    ),
    locations = (filters.locationHints || filters.locations || [])
      .map(fold)
      .filter(Boolean),
    families = (filters.jobFamilies || []).map(fold).filter(Boolean);
  if (exclude.some((term) => normalized.includes(term)))
    return { accepted: false, reason: "SOURCE_EXCLUDE_TERM" };
  if (include.length && !include.some((term) => normalized.includes(term)))
    return { accepted: false, reason: "SOURCE_INCLUDE_TERM_MISSING" };
  if (seniorities.length && !seniorities.includes(facts.seniority))
    return { accepted: false, reason: "SOURCE_SENIORITY_MISMATCH" };
  if (
    locations.length &&
    !locations.some(
      (term) =>
        normalized.includes(term) || fold(facts.location).includes(term),
    )
  )
    return { accepted: false, reason: "SOURCE_LOCATION_MISMATCH" };
  if (families.length && !families.some((term) => normalized.includes(term)))
    return { accepted: false, reason: "SOURCE_JOB_FAMILY_MISMATCH" };
  return { accepted: true, reason: "SOURCE_FILTERS_MATCH" };
}
export class CommunityDiscoveryService {
  constructor({
    repository,
    jobRepository,
    instanceName = process.env.EVOLUTION_INSTANCE_NAME || "career-unified",
    webhookSecret = process.env.CAREER_EVOLUTION_WEBHOOK_SECRET || "",
  } = {}) {
    Object.assign(this, {
      repository,
      jobRepository,
      instanceName,
      webhookSecret,
    });
  }
  configured() {
    return Boolean(this.webhookSecret);
  }
  verifySecret(value) {
    const expected = Buffer.from(this.webhookSecret),
      received = Buffer.from(clean(value));
    if (
      !expected.length ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw Object.assign(new Error("Webhook comunitário não autorizado."), {
        code: "COMMUNITY_WEBHOOK_UNAUTHORIZED",
        status: 401,
      });
  }
  normalizeEvent(payload = {}) {
    const event = clean(payload.event)
        .toUpperCase()
        .replaceAll(".", "_")
        .replaceAll("-", "_"),
      data = payload.data || {},
      key = data.key || payload.key || {},
      remoteJid = clean(key.remoteJid || data.remoteJid || payload.remoteJid),
      messageId = clean(key.id || data.id || payload.id),
      instance = clean(
        payload.instance || payload.instanceName || data.instance || "",
      );
    return {
      event,
      instance,
      groupJid: remoteJid,
      messageId,
      fromMe: key.fromMe === true || data.fromMe === true,
      text: messageText(data),
      raw: payload,
    };
  }
  ingest(payload = {}, secret = "") {
    this.verifySecret(secret);
    const event = this.normalizeEvent(payload);
    if (event.instance !== this.instanceName)
      throw Object.assign(new Error("Instância do webhook não confere."), {
        code: "COMMUNITY_INSTANCE_MISMATCH",
        status: 403,
      });
    if (event.event !== "MESSAGES_UPSERT")
      return { accepted: true, outcome: "IGNORED_EVENT" };
    if (!event.messageId)
      throw Object.assign(new Error("Evento sem messageId."), {
        code: "COMMUNITY_MESSAGE_ID_REQUIRED",
      });
    if (this.repository.hasReceipt(event.instance, event.messageId))
      return { accepted: true, outcome: "DUPLICATE" };
    if (event.fromMe) return this.record(event, "IGNORED", "FROM_ME");
    if (!event.groupJid.endsWith("@g.us"))
      return this.record(event, "IGNORED", "PRIVATE_MESSAGE");
    const source = this.repository.enabledGroup(event.groupJid);
    if (!source) return this.record(event, "REJECTED", "GROUP_NOT_ALLOWLISTED");
    const detector = detectHiringMessage(event.text);
    if (!detector.relevant)
      return this.record(
        event,
        "IGNORED",
        detector.ambiguous
          ? "AMBIGUOUS_REVIEW_NOT_ENABLED"
          : "NOT_HIRING_RELATED",
      );
    const facts = extractLeadFacts(detector.normalized),
      filter = matchesSourceFilters(detector.normalized, facts, source.filters);
    if (!filter.accepted) return this.record(event, "IGNORED", filter.reason);
    const trust = sourceTrust("COMMUNITY_WHATSAPP_GROUP"),
      risk = assessDiscoveryRisk({
        ...facts,
        sourceClass: "COMMUNITY_WHATSAPP_GROUP",
      }),
      reviewStatus =
        facts.title && (facts.applicationContact || facts.sourceUrl)
          ? "PROMOTABLE"
          : "NEEDS_REVIEW";
    const lead = this.repository.createLead({
      ...facts,
      sourceClass: "COMMUNITY_WHATSAPP_GROUP",
      sourceRef: digest(event.groupJid),
      trustTier: trust.tier,
      riskState: risk.state,
      reviewStatus,
      facts: {
        detectorScore: detector.score,
        seniority: facts.seniority,
        skills: facts.skills,
        applicationTarget: facts.applicationTarget,
      },
      provenance: {
        kind: "WHATSAPP_GROUP",
        communitySourceId: source.id,
        receivedAt: new Date().toISOString(),
        messageIdHash: digest(event.messageId),
      },
    });
    this.repository.receipt(
      event.instance,
      event.messageId,
      event.groupJid,
      lead.duplicate ? "DUPLICATE" : "LEAD_CREATED",
    );
    this.repository.createSignal({
      leadId: lead.id,
      signalType: "HIRING_INTENT",
      sourceClass: "COMMUNITY_WHATSAPP_GROUP",
      company: lead.company,
      summary: lead.title,
      confidence: detector.score,
      provenance: { communitySourceId: source.id },
    });
    return {
      accepted: true,
      outcome: lead.duplicate ? "DUPLICATE" : "LEAD_CREATED",
      lead,
    };
  }
  record(event, outcome, reason) {
    const receipt = this.repository.receipt(
      event.instance,
      event.messageId,
      event.groupJid,
      outcome,
    );
    return {
      accepted: true,
      outcome: receipt.duplicate ? "DUPLICATE" : outcome,
      reason,
    };
  }
  promote(id) {
    return new LeadPromotionService({
      repository: this.repository,
      jobRepository: this.jobRepository,
    }).promote(id);
  }
}
