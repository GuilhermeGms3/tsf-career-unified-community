import { applicationProvider } from "../discovery/source-attribution.mjs";

const terminal = new Set(["SUBMITTED", "SUBMISSION_UNCERTAIN", "CANCELLED"]);
const automationSource = (request = {}) =>
  request.source === "ATS_THRESHOLD"
    ? "ats-threshold-autoapply"
    : "whatsapp-autoapply";

export class AutoApplyOrchestrator {
  constructor({
    store,
    profileProvider = async () => ({}),
    applicationEngine,
    applicationBatchService,
    submissionPreflight,
    consentService,
    controlledSubmission,
    submissionEnabled = false,
    resultHandler = null,
    questionEscalation = null,
  } = {}) {
    Object.assign(this, {
      store,
      profileProvider,
      applicationEngine,
      applicationBatchService,
      submissionPreflight,
      consentService,
      controlledSubmission,
      submissionEnabled,
      resultHandler,
      questionEscalation,
    });
    this.inFlight = new Map();
  }

  start(context = {}) {
    const requestId = String(context.request?.id || "");
    if (!requestId) return { status: "FAILED", errorCode: "APPROVAL_REQUEST_REQUIRED" };
    if (this.inFlight.has(requestId)) return { status: "STARTED", reused: true };
    const work = Promise.resolve()
      .then(() => this.execute(context))
      .then(async (result) => {
        this.record(context.application?.id, "AUTOAPPLY_COMPLETED", result);
        await this.notifyResult(context, result);
        return result;
      })
      .catch(async (error) => {
        this.record(context.application?.id, "AUTOAPPLY_FAILED", {
          approvalRequestId: requestId,
          errorCode: error.code || "AUTOAPPLY_FAILED",
        });
        const application = this.store.applications.findById(context.application?.id);
        if (application && !terminal.has(application.status))
          this.store.applications.updateDetails({
            ...application,
            nextAction: "Revisar bloqueio do AutoApply",
          });
        const result = { status: "FAILED", errorCode: error.code || "AUTOAPPLY_FAILED" };
        await this.notifyResult(context, result);
        return result;
      })
      .finally(() => this.inFlight.delete(requestId));
    this.inFlight.set(requestId, work);
    this.record(context.application?.id, "AUTOAPPLY_DISPATCHED", {
      approvalRequestId: requestId,
    });
    queueMicrotask(() => work.catch(() => undefined));
    return { status: "STARTED", reused: false };
  }

  async wait(requestId) {
    return this.inFlight.get(requestId) || null;
  }

  async execute({ request, application }) {
    const current = this.store.applications.findById(application?.id);
    if (!current) throw this.error("AUTOAPPLY_APPLICATION_NOT_FOUND");
    if (terminal.has(current.status)) return { status: current.status, applicationId: current.id, reused: true };
    const job = this.store.jobs.findById(current.jobId);
    if (!job) throw this.error("AUTOAPPLY_JOB_NOT_FOUND");
    this.assertResumeQuality(current, request?.source === "ATS_THRESHOLD");
    const destination = job.applicationUrl || job.canonicalUrl || job.url;
    const provider = applicationProvider(destination).toLowerCase();
    if (provider === "gupy") return this.executeGupy({ request, application: current, job });
    const capability = this.applicationEngine?.registry?.describe(provider);
    if (provider !== "unknown" && capability?.canFill)
      return this.executeHosted({ request, application: current, job, provider });
    this.store.applications.updateDetails({
      ...current,
      nextAction: `Abrir candidatura manual (${provider === "unknown" ? "portal não reconhecido" : provider})`,
    });
    this.record(current.id, "AUTOAPPLY_MANUAL_HANDOFF", { provider, destination });
    return { status: "WAITING_USER", provider, applicationId: current.id, reason: "ADAPTER_NOT_AVAILABLE" };
  }

  async executeHosted({ request, application, job, provider }) {
    const source = automationSource(request);
    let current = this.store.applications.findById(application.id);
    if (!this.store.applicationPlans.forApplication(current.id)) {
      const analysis = this.latestAnalysis(job.id, current.resumeId);
      if (!analysis) throw this.error("AUTOAPPLY_ANALYSIS_NOT_FOUND");
      const plan = this.store.planApplication(current.id, analysis.id, await this.profileProvider());
      if (!["APPLY", "REVIEW"].includes(plan.decision)) throw this.error("AUTOAPPLY_POLICY_BLOCKED");
    }
    current = this.store.applications.findById(current.id);
    if (current.status === "APPROVED")
      current = this.store.applicationService.transitionApplication(current.id, "QUEUED", {
        source,
        approvalRequestId: request.id,
      });
    if (current.status === "FAILED")
      current = this.store.applicationService.transitionApplication(current.id, "RETRYABLE", {
        source: `${source}-retry`,
        approvalRequestId: request.id,
      });
    if (current.status === "RETRYABLE")
      current = this.store.applicationService.transitionApplication(current.id, "QUEUED", {
        source: `${source}-retry`,
        approvalRequestId: request.id,
      });
    let result;
    if (["QUEUED", "WAITING_USER"].includes(current.status)) result = await this.applicationEngine.run({ applicationId: current.id, mode: "FILL_ONLY" });
    current = this.store.applications.findById(current.id);
    if (current.status !== "READY_TO_SUBMIT") {
      const escalation = current.status === "WAITING_USER" && this.questionEscalation
        ? await this.questionEscalation.escalate(current.id).catch((error) => ({ status: "FAILED", reason: error.code || "QUESTION_ESCALATION_FAILED" }))
        : null;
      return { status: current.status, provider, applicationId: current.id, reason: result?.attempt?.errorCode || "USER_ACTION_REQUIRED", escalation };
    }
    const capability = this.applicationEngine.registry?.describe(provider) || { canSubmit: provider === "greenhouse" };
    if (!capability.canSubmit) {
      this.store.applications.updateDetails({ ...current, nextAction: "Revisar e concluir envio no portal" });
      return { status: "READY_TO_SUBMIT_MANUAL", provider, applicationId: current.id };
    }
    if (!this.submissionEnabled) {
      this.store.applications.updateDetails({ ...current, nextAction: "Habilitar Controlled Submit para concluir" });
      return { status: "READY_TO_SUBMIT", provider, applicationId: current.id, reason: "SUBMISSION_DISABLED" };
    }
    const preflight = await this.submissionPreflight.evaluate(current.id, { persist: true, fresh: true, mode: "PREVIEW" });
    if (!preflight.readyForConsent) throw this.error("AUTOAPPLY_FINAL_PREFLIGHT_BLOCKED");
    const granted = this.consentService.grant(current.id, preflight);
    const submitted = await this.controlledSubmission.submit({
      applicationId: current.id,
      consentToken: granted.token,
      idempotencyKey: `${source}:${request.id}:${provider}`,
    });
    return {
      status: submitted.uncertain ? "SUBMISSION_UNCERTAIN" : submitted.attempt.status,
      provider,
      applicationId: current.id,
      receiptId: submitted.receipt?.id || "",
    };
  }

  async executeGupy({ request, application, job }) {
    const source = automationSource(request);
    let draft = this.store.applicationBatches.forApplication(application.id);
    if (!draft) {
      const batch = await this.applicationBatchService.create({
        jobIds: [job.id],
        versions: { [job.id]: application.resumeVersionId },
        applications: { [job.id]: application.id },
        mode: "FILL_ONLY",
        policyMode: "APPROVAL_REQUIRED",
        automatic: false,
        schedule: false,
        approvalRequestId: request.id,
      });
      draft = batch.items[0];
    }
    if (draft.status === "PREPARING") await this.applicationBatchService.prepare(draft);
    draft = this.store.applicationBatches.findItem(draft.id);
    if (draft.status !== "READY_TO_SUBMIT")
      return { status: draft.status, provider: "gupy", applicationId: application.id, draftId: draft.id, reason: draft.reason || "USER_ACTION_REQUIRED" };
    if (!this.submissionEnabled)
      return { status: "READY_TO_SUBMIT", provider: "gupy", applicationId: application.id, draftId: draft.id, reason: "SUBMISSION_DISABLED" };
    const result = await this.applicationBatchService.submit(draft.id, {
      confirmed: true,
      idempotencyKey: `${source}:${request.id}:gupy`,
    });
    return {
      status: result.uncertain ? "SUBMISSION_UNCERTAIN" : result.attempt.status,
      provider: "gupy",
      applicationId: application.id,
      draftId: draft.id,
      receiptId: result.receipt?.id || "",
    };
  }

  latestAnalysis(jobId, resumeId) {
    return this.store.analyses
      .forJob(jobId)
      .filter((item) => item.jobId === jobId && (!resumeId || item.resumeId === resumeId))
      .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt))[0] || null;
  }

  assertResumeQuality(application, requireTailoring = false){
    const version=this.store.resumeVersions?.findById?.(application.resumeVersionId);
    if(!version?.tailoringRunId){if(requireTailoring)throw this.error("AUTOAPPLY_RESUME_QUALITY_REVIEW_REQUIRED");return;}
    const run=this.store.resumeTailoring?.findRun?.(version.tailoringRunId),quality=run?.quality;
    if(!quality||run.evidenceStatus!=="VALID"||quality.status!=="PASS"||quality.autoApplyEligible!==true)throw this.error("AUTOAPPLY_RESUME_QUALITY_REVIEW_REQUIRED");
  }

  record(applicationId, type, payload) {
    if (applicationId && this.store.applications.findById(applicationId))
      this.store.applications.recordEvent(applicationId, type, payload || {});
  }

  async notifyResult(context, result) {
    if (typeof this.resultHandler !== "function") return;
    try {
      await this.resultHandler(context, result);
    } catch (error) {
      this.record(context.application?.id, "AUTOAPPLY_RESULT_NOTIFICATION_FAILED", { errorCode: error.code || "AUTOAPPLY_RESULT_NOTIFICATION_FAILED" });
    }
  }

  error(code) {
    return Object.assign(new Error(code), { code, status: 409 });
  }
}
