import { createHash } from "node:crypto";
import { OpportunityDecisionPolicyV2 } from "./opportunity-decision-policy-v2.mjs";
import { calculateOpportunityPriority } from "./opportunity-priority.mjs";
import { preferenceLearning } from "./preference-learning.mjs";
import { duplicateOpportunityKey, opportunityFreshness } from "./opportunity-freshness.mjs";
import { buildProviderQualityReport } from "../discovery/provider-quality-service.mjs";
import { jobInformationQuality } from "../matching/job-information-quality.mjs";
import {
  classifyFreshness,
  classifyGeography,
  classifyJobFamily,
  classifyOpportunityType,
  classifySeniority,
} from "../discovery/relevance/pre-match-plausibility.mjs";

// Application source remains below the stable Tectonic warm-up layer in Docker.

const POLICY_REVISION = "opportunity-decision-policy-v2.1";
const timestamp = (value) => Date.parse(value || 0) || 0;
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const DOMAIN_REVISION_SQL = `
  SELECT 'jobs' domain, COUNT(*) count, COALESCE(MAX(updated_at), '') latest FROM jobs
  UNION ALL SELECT 'analyses', COUNT(*), COALESCE(MAX(updated_at), '') FROM ats_analyses
  UNION ALL SELECT 'analysis_items', COUNT(*), COALESCE(MAX(created_at), '') FROM ats_analysis_items
  UNION ALL SELECT 'requirements', COUNT(*), COALESCE(MAX(updated_at), '') FROM job_requirements
  UNION ALL SELECT 'applications', COUNT(*), COALESCE(MAX(updated_at), '') FROM applications
  UNION ALL SELECT 'feedback', COUNT(*), COALESCE(MAX(updated_at), '') FROM job_feedback
  UNION ALL SELECT 'alerts', COUNT(*), COALESCE(MAX(updated_at), '') FROM job_alerts
  UNION ALL SELECT 'policies', COUNT(*), COALESCE(MAX(updated_at), '') FROM job_hunt_profiles
  UNION ALL SELECT 'runs', COUNT(*), COALESCE(MAX(completed_at), MAX(started_at), '') FROM job_hunt_runs
  UNION ALL SELECT 'facts', COUNT(*), COALESCE(MAX(updated_at), '') FROM candidate_facts
  UNION ALL SELECT 'intents', COUNT(*), COALESCE(MAX(updated_at), '') FROM search_intents
`;

function groupBy(items, selector) {
  const groups = new Map();
  for (const item of items) {
    const key = selector(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function latestBy(items, selector) {
  const latest = new Map();
  for (const item of items) {
    const key = selector(item);
    const previous = latest.get(key);
    if (!previous || timestamp(item.updatedAt || item.createdAt) > timestamp(previous.updatedAt || previous.createdAt)) latest.set(key, item);
  }
  return latest;
}

function consolidateDuplicates(items) {
  const grouped = new Map();
  for (const item of items) {
    const key = duplicateOpportunityKey(item.job) || `job:${item.job.id}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  return [...grouped.values()].map((group) => {
    group.sort((left, right) =>
      Number(Boolean(right.application)) - Number(Boolean(left.application)) ||
      Number(right.freshness.current) - Number(left.freshness.current) ||
      Number((right.job.description || "").length >= 100) - Number((left.job.description || "").length >= 100) ||
      right.priority.score - left.priority.score ||
      timestamp(right.job.lastCheckedAt || right.job.lastSeenAt) - timestamp(left.job.lastCheckedAt || left.job.lastSeenAt));
    const representative = group[0];
    if (group.length === 1) return representative;
    return {
      ...representative,
      job: {
        ...representative.job,
        duplicateGroup: {
          count: group.length,
          jobIds: group.map((item) => item.job.id),
          providers: [...new Set(group.map((item) => item.job.provider || item.job.source).filter(Boolean))],
          sources: [...new Set(group.flatMap((item) => [item.job.source, item.job.provider]).filter(Boolean))],
        },
      },
    };
  });
}

function isExcluded(item = {}) {
  const lifecycleStatus = item.job?.lifecycleStatus || item.freshness?.lifecycleStatus;
  return (
    ["BLOCKED", "SKIP"].includes(item.decision?.disposition) ||
    lifecycleStatus === "CLOSED" ||
    item.freshness?.status === "CLOSED"
  );
}

function itemsForSection(items, section = "discover") {
  if (["all", "companies", "history"].includes(section)) return items;
  if (section === "decisions")
    return items
      .filter((item) => item.feedback?.userDecision)
      .sort(
        (left, right) =>
          timestamp(right.feedback?.updatedAt) - timestamp(left.feedback?.updatedAt),
      );
  const active = items.filter(
    (item) => !isExcluded(item) && !item.feedback?.userDecision,
  );
  const selected =
    section === "excluded"
      ? items.filter(isExcluded)
      : section === "recommended"
        ? active.filter((item) =>
            ["RECOMMENDED", "PREPARE_ELIGIBLE"].includes(
              item.decision?.disposition,
            ),
          )
        : section === "review"
          ? active.filter((item) => item.decision?.disposition === "REVIEW")
          : section === "stretch"
            ? active.filter((item) => item.decision?.disposition === "STRETCH")
            : active;
  if (section === "priority")
    return [...selected].sort(
      (left, right) =>
        (right.priority?.score || 0) - (left.priority?.score || 0),
    );
  if (section === "excluded")
    return [...selected].sort(
      (left, right) =>
        timestamp(right.job?.lastSeenAt || right.job?.updatedAt) -
        timestamp(left.job?.lastSeenAt || left.job?.updatedAt),
    );
  return selected;
}

function compactSummary({
  job,
  analysis,
  preMatch,
  feedback,
  application,
  priority,
  decision,
  freshness,
}) {
  return {
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      workModel: job.workModel,
      seniority: job.seniority,
      url: job.url,
      source: job.source,
      provider: job.provider,
      discoveredVia: job.discoveredVia,
      lifecycleStatus: job.lifecycleStatus,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      firstSeenAt: job.firstSeenAt,
      lastSeenAt: job.lastSeenAt,
      lastCheckedAt: job.lastCheckedAt,
      duplicateGroup: job.duplicateGroup,
    },
    analysis: analysis
      ? {
          id: analysis.id,
          analysisStatus: analysis.analysisStatus,
          overallScore: analysis.overallScore,
          knownEvidenceMatch: analysis.knownEvidenceMatch,
          calibratedMatchScore: analysis.calibratedMatchScore,
          evidenceCoverage: analysis.evidenceCoverage,
          matchConfidence: analysis.matchConfidence,
          confidenceBand: analysis.confidenceBand,
          jobInformation: jobInformationQuality(job),
          matched: (analysis.matched || []).slice(0, 3),
        }
      : null,
    preMatch: preMatch ? { reasons: (preMatch.reasons || []).slice(0, 3) } : null,
    feedback,
    application: application
      ? { id: application.id, status: application.status }
      : null,
    priority: {
      score: priority.score,
      level: priority.level,
      technicalMatch: priority.technicalMatch,
      components: { confidence: priority.components?.confidence ?? null },
      reasons: (priority.reasons || []).slice(0, 3),
    },
    decision: decision
      ? {
          disposition: decision.disposition,
          decisionExplanation: {
            summary: decision.decisionExplanation?.summary || "",
          },
          hardBlockers: (decision.hardBlockers || []).slice(0, 3),
          reasons: (decision.reasons || []).slice(0, 3),
          visibility: { recommended: Boolean(decision.visibility?.recommended) },
          gapSummary: {
            counts: decision.gapSummary?.counts || {},
            items: (decision.gapSummary?.items || []).slice(0, 3),
          },
        }
      : null,
    freshness,
  };
}

export class OpportunityService {
  constructor({
    store,
    profileProvider,
    decisionPolicy = new OpportunityDecisionPolicyV2(),
    revisionCheckIntervalMs = 0,
    clock = () => Date.now(),
  } = {}) {
    Object.assign(this, { store, profileProvider, decisionPolicy });
    this.revisionCheckIntervalMs = Math.max(0, Number(revisionCheckIntervalMs) || 0);
    this.clock = clock;
    this.projectionCache = null;
    this.projectionPromise = null;
    this.projectionBuildCount = 0;
    this.lastRevisionCheckAt = 0;
  }

  revision(profile) {
    const connection = this.store.database?.connection;
    if (connection) {
      const statement = connection.prepare(DOMAIN_REVISION_SQL);
      if (typeof statement.all === "function") {
        const domainRevision = statement.all();
        return hash({ domainRevision, profile, policy: POLICY_REVISION });
      }
    }
    const summarize = (items, fields) => items.map((item) => fields.map((field) => item?.[field] ?? "")).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    return hash({
      profile, policy: POLICY_REVISION,
      jobs: summarize(this.store.jobs.all(), ["id", "updatedAt", "contentHash", "lifecycleStatus", "status"]),
      analyses: summarize(this.store.analyses.all(), ["id", "updatedAt", "matcherVersion", "scoringModelVersion", "requirementExtractorVersion"]),
      applications: summarize(this.store.applications.all(), ["id", "updatedAt", "status", "jobId"]),
      feedback: summarize(this.store.jobFeedback.all(), ["jobId", "updatedAt", "verdict"]),
      alerts: summarize(this.store.jobAlerts.list(), ["id", "updatedAt", "status", "notificationCount"]),
      policies: summarize(this.store.jobHuntProfiles.all(), ["id", "updatedAt", "searchIntentVersion", "enabled"]),
      runs: summarize(this.store.jobHuntRuns?.list?.() || [], ["id", "completedAt", "status"]),
      facts: summarize(this.store.candidateFacts?.active?.() || [], ["id", "updatedAt", "verificationStatus", "lifecycleStatus"]),
    });
  }

  invalidate() {
    this.projectionCache = null;
    this.lastRevisionCheckAt = 0;
  }

  cached(jobId) {
    return (
      this.projectionCache?.items.find(
        (item) =>
          item.job.id === jobId ||
          item.job.duplicateGroup?.jobIds?.includes(jobId),
      ) || null
    );
  }

  async find(jobId) {
    return (
      this.cached(jobId) ||
      (await this.list()).find(
        (item) =>
          item.job.id === jobId ||
          item.job.duplicateGroup?.jobIds?.includes(jobId),
      ) ||
      null
    );
  }

  async list() {
    const checkedAt = this.clock();
    if (
      this.projectionCache &&
      this.revisionCheckIntervalMs > 0 &&
      checkedAt - this.lastRevisionCheckAt < this.revisionCheckIntervalMs
    )
      return this.projectionCache.items;
    const profile = await this.profileProvider();
    const revision = this.revision(profile);
    this.lastRevisionCheckAt = checkedAt;
    if (this.projectionCache?.revision === revision) return this.projectionCache.items;
    if (this.projectionPromise?.revision === revision) return this.projectionPromise.promise;
    const promise = this.buildProjection(profile, revision);
    this.projectionPromise = { revision, promise };
    try { return await promise; }
    finally { if (this.projectionPromise?.promise === promise) this.projectionPromise = null; }
  }

  async buildProjection(profile, revision) {
    this.projectionBuildCount++;

    const jobs = this.store.jobs.all();
    const analyses = this.store.analyses.latestProjectionPerJob?.() || this.store.analyses.latestPerJob?.() || this.store.analyses.all();
    const latestAnalysis = latestBy(analyses, (item) => item.jobId);
    const applications = new Map(this.store.applications.all().map((item) => [item.jobId, item]));
    const feedback = new Map(this.store.jobFeedback.all().map((item) => [item.jobId, item]));
    const learned = preferenceLearning(jobs, [...feedback.values()]);
    const notified = new Set(this.store.jobAlerts.list().filter((item) => item.notificationCount > 0 || item.status === "SENT").map((item) => item.jobId));
    const policies = this.store.jobHuntProfiles.all();
    const activePolicy = policies.find((item) => item.enabled) || policies[0] || null;
    const runs = this.store.jobHuntRuns?.list?.() || [];
    const latestPreMatch = new Map();
    for (const run of runs) for (const candidate of run.report?.preMatchDecisions || []) {
      const decision = { ...candidate, profileId: candidate.profileId || run.profileId || "", jobHuntRunId: candidate.jobHuntRunId || run.id, runId: run.id, runStatus: run.status, evaluatedAt: candidate.evaluatedAt || run.completedAt || run.startedAt };
      if (!latestPreMatch.has(candidate.jobId) || timestamp(decision.evaluatedAt) > timestamp(latestPreMatch.get(candidate.jobId).evaluatedAt)) latestPreMatch.set(candidate.jobId, decision);
    }
    const allRequirements = this.store.jobRequirements.all?.();
    const requirementsByJob = allRequirements ? groupBy(allRequirements, (item) => item.jobId) : null;
    const allItems = this.store.analysisItems.forAnalyses?.(
      [...latestAnalysis.values()].map((item) => item.id),
    ) || this.store.analysisItems.all?.();
    const itemsByAnalysis = allItems ? groupBy(allItems, (item) => item.analysisId) : null;

    const providerDiagnostics = runs.slice(0, 10).flatMap((run) => (run.report?.sourceReports || []).flatMap((report) => [report, ...(report.sites || [])]));
    const initialQualityReport = buildProviderQualityReport({ jobs, analyses, requirementsByJob, providerDiagnostics, extractMissingRequirements: false });
    const qualityByProvider = new Map(initialQualityReport.providers.map((item) => [item.providerId, item]));
    const qualityByPortal = new Map(initialQualityReport.sourcePortals.map((item) => [item.sourcePortal, item]));
    const intentByProfile = new Map(policies.map(policy => [policy.id,
      this.store.searchIntents?.forProfile?.(policy.id) || { profileId: policy.id, version: policy.searchIntentVersion || 0, originalIntent: { jobFamilies: policy.jobFamilies || [] }, families: policy.jobFamilies || [], seniorities: policy.seniorities || [], locationPolicy: policy.locationPolicy || {} },
    ]));
    const projected = [];
    for (const [jobIndex, job] of jobs.entries()) {
      if (jobIndex % 25 === 0) await new Promise(resolve => setImmediate(resolve));
      const analysis = latestAnalysis.get(job.id) || null;
      const currentFeedback = feedback.get(job.id) || null;
      const application = applications.get(job.id) || null;
      const preMatch = latestPreMatch.get(job.id) || null;
      const classifiedFamily = preMatch?.primaryJobFamily && Array.isArray(preMatch.secondaryJobFamilies)
        ? preMatch
        : classifyJobFamily(job);
      const basePreMatch = preMatch
        ? { ...classifiedFamily, ...preMatch }
        : classifiedFamily;
      const familyPolicy = policies.find((item) =>
        (item.jobFamilies || []).some((family) =>
          family === classifiedFamily.primaryJobFamily || classifiedFamily.secondaryJobFamilies.includes(family)));
      const originPolicy = policies.find((item) => item.id === preMatch?.profileId) || familyPolicy || activePolicy;
      const usedFallback = !preMatch?.profileId || !policies.some((item) => item.id === preMatch.profileId);
      const intent = originPolicy ? intentByProfile.get(originPolicy.id) : {};
      const evaluationPreMatch = {
        ...basePreMatch,
        seniority: basePreMatch.seniority || classifySeniority(job).seniority,
        freshness: basePreMatch.freshness || classifyFreshness(job),
        opportunityType: basePreMatch.opportunityType || classifyOpportunityType(job).opportunityType,
        geography: basePreMatch.geography || classifyGeography(job, intent.locationPolicy || {}),
      };
      const requirements = requirementsByJob?.get(job.id) || (!requirementsByJob ? this.store.jobRequirements.forJob(job.id) : []);
      const items = analysis ? itemsByAnalysis?.get(analysis.id) || (!itemsByAnalysis ? this.store.analysisItems.forAnalysis(analysis.id) : []) : [];
      const scopedPolicies = originPolicy ? [originPolicy] : [];
      const technicalProvider = String(job.provider || job.source || job.discoveredVia || "unknown").toLowerCase();
      const sourcePortal = String(job.discoveredVia || job.portal || job.provider || job.source || "unknown").toLowerCase();
      const sourceQuality = qualityByPortal.get(sourcePortal) || qualityByProvider.get(technicalProvider) || null;
      const priority = calculateOpportunityPriority({ job, analysis, requirements, items, profile, jobHuntPolicies: scopedPolicies, feedback: currentFeedback, application, notified: notified.has(job.id), sourceQuality, preMatch: evaluationPreMatch, intent });
      const learnedSignal = learned.get(classifyJobFamily({ title: job.title }).primaryJobFamily);
      if (learnedSignal?.adjustment && !currentFeedback) {
        priority.score = Math.max(0, Math.min(100, priority.score + learnedSignal.adjustment));
        priority.level = priority.score >= 80 ? "HIGH" : priority.score >= 60 ? "MEDIUM" : "LOW";
        priority.components.learnedPreferenceAdjustment = learnedSignal.adjustment;
        priority.reasons.push(`Preferência aprendida de decisões anteriores: ajuste leve de ${learnedSignal.adjustment} ponto(s), sem alterar ATS ou elegibilidade.`);
      }
      const contextProvenance = { source: usedFallback ? (familyPolicy ? "FAMILY_PROFILE_FALLBACK" : "LEGACY_ACTIVE_PROFILE_FALLBACK") : "JOB_HUNT_RUN", usedFallback, profileId: originPolicy?.id || "", searchIntentId: preMatch?.searchIntentId || intent?.id || "", searchIntentVersion: preMatch?.searchIntentVersion || intent?.version || 0, jobHuntRunId: preMatch?.jobHuntRunId || "" };
      const decision = this.decisionPolicy.evaluate({ job, analysis, preMatch: evaluationPreMatch, requirements, items, feedback: currentFeedback, application, priority, policies: scopedPolicies, intent, contextProvenance });
      projected.push({ job: { ...job, technicalProvider, sourcePortal, sourceQuality }, analysis, preMatch, requirements, items, feedback: currentFeedback, application, priority, decision, freshness: opportunityFreshness(job) });
    }
    const projection = consolidateDuplicates(projected)
      .sort((left, right) =>
        Number(["BLOCKED", "SKIP"].includes(left.decision?.disposition)) - Number(["BLOCKED", "SKIP"].includes(right.decision?.disposition)) ||
        right.priority.score - left.priority.score ||
        String(right.job.createdAt).localeCompare(String(left.job.createdAt)));
    const qualityReport = {
      ...initialQualityReport,
      providers: initialQualityReport.providers.map((provider) => {
        const providerItems = projection.filter((item) => String(item.job.provider || item.job.discoveredVia || item.job.source || "unknown").toLowerCase() === provider.providerId);
        return {
          ...provider,
          relevantJobs: providerItems.filter((item) => !["BLOCKED", "SKIP"].includes(item.decision?.disposition)).length,
          recommendedJobs: providerItems.filter((item) => item.decision?.visibility?.recommended).length,
          appliedJobs: providerItems.filter((item) => Boolean(item.application)).length,
        };
      }),
      funnel: {
        ...initialQualityReport.funnel,
        relevant: projection.filter((item) => !["BLOCKED", "SKIP"].includes(item.decision?.disposition)).length,
        recommended: projection.filter((item) => item.decision?.visibility?.recommended).length,
        applied: projection.filter((item) => Boolean(item.application)).length,
      },
    };
    this.projectionCache = { revision, items: projection, qualityReport };
    return projection;
  }

  async qualityReport() {
    await this.list();
    return this.projectionCache.qualityReport;
  }

  async summaries() {
    return (await this.list()).map(({ job, analysis, preMatch, feedback, application, priority, decision, freshness }) => ({
      job: {
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        workModel: job.workModel,
        seniority: job.seniority,
        description: String(job.description || "").slice(0, 1_000),
        url: job.url,
        source: job.source,
        provider: job.provider,
        discoveredVia: job.discoveredVia,
        sourcePortal: job.sourcePortal,
        technicalProvider: job.technicalProvider,
        lifecycleStatus: job.lifecycleStatus,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        firstSeenAt: job.firstSeenAt,
        lastSeenAt: job.lastSeenAt,
        lastCheckedAt: job.lastCheckedAt,
        duplicateGroup: job.duplicateGroup,
      },
      analysis: analysis ? {
        id: analysis.id,
        jobId: analysis.jobId,
        resumeId: analysis.resumeId,
        analysisStatus: analysis.analysisStatus,
        algorithmVersion: analysis.algorithmVersion,
        overallScore: analysis.overallScore,
        knownEvidenceMatch: analysis.knownEvidenceMatch,
        calibratedMatchScore: analysis.calibratedMatchScore,
        evidenceCoverage: analysis.evidenceCoverage,
        matchConfidence: analysis.matchConfidence,
        confidenceBand: analysis.confidenceBand,
        jobInformation: jobInformationQuality(job),
        eligibility: analysis.eligibility,
        matched: (analysis.matched || []).slice(0, 3),
        updatedAt: analysis.updatedAt,
      } : null,
      preMatch: preMatch ? { reasons: preMatch.reasons || [] } : null,
      feedback,
      application: application ? { id: application.id, status: application.status } : null,
      priority: {
        score: priority.score,
        level: priority.level,
        technicalMatch: priority.technicalMatch,
        components: priority.components,
        trace: priority.trace,
        reasons: (priority.reasons || []).slice(0, 3),
      },
      decision: decision ? {
        disposition: decision.disposition,
        decisionExplanation: { summary: decision.decisionExplanation?.summary || "" },
        hardBlockers: (decision.hardBlockers || []).slice(0, 3),
        reasons: (decision.reasons || []).slice(0, 3),
        visibility: { recommended: Boolean(decision.visibility?.recommended) },
        gapSummary: {
          counts: decision.gapSummary?.counts || {},
          items: (decision.gapSummary?.items || []).slice(0, 3),
        },
      } : null,
      freshness,
    }));
  }

  async page({ section = "discover", offset = 0, limit = 12, query = "" } = {}) {
    const all = await this.list(),
      selected = itemsForSection(all, section),
      normalizedQuery = String(query || "").trim().toLocaleLowerCase("pt-BR"),
      filtered = normalizedQuery
        ? selected.filter((item) =>
            [
              item.job.title,
              item.job.company,
              item.job.location,
              item.job.description,
              item.job.seniority,
            ]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase("pt-BR")
              .includes(normalizedQuery),
          )
        : selected,
      safeOffset = Math.max(0, Number(offset) || 0),
      safeLimit = Math.min(2_000, Math.max(1, Number(limit) || 12)),
      pageItems = filtered.slice(safeOffset, safeOffset + safeLimit);
    return {
      opportunities: pageItems.map(compactSummary),
      pagination: {
        section,
        offset: safeOffset,
        limit: safeLimit,
        returned: pageItems.length,
        total: filtered.length,
        hasMore: safeOffset + pageItems.length < filtered.length,
      },
    };
  }
}
