import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { createProviderRegistry } from "../src/discovery/provider-catalog.mjs";
import { DiscoveryService } from "../src/discovery/discovery-service.mjs";
import { JobHuntService } from "../src/automation/job-hunt-service.mjs";
import { EventBus } from "../src/integrations/event-bus.mjs";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-brazil-p0-"));
const store = await new UnifiedStateStore({ dataDir }).initialize();
const startedAt = Date.now();

try {
  const registry = createProviderRegistry({ searchClient: async () => ({ jobs: [] }) });
  const providerTelemetry = new Map();
  for (const providerId of ["iel", "programathor", "solides", "recrutei", "nerdin", "remotar"]) {
    const provider = registry.get(providerId),
      search = provider.search.bind(provider);
    provider.search = async (input) => {
      const providerStartedAt = Date.now();
      try {
        const result = await search(input);
        providerTelemetry.set(providerId, {
          logicalRequests: 1,
          latencyMs: Date.now() - providerStartedAt,
          raw: result.jobs?.length || 0,
          status: result.diagnostic?.status || "HEALTHY",
          errors: Number(result.diagnostic?.errorCount || 0),
        });
        return result;
      } catch (error) {
        providerTelemetry.set(providerId, {
          logicalRequests: 1,
          latencyMs: Date.now() - providerStartedAt,
          raw: 0,
          status: "ERROR",
          errors: 1,
          errorCode: error.code || "PROVIDER_ERROR",
        });
        throw error;
      }
    };
  }
  const discoveryService = new DiscoveryService({
    registry,
    repositories: store.discovery,
    jobRepository: store.jobs,
    boardRepository: store.watchlists,
  });
  const profile = {
    personal: { city: "Brasília", state: "DF", country: "Brasil" },
    career: {
      headline: "Desenvolvedor Júnior",
      targetRoles: "Desenvolvimento de Software",
      yearsExperience: 1,
      skills: "Java, JavaScript, Python, SQL, Git, APIs",
      workModels: "remoto, híbrido, presencial",
      locationRule: "Brasília, DF ou remoto Brasil",
      englishLevel: "Intermediário",
    },
    experience: "Projetos de software com JavaScript, Python, SQL, Git e APIs.",
  };
  const resume = store.resumes.upsert({
    id: "resume-homologation-brazil-p0",
    title: "Perfil técnico de homologação",
    text: "Projetos de software com JavaScript, Python, Java, SQL, Git e APIs.",
    sections: { skills: ["JavaScript", "Python", "Java", "SQL", "Git", "APIs"] },
    extraction: { method: "controlled-homologation" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const service = new JobHuntService({
    store,
    discoveryService,
    matcher: ({ job }) => runAtsMatcherV2({ job, profile, resume }),
    profileProvider: async () => profile,
    eventBus: new EventBus({ outbox: store.outbox }),
  });
  const run = await service.runManual(
    {
      name: "HOMOLOGATION_BRAZIL_P0",
      queries: ["Desenvolvedor"],
      seniorities: ["INTERNSHIP", "JUNIOR"],
      providers: ["iel", "programathor", "solides", "recrutei", "nerdin", "remotar"],
      sourcePreferences: ["iel", "programathor", "solides", "recrutei", "nerdin", "remotar"],
      locationPolicy: {
        priorities: [
          { priority: 1, location: "Brasil", workModel: "REMOTE", remoteScope: "Brasil", accepted: true },
        ],
        allowOnsiteOutsideArea: false,
      },
      considerThreshold: 55,
      prepareResumeThreshold: 100,
      notifyThreshold: 100,
      prepareResume: false,
      allowedEligibility: ["ELIGIBLE", "ELIGIBLE_WITH_WARNINGS", "REVIEW_REQUIRED"],
      queryBudget: {
        maxQueries: 1,
        maxQueriesPerProvider: 1,
        maxRequests: 6,
        concurrency: 1,
        timeoutMs: 20_000,
        retries: 1,
        backoffMs: 750,
      },
      notificationPolicy: { maxInstantAlerts: 0, quietHours: null },
    },
    { profileId: "homologation-brazil-p0", priorityThreshold: 85 },
  );
  const jobs = store.jobs.all(),
    analyses = store.analyses.all(),
    analysisByJob = new Map(analyses.map((item) => [item.jobId, item])),
    decisions = run.report?.preMatchDecisions || [],
    decisionByJob = new Map(decisions.map((item) => [item.jobId, item])),
    rankedJobs = [...jobs].sort((left, right) => {
      const leftAnalysis = analysisByJob.get(left.id),
        rightAnalysis = analysisByJob.get(right.id),
        leftDecision = decisionByJob.get(left.id)?.decision,
        rightDecision = decisionByJob.get(right.id)?.decision;
      return (
        Number(Boolean(rightAnalysis)) - Number(Boolean(leftAnalysis)) ||
        Number(rightAnalysis?.overallScore || 0) - Number(leftAnalysis?.overallScore || 0) ||
        Number(rightDecision !== "REJECT") - Number(leftDecision !== "REJECT") ||
        String(right.datePosted || "").localeCompare(String(left.datePosted || ""))
      );
    }),
    qualityLabel = (job) => {
      const decision = decisionByJob.get(job.id),
        analysis = analysisByJob.get(job.id);
      if (decision?.decision === "REJECT") return "BAD";
      if (analysis && analysis.overallScore >= 55) return "GOOD";
      return "QUESTIONABLE";
    },
    qualityAt = (size) => {
      const top = rankedJobs.slice(0, size),
        counts = top.reduce((result, job) => {
          const label = qualityLabel(job);
          result[label] = (result[label] || 0) + 1;
          return result;
        }, {});
      return {
        audited: top.length,
        ...counts,
        precision: top.length ? Number(((counts.GOOD || 0) / top.length).toFixed(3)) : null,
      };
    },
    sourceMetrics = Object.fromEntries(
      ["iel", "programathor", "solides", "recrutei", "nerdin", "remotar"].map((provider) => {
        const providerJobs = jobs.filter((job) => job.provider === provider),
          providerDecisions = providerJobs.map((job) => decisionByJob.get(job.id)).filter(Boolean),
          counts = providerDecisions.reduce(
            (result, item) => {
              if (item.decision === "REJECT") result.REJECT++;
              else if (item.decision === "REVIEW") result.REVIEW++;
              else if (item.decision === "PASS_WITH_WARNINGS") result.WARN++;
              else result.PASS++;
              return result;
            },
            { PASS: 0, WARN: 0, REVIEW: 0, REJECT: 0 },
          ),
          telemetry = providerTelemetry.get(provider) || {};
        return [
          provider,
          {
            logicalRequests: telemetry.logicalRequests || 0,
            latencyMs: telemetry.latencyMs || 0,
            raw: telemetry.raw || 0,
            unique: providerJobs.length,
            ...counts,
            matched: providerJobs.filter((job) => analysisByJob.has(job.id)).length,
            relevant: providerJobs.filter((job) => Number(analysisByJob.get(job.id)?.overallScore || 0) >= 55).length,
            errors: telemetry.errors || 0,
            status: telemetry.status || "NOT_CALLED",
          },
        ];
      }),
    );
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "REAL_CONTROLLED_MASS_HUNT",
        isolatedTemporaryStore: true,
        outboundSent: false,
        applicationsCreated: store.applications.all().length,
        durationMs: Date.now() - startedAt,
        status: run.status,
        funnel: run.report?.funnel || {},
        sourceReports: run.report?.sourceReports || [],
        homologationBySource: sourceMetrics,
        filterReasons: run.report?.filterReasons || {},
        quality: { top5: qualityAt(5), top10: qualityAt(10), top20: qualityAt(20) },
        coverage: {
          byProvider: Object.fromEntries(
            ["iel", "programathor", "solides", "recrutei", "nerdin", "remotar"].map((provider) => [
              provider,
              jobs.filter((job) => job.provider === provider).length,
            ]),
          ),
          byOpportunityType: decisions.reduce((result, item) => {
            result[item.opportunityType || "UNKNOWN"] = (result[item.opportunityType || "UNKNOWN"] || 0) + 1;
            return result;
          }, {}),
        },
        sample: rankedJobs.slice(0, 20).map((job) => {
          const analysis = analysisByJob.get(job.id),
            preMatch = decisionByJob.get(job.id);
          return {
            provider: job.provider,
            providerJobId: job.providerJobId,
            title: job.title,
            company: job.company,
            location: job.location,
            applicationMethod: job.applicationMethod,
            lifecycleStatus: job.lifecycleStatus,
            preMatch: preMatch?.decision || "NOT_EVALUATED",
            preMatchReasons: preMatch?.reasons || [],
            opportunityType: preMatch?.opportunityType || job.metadata?.opportunityType || "UNKNOWN",
            matchScore: analysis?.overallScore ?? null,
            evidenceCoverage: analysis?.evidenceCoverage ?? null,
            confidence: analysis?.matchConfidence ?? null,
            quality: qualityLabel(job),
          };
        }),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  store.close();
  await rm(dataDir, { recursive: true, force: true });
}
