import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { HubDatabase } from "../db/database.mjs";
import { AlertRepository } from "../repositories/alert-repository.mjs";
import {
  ApplicationAttemptRepository,
  ApplicationRepository,
} from "../repositories/application-repository.mjs";
import { AtsAnalysisRepository } from "../repositories/ats-analysis-repository.mjs";
import { AtsAnalysisItemRepository } from "../repositories/ats-analysis-item-repository.mjs";
import { JobRequirementRepository } from "../repositories/job-requirement-repository.mjs";
import { JobRepository } from "../repositories/job-repository.mjs";
import { ResumeRepository } from "../repositories/resume-repository.mjs";
import { SearchScheduleRepository } from "../repositories/search-schedule-repository.mjs";
import { WhatsappApprovalRepository } from "../repositories/whatsapp-approval-repository.mjs";
import { WhatsappQuestionRepository } from "../repositories/whatsapp-question-repository.mjs";
import { normalizeApplicationStatus } from "../domain/application-status.mjs";
import { ApplicationService } from "../domain/application-service.mjs";
import { ApplicationPlanner } from "../src/application/application-planner.mjs";
import { PolicyEngine } from "../src/application/policy-engine.mjs";
import { analyzeProfileCompleteness } from "../src/application/profile-completeness.mjs";
import { CandidateKnowledgeBase } from "../src/application/candidate-knowledge-base.mjs";
import { parseGreenhouseIdentity } from "../src/automation/ats/greenhouse/greenhouse-identity.mjs";
import { ResumeSelector } from "../src/intelligence/tasks/resume-selector.mjs";
import {
  ApplicationInspectionRepository,
  ApplicationPlanRepository,
  ApplicationQuestionRepository,
  ApplicationQueueRepository,
  CandidateAnswerRepository,
  GreenhouseJobMetadataRepository,
} from "../repositories/application-engine-repository.mjs";
import { CandidateFactRepository } from "../repositories/candidate-knowledge-repository.mjs";
import { CareerEvidenceRepository } from "../repositories/career-evidence-repository.mjs";
import {
  GeneratedContentRepository,
  IntelligenceBenchmarkRepository,
  IntelligenceCacheRepository,
  IntelligenceJobRepository,
  IntelligenceRunRepository,
  IntelligenceSettingsRepository,
  ResumeTailoringRepository,
  SkillGapSnapshotRepository,
} from "../repositories/intelligence-repository.mjs";
import {
  DiscoveryRepository,
  WatchlistRepository,
} from "../repositories/discovery-repository.mjs";
import {
  IntegrationSettingsRepository,
  OutboxRepository,
} from "../repositories/integration-repository.mjs";
import {
  DocumentExportRepository,
  ResumeArtifactRepository,
  ResumeDocumentJobRepository,
  ResumeRenderRunRepository,
  ResumeUploadAuditRepository,
  ResumeVersionRepository,
} from "../repositories/resume-document-repository.mjs";
import {
  ResumeArchetypeAssignmentRepository,
  ResumeArchetypeRepository,
  ResumeNormalizationReviewRepository,
  TemplateBenchmarkRepository,
} from "../repositories/resume-archetype-repository.mjs";
import {
  AutoApplyPolicyRepository,
  AutomationRunRepository,
  JobAlertRepository,
  JobHuntProfileRepository,
  JobHuntRunRepository,
  ProviderConfigurationRepository,
  ProviderHealthRepository,
} from "../repositories/automation-repository.mjs";
import {
  DecisionInboxDismissalRepository,
  DailyReviewStateRepository,
  JobFeedbackRepository,
} from "../repositories/product-hardening-repository.mjs";
import {
  DiscoveryQueryPlannerStateRepository,
  ExpandedQueryRepository,
  SearchIntentRepository,
  SourceCapabilityRepository,
  SourceSetupDiagnosticRepository,
  WhatsappConnectionMetadataRepository,
} from "../repositories/discovery-v3-repository.mjs";
import { DiscoveryV4Repository } from "../repositories/discovery-v4-repository.mjs";
import {
  SourceConnectionEventRepository,
  SourceCredentialRepository,
} from "../repositories/source-connection-repository.mjs";
import { GitHubEvidenceRepository } from "../repositories/github-evidence-repository.mjs";
import { StructuredLogRepository } from "../repositories/structured-log-repository.mjs";
import { DailyInboxSnapshotRepository, DailyRefreshRunRepository } from "../repositories/daily-operations-repository.mjs";
import { DiscoverySourceHealthRepository } from "../repositories/discovery-source-health-repository.mjs";
import { DiscoveryProviderCheckpointRepository } from "../repositories/discovery-provider-checkpoint-repository.mjs";
import { CoverageBenchmarkRepository } from "../repositories/coverage-benchmark-repository.mjs";
import { ResumeBatchRepository } from "../repositories/resume-batch-repository.mjs";
import { ApplicationBatchRepository, ApplicationAnswerLibrary } from "../repositories/application-batch-repository.mjs";
import {
  SubmissionAttemptRepository,
  SubmissionConsentRepository,
  SubmissionPreflightRepository,
  SubmissionReceiptRepository,
} from "../repositories/submission-repository.mjs";
import { capabilityCatalog } from "../src/discovery/source-capability-catalog.mjs";
import { ResumeArtifactService } from "../src/resume/resume-artifact-service.mjs";
import { CandidateKnowledgeMigrator } from "../src/candidate-knowledge/candidate-knowledge-migrator.mjs";
import { CandidateKnowledgeService } from "../src/candidate-knowledge/candidate-knowledge-service.mjs";
import { atomicWriteJson } from "./json-storage.mjs";
import { isCurrentAtsAnalysis } from "../src/matching/analysis-version.mjs";

export const SQLITE_COLLECTIONS = Object.freeze([
  "jobs",
  "resumes",
  "applications",
  "analyses",
  "searchSchedules",
  "alerts",
]);

export function defaultUnifiedState() {
  return {
    jobs: [],
    resumes: [],
    applications: [],
    analyses: [],
    generations: [],
    searchResults: [],
    searchSchedules: [],
    alerts: [],
    searchHistory: [],
    portalReports: [],
  };
}
function validCollection(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeState(value = {}) {
  const defaults = defaultUnifiedState();
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, validCollection(value[key])]),
  );
}

function withTimestamps(item) {
  const now = new Date().toISOString();
  return {
    ...item,
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || item.createdAt || now,
  };
}

function runStateSyncStep(collection, operation) {
  try {
    return operation();
  } catch (error) {
    const wrapped = new Error(`State sync failed for ${collection}.`, {
      cause: error,
    });
    wrapped.code = "STATE_SYNC_FAILED";
    wrapped.collection = collection;
    wrapped.sqliteCode = error?.code || "";
    throw wrapped;
  }
}

export class UnifiedStateStore {
  constructor({
    dataDir,
    legacyStatePath = path.join(dataDir, "unified-state.json"),
    databasePath = path.join(dataDir, "career-hub.sqlite"),
    migrationsDir,
  } = {}) {
    this.dataDir = dataDir;
    this.legacyStatePath = legacyStatePath;
    this.database = new HubDatabase(databasePath, {
      migrationsDir,
      ownerLease: true,
    });
    this.legacyState = defaultUnifiedState();
    this.legacyStateLoaded = false;
  }

  async initialize() {
    await mkdir(this.dataDir, { recursive: true });
    await this.database.initialize();
    const connection = this.database.connection;
    this.jobs = new JobRepository(connection);
    this.resumes = new ResumeRepository(connection);
    this.applications = new ApplicationRepository(connection, this.database);
    this.applicationService = new ApplicationService(this.applications);
    this.applicationAttempts = new ApplicationAttemptRepository(connection);
    this.applicationPlans = new ApplicationPlanRepository(connection);
    this.applicationQuestions = new ApplicationQuestionRepository(connection);
    this.candidateFacts = new CandidateFactRepository(
      connection,
      this.database,
    );
    this.candidateAnswers = new CandidateAnswerRepository(connection);
    this.careerEvidence = new CareerEvidenceRepository(
      connection,
      this.database,
    );
    this.githubEvidence = new GitHubEvidenceRepository(
      connection,
      this.database,
    );
    this.candidateKnowledge = new CandidateKnowledgeService({
      facts: this.candidateFacts,
      answers: this.candidateAnswers,
      evidence: this.careerEvidence,
    });
    this.candidateKnowledgeMigration = new CandidateKnowledgeMigrator({
      repository: this.candidateFacts,
      database: this.database,
    }).migrateLegacyAggregates();
    this.greenhouseJobs = new GreenhouseJobMetadataRepository(connection);
    this.applicationInspections = new ApplicationInspectionRepository(
      connection,
    );
    this.applicationQueue = new ApplicationQueueRepository(
      connection,
      this.database,
    );
    this.submissionPreflights = new SubmissionPreflightRepository(connection);
    this.submissionConsents = new SubmissionConsentRepository(connection);
    this.submissionAttempts = new SubmissionAttemptRepository(
      connection,
      this.database,
    );
    this.submissionReceipts = new SubmissionReceiptRepository(connection);
    this.intelligenceSettings = new IntelligenceSettingsRepository(connection);
    this.intelligenceRuns = new IntelligenceRunRepository(connection);
    this.intelligenceCache = new IntelligenceCacheRepository(connection);
    this.intelligenceBenchmarks = new IntelligenceBenchmarkRepository(
      connection,
    );
    this.intelligenceJobs = new IntelligenceJobRepository(
      connection,
      this.database,
    );
    this.generatedContent = new GeneratedContentRepository(connection);
    this.resumeTailoring = new ResumeTailoringRepository(connection);
    this.resumeVersions = new ResumeVersionRepository(connection);
    this.resumeArtifacts = new ResumeArtifactRepository(connection);
    this.resumeRenderRuns = new ResumeRenderRunRepository(connection);
    this.documentExports = new DocumentExportRepository(connection);
    this.resumeDocumentJobs = new ResumeDocumentJobRepository(
      connection,
      this.database,
    );
    this.resumeBatches = new ResumeBatchRepository(connection, this.database);
    this.applicationBatches = new ApplicationBatchRepository(connection, this.database);
    this.applicationAnswers = new ApplicationAnswerLibrary(connection);
    this.resumeUploadAudits = new ResumeUploadAuditRepository(connection);
    this.resumeArchetypes = new ResumeArchetypeRepository(connection);
    this.resumeArchetypeAssignments = new ResumeArchetypeAssignmentRepository(
      connection,
    );
    this.resumeNormalizationReviews = new ResumeNormalizationReviewRepository(
      connection,
    );
    this.templateBenchmarks = new TemplateBenchmarkRepository(connection);
    this.resumeArtifactService = new ResumeArtifactService({
      dataDir: this.dataDir,
      artifactRepository: this.resumeArtifacts,
    });
    this.skillGapSnapshots = new SkillGapSnapshotRepository(connection);
    this.analyses = new AtsAnalysisRepository(connection);
    this.analysisItems = new AtsAnalysisItemRepository(connection);
    this.jobRequirements = new JobRequirementRepository(connection);
    this.searchSchedules = new SearchScheduleRepository(connection);
    this.alerts = new AlertRepository(connection);
    this.discovery = new DiscoveryRepository(connection, this.database);
    this.watchlists = new WatchlistRepository(connection);
    this.outbox = new OutboxRepository(connection, this.database);
    this.integrationSettings = new IntegrationSettingsRepository(connection);
    this.whatsappApprovals = new WhatsappApprovalRepository(connection, this.database);
    this.whatsappQuestions = new WhatsappQuestionRepository(connection);
    this.autoApplyPolicy = new AutoApplyPolicyRepository(connection);
    this.jobHuntProfiles = new JobHuntProfileRepository(connection);
    this.jobHuntRuns = new JobHuntRunRepository(connection);
    this.jobAlerts = new JobAlertRepository(connection);
    this.providerConfigurations = new ProviderConfigurationRepository(
      connection,
    );
    this.providerHealth = new ProviderHealthRepository(connection);
    this.discoverySourceHealth = new DiscoverySourceHealthRepository(connection);
    this.discoveryProviderCheckpoints = new DiscoveryProviderCheckpointRepository(connection, this.database);
    this.coverageBenchmark = new CoverageBenchmarkRepository(connection, this.database);
    this.searchIntents = new SearchIntentRepository(connection);
    this.expandedQueries = new ExpandedQueryRepository(connection);
    this.discoveryQueryPlannerState = new DiscoveryQueryPlannerStateRepository(
      connection,
    );
    this.sourceCapabilities = new SourceCapabilityRepository(connection);
    this.sourceDiagnostics = new SourceSetupDiagnosticRepository(connection);
    this.whatsappConnection = new WhatsappConnectionMetadataRepository(
      connection,
    );
    this.sourceCredentials = new SourceCredentialRepository(connection);
    this.sourceConnectionEvents = new SourceConnectionEventRepository(
      connection,
    );
    this.discoveryV4 = new DiscoveryV4Repository(connection, this.database);
    this.structuredLogs = new StructuredLogRepository(connection);
    for (const [providerId, capabilities] of Object.entries(
      capabilityCatalog(),
    ))
      this.sourceCapabilities.replace(providerId, capabilities);
    this.automationRuns = new AutomationRunRepository(connection);
    this.jobFeedback = new JobFeedbackRepository(connection);
    this.decisionDismissals = new DecisionInboxDismissalRepository(connection);
    this.dailyReviewState = new DailyReviewStateRepository(connection);
    this.dailyInboxSnapshots = new DailyInboxSnapshotRepository(connection);
    this.dailyRefreshRuns = new DailyRefreshRunRepository(connection);
    this.dailyRefreshRuns.recover();
    this.jobHuntRuns.recover();
    await this.importLegacyStateIfChanged();
    this.recoverAutomationQueue();
    this.applicationBatches.recover();
    // The exclusive data-directory owner lease is already held. No worker from
    // the previous process can remain active, including recently claimed jobs.
    this.intelligenceJobs.recover(
      new Date().toISOString(),
    );
    this.resumeDocumentJobs.recover(
      new Date().toISOString(),
    );
    this.resumeBatches.recover(
      new Date().toISOString(),
    );
    connection.prepare("UPDATE resume_versions SET status='FAILED',updated_at=? WHERE status='RENDERING'").run(new Date().toISOString());
    connection.prepare("UPDATE resume_render_runs SET status='FAILED',error_code='WORKER_CRASH_RECOVERY',completed_at=? WHERE status='RUNNING'").run(new Date().toISOString());
    const hasSubmissionSchema = Boolean(
      connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='submission_consents'",
        )
        .get(),
    );
    if (hasSubmissionSchema) {
      this.submissionConsents.expireBefore();
      for (const recovered of this.submissionAttempts.recoverExpired()) {
        const application = this.applications.findById(recovered.applicationId);
        if (application?.status === "SUBMITTING")
          this.applicationService.transitionApplication(
            application.id,
            recovered.attempt.status === "UNCERTAIN"
              ? "SUBMISSION_UNCERTAIN"
              : "FAILED",
            {
              reason: "SUBMISSION_CRASH_RECOVERY",
              submissionAttemptId: recovered.id,
            },
          );
        this.applications.recordEvent(
          recovered.applicationId,
          recovered.attempt.status === "UNCERTAIN"
            ? "SUBMISSION_UNCERTAIN"
            : "SUBMISSION_FAILED",
          {
            submissionAttemptId: recovered.id,
            code: "SUBMISSION_CRASH_RECOVERY",
          },
        );
      }
    }
    return this;
  }

  recoverAutomationQueue({
    staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  } = {}) {
    const recovered = this.applicationQueue.recover(staleBefore);
    for (const item of recovered) {
      const application = this.applications.findById(item.application_id);
      if (
        ["OPENING_PAGE", "FILLING", "VALIDATING", "FAILED"].includes(
          application?.status,
        )
      ) {
        if (application.status !== "FAILED")
          this.applicationService.transitionApplication(
            application.id,
            "FAILED",
            { reason: "WORKER_CRASH_RECOVERY" },
          );
        this.applicationService.transitionApplication(
          application.id,
          "RETRYABLE",
          { reason: "WORKER_CRASH_RECOVERY" },
        );
        this.applications.recordEvent(application.id, "ATTEMPT_FAILED", {
          code: "WORKER_CRASH_RECOVERY",
        });
      }
    }
    return recovered.length;
  }

  planApplication(applicationId, analysisId, profile = {}, policyInput = {}) {
    const application = this.applications.findById(applicationId);
    if (!application) throw new Error("Candidatura nao encontrada.");
    const job = this.jobs.findById(application.jobId);
    const jobAnalyses = this.analyses.forJob(job.id);
    const analysis = analysisId
      ? this.analyses.findById(analysisId)
      : jobAnalyses.find(
          (x) =>
            !application.resumeId || x.resumeId === application.resumeId,
        );
    if (!isCurrentAtsAnalysis(analysis))
      throw new Error("Analise ATS V2 da candidatura nao encontrada.");
    const policies = new PolicyEngine({
      blockedCompanies: profile.preferences?.blacklistCompanies,
      blockedKeywords: profile.preferences?.blacklistTitleTerms,
      ...policyInput,
    });
    const existing = this.applications
      .all()
      .map((item) => ({
        ...item,
        company: this.jobs.findById(item.jobId)?.company || "",
      }));
    const resumes = this.resumes.all();
    const pinnedVersion = application.resumeVersionId
        ? this.resumeVersions.findById(application.resumeVersionId)
        : null,
      exactResumeVersion =
        pinnedVersion &&
        pinnedVersion.jobId === job.id &&
        ["APPROVED", "READY"].includes(pinnedVersion.status)
          ? pinnedVersion
          : null,
      approvedResumeVersions = this.resumeVersions
        .list()
        .filter(
          (item) =>
            ["APPROVED", "READY"].includes(item.status) &&
            !item.jobId &&
            !item.tailoringRunId,
        ),
      resumeVersions = exactResumeVersion
        ? [exactResumeVersion]
        : approvedResumeVersions.length
          ? approvedResumeVersions
        : null;
    const resumeSelection = exactResumeVersion
      ? {
          selectedResumeId: exactResumeVersion.resumeId,
          selectedResumeVersionId: exactResumeVersion.id,
          selectedArchetypeId: exactResumeVersion.archetypeId || "GENERAL",
          score: 1,
          reasons: ["Versão específica aprovada para esta vaga."],
          fallback: false,
          candidates: [{
            resumeId: exactResumeVersion.resumeId,
            resumeVersionId: exactResumeVersion.id,
            score: 1,
          }],
        }
      : new ResumeSelector().select({
          resumes,
          resumeVersions,
          analyses: jobAnalyses,
          job,
          requirements: this.jobRequirements.forJob(job.id),
          evidence: analysis.candidateEvidence || [],
          archetypes: this.resumeArchetypes.list(),
          assignments: this.resumeArchetypeAssignments.list({ status: "APPROVED" }),
        });
    const selectedApplication = resumeSelection.selectedResumeId
      ? {
          ...application,
          resumeId: resumeSelection.selectedResumeId,
          resumeVersionId:
            resumeSelection.selectedResumeVersionId ||
            application.resumeVersionId,
        }
      : application;
    const selectedAnalysis =
      jobAnalyses.find(
        (item) => item.resumeId === selectedApplication.resumeId,
      ) || analysis;
    this.candidateFacts.syncProfile(
      CandidateKnowledgeBase.fromProfile(profile).all(),
    );
    const knowledge = CandidateKnowledgeBase.fromFacts(
      this.candidateFacts.active(),
      this.candidateAnswers.reusable(),
    );
    const planned = new ApplicationPlanner(policies).plan({
      application: selectedApplication,
      job,
      analysis: selectedAnalysis,
      resumes,
      resumeVersions,
      existingApplications: existing,
      essentialFactsKnown: Boolean(
        knowledge.get("IDENTITY.FULL_NAME") && knowledge.get("CONTACT.EMAIL"),
      ),
    });
    planned.resumeSelection = resumeSelection;
    planned.selectedResumeVersionId =
      resumeSelection.selectedResumeVersionId ||
      selectedApplication.resumeVersionId ||
      "";
    planned.selectedArchetypeId =
      resumeSelection.selectedArchetypeId || "GENERAL";
    planned.reasons = [
      ...(planned.reasons || []),
      ...resumeSelection.reasons.map(
        (reason) => `Selecao de curriculo: ${reason}`,
      ),
    ];
    const identity = parseGreenhouseIdentity(job.applicationUrl || job.canonicalUrl || job.url);
    const plan = this.applicationPlans.save({
      ...planned,
      greenhouseIdentity: identity,
      profileCompleteness: analyzeProfileCompleteness(profile),
    });
    if (plan.selectedResumeVersionId)
      this.applications.updateDetails({
        ...application,
        resumeId: plan.selectedResumeId,
        resumeVersionId: plan.selectedResumeVersionId,
        updatedAt: new Date().toISOString(),
      });
    if (["DISCOVERED", "MATCHED"].includes(application.status))
      this.applicationService.transitionApplication(applicationId, "PLANNED", {
        decision: plan.decision,
      });
    this.applications.recordEvent(applicationId, "APPLICATION_PLANNED", {
      decision: plan.decision,
      atsType: plan.atsType,
      requiresReview: true,
    });
    return plan;
  }

  answerApplicationQuestion(
    applicationId,
    questionId,
    value,
    { reusable = false } = {},
  ) {
    const current = this.applicationQuestions
      .forApplication(applicationId)
      .find((item) => item.id === questionId);
    if (!current) throw new Error("Pergunta nao encontrada.");
    const question = this.applicationQuestions.answer(
      applicationId,
      questionId,
      value,
      { source: "USER_CONFIRMED", reusable },
    );
    const memory = this.candidateAnswers.saveConfirmed(question, value, {
      reusable,
      scope: question.consentType ? { applicationId } : {},
    });
    this.applications.recordEvent(applicationId, "QUESTION_ANSWERED", {
      field: question.semanticKey,
      source: "USER_CONFIRMED",
      reusable: memory.reusable,
      sensitive: question.sensitive,
    });
    return { question, memory: { ...memory, answerValue: undefined } };
  }

  applicationEngineDetails(applicationId, profile = {}) {
    const plan = this.applicationPlans.forApplication(applicationId);
    const application = this.applications.findById(applicationId);
    const tailoring =
      application && plan
        ? this.resumeTailoring.latestFor(
            application.jobId,
            plan.selectedResumeId,
          )
        : null;
    return {
      application,
      job: application ? this.jobs.findById(application.jobId) : null,
      plan,
      questions: this.applicationQuestions.forApplication(applicationId),
      generatedContent: this.generatedContent.forApplication(applicationId),
      resumeTailoring: tailoring,
      latestAttempt:
        this.applicationAttempts.forApplication(applicationId)[0] || null,
      inspection: this.applicationInspections.latest(applicationId),
      profileCompleteness: analyzeProfileCompleteness(profile),
      queue: this.applicationQueue.forApplication(applicationId),
      submissionPreflight: this.submissionPreflights.latest(applicationId),
      submissionAttempt: this.submissionAttempts.latest(applicationId),
      submissionReceipt: this.submissionReceipts.latest(applicationId),
      submissionConsent: this.submissionConsents.latest(applicationId),
    };
  }

  queueApplication(applicationId, mode) {
    const plan = this.applicationPlans.forApplication(applicationId);
    if (!plan || !["APPLY", "REVIEW"].includes(plan.decision))
      throw new Error("O plano nao permite colocar esta candidatura na fila.");
    let application = this.applications.findById(applicationId);
    if (application.status === "PLANNED")
      application = this.applicationService.transitionApplication(
        applicationId,
        "APPROVED",
        { action: "explicit-queue" },
      );
    if (application.status === "RETRYABLE")
      application = this.applicationService.transitionApplication(
        applicationId,
        "QUEUED",
        { action: "explicit-retry" },
      );
    else if (application.status === "APPROVED")
      application = this.applicationService.transitionApplication(
        applicationId,
        "QUEUED",
        { action: "explicit-queue" },
      );
    if (!["QUEUED", "WAITING_USER"].includes(application.status))
      throw new Error(
        `Candidatura em ${application.status} nao pode entrar na fila.`,
      );
    const queued = this.applicationQueue.enqueue(applicationId, mode);
    this.applications.recordEvent(applicationId, "APPLICATION_QUEUED", {
      mode,
    });
    return queued;
  }

  async readLegacyFile() {
    try {
      const raw = await readFile(this.legacyStatePath, "utf8");
      return { raw, state: normalizeState(JSON.parse(raw)) };
    } catch {
      return { raw: "", state: defaultUnifiedState() };
    }
  }

  async legacyFileSignature() {
    try {
      const details = await stat(this.legacyStatePath);
      return `${details.size}:${Math.floor(details.mtimeMs)}`;
    } catch {
      return "";
    }
  }

  async legacyFileHash() {
    const digest = createHash("sha256");
    await new Promise((resolve, reject) => {
      const stream = createReadStream(this.legacyStatePath);
      stream.on("data", (chunk) => digest.update(chunk));
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    return digest.digest("hex");
  }

  async importLegacyStateIfChanged() {
    const signature = await this.legacyFileSignature();
    if (!signature) return this.importLegacyState();
    const metadata = this.database.connection
      .prepare("SELECT key,value FROM app_metadata WHERE key IN ('legacy_state_signature','legacy_state_sha256')")
      .all();
    const values = new Map(metadata.map((item) => [item.key, item.value]));
    if (values.get("legacy_state_signature") === signature) return { skipped: true };
    if (!values.has("legacy_state_signature") && values.get("legacy_state_sha256")) {
      const currentHash = await this.legacyFileHash();
      if (currentHash === values.get("legacy_state_sha256")) {
        this.database.setMetadata("legacy_state_signature", signature);
        return { skipped: true };
      }
    }
    return this.importLegacyState();
  }

  async ensureLegacyStateLoaded() {
    if (this.legacyStateLoaded) return this.legacyState;
    const { state } = await this.readLegacyFile();
    this.legacyState = { ...state, ...this.searchProjection() };
    this.legacyStateLoaded = true;
    return this.legacyState;
  }

  searchProjection() {
    const row = this.database.connection
      .prepare("SELECT value FROM app_metadata WHERE key='legacy_search_projection'")
      .get();
    if (!row?.value) return {};
    try {
      const parsed = JSON.parse(row.value);
      return {
        searchResults: validCollection(parsed.searchResults).slice(0, 150),
        searchHistory: validCollection(parsed.searchHistory).slice(0, 50),
        portalReports: validCollection(parsed.portalReports).slice(0, 50),
      };
    } catch {
      return {};
    }
  }

  async saveSearchProjection(input = {}) {
    await this.ensureLegacyStateLoaded();
    const current = this.searchProjection();
    const projection = {
      searchResults: validCollection(input.searchResults ?? current.searchResults).slice(0, 150),
      searchHistory: validCollection(input.searchHistory ?? current.searchHistory).slice(0, 50),
      portalReports: validCollection(input.portalReports ?? current.portalReports).slice(0, 50),
    };
    this.database.setMetadata("legacy_search_projection", JSON.stringify(projection));
    Object.assign(this.legacyState, projection);
    return projection;
  }

  async importLegacyState() {
    const { raw, state } = await this.readLegacyFile();
    const signature = await this.legacyFileSignature();
    this.legacyState = state;
    this.legacyStateLoaded = true;
    const report = {
      jobs: 0,
      resumes: 0,
      applications: 0,
      analyses: 0,
      searchSchedules: 0,
      alerts: 0,
      updated: 0,
    };
    this.database.transaction(() => {
      for (const item of state.jobs.map(withTimestamps)) {
        const result = this.jobs.importIfNewer(item);
        report.jobs += Number(result === "inserted");
        report.updated += Number(result === "updated");
      }
      for (const item of state.resumes.map(withTimestamps)) {
        const result = this.resumes.importIfNewer(item);
        report.resumes += Number(result === "inserted");
        report.updated += Number(result === "updated");
      }
      for (const item of state.searchSchedules.map(withTimestamps)) {
        const result = this.searchSchedules.importIfNewer(item);
        report.searchSchedules += Number(result === "inserted");
        report.updated += Number(result === "updated");
      }
      for (const rawItem of state.applications.map(withTimestamps)) {
        if (!this.jobs.findById(rawItem.jobId)) continue;
        const item = {
          ...rawItem,
          resumeId: rawItem.resumeId
            ? this.resumes.findById(rawItem.resumeId)?.id || ""
            : "",
          status: normalizeApplicationStatus(rawItem.status),
        };
        const result = this.applications.insertLegacyIfMissing(item);
        report.applications += Number(result === "inserted");
        report.updated += Number(result === "updated");
      }
      for (const item of state.analyses.map(withTimestamps)) {
        if (
          !this.jobs.findById(item.jobId) ||
          !this.resumes.findById(item.resumeId)
        )
          continue;
        const result = this.analyses.importIfNewer(item);
        report.analyses += Number(result === "inserted");
        report.updated += Number(result === "updated");
        if (
          isCurrentAtsAnalysis(item) &&
          Array.isArray(item.requirements)
        )
          this.jobRequirements.syncForJob(
            item.jobId,
            item.requirements,
            item.updatedAt,
          );
        if (
          isCurrentAtsAnalysis(item) &&
          Array.isArray(item.items)
        )
          this.analysisItems.syncForAnalysis(
            item.id,
            item.items,
            item.createdAt,
          );
      }
      for (const rawItem of state.alerts.map(withTimestamps)) {
        const item = {
          ...rawItem,
          scheduleId: rawItem.scheduleId
            ? this.searchSchedules.findById(rawItem.scheduleId)?.id || ""
            : "",
          jobId: rawItem.jobId
            ? this.jobs.findById(rawItem.jobId)?.id || ""
            : "",
        };
        report.alerts += Number(this.alerts.insertIfMissing(item));
      }
      if (raw)
        this.database.setMetadata(
          "legacy_state_sha256",
          createHash("sha256").update(raw).digest("hex"),
        );
      this.database.setMetadata("legacy_state_signature", signature);
      this.database.setMetadata("legacy_import_report", JSON.stringify(report));
    });
    return report;
  }

  async read() {
    await this.ensureLegacyStateLoaded();
    const analyses = this.analyses.all().map((analysis) => {
      const items = this.analysisItems.forAnalysis(analysis.id);
      const historicalRequirements = items
        .map((item) => item.requirement)
        .filter((item) => item?.id);
      return {
        ...analysis,
        requirements:
          isCurrentAtsAnalysis(analysis)
            ? historicalRequirements.length
              ? historicalRequirements
              : this.jobRequirements.forJob(analysis.jobId)
            : [],
        items,
      };
    });
    return {
      ...this.legacyState,
      jobs: this.jobs.all(),
      resumes: this.resumes.all(),
      applications: this.applications.all(),
      analyses,
      searchSchedules: this.searchSchedules.all(),
      alerts: this.alerts.all(),
    };
  }

  async save(input) {
    const state = normalizeState(input);
    this.database.transaction(() => {
      runStateSyncStep("jobs", () =>
        this.jobs.sync(state.jobs.map(withTimestamps)),
      );
      runStateSyncStep("resumes", () =>
        this.resumes.sync(state.resumes.map(withTimestamps)),
      );
      runStateSyncStep("searchSchedules", () =>
        this.searchSchedules.sync(state.searchSchedules.map(withTimestamps)),
      );
      runStateSyncStep("applications", () =>
        this.applications.sync(state.applications.map(withTimestamps)),
      );
      runStateSyncStep("analyses", () =>
        this.analyses.sync(state.analyses.map(withTimestamps)),
      );
      const latestRequirementsByJob = new Map();
      for (const analysis of [...state.analyses].sort((left, right) =>
        String(right.createdAt || "").localeCompare(
          String(left.createdAt || ""),
        ),
      )) {
        if (
          isCurrentAtsAnalysis(analysis) &&
          Array.isArray(analysis.requirements) &&
          !latestRequirementsByJob.has(analysis.jobId)
        ) {
          latestRequirementsByJob.set(analysis.jobId, analysis);
        }
      }
      for (const [jobId, analysis] of latestRequirementsByJob) {
        runStateSyncStep("jobRequirements", () =>
          this.jobRequirements.syncForJob(
            jobId,
            analysis.requirements,
            analysis.updatedAt || analysis.createdAt,
          ),
        );
      }
      const currentRequirementIds = new Set(
        this.jobRequirements.all().map((item) => item.id),
      );
      for (const analysis of state.analyses) {
        if (Array.isArray(analysis.items)) {
          const items = analysis.items.map((item) => ({
            ...item,
            requirementId:
              item.requirementId &&
              currentRequirementIds.has(item.requirementId)
                ? item.requirementId
                : "",
          }));
          runStateSyncStep("analysisItems", () =>
            this.analysisItems.syncForAnalysis(
              analysis.id,
              items,
              analysis.createdAt,
            ),
          );
        }
      }
      const alerts = state.alerts.map(withTimestamps).map((item) => ({
        ...item,
        scheduleId: item.scheduleId
          ? this.searchSchedules.findById(item.scheduleId)?.id || ""
          : "",
        jobId: item.jobId ? this.jobs.findById(item.jobId)?.id || "" : "",
      }));
      runStateSyncStep("alerts", () => this.alerts.sync(alerts));
    });
    this.database.setMetadata("legacy_search_projection", JSON.stringify({
      searchResults: state.searchResults.slice(0, 150),
      searchHistory: state.searchHistory.slice(0, 50),
      portalReports: state.portalReports.slice(0, 50),
    }));
    this.legacyState = state;
    const persisted = await this.read();
    await atomicWriteJson(this.legacyStatePath, persisted);
    return persisted;
  }

  async saveSearchSchedule(input) {
    const schedule = this.database.transaction(() =>
      this.searchSchedules.upsert(withTimestamps(input)),
    );
    this.legacyState = await this.read();
    await atomicWriteJson(this.legacyStatePath, this.legacyState);
    return schedule;
  }

  async upsertApplication(input) {
    const job = this.jobs.findById(input.jobId);
    if (!job) return { ok: false, error: "Selecione uma vaga cadastrada." };
    const current = input.id ? this.applications.findById(input.id) : null;
    const now = new Date().toISOString();
    const application = this.database.transaction(() => {
      let persisted;
      if (!current) {
        persisted = this.applications.create(
          {
            id: `application-${randomUUID()}`,
            jobId: job.id,
            resumeId: input.resumeId
              ? this.resumes.findById(input.resumeId)?.id || ""
              : "",
            resumeVersionId:
              input.resumeVersionId &&
              this.resumeVersions.findById(input.resumeVersionId)?.resumeId ===
                input.resumeId
                ? input.resumeVersionId
                : "",
            status: normalizeApplicationStatus(input.status || "PLANNED"),
            appliedAt: String(input.appliedAt || ""),
            nextAction: String(input.nextAction || "").trim(),
            notes: String(input.notes || "").trim(),
            createdAt: now,
            updatedAt: now,
          },
          { source: "api" },
        );
      } else {
        const requestedStatus = normalizeApplicationStatus(
          input.status || current.status,
        );
        persisted = this.applications.updateDetails({
          ...current,
          jobId: job.id,
          resumeId: input.resumeId
            ? this.resumes.findById(input.resumeId)?.id || current.resumeId
            : current.resumeId,
          resumeVersionId:
            input.resumeVersionId &&
            this.resumeVersions.findById(input.resumeVersionId)?.resumeId ===
              (input.resumeId || current.resumeId)
              ? input.resumeVersionId
              : current.resumeVersionId,
          appliedAt: String(input.appliedAt ?? current.appliedAt),
          nextAction: String(input.nextAction ?? current.nextAction).trim(),
          notes: String(input.notes ?? current.notes).trim(),
          updatedAt: now,
        });
        if (requestedStatus !== current.status) {
          persisted = this.applicationService.transitionApplication(
            current.id,
            requestedStatus,
            { source: "api" },
          );
        }
      }
      this.jobs.upsert({ ...job, status: persisted.status, updatedAt: now });
      return persisted;
    });
    return { ok: true, application };
  }

  close() {
    this.database.close();
  }
}
