import { randomUUID } from "node:crypto";

const providerBySource = Object.freeze({
  COMMUNITY_WHATSAPP_GROUP: "evolution-whatsapp",
  PUBLIC_WEB: "brave-public-web",
  NEWS_BLOG_HIRING_SIGNAL: "brave-public-web",
  MANUAL_LEAD_CAPTURE: "manual",
  PUBLIC_SOCIAL_SIGNAL: "manual",
  RECRUITER_PUBLIC_SIGNAL: "manual",
  EXTERNAL_FORM: "manual",
});

export class LeadPromotionService {
  constructor({ repository, jobRepository } = {}) {
    Object.assign(this, { repository, jobRepository });
  }

  promote(id) {
    const lead = this.repository.listLeads().find((item) => item.id === id);
    if (!lead)
      throw Object.assign(new Error("Lead não encontrado."), {
        code: "LEAD_NOT_FOUND",
        status: 404,
      });
    if (!lead.title || (!lead.applicationContact && !lead.sourceUrl))
      throw Object.assign(
        new Error("Lead ainda não possui fatos suficientes para promoção."),
        { code: "LEAD_INCOMPLETE" },
      );
    if (["RISKY", "REVIEW_REQUIRED"].includes(lead.riskState))
      throw Object.assign(
        new Error("Revise os sinais de risco antes da promoção."),
        { code: "LEAD_RISK_REVIEW_REQUIRED" },
      );
    const timestamp = new Date().toISOString();
    const provider =
      lead.provenance?.provider ||
      providerBySource[lead.sourceClass] ||
      "manual";
    const source =
      lead.sourceClass === "COMMUNITY_WHATSAPP_GROUP"
        ? "community"
        : lead.sourceClass === "PUBLIC_WEB"
          ? "public-web"
          : "manual";
    const legacyMethod = ["WHATSAPP", "DIRECT_MESSAGE"].includes(
      lead.applicationMethod,
    )
      ? "MANUAL"
      : lead.applicationMethod;
    const job = this.jobRepository.upsert({
      id: `job-${randomUUID()}`,
      externalId: `lead:${lead.id}`,
      source,
      provider,
      providerJobId: lead.id,
      canonicalKey: `lead:${lead.contentHash}`,
      canonicalUrl: lead.sourceUrl,
      applicationUrl: lead.sourceUrl,
      applicationMethod: legacyMethod,
      discoveryV4ApplicationMethod: lead.applicationMethod,
      title: lead.title,
      company: lead.company,
      location: lead.location,
      workModel: lead.workModel,
      description: lead.excerpt,
      url: lead.sourceUrl,
      status: "salva",
      lifecycleStatus: "UNKNOWN",
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      lastCheckedAt: timestamp,
      sourceTrustTier: lead.trustTier,
      riskState: lead.riskState,
      provenance: {
        ...lead.provenance,
        sourceClass: lead.sourceClass,
        leadId: lead.id,
        provider,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      lead: this.repository.updateLead(id, {
        reviewStatus: "PROMOTED",
        jobId: job.id,
      }),
      job,
    };
  }
}
