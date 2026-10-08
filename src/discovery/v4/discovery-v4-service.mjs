import {
  hiringIntentTerms,
  HIRING_INTENT_TAXONOMY,
} from "./hiring-intent-taxonomy.mjs";
import {
  normalizeSourceClasses,
  sourceAvailability,
} from "./source-classes.mjs";
import { sourceTrust } from "./source-trust.mjs";
import { assessDiscoveryRisk } from "./risk-assessment.mjs";
import { detectHiringMessage } from "../community/hiring-message-detector.mjs";
import { jobFamilyCatalog } from "../search-intent/job-family-catalog.mjs";
import { createMassHuntFunnel } from "./mass-hunt-funnel.mjs";
import { brazilianProviderDefinitions } from "../providers/brazilian-public-providers.mjs";

const clean = (value) =>
    String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160),
  unique = (values) => [
    ...new Set(
      (Array.isArray(values) ? values : []).map(clean).filter(Boolean),
    ),
  ];
const directAts = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "gupy",
]);
const brazilianProviders = new Map(
  brazilianProviderDefinitions.map((item) => [item.providerId, item]),
);
const emptyFunnel = createMassHuntFunnel;
const add = (target, source) => {
  for (const key of Object.keys(target))
    target[key] += Number(source?.[key] || 0);
  return target;
};
const report = (sourceClass, provider, status, startedAt, extra = {}) => ({
  sourceClass,
  provider,
  status,
  queries: Number(extra.queries || 0),
  targets: Number(extra.targets || 0),
  durationMs: Date.now() - startedAt,
  rawResults: Number(extra.rawResults || 0),
  newResults: Number(extra.newResults || 0),
  duplicates: Number(extra.duplicates || 0),
  errors: Array.isArray(extra.errors) ? extra.errors : [],
  ...extra,
});

export class DiscoveryV4Service {
  constructor({
    searchIntentService,
    publicWeb,
    repository,
    jobHuntService,
    evolutionService = null,
    communityService = null,
    store = null,
    careerPageDiscovery = null,
  } = {}) {
    Object.assign(this, {
      searchIntentService,
      publicWeb,
      repository,
      jobHuntService,
      evolutionService,
      communityService,
      store,
      careerPageDiscovery,
    });
    this.capabilitiesCache = null;
  }
  capabilities() {
    const checkedAt = Date.now();
    if (
      this.capabilitiesCache &&
      checkedAt - this.capabilitiesCache.checkedAt < 60_000
    )
      return this.capabilitiesCache.value;
    const profiles=this.store?.jobHuntProfiles?.all?.()||[],activeProfile=profiles.find(item=>item.enabled)||profiles[0]||null,activeIntent=activeProfile?this.store?.searchIntents?.forProfile?.(activeProfile.id):null,
      atsTargets = this.configuredAtsTargets({}).length,
      communityOptIn = (
        this.store?.discoveryV4?.listCommunitySources?.() || []
      ).some((item) => item.enabled),
      careerTargets = (this.store?.watchlists?.all?.() || []).some(
        (item) => item.active !== false && item.careerUrl,
      ),
      classes = sourceAvailability({
        publicWebConfigured: this.publicWeb.capability().configured,
        evolutionConfigured: Boolean(
          this.evolutionService?.publicConfiguration().configured &&
            this.communityService?.configured(),
        ),
        brazilianSourcesReady: true,
      }).map((item) => ({
        ...item,
        defaultSelected:
          (item.sourceClass === "JOB_BOARD" && item.operational) ||
          (item.sourceClass === "STRUCTURED_ATS" && atsTargets > 0) ||
          (item.sourceClass === "PUBLIC_WEB" && item.operational) ||
          (item.sourceClass === "OFFICIAL_CAREER_PAGE" && careerTargets) ||
          (item.sourceClass === "COMMUNITY_WHATSAPP_GROUP" &&
            communityOptIn &&
            item.operational),
      }));
    const value = {
      taxonomyVersion: HIRING_INTENT_TAXONOMY.version,
      jobFamilies: jobFamilyCatalog.list(),
      sourceClasses: classes,
      providers: brazilianProviderDefinitions.map((item) => ({
        ...item,
        status: "READY",
        operational: true,
        defaultSelected: false,
      })),
      activeSearchIntent:activeIntent?.originalIntent||activeProfile?{
        profileId:activeProfile?.id||"",profileName:activeProfile?.name||"",families:activeIntent?.originalIntent?.families||activeProfile?.jobFamilies||[],seniorities:activeIntent?.originalIntent?.seniorities||activeProfile?.seniorities||[],locationPolicy:activeIntent?.originalIntent?.locationPolicy||activeProfile?.locationPolicy||{},queryBudget:activeProfile?.queryBudget||{},thresholds:{consider:activeProfile?.considerThreshold,prepareResume:activeProfile?.prepareResumeThreshold,notify:activeProfile?.notifyThreshold}
      }:null,
      applicationMethods: [
        "ATS",
        "EMAIL",
        "WHATSAPP",
        "DIRECT_MESSAGE",
        "EXTERNAL_FORM",
        "CAREER_PAGE",
        "MANUAL",
        "UNKNOWN",
      ],
      linkedIn: {
        status: "SUPPORTED_LIMITED",
        discovery: "JOBSPY_PUBLIC_DISCOVERY",
        manualUrl: "SUPPORTED",
        accountSession: "NOT_MANAGED",
        oauthImplemented: false,
        scraping: false,
      },
    };
    this.capabilitiesCache = { checkedAt, value };
    return value;
  }
  normalize(input = {}) {
    const consider = Math.max(
        0,
        Math.min(100, Number(input.thresholds?.consider ?? 70)),
      ),
      prepareResume = Math.max(
        consider,
        Math.min(100, Number(input.thresholds?.prepareResume ?? 82)),
      ),
      notify = Math.max(
        prepareResume,
        Math.min(100, Number(input.thresholds?.notify ?? 90)),
      ),
      priority = Math.max(
        0,
        Math.min(100, Number(input.thresholds?.priority ?? 85)),
      );
    const providers = unique(input.providers).filter((item) =>
      brazilianProviders.has(item),
    );
    const sourceClasses = normalizeSourceClasses(input.sourceClasses);
    for (const provider of providers) {
      const sourceClass = brazilianProviders.get(provider).sourceClass;
      if (!sourceClasses.includes(sourceClass)) sourceClasses.push(sourceClass);
    }
    return {
      name: clean(input.name) || "Search Composer V4.1",
      families: unique(input.families),
      customTerms: unique(input.customTerms || input.roles),
      seniorities: unique(input.seniorities),
      locationPolicy: input.locationPolicy || {},
      languages: unique(input.languages || ["pt-BR", "en"]),
      sourceClasses,
      providers,
      providerTargets: Array.isArray(input.providerTargets)
        ? input.providerTargets
        : [],
      thresholds: { consider, prepareResume, notify, priority },
      queryBudget: input.queryBudget || {},
    };
  }
  preview(input = {}) {
    const normalized = this.normalize(input);
    if (!normalized.sourceClasses.length)
      normalized.sourceClasses = ["STRUCTURED_ATS"];
    const base = this.searchIntentService.preview(
        normalized,
        normalized.queryBudget,
      ),
      roles = unique([
        ...normalized.customTerms,
        ...base.queries.map((item) => item.query),
      ]).slice(0, 12),
      locations = (normalized.locationPolicy.priorities || []).filter(
        (item) => item.accepted !== false,
      ),
      intents = hiringIntentTerms(normalized.languages).slice(0, 4),
      webQueries = [];
    for (const role of roles.slice(0, 4))
      for (const hiring of intents.slice(0, 2)) {
        const location = clean(
          locations[0]?.location || locations[0]?.remoteScope || process.env.CAREER_DEFAULT_COUNTRY || "Portugal",
        );
        webQueries.push(
          [`"${hiring}"`, role, location]
            .filter(Boolean)
            .join(" ")
            .slice(0, 400),
        );
      }
    const requested = normalized.sourceClasses,
      availability = this.capabilities().sourceClasses.filter((item) =>
        requested.includes(item.sourceClass),
      );
    return {
      intent: normalized,
      structuredQueries: base.queries,
      publicWebQueries: [...new Set(webQueries)].slice(0, 8),
      budget: base.budget,
      truncated: base.truncated,
      availability,
      summary: {
        requested: requested.length,
        operational: availability.filter((item) => item.operational).length,
        configRequired: availability.filter(
          (item) => item.status === "CONFIG_REQUIRED",
        ).length,
        unsupported: availability.filter(
          (item) => item.status === "UNSUPPORTED",
        ).length,
      },
    };
  }
  configuredAtsTargets(input = {}) {
    const activeWatchlists = new Map(
        (this.store?.watchlists?.all?.() || [])
          .filter((item) => item.active !== false)
          .map((item) => [item.id,item]),
      ),
      isConfiguredBoard = (item) =>
        Boolean(item.watchlistId) && activeWatchlists.has(item.watchlistId);
    const explicit = (input.providerTargets || [])
        .filter(
          (item) =>
            directAts.has(
              String(item.provider || item.providerId || "").toLowerCase(),
            ) && String(item.organizationKey || "").trim(),
        )
        .map((item) => ({
          provider: String(item.provider || item.providerId).toLowerCase(),
          identity: item,
        }));
    const configured = (this.store?.providerConfigurations?.all?.() || [])
        .filter(
          (item) =>
            item.enabled !== false &&
            directAts.has(item.providerId) &&
            String(item.identity?.organizationKey || "").trim(),
        )
        .map((item) => ({
          provider: item.providerId,
          identity: item.identity,
        })),
      boards = (this.store?.watchlists?.boards?.() || [])
        .filter(
          (item) =>
            isConfiguredBoard(item) &&
            item.enabled !== false &&
            directAts.has(item.provider) &&
            String(item.organizationKey || "").trim(),
        )
        .map((item) => ({
          provider: item.provider,
          priority: Number(activeWatchlists.get(item.watchlistId)?.priority||50),
          identity: {
            organizationKey: item.organizationKey,
            company: item.company,
            careerUrl: item.careerUrl,
          },
        })).sort((left,right)=>right.priority-left.priority||left.identity.company.localeCompare(right.identity.company,"pt-BR"));
    return [
      ...new Map(
        [...explicit, ...configured, ...boards].map((item) => [
          `${item.provider}:${item.identity.organizationKey}`,
          item,
        ]),
      ).values(),
    ];
  }
  searchInput(preview, providers, sourcePreferences, providerTargets = preview.intent.providerTargets) {
    return {
      name: preview.intent.name,
      queries: preview.structuredQueries.map((item) => item.query),
      jobFamilies: preview.intent.families,
      seniorities: preview.intent.seniorities,
      locationPolicy: preview.intent.locationPolicy,
      providers,
      providerTargets,
      sourcePreferences,
      workModels: unique(
        (preview.intent.locationPolicy.priorities || []).map(
          (item) => item.workModel,
        ),
      ),
      considerThreshold: preview.intent.thresholds.consider,
      prepareResumeThreshold: preview.intent.thresholds.prepareResume,
      notifyThreshold: preview.intent.thresholds.notify,
      prepareResume: true,
      allowedEligibility: [
        "ELIGIBLE",
        "ELIGIBLE_WITH_WARNINGS",
        "REVIEW_REQUIRED",
      ],
      queryBudget: preview.budget,
    };
  }
  async testProvider(preview, sourceClass, provider, target, reports, funnel) {
    const started = Date.now(),
      providerTargets =
        target && typeof target === "object" ? [{ provider, ...target }] : [];
    try {
      const result = await this.jobHuntService.testSearch({
        ...this.searchInput(
          preview,
          [provider],
          provider === "jobspy"
            ? ["indeed", "linkedin", "glassdoor", "google"]
            : [provider],
        ),
        providerTargets,
      });
      add(funnel, {
        rawDiscoveries: result.summary.rawJobs,
        candidateDiscoveries: result.summary.normalized,
        duplicates: result.summary.duplicates,
        canonicalOpportunities: result.summary.newJobs,
        errors: result.summary.errors,
      });
      reports.push(
        report(
          sourceClass,
          provider,
          result.summary.errors ? "ERROR" : "CONSULTED",
          started,
          {
            executionMode: "TEST",
            queries: result.summary.queries,
            targets: 1,
            target: target?.company || target?.organizationKey || target,
            rawResults: result.summary.rawJobs,
            newResults: result.summary.newJobs,
            duplicates: result.summary.duplicates,
            errors: result.reports.flatMap((item) => item.errors || []),
          },
        ),
      );
    } catch (error) {
      funnel.errors++;
      reports.push(
        report(sourceClass, provider, "ERROR", started, {
          targets: 1,
          target: target?.company || target?.organizationKey || target,
          errors: [
            {
              errorCode: error.code || "PROVIDER_FAILED",
              message: error.message,
            },
          ],
        }),
      );
    }
  }
  async runStructuredTest(preview, reports, funnel) {
    if (preview.intent.sourceClasses.includes("JOB_BOARD"))
      await this.testProvider(
        preview,
        "JOB_BOARD",
        "jobspy",
        "aggregators",
        reports,
        funnel,
      );
    for (const provider of preview.intent.providers) {
      const definition = brazilianProviders.get(provider);
      if (!definition || !preview.intent.sourceClasses.includes(definition.sourceClass)) continue;
      await this.testProvider(
        preview,
        definition.sourceClass,
        provider,
        "public-catalog",
        reports,
        funnel,
      );
    }
    if (preview.intent.sourceClasses.includes("STRUCTURED_ATS")) {
      const targets = this.configuredAtsTargets(preview.intent);
      if (!targets.length)
        reports.push(
          report("STRUCTURED_ATS", "configured-ats", "NO_TARGETS", Date.now(), {
            message: "Nenhum board ATS público foi configurado.",
          }),
        );
      for (const target of targets)
        await this.testProvider(
          preview,
          "STRUCTURED_ATS",
          target.provider,
          target.identity,
          reports,
          funnel,
        );
    }
  }
  async runCareerPages(preview, mode, reports, funnel) {
    if (!preview.intent.sourceClasses.includes("OFFICIAL_CAREER_PAGE")) return;
    const targets = (this.store?.watchlists?.all?.() || []).filter(
      (item) => item.active !== false && item.careerUrl,
    );
    if (!targets.length) {
      reports.push(
        report(
          "OFFICIAL_CAREER_PAGE",
          "company-radar",
          "NO_TARGETS",
          Date.now(),
          { message: "Nenhuma página oficial ativa no Company Radar." },
        ),
      );
      return;
    }
    for (const target of targets) {
      const started = Date.now();
      if (!this.careerPageDiscovery) {
        reports.push(
          report(
            "OFFICIAL_CAREER_PAGE",
            "career-page",
            "UNSUPPORTED",
            started,
            { targets: 1 },
          ),
        );
        continue;
      }
      try {
        const result = await this.careerPageDiscovery.inspect(
            target.careerUrl,
            { company: target.name, limit: 25 },
          ),
          ingested = result.jobs.length
            ? this.jobHuntService.discoveryService.ingestResolvedJobs(
                result.jobs,
                {
                  source: "career-page",
                  query: { query: target.name, location: process.env.CAREER_DEFAULT_COUNTRY || "Portugal" },
                },
              )
            : { jobs: [], newCount: 0, duplicateCount: 0 },
          evaluated =
            mode === "MASS" && ingested.jobs.length
              ? await this.jobHuntService.evaluateDiscoveredJobs(
                  ingested.jobs,
                  preview.intent.thresholds,
                )
              : {};
        add(funnel, {
          rawDiscoveries: result.jobs.length,
          candidateDiscoveries: ingested.jobs.length,
          canonicalOpportunities: ingested.jobs.length,
          duplicates: ingested.duplicateCount,
          ...evaluated,
        });
        reports.push(
          report("OFFICIAL_CAREER_PAGE", "career-page", "CONSULTED", started, {
            executionMode: mode,
            queries: 1,
            targets: 1,
            target: target.name,
            rawResults: result.jobs.length,
            newResults: ingested.newCount,
            strategy: result.strategy,
            errorCode: result.diagnostic?.errorCode||"",
            diagnostic: result.diagnostic||null,
            message: result.jobs.length
              ? "JSON-LD persistido no pipeline canônico."
              : "Página consultada sem JobPosting estruturado.",
          }),
        );
      } catch (error) {
        funnel.errors++;
        reports.push(
          report("OFFICIAL_CAREER_PAGE", "career-page", "ERROR", started, {
            targets: 1,
            errors: [
              {
                errorCode: error.code || "CAREER_PAGE_FAILED",
                message: error.message,
              },
            ],
          }),
        );
      }
    }
  }
  async runMass(preview, reports, funnel) {
    const providers = [],
      sourcePreferences = [],
      targets = this.configuredAtsTargets(preview.intent);
    if (preview.intent.sourceClasses.includes("JOB_BOARD")) {
      providers.push("jobspy");
      sourcePreferences.push("indeed", "linkedin", "glassdoor", "google");
    }
    if (preview.intent.sourceClasses.includes("STRUCTURED_ATS")) {
      providers.push(...targets.map((item) => item.provider));
      sourcePreferences.push(...targets.map((item) => item.provider));
      if (!targets.length)
        reports.push(
          report("STRUCTURED_ATS", "configured-ats", "NO_TARGETS", Date.now()),
        );
    }
    for (const provider of preview.intent.providers) {
      const definition = brazilianProviders.get(provider);
      if (!definition || !preview.intent.sourceClasses.includes(definition.sourceClass)) continue;
      providers.push(provider);
      sourcePreferences.push(provider);
    }
    if (!providers.length) return null;
    const run = await this.jobHuntService.runManual(
      this.searchInput(preview, unique(providers), unique(sourcePreferences),targets.map(item=>({provider:item.provider,...item.identity}))),
      { priorityThreshold: preview.intent.thresholds.priority },
    );
    add(funnel, run.report?.funnel || {});
    const reportedProviders = new Set();
    for (const item of run.report?.sourceReports || []) {
      reportedProviders.add(item.provider);
      reports.push(
        report(item.sourceClass, item.provider, item.status, Date.now(), {
          executionMode: "MASS",
          queries: run.queryCount,
          targets: 1,
          requestCount: Number(item.requestCount || 0),
          called: item.called === true,
          rawResults: Number(item.rawResults || 0),
          candidateResults: Number(item.candidateResults || 0),
          newResults: Number(item.newResults || 0),
          duplicates: Number(item.duplicates || 0),
          sites: item.sites || [],
          errors: item.errors || [],
          runId: run.id,
          pipeline:
            "DISCOVERY_CANONICAL_FILTER_CANDIDATE_KNOWLEDGE_MATCHER_V2_PRIORITY_THRESHOLDS_PERSISTENCE",
        }),
      );
    }
    if (run.report?.errors?.length)
      for (const provider of unique(
        run.report.errors.flatMap((item) => item.providers || []),
      ).filter((item) => !reportedProviders.has(item)))
        reports.push(
          report(
            brazilianProviders.get(provider)?.sourceClass ||
              (provider === "jobspy" ? "JOB_BOARD" : "STRUCTURED_ATS"),
            provider,
            "ERROR",
            Date.now(),
            {
              executionMode: "MASS",
              queries: run.queryCount,
              targets: 1,
              requestCount: 1,
              called: true,
              rawResults: 0,
              newResults: 0,
              duplicates: 0,
              errors: run.report.errors.filter((error) =>
                (error.providers || []).includes(provider),
              ),
              runId: run.id,
              pipeline:
                "DISCOVERY_CANONICAL_FILTER_CANDIDATE_KNOWLEDGE_MATCHER_V2_PRIORITY_THRESHOLDS_PERSISTENCE",
            },
          ),
        );
    return run;
  }
  queueMass(input = {}) {
    const preview = this.preview(input), providers = [], sourcePreferences = [], targets = this.configuredAtsTargets(preview.intent);
    if (preview.intent.sourceClasses.includes("JOB_BOARD")) {
      providers.push("jobspy");
      sourcePreferences.push("indeed", "linkedin", "glassdoor", "google");
    }
    if (preview.intent.sourceClasses.includes("STRUCTURED_ATS")) {
      providers.push(...targets.map((item) => item.provider));
      sourcePreferences.push(...targets.map((item) => item.provider));
    }
    for (const provider of preview.intent.providers) {
      const definition = brazilianProviders.get(provider);
      if (definition && preview.intent.sourceClasses.includes(definition.sourceClass)) {
        providers.push(provider);
        sourcePreferences.push(provider);
      }
    }
    if (!providers.length) throw Object.assign(new Error("Selecione ao menos uma fonte executável para o Mass Hunt."), { code: "MASS_HUNT_SOURCE_REQUIRED" });
    const run = this.jobHuntService.queueManual(this.searchInput(preview, unique(providers), unique(sourcePreferences),targets.map(item=>({provider:item.provider,...item.identity}))), { priorityThreshold: preview.intent.thresholds.priority });
    return { runId: run.id || "", profileId: run.profileId || "", status: run.status || "RUNNING", reused: Boolean(run.reused), progressUrl: run.id ? `/api/job-hunt/runs/${encodeURIComponent(run.id)}` : "", logsUrl: run.id ? `/api/logs?runId=${encodeURIComponent(run.id)}` : "" };
  }
  async runPublicWeb(preview, mode, reports, funnel) {
    const classes = preview.intent.sourceClasses.filter((item) =>
      ["PUBLIC_WEB", "NEWS_BLOG_HIRING_SIGNAL"].includes(item),
    );
    for (const sourceClass of classes) {
      if (!this.publicWeb.capability().configured) {
        reports.push(
          report(
            sourceClass,
            "brave-public-web",
            "SKIPPED_OPTIONAL",
            Date.now(),
            {message:"Provedor pago opcional desativado; as fontes públicas gratuitas continuam disponíveis."},
          ),
        );
        continue;
      }
      for (const baseQuery of preview.publicWebQueries.slice(
        0,
        mode === "TEST" ? 1 : 6,
      )) {
        const query =
            sourceClass === "NEWS_BLOG_HIRING_SIGNAL"
              ? `${baseQuery} (contratando OR hiring OR expansão)`
              : baseQuery,
          started = Date.now();
        try {
          const found = await this.publicWeb.search(query, {
              count: mode === "TEST" ? 5 : 10,
            }),
            relevant = found.filter(
              (item) =>
                detectHiringMessage(`${item.title} ${item.excerpt}`).relevant,
            );
          add(funnel, {
            rawDiscoveries: found.length,
            hiringRelevantSignals: relevant.length,
          });
          let created = 0,
            duplicates = 0;
          for (const item of relevant) {
            const trust = sourceTrust(sourceClass),
              risk = assessDiscoveryRisk(item),
              lead = this.repository.createLead({
                ...item,
                sourceClass,
                sourceRef: item.url,
                sourceUrl: item.url,
                trustTier: trust.tier,
                riskState: risk.state,
                reviewStatus: "NEEDS_REVIEW",
                provenance: {
                  provider: "brave-public-web",
                  query,
                  taxonomyVersion: HIRING_INTENT_TAXONOMY.version,
                },
              });
            if (lead.duplicate) duplicates++;
            else {
              created++;
              this.repository.createSignal({
                leadId: lead.id,
                sourceClass,
                signalType: "HIRING_INTENT",
                summary: item.title,
                confidence: 0.45,
                provenance: { url: item.url },
              });
            }
          }
          add(funnel, {
            opportunityLeads: created,
            hiringSignals: created,
            duplicates,
            needsReview: created,
          });
          reports.push(
            report(sourceClass, "brave-public-web", "CONSULTED", started, {
              executionMode: mode,
              queries: 1,
              targets: 1,
              rawResults: found.length,
              newResults: created,
              duplicates,
            }),
          );
        } catch (error) {
          funnel.errors++;
          reports.push(
            report(sourceClass, "brave-public-web", "ERROR", started, {
              queries: 1,
              errors: [
                {
                  errorCode: error.code || "PUBLIC_WEB_FAILED",
                  message: error.message,
                },
              ],
            }),
          );
        }
      }
    }
  }
  runCommunity(preview, reports, funnel, runStartedAt) {
    if (!preview.intent.sourceClasses.includes("COMMUNITY_WHATSAPP_GROUP"))
      return;
    const configured = Boolean(
        this.evolutionService?.publicConfiguration().configured &&
          this.communityService?.configured(),
      ),
      allLeads = this.repository
        .listLeads()
        .filter((item) => item.sourceClass === "COMMUNITY_WHATSAPP_GROUP"),
      leads = allLeads.filter(
        (item) => Date.parse(item.createdAt) >= runStartedAt,
      ),
      signals = this.repository
        .listSignals()
        .filter(
          (item) =>
            item.sourceClass === "COMMUNITY_WHATSAPP_GROUP" &&
            Date.parse(item.createdAt) >= runStartedAt,
        );
    add(funnel, {
      candidateDiscoveries: leads.length,
      opportunityLeads: leads.length,
      hiringSignals: signals.length,
      hiringRelevantSignals: signals.length,
      needsReview: leads.filter((item) => item.reviewStatus === "NEEDS_REVIEW")
        .length,
      risky: leads.filter((item) =>
        ["RISKY", "REVIEW_REQUIRED"].includes(item.riskState),
      ).length,
    });
    reports.push(
      report(
        "COMMUNITY_WHATSAPP_GROUP",
        "evolution-whatsapp",
        configured ? "LISTENING" : "CONFIG_REQUIRED",
        runStartedAt,
        {
          executionMode: "EVENT_DRIVEN",
          targets:
            this.store?.discoveryV4
              ?.listCommunitySources?.()
              .filter((item) => item.enabled).length || 0,
          rawResults: leads.length,
          backlogAvailable: allLeads.length - leads.length,
          message:
            "Fonte event-driven; somente eventos recebidos durante esta execução entram como novos.",
        },
      ),
    );
  }
  async run(input = {}, mode = "TEST") {
    const runStartedAt = Date.now(),
      preview = this.preview(input),
      reports = [],
      funnel = emptyFunnel();
    await this.runCareerPages(preview, mode, reports, funnel);
    let massRun=null;
    if (mode === "TEST") await this.runStructuredTest(preview, reports, funnel);
    else massRun=await this.runMass(preview, reports, funnel);
    await this.runPublicWeb(preview, mode, reports, funnel);
    this.runCommunity(preview, reports, funnel, runStartedAt);
    for (const sourceClass of preview.intent.sourceClasses.filter((item) =>
      [
        "PUBLIC_SOCIAL_SIGNAL",
        "RECRUITER_PUBLIC_SIGNAL",
        "MANUAL_LEAD_CAPTURE",
        "EXTERNAL_FORM",
      ].includes(item),
    ))
      reports.push(
        report(sourceClass, "manual", "SKIPPED", Date.now(), {
          message:
            "Captura manual legítima; nenhum provider automático foi chamado.",
        }),
      );
    for (const sourceClass of preview.intent.sourceClasses.filter(
      (item) => item === "CONSULTANCY_STAFFING",
    ))
      reports.push(report(sourceClass, "none", "UNSUPPORTED", Date.now()));
    const consulted = new Set(
      reports
        .filter((item) => ["CONSULTED", "PARTIAL"].includes(item.status))
        .map((item) => item.sourceClass),
    ).size;
    return {
      mode,
      executionMode: mode,
      preview,
      reports,
      metrics: funnel,
      funnel,
      relevance: massRun?.report?{filterReasons:massRun.report.filterReasons||{},queryDiagnostics:massRun.report.queryDiagnostics||[],preMatchDecisions:massRun.report.preMatchDecisions||[]}:null,
      summary: {
        requested: preview.availability.length,
        operational: preview.availability.filter((item) => item.operational)
          .length,
        consulted,
        error: reports.filter((item) => item.status === "ERROR").length,
        partial: reports.filter((item) => item.status === "PARTIAL").length,
        configRequired: reports.filter(
          (item) => item.status === "CONFIG_REQUIRED",
        ).length,
        unsupported: reports.filter((item) => item.status === "UNSUPPORTED")
          .length,
        noTargets: reports.filter((item) => item.status === "NO_TARGETS")
          .length,
      },
    };
  }
  async captureWithClassification(input = {}) {
    let hostname="";try{hostname=new URL(input.sourceUrl||input.url||"").hostname;}catch{}
    if(!this.linkedinResolver||!(hostname==="linkedin.com"||hostname.endsWith(".linkedin.com")))return this.captureManual(input);
    const run=this.linkedinResolver.createRun(),classification=await this.linkedinResolver.classify(input,run);
    if(classification.opportunityType==="NOT_A_JOB")return {rejected:true,reason:"NOT_A_JOB",classification,telemetry:run.metrics};
    return {...this.captureManual({...input,linkedinClassification:{opportunityType:classification.opportunityType,signals:classification.signals,uncertain:classification.opportunityType==="POSSIBLE_JOB_POST"}}),classification,telemetry:run.metrics};
  }
  captureManual(input = {}) {
    const sourceClass =
        normalizeSourceClasses([input.sourceClass])[0] || "MANUAL_LEAD_CAPTURE",
      title = clean(input.title || input.text?.split(/\r?\n/)[0]),
      excerpt = String(input.text || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500),
      sourceUrl = String(input.url || "")
        .trim()
        .slice(0, 1000);
    if (!title && !excerpt && !sourceUrl)
      throw Object.assign(new Error("Informe uma URL ou texto do sinal."), {
        code: "MANUAL_SIGNAL_REQUIRED",
      });
    const trust = sourceTrust(sourceClass, {
        official: input.official === true,
      }),
      risk = assessDiscoveryRisk({ ...input, title, excerpt, sourceClass }),
      lead = this.repository.createLead({
        sourceClass,
        sourceRef: sourceUrl,
        title,
        company: clean(input.company),
        location: clean(input.location),
        workModel: clean(input.workModel),
        applicationMethod: input.applicationMethod || "UNKNOWN",
        applicationContact: clean(input.applicationContact),
        sourceUrl,
        excerpt,
        trustTier: trust.tier,
        riskState: risk.state,
        reviewStatus: "NEEDS_REVIEW",
        provenance: {
          capturedBy: "USER",
          capturedAt: new Date().toISOString(),
          ...(input.linkedinClassification?{linkedinClassification:input.linkedinClassification}:{}),
        },
      });
    if (!lead.duplicate)
      this.repository.createSignal({
        leadId: lead.id,
        signalType: "HIRING_INTENT",
        sourceClass,
        company: lead.company,
        summary: lead.title || lead.excerpt,
        confidence: 0.5,
        provenance: { capturedBy: "USER" },
      });
    return lead;
  }
}
