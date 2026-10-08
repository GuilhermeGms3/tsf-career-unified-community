import { createHash } from "node:crypto";
import {
  aggregatorSites,
  isQuietHours,
  jobMatchesLocationPolicy,
  jobMatchesSeniority,
  jobMatchesWorkModels,
  nextJobHuntRun,
  normalizeJobHuntProfile,
} from "./job-hunt-policy.mjs";
import { calculateOpportunityPriority } from "../opportunities/opportunity-priority.mjs";
import { evaluateOpportunityDecision } from "../opportunities/opportunity-decision-policy-v2.mjs";
import { SearchIntentService } from "../discovery/search-intent/search-intent-service.mjs";
import { DiscoveryQueryPlanner } from "../discovery/search-intent/discovery-query-planner.mjs";
import { classifyThresholdScore } from "../discovery/v4/mass-hunt-funnel.mjs";
import { PreMatchPlausibility } from "../discovery/relevance/pre-match-plausibility.mjs";
import { serializePreMatchDecision } from "../discovery/relevance/pre-match-snapshot.mjs";
import { brazilianProviderDefinitions } from "../discovery/providers/brazilian-public-providers.mjs";

const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const uniqueById = (items) => [
  ...new Map(items.map((item) => [item.id, item])).values(),
];
const brazilianSourceClass = new Map(
  brazilianProviderDefinitions.map((item) => [item.providerId, item.sourceClass]),
);
const providerSourceClass = (provider) =>
  brazilianSourceClass.get(provider) ||
  (provider === "jobspy" ? "JOB_BOARD" : "STRUCTURED_ATS");

export function fairRequestSchedule(requestGroups = []) {
  return requestGroups.flat();
}

export function rotateProviderTargets(targets = [], offset = 0) {
  if(targets.length<2)return targets;
  const start=((Number(offset)||0)%targets.length+targets.length)%targets.length;
  return [...targets.slice(start),...targets.slice(0,start)];
}

export class JobHuntService {
  constructor({
    store,
    discoveryService,
    matcher,
    profileProvider,
    eventBus,
    prepareResume = null,
    requestApproval = null,
    preMatch = new PreMatchPlausibility(),
  } = {}) {
    Object.assign(this, {
      store,
      discoveryService,
      matcher,
      profileProvider,
      eventBus,
      prepareResume,
      requestApproval,
      preMatch,
    });
    this.searchIntent = new SearchIntentService({
      intents: store.searchIntents,
      expandedQueries: store.expandedQueries,
    });
    this.queryPlanner = new DiscoveryQueryPlanner();
    this.running = new Set();
    this.transientProviderTargets = new Map();
  }

  saveSearchIntent(profile) {
    const input = {
        name: profile.name,
        families: profile.jobFamilies,
        customTerms: profile.queries,
        seniorities: profile.seniorities,
        locationPolicy: profile.locationPolicy,
      },
      normalized = this.searchIntent.normalize(input),
      current = this.store.searchIntents?.forProfile(profile.id);
    if (
      current &&
      JSON.stringify(current.originalIntent) === JSON.stringify(normalized)
    )
      return { intent: current, reused: true };
    return this.searchIntent.save(profile.id, input, profile.queryBudget);
  }

  listProfiles() {
    return this.store.jobHuntProfiles.all();
  }

  saveProfile(input, id = "") {
    const current = id ? this.store.jobHuntProfiles.findById(id) : {};
    if (id && !current)
      throw Object.assign(new Error("Perfil de busca não encontrado."), {
        code: "JOB_HUNT_PROFILE_NOT_FOUND",
      });
    const profile = normalizeJobHuntProfile(input, current);
    if (!profile.queries.length && !profile.jobFamilies.length)
      throw Object.assign(
        new Error("Informe ao menos uma família de cargos ou termo adicional."),
        { code: "JOB_HUNT_QUERY_REQUIRED" },
      );
    if (
      !profile.providers.length &&
      !profile.sourcePreferences.includes("monitored_companies")
    )
      throw Object.assign(new Error("Selecione ao menos uma fonte real."), {
        code: "JOB_HUNT_SOURCE_REQUIRED",
      });
    if (!profile.allowedEligibility.length)
      profile.allowedEligibility = ["ELIGIBLE", "ELIGIBLE_WITH_WARNINGS"];
    let saved = this.store.jobHuntProfiles.save({
        ...profile,
        id: id || undefined,
      }),
      expanded = this.searchIntent.save(
        saved.id,
        {
          name: saved.name,
          families: saved.jobFamilies,
          customTerms: saved.queries,
          seniorities: saved.seniorities,
          locationPolicy: saved.locationPolicy,
        },
        saved.queryBudget,
      );
    saved = this.store.jobHuntProfiles.save({
      ...saved,
      searchIntentVersion: expanded.intent.version,
    });
    return saved;
  }

  removeProfile(id) {
    if (this.running.has(id))
      throw Object.assign(new Error("O perfil está em execução."), {
        code: "JOB_HUNT_RUNNING",
      });
    return this.store.jobHuntProfiles.remove(id);
  }

  async runDue(now = new Date()) {
    const results = [];
    for (const profile of this.store.jobHuntProfiles.due(now.toISOString())) {
      const latest = this.store.jobHuntRuns.list(profile.id)[0];
      if (
        latest?.errorCode === "PROCESS_INTERRUPTED" &&
        latest.completedAt &&
        Date.parse(profile.nextRunAt || "") <= Date.parse(latest.completedAt)
      ) {
        this.store.jobHuntProfiles.markRun(profile.id, {
          lastRunAt: profile.lastRunAt || latest.startedAt,
          nextRunAt: nextJobHuntRun(profile.schedule, now),
        });
        results.push({
          status: "SKIPPED",
          reason: "PROCESS_INTERRUPTED",
          profileId: profile.id,
        });
        continue;
      }
      results.push(
        await this.run(profile.id, { triggerType: "SCHEDULED", now }),
      );
    }
    return results;
  }

  pause(runId) {
    const run = this.store.jobHuntRuns.findById(runId);
    if (!run)
      throw Object.assign(new Error("Execução não encontrada."), {
        status: 404,
        code: "JOB_HUNT_RUN_NOT_FOUND",
      });
    if (run.status !== "RUNNING") return run;
    const paused = this.store.jobHuntRuns.pause(runId);
    const profile = this.store.jobHuntProfiles.findById(run.profileId);
    if (profile)
      this.store.jobHuntProfiles.markRun(profile.id, {
        lastRunAt: profile.lastRunAt || run.startedAt,
        nextRunAt: profile.enabled
          ? nextJobHuntRun(profile.schedule, new Date())
          : null,
      });
    return paused;
  }

  assertRunActive(runId) {
    const current = this.store.jobHuntRuns.findById(runId);
    if (current?.status === "RUNNING") return current;
    const error = new Error("Busca em massa pausada pelo usuário.");
    error.code =
      current?.errorCode === "USER_PAUSED"
        ? "USER_PAUSED"
        : "JOB_HUNT_INTERRUPTED";
    throw error;
  }

  async evaluateDiscoveredJobs(jobs = [], thresholds = {}) {
    const candidateProfile = await this.profileProvider(),
      storedResumes = this.store.resumes.allActive?.() || this.store.resumes.all(),
      resumes = storedResumes.length
        ? storedResumes
        : [{ id: null, text: "", sections: {} }],
      result = {
        matchEvaluated: 0,
        relevantOpportunities: 0,
        priorityOpportunities: 0,
        needsReview: 0,
      };
    for (const job of uniqueById(jobs)) {
      let best = null;
      for (let resumeIndex = 0; resumeIndex < resumes.length; resumeIndex++) {
        if (resumeIndex % 2 === 0)
          await new Promise((resolve) => setImmediate(resolve));
        const resume = resumes[resumeIndex];
        const analysis = this.matcher({
          job,
          profile: candidateProfile,
          resume,
        });
        result.matchEvaluated++;
        this.store.analyses.upsert(analysis);
        this.store.jobRequirements.syncForJob(
          job.id,
          analysis.requirements || [],
        );
        this.store.analysisItems.syncForAnalysis(
          analysis.id,
          analysis.items || [],
        );
        if (!best || analysis.overallScore > best.overallScore) best = analysis;
      }
      if (!best) continue;
      const priority = calculateOpportunityPriority({
          job,
          analysis: best,
          requirements: best.requirements || [],
          items: best.items || [],
          profile: candidateProfile,
          feedback: this.store.jobFeedback.forJob(job.id),
        }),
        decision = classifyThresholdScore(
          {
            technicalMatch: best.overallScore,
            opportunityPriority: priority.score,
            evidenceCoverage: best.evidenceCoverage ?? 100,
            confidence: best.matchConfidence ?? priority.components.confidence,
          },
          {
            consider: thresholds.consider ?? 70,
            priority: thresholds.priority ?? 85,
          },
        );
      if (decision.relevant) result.relevantOpportunities++;
      if (decision.priority) result.priorityOpportunities++;
      if (
        best.eligibility === "REVIEW_REQUIRED" ||
        best.unknownRequirements?.length
      )
        result.needsReview++;
    }
    return result;
  }

  async testSearch(input = {}) {
    const profile = normalizeJobHuntProfile({ ...input, enabled: false });
    if (!profile.queries.length && !profile.jobFamilies.length)
      throw Object.assign(
        new Error("Informe ao menos uma família de cargos ou termo adicional."),
        { code: "JOB_HUNT_QUERY_REQUIRED" },
      );
    if (!profile.providers.length)
      throw Object.assign(
        new Error("Selecione ao menos uma fonte disponível para o teste."),
        { code: "JOB_HUNT_SOURCE_REQUIRED" },
      );
    const preview = this.searchIntent.preview(
      {
        name: profile.name,
        families: profile.jobFamilies,
        customTerms: profile.queries,
        seniorities: profile.seniorities,
        locationPolicy: profile.locationPolicy,
      },
      profile.queryBudget,
    );
    const queryPlan = this.queryPlanner.plan({
        intent: preview.intent,
        candidates: preview.candidates,
        budget: {
          ...profile.queryBudget,
          maxQueries: Math.min(3, profile.queryBudget.maxQueries),
        },
      }),
      queries = queryPlan.selected;
    const providers = profile.providers.slice(0, 5),
      location =
        profile.locationPolicy.priorities?.[0]?.location ||
        profile.locations?.[0] ||
        "Portugal",
      reports = [];
    for (const query of queries)
      for (const provider of providers) {
        try {
          const configuration =
              this.store.providerConfigurations?.get(provider),
            explicit = (input.providerTargets || []).find(
              (item) =>
                String(item.provider || item.providerId).toLowerCase() ===
                provider,
            ),
            identity = explicit || configuration?.identity || {},
            result = await this.discoveryService.discover({
              query: query.query,
              location,
              providers: [provider],
              organizationKey: identity.organizationKey || "",
              company: identity.company || "",
              sites: aggregatorSites(profile),
              timeoutMs: profile.queryBudget.timeoutMs,
              limit: 10,
            });
          reports.push({
            query: query.query,
            provider,
            ok: result.ok,
            rawJobs: result.discoveredCount,
            normalized: result.jobs.length,
            duplicates: result.duplicateCount || 0,
            newJobs: result.newCount || 0,
            errors:
              result.sourceReports?.filter((item) => item.status === "ERROR") ||
              [],
          });
        } catch (error) {
          reports.push({
            query: query.query,
            provider,
            ok: false,
            rawJobs: 0,
            normalized: 0,
            duplicates: 0,
            newJobs: 0,
            errors: [
              {
                errorCode: error.code || "DISCOVERY_FAILED",
                humanMessage: String(error.message).slice(0, 300),
              },
            ],
          });
        }
      }
    return {
      activatedSchedule: false,
      preview,
      queryPlan,
      reports,
      summary: {
        queries: queries.length,
        providers: providers.length,
        rawJobs: reports.reduce((n, item) => n + item.rawJobs, 0),
        normalized: reports.reduce((n, item) => n + item.normalized, 0),
        duplicates: reports.reduce((n, item) => n + item.duplicates, 0),
        newJobs: reports.reduce((n, item) => n + item.newJobs, 0),
        errors: reports.reduce((n, item) => n + item.errors.length, 0),
      },
    };
  }

  prepareManual(
    input = {},
    {
      profileId = "job-hunt-profile-discovery-v4",
      priorityThreshold = 85,
      now = new Date(),
    } = {},
  ) {
    const current = this.store.jobHuntProfiles.findById(profileId) || {},
      profile = normalizeJobHuntProfile(
        { ...input, enabled: false, massHunt: true },
        current,
      );
    if (!profile.queries.length && !profile.jobFamilies.length)
      throw Object.assign(
        new Error("Informe ao menos uma família de cargos ou termo adicional."),
        { code: "JOB_HUNT_QUERY_REQUIRED" },
      );
    if (
      !profile.providers.length &&
      !profile.sourcePreferences.includes("monitored_companies")
    )
      throw Object.assign(new Error("Selecione ao menos uma fonte real."), {
        code: "JOB_HUNT_SOURCE_REQUIRED",
      });
    if (!profile.allowedEligibility.length)
      profile.allowedEligibility = [
        "ELIGIBLE",
        "ELIGIBLE_WITH_WARNINGS",
        "REVIEW_REQUIRED",
      ];
    let saved = this.store.jobHuntProfiles.save({
        ...profile,
        id: profileId,
        name: profile.name || "Mass Hunt manual",
        enabled: false,
      }),
      expanded = this.saveSearchIntent(saved);
    saved = this.store.jobHuntProfiles.save({
      ...saved,
      searchIntentVersion: expanded.intent.version,
    });
    this.transientProviderTargets.set(saved.id, profile.providerTargets || []);
    return { profile: saved, runOptions: { triggerType: "MANUAL", now, priorityThreshold } };
  }

  async runManual(input = {}, options = {}) {
    const prepared = this.prepareManual(input, options);
    return this.run(prepared.profile.id, prepared.runOptions);
  }

  queueManual(input = {}, options = {}) {
    const prepared = this.prepareManual(input, options);
    return this.queue(prepared.profile.id, prepared.runOptions);
  }

  queue(profileId, options = {}) {
    const profile = this.store.jobHuntProfiles.findById(profileId);
    if (!profile) throw Object.assign(new Error("Perfil de busca não encontrado."), { code: "JOB_HUNT_PROFILE_NOT_FOUND" });
    const activeRun = this.store.jobHuntRuns.active?.(profileId)?.[0];
    if (activeRun || this.running.has(profileId))
      return activeRun
        ? { ...activeRun, reused: true, reason: "ALREADY_RUNNING" }
        : { status: "SKIPPED", reason: "ALREADY_RUNNING", profileId };
    const run = this.store.jobHuntRuns.start(profileId, options.triggerType || "MANUAL");
    this.running.add(profileId);
    setImmediate(() => {
      this.run(profileId, { ...options, prestartedRun: run, reserved: true }).catch((error) => {
        const current = this.store.jobHuntRuns.findById(run.id);
        if (current?.status === "RUNNING") this.store.jobHuntRuns.finish(run.id, { status: "FAILED", errorCode: error.code || "JOB_HUNT_FAILED", report: { message: "A execução assíncrona falhou antes de iniciar o pipeline." } });
        this.running.delete(profileId);
      });
    });
    return run;
  }

  async run(
    profileId,
    { triggerType = "MANUAL", now = new Date(), priorityThreshold = 85, prestartedRun = null, reserved = false } = {},
  ) {
    const storedProfile = this.store.jobHuntProfiles.findById(profileId);
    const profile = storedProfile
      ? {
          ...storedProfile,
          providerTargets:
            this.transientProviderTargets.get(profileId) ||
            storedProfile.providerTargets ||
            [],
        }
      : null;
    if (!profile)
      throw Object.assign(new Error("Perfil de busca não encontrado."), {
        code: "JOB_HUNT_PROFILE_NOT_FOUND",
      });
    if (triggerType === "SCHEDULED" && !profile.enabled)
      return { status: "SKIPPED", reason: "PROFILE_DISABLED" };
    const persistedRun = !reserved
      ? this.store.jobHuntRuns.active?.(profileId)?.[0]
      : null;
    if ((this.running.has(profileId) || persistedRun) && !reserved)
      return persistedRun
        ? { ...persistedRun, reused: true, reason: "ALREADY_RUNNING" }
        : { status: "SKIPPED", reason: "ALREADY_RUNNING" };
    if (!reserved) this.running.add(profileId);
    const run = prestartedRun || this.store.jobHuntRuns.start(profileId, triggerType),
      automation = this.store.automationRuns.start(
        "JOB_HUNT",
        profileId,
        "DISCOVERY",
      );
    const logBase = { runId: run.id, profileId, category: "DISCOVERY" },
      recordLog = (event) =>
        this.store.structuredLogs?.recordMany([{ ...logBase, ...event }]);
    recordLog({
      event: "DISCOVERY_RUN_STARTED",
      message: "Execução de descoberta iniciada.",
      status: "RUNNING",
    });
    this.eventBus?.emit("JOB_HUNT_STARTED", {
      jobHuntRunId: run.id,
      profileId,
      triggerType,
    });
    const startedAt = Date.now(),
      stats = {
        discoveryRunIds: [],
        discoveredCount: 0,
        matchedCount: 0,
        matchEvaluatedCount: 0,
        filteredOutCount: 0,
        priorityCount: 0,
        needsReviewCount: 0,
        preMatchEvaluatedCount: 0,
        passedPreMatchCount: 0,
        preMatchReviewCount: 0,
        roleMismatchCount: 0,
        locationMismatchCount: 0,
        seniorityMismatchCount: 0,
        staleCount: 0,
        nonJobCount: 0,
        riskyCount: 0,
        alertCount: 0,
        digestCount: 0,
        resumePreparationCount: 0,
        queryCount: 0,
        providerCount: 0,
        requestCount: 0,
        rawCount: 0,
        canonicalCount: 0,
        duplicateCount: 0,
        closedCount: 0,
        potentialMatchCount: 0,
        highMatchCount: 0,
        durationMs: 0,
        errors: [],
        budgetSkippedRequestCount: 0,
      };
    try {
      const jobs = [],
        providers = profile.providers.length ? profile.providers : ["jobspy"],
        providerMetrics = new Map(
          providers.map((provider) => [
            provider,
            {
              executionMode: "MASS",
              sourceClass: providerSourceClass(provider),
              provider,
              status: "BUDGET_SKIPPED",
              requested: true,
              called: false,
              requestCount: 0,
              rawResults: 0,
              candidateResults: 0,
              newResults: 0,
              duplicates: 0,
              sites: [],
              errors: [],
            },
          ]),
        ),
        intent = this.store.searchIntents?.forProfile(profileId),
        storedQueries = intent
          ? this.store.expandedQueries.forIntent(intent.id, intent.version)
          : [],
        previewInput = intent?.originalIntent || {
          name: profile.name,
          families: profile.jobFamilies,
          customTerms: profile.queries,
          seniorities: profile.seniorities,
          locationPolicy: profile.locationPolicy,
        },
        generatedQueries = this.searchIntent.preview(
          previewInput,
          profile.queryBudget,
        ).candidates,
        storedFamilies = new Set(
          storedQueries.map((item) => item.familyId).filter(Boolean),
        ),
        missingStoredFamilies = new Set(
          (previewInput.families || []).filter(
            (familyId) => !storedFamilies.has(familyId),
          ),
        ),
        preview = storedQueries.length
          ? [
              ...storedQueries,
              ...generatedQueries.filter((item) =>
                missingStoredFamilies.has(item.familyId),
              ),
            ]
          : generatedQueries,
        plannerState = this.store.discoveryQueryPlannerState?.get(profileId),
        queryPlan = this.queryPlanner.plan({
          intent: intent?.originalIntent || {
            families: profile.jobFamilies,
            customTerms: profile.queries,
          },
          candidates: preview,
          budget: profile.queryBudget,
          state: plannerState,
          intentVersion: intent?.version || profile.searchIntentVersion,
        }),
        queryDetails = queryPlan.selected,
        queries = queryDetails.map((item) => item.query),
        locations = [
          ...new Set(
            (profile.locationPolicy.priorities || [])
              .map((item) =>
                item.workModel === "REMOTE"
                  ? item.remoteScope || item.location || "Portugal"
                  : item.location,
              )
              .filter(Boolean),
          ),
        ],
        effectiveLocations = locations.length
          ? locations
          : profile.locations.length
            ? profile.locations
            : ["Portugal"],
        sites = aggregatorSites(profile),
        requestFingerprints = new Set(),
        preMatchDecisions = [],
        opportunityDecisions = new Map();
      let completedRequestCount = 0;
      const recentDiscoveries = () => [
        ...new Map(
          [...jobs].reverse().map((job) => [
            job.canonicalKey || job.id || `${job.company}:${job.title}:${job.location}`,
            {
              id: job.id || "",
              title: String(job.title || "Oportunidade").slice(0, 180),
              company: String(job.company || "Empresa não informada").slice(0, 140),
              location: String(job.location || "Local não informado").slice(0, 140),
              source: String(job.discoveredVia || job.source || job.provider || "fonte").slice(0, 80),
            },
          ]),
        ).values(),
      ].slice(0, 6);
      const persistProgress = (stage) => {
        this.assertRunActive(run.id);
        stats.durationMs = Date.now() - startedAt;
        this.store.jobHuntRuns.progress?.(run.id, {
          ...stats,
          report: {
            progress: { stage, plannedQueries: queryDetails.length, completedRequests: completedRequestCount, totalRequests: stats.requestCount, partialDiscoveredCount: stats.rawCount, partialCanonicalCount: stats.canonicalCount, recentDiscoveries: recentDiscoveries() },
            sourceReports: [...providerMetrics.values()],
            errors: stats.errors,
          },
        });
      };
      stats.queryCount = queries.length;
      stats.providerCount = providers.length;
      persistProgress("PLANNED");
      this.store.structuredLogs?.recordMany(
        queryDetails.map((item) => ({
          ...logBase,
          event: "QUERY_PLANNED",
          message: "Consulta planejada para execução.",
          query: item.query,
          source: item.geographySurface,
          status: "PLANNED",
          metadata: {
            familyId: item.familyId,
            geographySurface: item.geographySurface,
            workModel: item.workModel,
            location: item.location,
          },
        })),
      );
      const discover = async (input) => {
        this.assertRunActive(run.id);
        const provider = input.providers?.[0] || "unknown",
          metrics = providerMetrics.get(provider) || {
            executionMode: "MASS",
            sourceClass: providerSourceClass(provider),
            provider,
            status: "BUDGET_SKIPPED",
            requested: true,
            called: false,
            requestCount: 0,
            rawResults: 0,
            candidateResults: 0,
            newResults: 0,
            duplicates: 0,
            sites: [],
            errors: [],
          };
        providerMetrics.set(provider, metrics);
        const structuredTarget = provider !== "jobspy" && input.organizationKey,
          requestKey = structuredTarget
            ? `${provider}:${input.organizationKey}`
            : `${provider}:${input.query}:${input.location}:${input.geographySurface || ""}`;
        if (requestFingerprints.has(requestKey)) return;
        requestFingerprints.add(requestKey);
        if(structuredTarget)input.queryProvenance={...(input.queryProvenance||{}),query:"",source:"ATS_BOARD_LIST",reason:"Board completo; query não aplicada pelo provider"};
        if (
          stats.requestCount >= profile.queryBudget.maxRequests ||
          metrics.requestCount >= profile.queryBudget.maxQueriesPerProvider
        ) {
          stats.budgetSkippedRequestCount++;
          return;
        }
        stats.requestCount++;
        metrics.called = true;
        metrics.requestCount++;
        recordLog({
          event: "QUERY_EXECUTION_STARTED",
          message: "Execução da consulta iniciada.",
          query: input.query,
          provider,
          source: input.geographySurface,
          status: "RUNNING",
          metadata: {
            geographySurface: input.geographySurface,
            location: input.location,
            remote: input.remote,
            country: input.country,
          },
        });
        recordLog({
          event: "PROVIDER_REQUEST_STARTED",
          message: "Requisição ao provider iniciada.",
          query: input.query,
          provider,
          source: input.geographySurface,
          status: "RUNNING",
        });
        if (provider === "jobspy")
          this.store.structuredLogs?.recordMany(
            sites.map((site) => ({
              ...logBase,
              event: "PORTAL_REQUEST_STARTED",
              message: "Consulta isolada ao portal iniciada.",
              query: input.query,
              provider,
              source: site,
              status: "RUNNING",
              metadata: {
                geographySurface: input.geographySurface,
                location: input.location,
                remote: input.remote,
              },
            })),
          );
        try {
          const result = await this.discoveryService.discover({
            ...input,
            sites,
            limit: 50,
            queryProvenance: input.queryProvenance || null,
          });
          this.assertRunActive(run.id);
          stats.discoveryRunIds.push(result.run.id);
          stats.discoveredCount += result.discoveredCount;
          stats.rawCount += result.discoveredCount;
          stats.duplicateCount += result.duplicateCount || 0;
          stats.closedCount += result.closedCount || 0;
          jobs.push(...result.jobs);
          metrics.rawResults += Number(result.discoveredCount || 0);
          metrics.candidateResults += Number(result.jobs?.length || 0);
          metrics.newResults += Number(result.newCount || 0);
          metrics.duplicates += Number(result.duplicateCount || 0);
          for(const sourceReport of result.sourceReports||[])for(const site of sourceReport.sites||[])metrics.sites.push(site);
          const portalReports=(result.sourceReports||[]).flatMap(item=>item.sites||[]);
          this.store.structuredLogs?.recordMany(portalReports.map(site=>({
            ...logBase,
            event: site.status === "SUCCESS" || site.status === "NO_RESULTS" ? "PORTAL_REQUEST_SUCCEEDED" : site.status === "TIMED_OUT" ? "PORTAL_REQUEST_TIMED_OUT" : site.status === "RATE_LIMITED" ? "PORTAL_REQUEST_RATE_LIMITED" : "PORTAL_REQUEST_FAILED",
            message: site.message || "Consulta ao portal concluída.",
            query: site.query || input.query,
            provider,
            source: site.site || site.source,
            status: site.status,
            durationMs: site.durationMs,
            resultCount: site.acceptedResults,
            reasonCode: site.errorCode,
            metadata: { geographySurface: input.geographySurface, location: input.location, remote: input.remote },
          })));
          const providerErrors = (result.sourceReports || [])
            .filter((item) =>
              ["ERROR", "UNSUPPORTED", "OFFLINE", "FAILED", "TIMED_OUT", "RATE_LIMITED"].includes(item.status),
            )
            .map((item) => ({
              errorCode: item.errorCode || item.status || "DISCOVERY_FAILED",
            }));
          metrics.errors.push(...providerErrors);
          metrics.errors.push(...portalReports.filter(item=>["FAILED","TIMED_OUT","RATE_LIMITED"].includes(item.status)).map(item=>({errorCode:item.errorCode||item.status})));
          if(portalReports.some(item=>["FAILED","TIMED_OUT","RATE_LIMITED"].includes(item.status)))stats.errors.push({stage:"PORTAL_DISCOVERY",providers:input.providers,errorCode:"PARTIAL_PORTAL_FAILURE"});
          metrics.status = metrics.errors.length
            ? result.jobs?.length
              ? "PARTIAL"
              : "ERROR"
            : "CONSULTED";
          if (!result.ok)
            stats.errors.push({
              stage: "DISCOVERY",
              providers: input.providers,
              errorCode: "PARTIAL_PROVIDER_FAILURE",
            });
          recordLog({event:"PROVIDER_REQUEST_COMPLETED",message:"Requisição ao provider concluída.",query:input.query,provider,source:input.geographySurface,status:metrics.status,resultCount:result.discoveredCount,durationMs:(result.sourceReports||[]).reduce((total,item)=>total+Number(item.durationMs||0),0)});
          recordLog({event:"QUERY_EXECUTION_COMPLETED",message:"Execução da consulta concluída.",query:input.query,provider,source:input.geographySurface,status:metrics.status,resultCount:result.jobs?.length||0});
        } catch (error) {
          if (error.code === "USER_PAUSED") throw error;
          metrics.status = "ERROR";
          metrics.errors.push({
            errorCode: error.code || "DISCOVERY_FAILED",
          });
          stats.errors.push({
            stage: "DISCOVERY",
            providers: input.providers,
            errorCode: error.code || "DISCOVERY_FAILED",
          });
          recordLog({event:"PROVIDER_REQUEST_COMPLETED",level:"ERROR",message:"Requisição ao provider falhou.",query:input.query,provider,source:input.geographySurface,status:"FAILED",reasonCode:error.code||"DISCOVERY_FAILED"});
          recordLog({event:"QUERY_EXECUTION_COMPLETED",level:"ERROR",message:"Execução da consulta falhou.",query:input.query,provider,source:input.geographySurface,status:"FAILED",reasonCode:error.code||"DISCOVERY_FAILED"});
        }
        completedRequestCount++;
        persistProgress("DISCOVERY");
      };
      const requestGroups=[];
      for (const queryDetail of queryDetails){
        this.assertRunActive(run.id);
        const requests=[];
        for (const location of [queryDetail.location||effectiveLocations[0]])
          for (const provider of providers) {
            const configuration =
                this.store.providerConfigurations?.get(provider),
              configuredIdentity =
                configuration?.enabled === false
                  ? null
                  : configuration?.identity,
              targets = rotateProviderTargets((profile.providerTargets || []).filter(
                (item) => item.provider === provider,
              ),Number(plannerState?.round||0)*Math.max(1,profile.queryBudget.maxQueriesPerProvider)),
              identities = targets.length
                ? targets
                : [configuredIdentity || {}];
            for (const identity of identities)
              requests.push({
                query: queryDetail.query,
                location,
                geographySurface: queryDetail.geographySurface || "",
                workModel: queryDetail.workModel || "",
                remote:
                  queryDetail.workModel === "REMOTE" ||
                  queryDetail.geographySurface.startsWith("REMOTE_"),
                country: queryDetail.country || "Portugal",
                remoteScope: queryDetail.remoteScope || "",
                providers: [provider],
                organizationKey: String(identity?.organizationKey || ""),
                company: identity?.company || "",
                queryProvenance: {
                  query: queryDetail.query,
                  tier: queryDetail.tier || "TIER_2",
                  reason: queryDetail.reason || "",
                  source: queryDetail.source || "",
                  familyId: queryDetail.familyId || "",
                  priority: queryDetail.priority,
                  selectionReason: queryDetail.selectionReason,
                  round: queryDetail.round,
                  rotationIndex: queryDetail.rotationIndex,
                  geographySurface: queryDetail.geographySurface||"",
                },
              });
          }
        requestGroups.push(requests);
      }
      const scheduledRequests=fairRequestSchedule(requestGroups);
      for(const request of scheduledRequests)await discover(request);
      this.store.discoveryQueryPlannerState?.save({profileId,...queryPlan.nextState});
      if (
        profile.sourcePreferences.includes("monitored_companies") ||
        profile.companyWatchlistIds.length
      )
        for (const watchlistId of profile.companyWatchlistIds) {
          this.assertRunActive(run.id);
          const watchlist = this.store.watchlists
            .all()
            .find((item) => item.id === watchlistId);
          for (const board of this.store.watchlists
            .boards()
            .filter(
              (item) =>
                item.watchlistId === watchlistId && item.enabled !== false,
            ))
            await discover({
              query: queries[0] || profile.queries[0],
              location: effectiveLocations[0],
              geographySurface: queryDetails[0]?.geographySurface || "",
              workModel: queryDetails[0]?.workModel || "",
              remote:
                queryDetails[0]?.workModel === "REMOTE" ||
                queryDetails[0]?.geographySurface?.startsWith("REMOTE_"),
              country: queryDetails[0]?.country || "Portugal",
              remoteScope: queryDetails[0]?.remoteScope || "",
              providers: [board.provider],
              organizationKey: board.organizationKey,
              company: watchlist?.name || board.company || "",
              queryProvenance: queryDetails[0] || null,
            });
        }
      const canonicalJobs = uniqueById(jobs);
      stats.canonicalCount = canonicalJobs.length;
      recordLog({event:"NORMALIZATION_COMPLETED",message:"Normalização das descobertas concluída.",status:"COMPLETED",resultCount:stats.rawCount});
      recordLog({event:"DEDUPLICATION_COMPLETED",message:"Deduplicação das oportunidades concluída.",status:"COMPLETED",resultCount:stats.canonicalCount,metadata:{duplicates:stats.duplicateCount}});
      persistProgress("MATCHING");
      const candidateProfile = await this.profileProvider(),
        storedResumes = this.store.resumes.allActive?.() || this.store.resumes.all(),
        defaultResumeId = this.store.database.getMetadata?.(
          "default_resume_id",
          "",
        ),
        resumes = storedResumes.length
          ? storedResumes
          : [{ id: null, text: "", sections: {} }],
        relevant = [];
      for (let jobIndex = 0; jobIndex < canonicalJobs.length; jobIndex++) {
        if (jobIndex && jobIndex % 10 === 0)
          await new Promise((resolve) => setImmediate(resolve));
        this.assertRunActive(run.id);
        const job = canonicalJobs[jobIndex];
        const preMatch = this.preMatch.evaluate(job, {
          families: profile.jobFamilies,
          seniorities: profile.seniorities,
          locationPolicy: profile.locationPolicy,
        });
        stats.preMatchEvaluatedCount++;
        if (preMatch.decision === "REVIEW") stats.preMatchReviewCount++;
        if (preMatch.decision !== "REJECT") stats.passedPreMatchCount++;
        const reasonCounter = {
          ROLE_FAMILY_MISMATCH: "roleMismatchCount",
          LOCATION_MISMATCH: "locationMismatchCount",
          FOREIGN_LOCATION: "locationMismatchCount",
          OUTSIDE_ACCEPTED_REGION: "locationMismatchCount",
          LOCATION_CONFLICT: "locationMismatchCount",
          WORK_MODEL_MISMATCH: "locationMismatchCount",
          SENIORITY_MISMATCH: "seniorityMismatchCount",
          STALE: "staleCount",
          NON_JOB_CONTENT: "nonJobCount",
          JOB_CLOSED: "closedCount",
        };
        for (const reason of preMatch.reasons)
          if (reasonCounter[reason]) stats[reasonCounter[reason]]++;
        preMatchDecisions.push(serializePreMatchDecision(preMatch,{
          jobId:job.id,
          profileId,
          searchIntentId:intent?.id,
          searchIntentVersion:intent?.version||profile.searchIntentVersion,
          jobHuntRunId:run.id,
          queryProvenance:
            job.provenance?.discoveryQuery?.source === "ATS_BOARD_LIST"
              ? { ...job.provenance.discoveryQuery, query: "" }
              : job.provenance?.discoveryQuery || null,
        }));
        if (preMatch.decision === "REJECT") {
          opportunityDecisions.set(job.id,evaluateOpportunityDecision({job,preMatch,policies:[profile],intent}));
          stats.filteredOutCount++;
          continue;
        }
        if (
          this.store.applications.all().some((item) => item.jobId === job.id)
        ) {
          stats.filteredOutCount++;
          continue;
        }
        stats.potentialMatchCount++;
        let best = null,
          preferred = null;
        for (let resumeIndex = 0; resumeIndex < resumes.length; resumeIndex++) {
          if (resumeIndex % 2 === 0)
            await new Promise((resolve) => setImmediate(resolve));
          this.assertRunActive(run.id);
          const resume = resumes[resumeIndex];
          const analysis = this.matcher({
            job,
            profile: candidateProfile,
            resume,
          });
          stats.matchEvaluatedCount++;
          this.store.analyses.upsert(analysis);
          this.store.jobRequirements.syncForJob(
            job.id,
            analysis.requirements || [],
          );
          this.store.analysisItems.syncForAnalysis(
            analysis.id,
            analysis.items || [],
          );
          if (!best || analysis.overallScore > best.analysis.overallScore)
            best = { resume, analysis };
          if (resume.id && resume.id === defaultResumeId)
            preferred = { resume, analysis };
        }
        const selected = preferred || best;
        if (!selected) continue;
        const { analysis, resume } = selected,
          feedback = this.store.jobFeedback.forJob(job.id),
          priority = calculateOpportunityPriority({
            job,
            analysis,
            requirements: analysis.requirements || [],
            items: analysis.items || [],
            profile: candidateProfile,
            jobHuntPolicies: [profile],
            feedback,
          }),
          technicalMatch = Number(analysis.overallScore ?? analysis.score ?? 0),
          coverage = Number(analysis.evidenceCoverage ?? 100),
          confidence = Number(
            analysis.matchConfidence ?? priority.components.confidence ?? 100,
          );
        opportunityDecisions.set(job.id,evaluateOpportunityDecision({job,analysis,preMatch,requirements:analysis.requirements||[],items:analysis.items||[],feedback,priority,policies:[profile],intent}));
        const thresholdDecision = classifyThresholdScore(
          {
            technicalMatch,
            opportunityPriority: priority.score,
            evidenceCoverage: coverage,
            confidence,
          },
          { consider: profile.considerThreshold, priority: priorityThreshold },
        );
        if (
          thresholdDecision.filtered ||
          !profile.allowedEligibility.includes(analysis.eligibility) ||
          analysis.blockingIssues.length
        ) {
          stats.filteredOutCount++;
          continue;
        }
        stats.matchedCount++;
        if (thresholdDecision.priority) stats.priorityCount++;
        if (
          analysis.unknownRequirements?.length ||
          analysis.eligibility === "UNKNOWN"
        )
          stats.needsReviewCount++;
        if (["RISKY", "REVIEW_REQUIRED"].includes(job.riskState))
          stats.riskyCount++;
        const item = {
          job,
          analysis,
          resume,
          priority,
          resumeVersionId: "",
          tailoringRunId: "",
          resumeErrorCode: "",
        };
        if (
          profile.prepareResume &&
          resume.id &&
          technicalMatch >= profile.prepareResumeThreshold &&
          coverage >= 50 &&
          confidence >= 40 &&
          this.prepareResume
        ) {
          try {
            const prepared = await this.prepareResume(item);
            this.assertRunActive(run.id);
            if (!["REVIEW_REQUIRED", "READY"].includes(prepared?.status))
              throw Object.assign(
                new Error("Preparação automática deve exigir revisão."),
                { code: "AUTOMATION_REVIEW_REQUIRED" },
              );
            item.resumeVersionId =
              prepared.resumeVersionId ||
              (prepared.kind === "VERSION" ? prepared.id : "") ||
              "";
            item.tailoringRunId =
              prepared.tailoringRunId ||
              (prepared.kind === "TAILORING" ? prepared.id : "") ||
              "";
            item.resumeStatus = prepared.status;
            stats.resumePreparationCount++;
          } catch (error) {
            if (error.code === "USER_PAUSED") throw error;
            item.resumeErrorCode = error.code || "RESUME_PREPARATION_FAILED";
            this.eventBus?.emit("JOB_HUNT_RESUME_PREPARATION_FAILED", {
              jobId: job.id,
              profileId,
              errorCode: item.resumeErrorCode,
            });
          }
        }
        relevant.push({ ...item, technicalMatch, coverage, confidence });
      }
      recordLog({event:"PREMATCH_COMPLETED",message:"Pré-match determinístico concluído.",status:"COMPLETED",resultCount:stats.passedPreMatchCount,metadata:{evaluated:stats.preMatchEvaluatedCount,rejected:stats.filteredOutCount}});
      recordLog({event:"DECISION_COMPLETED",message:"Decisões de oportunidade concluídas.",status:"COMPLETED",resultCount:relevant.length});
      persistProgress("DECISION");
      const notify = relevant.filter(
          (item) => item.priority.score >= profile.notifyThreshold,
        ),
        instant = notify.slice(0, profile.notificationPolicy.maxInstantAlerts),
        digest = notify.slice(profile.notificationPolicy.maxInstantAlerts);
      stats.highMatchCount = notify.length;
      for (const item of instant) {
        this.assertRunActive(run.id);
        const key = fingerprint({
          profileId,
          jobId: item.job.id,
          contentHash: item.job.contentHash,
          status: item.job.lifecycleStatus,
          eventType: "JOB_HIGH_MATCH",
        });
        const existingAlert = this.store.jobAlerts.findFingerprint(key);
        if (existingAlert) {
          if (this.requestApproval && existingAlert.status !== "SENT" && item.resumeVersionId && item.resumeStatus === "READY") {
            try {
              const approval = await this.requestApproval({ ...item, profileId, jobHuntRunId: run.id, jobAlertId: existingAlert.id });
              if (approval?.handled === true || approval?.sent === true) {
                this.store.jobAlerts.mark(existingAlert.id, "SENT");
                stats.alertCount++;
              }
            } catch (error) {
              this.store.structuredLogs?.record({category:"AUTOMATION",level:"WARN",eventCode:"WHATSAPP_APPROVAL_RETRY_FAILED",jobId:item.job.id,resumeVersionId:item.resumeVersionId,errorCode:error.code||"WHATSAPP_APPROVAL_RETRY_FAILED",metadata:{jobHuntRunId:run.id}});
            }
          }
          continue;
        }
        const payload = {
          jobId: item.job.id,
          profileId,
          jobHuntRunId: run.id,
          fitScore: item.analysis.overallScore,
          opportunityPriority: item.priority.score,
          eligibility: item.analysis.eligibility,
          title: item.job.title,
          company: item.job.company,
          location: item.job.location,
          workModel: item.job.workModel || "",
          applicationMethod: item.job.applicationMethod || "UNKNOWN",
          applicationUrl: item.job.applicationUrl || item.job.url,
          deepLink: `/?view=opportunities&job=${encodeURIComponent(item.job.id)}`,
          resumeVersionId: item.resumeVersionId,
          tailoringRunId: item.tailoringRunId,
          resumeStatus: item.resumeStatus || (item.resumeVersionId || item.tailoringRunId ? "REVIEW_REQUIRED" : ""),
          resumeErrorCode: item.resumeErrorCode,
        };
        const quiet = isQuietHours(profile.notificationPolicy, now),
          alert = this.store.jobAlerts.create({
            profileId,
            runId: run.id,
            jobId: item.job.id,
            notificationFingerprint: key,
            eventType: "JOB_HIGH_MATCH",
            status: quiet ? "QUIET_HOURS" : "QUEUED",
            payload,
          });
        if (!quiet) {
          let approvalSent = false;
          if (this.requestApproval && item.resumeVersionId && item.resumeStatus === "READY") {
            try {
              const approval = await this.requestApproval({ ...item, profileId, jobHuntRunId: run.id, jobAlertId: alert.id });
              approvalSent = approval?.handled === true || approval?.sent === true;
              if (approvalSent) this.store.jobAlerts.mark(alert.id, "SENT");
            } catch (error) {
              this.store.structuredLogs?.record({category:"AUTOMATION",level:"WARN",eventCode:"WHATSAPP_APPROVAL_PREPARATION_FAILED",jobId:item.job.id,resumeVersionId:item.resumeVersionId,errorCode:error.code||"WHATSAPP_APPROVAL_PREPARATION_FAILED",metadata:{jobHuntRunId:run.id}});
            }
          }
          if (!approvalSent) this.eventBus?.emit("JOB_HIGH_MATCH", { ...payload, jobAlertId: item.resumeVersionId ? "" : alert.id });
          stats.alertCount++;
        } else
          this.eventBus?.emit("JOB_ALERT_DEFERRED", {
            jobId: item.job.id,
            profileId,
            jobAlertId: alert.id,
            reason: "QUIET_HOURS",
          });
      }
      if (digest.length && profile.notificationPolicy.digestEnabled) {
        this.assertRunActive(run.id);
        const ids = digest.map((item) => item.job.id),
          key = fingerprint({
            profileId,
            ids,
            eventType: "JOB_MATCH_DIGEST_READY",
          });
        if (!this.store.jobAlerts.findFingerprint(key)) {
          const first = digest[0],
            payload = {
              jobId: first.job.id,
              profileId,
              jobHuntRunId: run.id,
              matchCount: digest.length,
              jobIds: ids.slice(0, 20),
              topScore: first.priority.score,
            };
          const quiet = isQuietHours(profile.notificationPolicy, now),
            alert = this.store.jobAlerts.create({
              profileId,
              runId: run.id,
              jobId: first.job.id,
              notificationFingerprint: key,
              eventType: "JOB_MATCH_DIGEST_READY",
              status: quiet ? "QUIET_HOURS" : "QUEUED",
              payload,
            });
          if (!quiet)
            this.eventBus?.emit("JOB_MATCH_DIGEST_READY", {
              ...payload,
              jobAlertId: alert.id,
            });
          else
            this.eventBus?.emit("JOB_ALERT_DEFERRED", {
              jobId: first.job.id,
              profileId,
              jobAlertId: alert.id,
              reason: "QUIET_HOURS",
            });
          stats.digestCount = 1;
        }
      }
      stats.durationMs = Date.now() - startedAt;
      const decisionCount=disposition=>[...opportunityDecisions.values()].filter(item=>item.disposition===disposition).length;
      const humanDiscoveryCount=["STRETCH","REVIEW","RECOMMENDED","PREPARE_ELIGIBLE"].reduce((total,disposition)=>total+decisionCount(disposition),0);
      const funnel = {
        rawDiscoveries: stats.rawCount,
        normalizedDiscoveries: stats.rawCount,
        candidateDiscoveries: stats.rawCount,
        hiringRelevantSignals: 0,
        opportunityLeads: 0,
        hiringSignals: 0,
        duplicates: stats.duplicateCount,
        canonicalOpportunities: stats.canonicalCount,
        preMatchEvaluated: stats.preMatchEvaluatedCount,
        roleMismatch: stats.roleMismatchCount,
        locationMismatch: stats.locationMismatchCount,
        seniorityMismatch: stats.seniorityMismatchCount,
        stale: stats.staleCount,
        nonJob: stats.nonJobCount,
        passedPreMatch: stats.passedPreMatchCount,
        filteredOut: stats.filteredOutCount,
        matchEvaluated: stats.matchEvaluatedCount,
        relevantOpportunities: humanDiscoveryCount,
        humanDiscoveryOpportunities: humanDiscoveryCount,
        automationEligibleOpportunities: relevant.length,
        priorityOpportunities: stats.priorityCount,
        needsReview: stats.needsReviewCount + stats.preMatchReviewCount,
        decisionBlocked: decisionCount("BLOCKED"),
        decisionSkipped: decisionCount("SKIP"),
        decisionStretch: decisionCount("STRETCH"),
        decisionReview: decisionCount("REVIEW"),
        decisionRecommended: decisionCount("RECOMMENDED"),
        decisionPrepareEligible: decisionCount("PREPARE_ELIGIBLE"),
        risky: stats.riskyCount,
        errors: stats.errors.length,
      };
      const sourceReports = [...providerMetrics.values()];
      const executedProviderRequests=sourceReports.reduce((total,item)=>total+item.requestCount,0),potentialProviderRequests=queryDetails.length*providers.length,coverage={
        familyCoverage:{covered:[...new Set(queryDetails.map(item=>item.familyId).filter(Boolean))].length,total:[...new Set(profile.jobFamilies||[])].length},
        geographyCoverage:{covered:[...new Set(queryDetails.map(item=>item.geographySurface).filter(Boolean))].length,total:[...new Set(queryPlan.geographySurfaces||[])].length},
        queryCombinationCoverage:{covered:queryDetails.length,total:queryPlan.requiredCombinationCount||queryDetails.length},
        providerCoverage:{attempted:sourceReports.filter(item=>item.called).length,total:providers.length},
        providerQueryCoverage:{executed:executedProviderRequests,potential:potentialProviderRequests,budgetSkipped:Math.max(0,potentialProviderRequests-executedProviderRequests)},
        requestBudgetUtilization:{used:stats.requestCount,maximum:profile.queryBudget.maxRequests,ratio:Number((stats.requestCount/Math.max(1,profile.queryBudget.maxRequests)).toFixed(3))},
      };
      const queryDiagnostics=[...new Map(preMatchDecisions.filter(item=>item.queryProvenance?.query).map(item=>[item.queryProvenance.query,[]])).keys()].map(query=>{const decisions=preMatchDecisions.filter(item=>item.queryProvenance?.query===query),rejected=decisions.filter(item=>item.decision==="REJECT").length,detail=decisions[0]?.queryProvenance||{};return {query,tier:detail.tier||"TIER_2",evaluated:decisions.length,rejected,rejectionRate:decisions.length?Number((rejected/decisions.length).toFixed(3)):0,suggestion:decisions.length>=3&&rejected/decisions.length>=.8?"Refinar ou remover esta consulta ampla":""};});
      this.assertRunActive(run.id);
      const completed = this.store.jobHuntRuns.finish(run.id, {
        ...stats,
        status: stats.errors.length ? "PARTIAL" : "COMPLETED",
        report: {
          intentVersion: profile.searchIntentVersion,
          expandedQueries: queries,
          expandedQueryDetails: queryDetails,
          queryPlanner: {
            version: queryPlan.version,
            round: queryPlan.round,
            configuredQueryBudget: queryPlan.configuredQueryBudget,
            effectiveQueryBudget: queryPlan.effectiveQueryBudget,
            requestBudget: queryPlan.requestBudget,
            coverageWindowRounds: queryPlan.coverageWindowRounds,
            requiredCombinationCount: queryPlan.requiredCombinationCount,
            geographySurfaces: queryPlan.geographySurfaces,
            coverage: queryPlan.coverage,
            cycleProgress: queryPlan.cycleProgress,
            diagnostics: queryPlan.diagnostics,
            familyOrder: queryPlan.familyOrder,
            missingFamilies: queryPlan.missingFamilies,
            previousState: plannerState ? {
              intentVersion: plannerState.intentVersion,
              round: plannerState.round,
              familyCursor: plannerState.familyCursor,
              combinationCursor: plannerState.combinationCursor,
            } : null,
            nextState: {
              intentVersion: queryPlan.nextState.intentVersion,
              round: queryPlan.nextState.round,
              familyCursor: queryPlan.nextState.familyCursor,
              combinationCursor: queryPlan.nextState.combinationCursor,
            },
          },
          providers,
          queryBudget: profile.queryBudget,
          coverage,
          rawCount: stats.rawCount,
          canonicalCount: stats.canonicalCount,
          relevantCount: humanDiscoveryCount,
          humanDiscoveryCount,
          automationEligibleCount: relevant.length,
          notifyCount: notify.length,
          priorityThreshold,
          funnel,
          preMatchDecisions: preMatchDecisions.slice(0, 1000),
          opportunityDecisionCounts: Object.fromEntries(["BLOCKED","SKIP","STRETCH","REVIEW","RECOMMENDED","PREPARE_ELIGIBLE"].map(disposition=>[disposition,decisionCount(disposition)])),
          filterReasons: {
            roleMismatch: stats.roleMismatchCount,
            locationMismatch: stats.locationMismatchCount,
            seniorityMismatch: stats.seniorityMismatchCount,
            stale: stats.staleCount,
            nonJob: stats.nonJobCount,
            needsReview: stats.preMatchReviewCount,
          },
          queryDiagnostics,
          recentDiscoveries: recentDiscoveries(),
          sourceReports,
          errors: stats.errors,
        },
      });
      recordLog({event:"DISCOVERY_RUN_COMPLETED",message:"Execução de descoberta concluída.",status:completed.status,durationMs:stats.durationMs,resultCount:stats.canonicalCount,metadata:completed.report?.funnel||{}});
      this.store.automationRuns.finish(automation.id, { metrics: stats });
      this.store.jobHuntProfiles.markRun(profileId, {
        lastRunAt: now.toISOString(),
        nextRunAt: profile.enabled
          ? nextJobHuntRun(profile.schedule, now)
          : null,
      });
      this.eventBus?.emit("JOB_HUNT_COMPLETED", {
        jobHuntRunId: run.id,
        profileId,
        ...stats,
      });
      return completed;
    } catch (error) {
      stats.durationMs = Date.now() - startedAt;
      if (error.code === "USER_PAUSED") {
        this.store.automationRuns.finish(automation.id, {
          status: "SKIPPED",
          stage: "PAUSED",
          metrics: stats,
          errorCode: "USER_PAUSED",
        });
        return this.store.jobHuntRuns.findById(run.id);
      }
      const failed = this.store.jobHuntRuns.finish(run.id, {
        ...stats,
        status: "FAILED",
        errorCode: error.code || "JOB_HUNT_FAILED",
        report: { message: String(error.message).slice(0, 500) },
      });
      this.store.structuredLogs?.recordMany([{runId:run.id,profileId,category:"DISCOVERY",event:"DISCOVERY_RUN_FAILED",level:"ERROR",status:"FAILED",reasonCode:error.code||"JOB_HUNT_FAILED",durationMs:stats.durationMs,message:"A execução de descoberta falhou."}]);
      this.store.automationRuns.finish(automation.id, {
        status: "FAILED",
        stage: "FAILED",
        metrics: stats,
        errorCode: error.code || "JOB_HUNT_FAILED",
      });
      this.eventBus?.emit("JOB_HUNT_FAILED", {
        jobHuntRunId: run.id,
        profileId,
        errorCode: error.code || "JOB_HUNT_FAILED",
      });
      this.store.jobHuntProfiles.markRun(profileId, {
        lastRunAt: profile.lastRunAt || now.toISOString(),
        nextRunAt: profile.enabled
          ? nextJobHuntRun(profile.schedule, new Date())
          : null,
      });
      return failed;
    } finally {
      this.running.delete(profileId);
      this.transientProviderTargets.delete(profileId);
    }
  }
}
