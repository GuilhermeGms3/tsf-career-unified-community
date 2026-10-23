import { createHash, randomUUID } from "node:crypto";
import { normalizeDiscoveryJob } from "./types.mjs";
import { CanonicalJobResolver } from "./canonical-job-resolver.mjs";
import { SourceResolver } from "./source-resolver.mjs";
import { DiscoveryPolicy } from "./discovery-policy.mjs";
import { mergeJobFields } from "./field-merge.mjs";
import { ApplicationMethodDetector } from "./application-method/application-method-detector.mjs";
import { discoveryRecovery } from "./discovery-recovery.mjs";
import {
  operationalStatusFromObservation,
  sourceSurface,
} from "./source-authority.mjs";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const officialProviders = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "career-page",
]);
const canonicalApplicationProviders = new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "gupy", "workday"]);
const discoveryErrorCode = (error) => {
  if (
    error?.name === "AbortError" ||
    error?.name === "TimeoutError" ||
    error?.code === 20
  )
    return "ENGINE_TIMEOUT";
  return typeof error?.code === "string" && error.code
    ? error.code
    : "PROVIDER_ERROR";
};

export class DiscoveryService {
  constructor({
    registry,
    repositories,
    jobRepository,
    boardRepository = null,
    leadRepository = null,
    sourceHealthRepository = null,
    policy = new DiscoveryPolicy(),
    eventBus = null,
  }) {
    Object.assign(this, {
      registry,
      repositories,
      jobRepository,
      boardRepository,
      leadRepository,
      sourceHealthRepository,
      policy,
      eventBus,
    });
    this.canonical = new CanonicalJobResolver();
    this.sources = new SourceResolver();
    this.applicationMethods = new ApplicationMethodDetector();
  }

  async discover(rawInput = {}) {
    const input = this.policy.constrain(rawInput);
    const providerIds = input.providers?.length ? input.providers : ["jobspy"];
    const run = this.repositories.startRun(input, providerIds);
    const rawJobs = [],
      reports = [],
      successfulBoards = [],
      continuations = [];
    for (const providerId of providerIds) {
      const provider = this.registry.get(providerId),
        startedAt = Date.now(),
        startedAtIso = new Date(startedAt).toISOString();
      if (!provider) {
        reports.push({
          provider: providerId,
          status: "UNSUPPORTED",
          count: 0,
          durationMs: 0,
          errorCode: "PROVIDER_NOT_FOUND",
          startedAt: startedAtIso,
          completedAt: new Date().toISOString(),
        });
        continue;
      }
      try {
        let result;
        if (providerId === "jobspy") result = await provider.search(input);
        else if (input.organizationKey) {
          const jobs=await provider.listCompanyJobs({
              ...input,
              limit: input.limit,
            });
          result = {
            jobs,
            diagnostic: { status: "HEALTHY" },
          };
          if(jobs.listingComplete!==false)successfulBoards.push(providerId);
        } else result = await provider.search(input);
        rawJobs.push(...(result.jobs || []));
        const diagnostic = result.diagnostic || {};
        if (diagnostic.continuation)
          continuations.push({ provider, continuation: diagnostic.continuation });
        reports.push({
          provider: providerId,
          status: diagnostic.status || "HEALTHY",
          count: result.jobs?.length || 0,
          durationMs: Date.now() - startedAt,
          startedAt: startedAtIso,
          completedAt: new Date().toISOString(),
          pagesScanned: Number(diagnostic.pagesScanned || 0),
          candidates: Number(diagnostic.candidates || 0),
          recordsExamined: Number(diagnostic.recordsExamined || 0),
          candidateUrls: Number(diagnostic.candidateUrls || 0),
          processedUrls: Number(diagnostic.processedUrls || 0),
          remainingUrls: Number(diagnostic.remainingUrls || 0),
          totalAvailable: Number(diagnostic.totalAvailable || result.jobs?.totalAvailable || 0),
          errorCount: Number(diagnostic.errorCount || 0),
          errorCode: diagnostic.errorCode || "",
          recovery: discoveryRecovery(diagnostic.errorCode, diagnostic.status),
          strategy: diagnostic.strategy || "",
          alternativesExhausted: Boolean(diagnostic.alternativesExhausted),
          strategyAttempts: diagnostic.strategyAttempts || [],
          checkpoint: diagnostic.checkpoint || null,
          rateLimited: Boolean(diagnostic.rateLimited),
          rateLimits: diagnostic.rateLimits || [],
          resultsLimit: Number(diagnostic.resultsLimit || input.limit),
          sites: diagnostic.details?.sourceReports || diagnostic.sourceReports || [],
        });
      } catch (error) {
        const errorCode=discoveryErrorCode(error),sites=providerId==="jobspy"?(input.sites||input.aggregators||["indeed","linkedin","glassdoor","google"]).map(site=>({source:site,site,attempted:true,status:errorCode==="ENGINE_TIMEOUT"?"TIMED_OUT":errorCode==="RATE_LIMITED"?"RATE_LIMITED":"FAILED",rawResults:0,acceptedResults:0,query:String(input.query||"").slice(0,180),location:String(input.location||"").slice(0,120),country:"Brazil",durationMs:Date.now()-startedAt,errorCode,message:errorCode==="ENGINE_TIMEOUT"?"O limite global encerrou a consulta antes do relatório por portal.":"A consulta do agregador falhou antes do relatório por portal."})):[];
        reports.push({
          provider: providerId,
          status: errorCode === "RATE_LIMITED" ? "RATE_LIMITED" : errorCode === "ENGINE_TIMEOUT" ? "TIMED_OUT" : "ERROR",
          count: 0,
          durationMs: Date.now() - startedAt,
          errorCode,
          recovery: discoveryRecovery(errorCode),
          alternativesExhausted: Boolean(error.alternativesExhausted),
          strategyAttempts: error.strategyAttempts || [],
          message: error.message,
          sites,
          startedAt: startedAtIso,
          completedAt: new Date().toISOString(),
          resultsLimit: input.limit,
        });
      }
    }
    return this.finishRunCooperatively({ input, run, rawJobs, reports, successfulBoards, continuations });
  }

  async enrichJob(job) {
    const identity = this.sources.resolve(job.applicationUrl || job.url || job.canonicalUrl);
    const provider = this.registry.get(identity.atsType);
    if (!["gupy", "smartrecruiters"].includes(identity.atsType) || !provider?.resolveJob) return job;
    const detail = await provider.resolveJob({ ...job, companyIdentity: identity.organizationKey, providerJobId: identity.providerJobId });
    if (!detail.description || detail.description.length <= (job.description || "").length) return job;
    const timestamp = new Date().toISOString();
    const enriched = { ...job, description: detail.description, postedAt: detail.postedAt || job.postedAt, expiresAt: detail.expiresAt || job.expiresAt, updatedAt: timestamp };
    if (enriched.expiresAt && Date.parse(enriched.expiresAt) <= Date.parse(timestamp)) {
      enriched.lifecycleStatus = "CLOSED";
      enriched.closedAt = timestamp;
      enriched.availability = { status: "CLOSED", reason: "EXPIRED_DURING_DETAIL_ENRICHMENT", checkedAt: timestamp };
    }
    const contentHash = hash({ title: enriched.title, company: enriched.company, description: enriched.description, location: enriched.location, applicationUrl: enriched.applicationUrl, lifecycleStatus: enriched.lifecycleStatus });
    const persisted = this.jobRepository.upsert({ ...enriched, contentHash });
    this.repositories.snapshot(persisted.id, contentHash, enriched, "UPDATED");
    this.eventBus?.emit("JOB_UPDATED", { jobId: persisted.id, provider: persisted.provider, title: persisted.title, company: persisted.company });
    return persisted;
  }

  ingestResolvedJobs(
    rawJobs = [],
    { source = "career-page", query = {}, recordSourceHealth = true } = {},
  ) {
    const input = this.policy.constrain({
      query: query.query || source,
      location: query.location || process.env.CAREER_DEFAULT_COUNTRY || "Portugal",
      providers: [source],
      limit: Math.max(1, rawJobs.length),
    });
    const run = this.repositories.startRun(input, [source]);
    const reports = [
      {
        provider: source,
        status: "HEALTHY",
        count: rawJobs.length,
        durationMs: 0,
      },
    ];
    return this.finishRun({
      input,
      run,
      rawJobs,
      reports,
      successfulBoards: [],
      recordSourceHealth,
    });
  }

  finishRun(input) {
    const steps = this.finishRunSteps(input);
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }

  async finishRunCooperatively(input) {
    for (const steps = this.finishRunSteps(input);;) {
      const step = steps.next();
      if (step.done) return step.value;
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  *finishRunSteps({ input, run, rawJobs, reports, successfulBoards, continuations = [], recordSourceHealth = true }) {
    const counts = {
      discoveredCount: rawJobs.length,
      newCount: 0,
      updatedCount: 0,
      closedCount: 0,
      duplicateCount: 0,
      errorCount: reports.filter((item) =>
        ["ERROR", "OFFLINE", "TIMED_OUT", "RATE_LIMITED", "UNSUPPORTED", "FAILED"].includes(item.status),
      ).length,
    };
    const jobs = [],
      sourceOutcomes = new Map(),
      seenByBoard = new Map();
    for (const raw of rawJobs) {
      yield;
      let job = normalizeDiscoveryJob(raw);
      const target = this.sources.resolve(
        job.applicationUrl || job.canonicalUrl || job.sourceUrl,
      );
      if (target.canonicalTarget)
        job = {
          ...job,
          atsType: target.atsType,
          canonicalUrl: canonicalApplicationProviders.has(target.atsType) ? target.url : job.canonicalUrl,
          companyIdentity: target.organizationKey || job.companyIdentity,
          providerJobId: target.providerJobId || job.providerJobId,
        };
      if (
        job.companyIdentity &&
        [
          "greenhouse",
          "lever",
          "ashby",
          "workable",
          "smartrecruiters",
          "gupy",
        ].includes(job.atsType)
      )
        this.boardRepository?.saveBoard({
          company: job.company || job.companyIdentity,
          provider: job.atsType,
          organizationKey: job.companyIdentity,
          careerUrl: job.canonicalUrl,
          source: "discovered_job",
          confidence: 0.9,
          enabled: true,
        });
      const identity = this.canonical.resolve(job),
        application = this.applicationMethods.detect(job);
      job = {
        ...job,
        canonicalKey: identity.key,
        applicationMethod: application.method,
        applicationEmail: application.email,
        applicationInstructions: application.instructions,
        applicationSubjectHint: application.subjectHint,
        applicationMethodEvidence: application.evidence,
        provenance: {
          ...job.provenance,
          ...(input.queryProvenance
            ? {
                discoveryQuery: {
                  query: String(input.queryProvenance.source==="ATS_BOARD_LIST"?"":input.queryProvenance.query || input.query || "").slice(0, 160),
                  tier: input.queryProvenance.tier || "TIER_2",
                  reason: String(input.queryProvenance.reason || "").slice(0, 240),
                  source: String(input.queryProvenance.source || "").slice(0, 80),
                  familyId: String(input.queryProvenance.familyId || "").slice(0, 80),
                },
              }
            : {}),
          canonicalIdentity: {
            strategy: identity.strategy,
            confidence: identity.confidence,
          },
          applicationMethod: application.evidence,
        },
      };
      let persisted;
      const surfaceId = job.provider === "jobspy" ? `jobspy:${job.discoveredVia}` : job.provider;
      const outcome = sourceOutcomes.get(surfaceId) || { valid: 0, newCount: 0, duplicates: 0, sampleUrls: [], publishedAt: [] };
      outcome.valid++;
      const sampleUrl = job.canonicalUrl || job.applicationUrl || job.sourceUrl;
      if (sampleUrl && outcome.sampleUrls.length < 5) outcome.sampleUrls.push(sampleUrl);
      if (job.postedAt && Number.isFinite(Date.parse(job.postedAt))) outcome.publishedAt.push(job.postedAt);
      sourceOutcomes.set(surfaceId, outcome);
      this.repositories.database.transaction(() => {
        const externalId = `${job.provider}:${job.providerJobId || identity.key}`,
          existingId =
            this.repositories.findJobByCanonicalKey(identity.key) ||
            this.repositories.findJobByExternalId(externalId) ||
            this.repositories.findLinkedInSource?.(job.sourceUrl),
          current = existingId ? this.jobRepository.findById(existingId) : null;
        job = mergeJobFields(current, job);
        const timestamp = job.fetchedAt || new Date().toISOString(),
          contentHash = hash({
            title: job.title,
            company: job.company,
            description: job.description,
            location: job.location,
            applicationUrl: job.applicationUrl,
            lifecycleStatus: job.lifecycleStatus,
          });
        persisted = this.jobRepository.upsert({
          ...current,
          id: current?.id || `job-${randomUUID()}`,
          externalId: current?.externalId || externalId,
          source: job.discoveredVia || job.provider,
          provider: job.provider,
          providerJobId: job.providerJobId,
          canonicalKey: identity.key,
          canonicalUrl: job.canonicalUrl,
          applicationUrl: job.applicationUrl,
          atsType: job.atsType,
          applicationMethod: job.applicationMethod,
          applicationEmail: job.applicationEmail,
          applicationInstructions: job.applicationInstructions,
          applicationSubjectHint: job.applicationSubjectHint,
          applicationMethodEvidence: job.applicationMethodEvidence,
          title: job.title || "",
          company: job.company || "",
          description: job.description || "",
          location: job.location || "",
          workModel: job.workModel || "",
          url: job.applicationUrl || job.canonicalUrl || job.sourceUrl,
          status: current?.status || "salva",
          lifecycleStatus: current?.availabilityHistory?.length && current.lifecycleStatus === "CLOSED" ? "CLOSED" : job.lifecycleStatus,
          firstSeenAt: current?.firstSeenAt || timestamp,
          lastSeenAt: timestamp,
          lastCheckedAt: current?.availabilityHistory?.length ? current.lastCheckedAt : timestamp,
          availability: current?.availabilityHistory?.length && job.lifecycleStatus !== "CLOSED" ? current.availability : {
            status: job.lifecycleStatus === "CLOSED" ? "CLOSED" : "AVAILABLE",
            reason: job.lifecycleStatus === "CLOSED" ? "CLOSED_DURING_DISCOVERY" : "OBSERVED_DURING_DISCOVERY",
            checkedAt: timestamp,
            finalUrl: job.canonicalUrl || job.applicationUrl || job.sourceUrl,
          },
          closedAt:
            job.lifecycleStatus === "CLOSED"
              ? timestamp
              : current?.closedAt || "",
          contentHash,
          provenance: job.provenance,
          createdAt: current?.createdAt || timestamp,
          updatedAt: timestamp,
        });
        this.repositories.recordSource(persisted.id, job);
        const change = !current
          ? "DISCOVERED"
          : current.contentHash !== contentHash
            ? "UPDATED"
            : null;
        if (change) {
          this.repositories.snapshot(persisted.id, contentHash, job, change);
          counts[change === "DISCOVERED" ? "newCount" : "updatedCount"]++;
          if (change === "DISCOVERED") outcome.newCount++;
          this.eventBus?.emit(`JOB_${change}`, {
            jobId: persisted.id,
            provider: job.provider,
            title: persisted.title,
            company: persisted.company,
            fitScore: persisted.fitScore || 0,
          });
        } else {
          counts.duplicateCount++;
          outcome.duplicates++;
        }
      });
      if (officialProviders.has(job.provider))
        for (const lead of this.leadRepository?.reconcileOfficialJob(
          persisted,
        ) || [])
          this.repositories.recordSource(persisted.id, {
            provider: lead.provenance?.provider || sourceProviderForLead(lead),
            providerCategory: "LEAD",
            providerJobId: lead.id,
            discoveredVia: "cross-source-reconciliation",
            sourceUrl: lead.sourceUrl,
            canonicalUrl: persisted.canonicalUrl,
            fetchedAt: new Date().toISOString(),
            provenance: {
              leadId: lead.id,
              sourceClass: lead.sourceClass,
              confidence: lead.reconciliationConfidence,
            },
          });
      if (job.companyIdentity && job.atsType) {
        const key = `${job.atsType}:${job.companyIdentity}`;
        seenByBoard.set(key, [...(seenByBoard.get(key) || []), identity.key]);
      }
      jobs.push({
        ...persisted,
        sources: this.repositories.sourcesForJob(persisted.id),
      });
    }
    if (input.organizationKey)
      for (const provider of successfulBoards)
        this.repositories.database.transaction(() => {
          const closed = this.repositories.closeMissing(
            provider,
            input.organizationKey,
            seenByBoard.get(`${provider}:${input.organizationKey}`) || [],
          );
          counts.closedCount += closed.length;
          for (const jobId of closed)
            this.eventBus?.emit("JOB_CLOSED", { jobId, provider });
        });
    for (const item of continuations) {
      try {
        item.provider.commitContinuation?.(item.continuation);
      } catch (error) {
        const report = reports.find((candidate) => candidate.provider === item.provider.id);
        if (report) {
          report.status = "DEGRADED";
          report.errorCode = error.code || "CHECKPOINT_COMMIT_FAILED";
          report.errorCount = Number(report.errorCount || 0) + 1;
          report.message = "Resultados persistidos, mas o checkpoint não pôde ser atualizado.";
        }
        counts.errorCount++;
      }
    }
    for (const report of reports)
      this.repositories.addSourceReport(run.id, report);
    if (recordSourceHealth)
      this.recordSourceHealth({ runId: run.id, input, reports, outcomes: sourceOutcomes });
    let finished;
    this.repositories.database.transaction(() => {
      finished = this.repositories.finishRun(run.id, { ...counts, reports });
      this.eventBus?.emit("DISCOVERY_RUN_COMPLETED", {
        runId: run.id,
        ...counts,
      });
    });
    return {
      ok: counts.errorCount < reports.length,
      run: finished,
      jobs,
      sourceReports: reports,
      ...counts,
    };
  }

  recordSourceHealth({ runId, input, reports, outcomes }) {
    if (!this.sourceHealthRepository) return [];
    const recorded = [];
    for (const report of reports) {
      const observations = report.provider === "jobspy" && report.sites?.length
        ? report.sites.map((site) => ({ ...site, provider: "jobspy", surfaceId: `jobspy:${site.site || site.source}` }))
        : [{ ...report, surfaceId: report.provider }];
      for (const item of observations) {
        const definition = sourceSurface(item.surfaceId);
        if (!definition) continue;
        const outcome = outcomes.get(item.surfaceId) || { valid: 0, newCount: 0, duplicates: 0, sampleUrls: [], publishedAt: [] };
        const startedAt = item.startedAt || report.startedAt || new Date(Date.now() - Number(item.durationMs || report.durationMs || 0)).toISOString();
        const finishedAt = item.completedAt || report.completedAt || new Date().toISOString();
        const attempted = item.attempted !== false && !["UNSUPPORTED", "NOT_ATTEMPTED", "CONFIG_REQUIRED", "IDENTITY_REQUIRED", "CREDENTIAL_REQUIRED", "AUTH_REQUIRED", "AGGREGATOR_ONLY"].includes(String(item.status || "").toUpperCase());
        const rawCount = Number(
          item.rawResults ??
            (Number(report.candidates) > 0 ? report.candidates : report.count) ??
            0,
        );
        const parsedCount = Number(item.parsedResults ?? item.rawResults ?? report.count ?? outcome.valid);
        const validCount = Number(item.acceptedResults ?? outcome.valid);
        const discardedCount = Number(item.discardedResults ?? item.geographyRejectedResults ?? Math.max(0, rawCount - validCount));
        const errorCode = item.errorCode || report.errorCode || "";
        const draft = { attempted, realQuery: attempted, status: item.status || report.status, errorCode, validCount, finishedAt };
        const status = operationalStatusFromObservation(draft);
        const published = [...outcome.publishedAt].sort((left, right) => Date.parse(left) - Date.parse(right));
        const successful = ["OPERATIONAL_REAL", "SUCCESS_EMPTY"].includes(status);
        const observation = this.sourceHealthRepository.record({
          runId,
          sourceId: definition.provider_id,
          providerId: definition.provider_id,
          surfaceId: definition.id,
          status,
          realQuery: attempted,
          query: item.query || input.query,
          location: item.location || input.location,
          startedAt,
          finishedAt,
          lastSuccessAt: successful ? finishedAt : "",
          lastRealQueryAt: attempted ? finishedAt : "",
          lastErrorAt: errorCode || ["DEGRADED", "BLOCKED"].includes(status) ? finishedAt : "",
          lastErrorCode: errorCode,
          rawCount,
          parsedCount,
          validCount,
          newCount: outcome.newCount,
          duplicateCount: outcome.duplicates,
          discardedCount,
          pagesScanned: Number(item.pagesScanned ?? report.pagesScanned ?? (attempted ? 1 : 0)),
          resultsLimit: Number(item.resultsLimit ?? report.resultsLimit ?? input.limit ?? definition.current_limit),
          queryCount: attempted ? 1 : 0,
          latestJobPublishedAt: published.at(-1) || "",
          oldestJobPublishedAt: published[0] || "",
          lastNewJobAt: outcome.newCount ? finishedAt : "",
          latencyMs: Number(item.latencyMs ?? item.durationMs ?? report.durationMs ?? 0),
          durationMs: Number(item.durationMs ?? report.durationMs ?? 0),
          authenticationState: definition.requires_authentication ? "NOT_USED_OR_UNKNOWN" : "NOT_REQUIRED",
          configurationState: definition.configuration_state,
          errors: errorCode ? [{ code: errorCode, message: String(item.message || report.message || "").slice(0, 300) }] : [],
          rateLimits: item.rateLimits?.length
            ? item.rateLimits
            : /RATE_LIMIT/i.test(`${item.status || ""} ${errorCode}`)
              ? [{ code: errorCode || "RATE_LIMITED" }]
              : [],
          sampleUrls: outcome.sampleUrls,
          metadata: {
            providerStatus: report.status,
            surfaceStatus: item.status || report.status,
            totalAvailable: report.totalAvailable || 0,
            recordsExamined: report.recordsExamined || report.candidates || 0,
            candidateUrls: report.candidateUrls || 0,
            processedUrls: report.processedUrls || 0,
            remainingUrls: report.remainingUrls || 0,
            checkpoint: report.checkpoint || null,
          },
        });
        recorded.push(observation);
      }
    }
    return recorded;
  }
}

function sourceProviderForLead(lead) {
  if (lead.sourceClass === "COMMUNITY_WHATSAPP_GROUP")
    return "evolution-whatsapp";
  if (["PUBLIC_WEB", "NEWS_BLOG_HIRING_SIGNAL"].includes(lead.sourceClass))
    return "brave-public-web";
  return "manual";
}
