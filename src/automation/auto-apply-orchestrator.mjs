import { applicationProvider } from "../discovery/source-attribution.mjs";
import { jobInformationQuality } from "../matching/job-information-quality.mjs";
import { classifyAutomationFailure } from "./automation-failure.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { evaluateApplicationRoutingPolicy, resumeAtsScore, tailoringAllowsAutoApply } from "../application/application-routing-policy.mjs";

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
    availabilityService = null,
    retryDelay = delay,
    manualSince = "",
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
      availabilityService,
      retryDelay,
      manualSince,
    });
    this.inFlight = new Map();
    this.workerId = `autoapply-${randomUUID()}`;
    this.leases = new Map();
    this.draining = false;
  }

  start(context = {}) {
    if(this.manualSince&&(!context.request?.decisionId||context.request.source!=="MOBILE"))return {status:"FAILED",errorCode:"MANUAL_APPROVAL_REQUIRED"};
    const requestId = String(context.request?.id || "");
    if (!requestId) return { status: "FAILED", errorCode: "APPROVAL_REQUEST_REQUIRED" };
    if (this.inFlight.has(requestId)) return { status: "STARTED", reused: true };
    const applicationId=String(context.application?.id||"");
    if(!applicationId||!this.store.applications.findById(applicationId))
      return {status:"FAILED",errorCode:"AUTOAPPLY_APPLICATION_NOT_FOUND"};
    const persisted=this.store.autoApplyRuns?.claim({requestId,applicationId,source:automationSource(context.request),workerId:this.workerId,recoverExpired:!this.manualSince,context:{request:context.request,resumeVersionId:this.store.applications.findById(applicationId).resumeVersionId}});
    if(persisted?.reused)return persisted.run.status==="COMPLETED"?{status:persisted.run.result.status||"COMPLETED",reused:true,result:persisted.run.result}:{status:"STARTED",reused:true};
    const ownership=persisted?{workerId:this.workerId,generation:persisted.run.generation}:null;
    if(ownership)this.leases.set(applicationId,{requestId,...ownership,request:context.request});
    const heartbeat=ownership?setInterval(()=>{try{this.store.autoApplyRuns.renew(requestId,this.workerId,ownership.generation);}catch{/* A failed renewal never authorizes a later submit. */}},10000):null;
    heartbeat?.unref();
    const work = Promise.resolve()
      .then(() => this.execute(context))
      .then(async (result) => {
        if(ownership&&!this.store.autoApplyRuns.owns(requestId,this.workerId,ownership.generation))return {status:"WAITING_USER",reason:"AUTOAPPLY_LEASE_LOST",applicationId};
        this.store.autoApplyRuns?.complete(requestId,result,ownership||{});
        this.record(context.application?.id, "AUTOAPPLY_COMPLETED", result);
        await this.notifyResult(context, result);
        return result;
      })
      .catch(async (error) => {
        if(ownership&&!this.store.autoApplyRuns.owns(requestId,this.workerId,ownership.generation))return {status:"WAITING_USER",reason:"AUTOAPPLY_LEASE_LOST",applicationId};
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
        const job = application && this.store.jobs.findById(application.jobId);
        const result = { status: application && ["SUBMITTED", "SUBMISSION_UNCERTAIN", "SUBMITTING", "CANCELLED"].includes(application.status) ? application.status : "FAILED", errorCode: error.code || "AUTOAPPLY_FAILED",
          provider: error.provider || (job ? applicationProvider(job.applicationUrl || job.canonicalUrl || job.url).toLowerCase() : "unknown"),
          blockingReasons: error.blockingReasons || [], matchScore: error.matchScore, minimumMatchScore: error.minimumMatchScore,
          recoveryAttempts: error.recoveryAttempts || 0, failureClass: error.failureClass || "" };
        this.store.autoApplyRuns?.complete(requestId,result,ownership||{});
        await this.notifyResult(context, result);
        return result;
      })
      .finally(() => {if(heartbeat)clearInterval(heartbeat);if(this.leases.get(applicationId)?.requestId===requestId)this.leases.delete(applicationId);this.inFlight.delete(requestId);});
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

  assertLease(applicationId){
    const lease=this.leases.get(applicationId);
    if(lease&&!this.store.autoApplyRuns.owns(lease.requestId,lease.workerId,lease.generation))throw this.error("AUTOAPPLY_LEASE_LOST");
    if(lease?.request?.source==="ATS_THRESHOLD"&&this.automaticRouting(this.store.applications.findById(applicationId)).route!=="AUTO_APPLY")throw this.error("AUTOAPPLY_POLICY_REVALIDATION_REQUIRED");
    if(lease?.request?.decisionId){const decision=this.store.applicationDecisions.findById(lease.request.decisionId);if(!decision||!this.store.applicationDecisionService.isCurrent(decision))throw this.error("DECISION_CONTEXT_STALE");}
    if(lease?.request?.approvalRequestId&&!lease.request.decisionId&&!this.recoveryAuthorized(lease.request,this.store.applications.findById(applicationId)))throw this.error("AUTOAPPLY_RECOVERY_APPROVAL_REQUIRED");
  }

  async resumePending(){
    if(this.draining||this.inFlight.size||!this.store.autoApplyRuns?.pending)return;
    this.draining=true;
    try{
      if(!this.manualSince)this.store.autoApplyRuns.recoverExpired();
      const run=this.store.autoApplyRuns.pending(1,{since:this.manualSince,manualOnly:Boolean(this.manualSince)})[0];if(!run)return;
      const application=this.store.applications.findById(run.applicationId),request=run.context?.request;
      let reason="";
      if(!application||terminal.has(application.status)||application.status==="SUBMITTING"||this.store.submissionReceipts.latest(run.applicationId)||["PENDING","SUBMITTING","UNCERTAIN"].includes(this.store.submissionAttempts.latest(run.applicationId)?.status))reason="APPLICATION_NOT_RECOVERABLE";
      else if(!request?.id||!run.context.resumeVersionId||run.context.resumeVersionId!==application.resumeVersionId)reason="AUTOAPPLY_RECOVERY_CONTEXT_STALE";
      else if(run.attemptCount>=3)reason="AUTOAPPLY_RECOVERY_LIMIT_REACHED";
      else if(!this.recoveryAuthorized(request,application))reason="AUTOAPPLY_RECOVERY_APPROVAL_REQUIRED";
      else if(this.store.applicationQuestions.forApplication(application.id).some(q=>q.required&&q.answerStatus==="USER_REQUIRED"))reason="REQUIRED_FIELD_UNKNOWN";
      if(reason){
        const messages={AUTOAPPLY_RECOVERY_CONTEXT_STALE:"Atualizar curriculo e revisar a autorizacao de envio",AUTOAPPLY_RECOVERY_LIMIT_REACHED:"Retomada automatica esgotada; revisar a tentativa antes de continuar",AUTOAPPLY_RECOVERY_APPROVAL_REQUIRED:"Renovar aprovacao antes de retomar",REQUIRED_FIELD_UNKNOWN:"Responder a pergunta obrigatoria antes de retomar"};
        let current=application;
        if(application&&["APPROVED","QUEUED","OPENING_PAGE","FILLING","VALIDATING","READY_TO_SUBMIT"].includes(application.status))current=this.store.applicationService.transitionApplication(application.id,"WAITING_USER",{source:"autoapply-recovery",reason});
        const escalation=reason==="REQUIRED_FIELD_UNKNOWN"&&this.questionEscalation?await this.questionEscalation.escalate(application.id).catch(error=>({status:"FAILED",reason:error.code||"QUESTION_ESCALATION_FAILED"})):null;
        const result={status:current?.status||"WAITING_USER",reason,applicationId:run.applicationId,escalation};
        this.store.autoApplyRuns.finishPending(run.requestId,result);
        if(current&&!terminal.has(current.status)&&current.status!=="SUBMITTING")this.store.applications.updateDetails({...current,nextAction:messages[reason]||"Conferir estado e historico antes de retomar"});
        this.record(run.applicationId,"AUTOAPPLY_RECOVERY_WAITING_USER",result);
        await this.notifyResult({request:request||{id:run.requestId},application},result);return result;
      }
      return this.start({request,application});
    }finally{this.draining=false;}
  }

  recoveryAuthorized(request,application){
    if(request.source==="ATS_THRESHOLD")return this.automaticRouting(application).route==="AUTO_APPLY";
    const decision=request.decisionId&&this.store.applicationDecisions?.findById(request.decisionId);
    if(decision)return decision.applicationId===application.id&&decision.resumeVersionId===application.resumeVersionId&&decision.decision==="APPROVE"&&decision.mode==="AUTO_APPLY"&&this.store.applicationDecisionService.isCurrent(decision);
    const approval=this.store.whatsappApprovals.findById(request.approvalRequestId||request.id);
    return approval?.status==="APPROVED"&&(!approval.expiresAt||Date.parse(approval.expiresAt)>Date.now())&&approval.applicationId===application.id&&approval.resumeVersionId===application.resumeVersionId&&
      this.store.applications.events(application.id).some(event=>event.eventType==="WHATSAPP_APPROVAL_MODE_SELECTED"&&event.metadata?.approvalRequestId===approval.id&&event.metadata?.approvalMode==="AUTO_APPLY");
  }

  async execute({ request, application }) {
    this.assertLease(application.id);
    const current = this.store.applications.findById(application?.id);
    if (!current) throw this.error("AUTOAPPLY_APPLICATION_NOT_FOUND");
    if (terminal.has(current.status)) return { status: current.status, applicationId: current.id, reused: true };
    if(request?.source==="ATS_THRESHOLD"&&this.store.autoApplyPolicy&&this.automaticRouting(current).route!=="AUTO_APPLY")return {status:"WAITING_USER",applicationId:current.id,reason:"AUTOAPPLY_POLICY_REVALIDATION_REQUIRED"};
    const job = this.store.jobs.findById(current.jobId);
    if (!job) throw this.error("AUTOAPPLY_JOB_NOT_FOUND");
    const provider = applicationProvider(job.applicationUrl || job.canonicalUrl || job.url).toLowerCase();
    const alreadyClosed = job.lifecycleStatus === "CLOSED" || job.availability?.status === "CLOSED";
    const verification = !alreadyClosed && this.availabilityService
      ? await this.availabilityService.verify(job.id).catch(() => null) : null;
    const latest = this.store.applications.findById(current.id);
    this.assertLease(current.id);
    if (["SUBMITTED", "SUBMISSION_UNCERTAIN", "SUBMITTING", "CANCELLED"].includes(latest?.status))
      return { status: latest.status, provider, applicationId: latest.id, reused: true };
    if (alreadyClosed || verification?.availability?.status === "CLOSED") {
      const cancelled = this.store.applicationService.transitionApplication(current.id, "CANCELLED", { source: "autoapply-availability", reason: "JOB_CLOSED" });
      this.store.applications.updateDetails({ ...cancelled, nextAction: "Vaga encerrada no portal; nenhuma candidatura enviada" });
      return { status: "CANCELLED", provider, applicationId: current.id, reason: "JOB_CLOSED" };
    }
    if (this.availabilityService && verification?.availability?.status !== "AVAILABLE") {
      this.store.applications.updateDetails({ ...latest, nextAction: "Confirmar disponibilidade da vaga no portal antes de continuar" });
      return { status: "WAITING_USER", provider, applicationId: current.id, reason: "JOB_AVAILABILITY_UNCONFIRMED" };
    }
    if (request?.source === "ATS_THRESHOLD" && !jobInformationQuality(job).sufficient) {
      this.store.applications.updateDetails({ ...current, nextAction: "Atualizar descrição da vaga antes do envio automático" });
      return { status: "WAITING_USER", applicationId: current.id, reason: "JOB_DESCRIPTION_INSUFFICIENT" };
    }
    this.assertResumeQuality(current, request?.source === "ATS_THRESHOLD");
    const destination = job.applicationUrl || job.canonicalUrl || job.url;
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
    let plan = this.store.applicationPlans.forApplication(current.id);
    const approvalId = request.approvalRequestId || request.id;
    const approval = request.source !== "ATS_THRESHOLD" ? this.store.whatsappApprovals?.findById(approvalId) : null;
    const mode = approval && this.store.applications.events(current.id).findLast(event =>
      event.eventType === "WHATSAPP_APPROVAL_MODE_SELECTED" && event.metadata?.approvalRequestId === approval.id)?.metadata?.approvalMode;
    const humanScoreApproved = approval?.status === "APPROVED" && approval.applicationId === current.id && approval.resumeVersionId === current.resumeVersionId && mode === "AUTO_APPLY";
    if (!plan || (humanScoreApproved && plan.decision === "SKIP")) {
      const analysis = this.latestAnalysis(job.id, current.resumeId);
      if (!analysis) throw this.error("AUTOAPPLY_ANALYSIS_NOT_FOUND");
      plan = this.store.planApplication(current.id, analysis.id, await this.profileProvider(), humanScoreApproved ? { minimumMatchScore: 0 } : {});
      if (humanScoreApproved) this.record(current.id, "AUTOAPPLY_HUMAN_SCORE_APPROVAL", { approvalRequestId: approval.id, resumeVersionId: current.resumeVersionId, matchScore: plan.matchScore });
    }
    if (!["APPLY", "REVIEW"].includes(plan.decision)) throw Object.assign(this.error("AUTOAPPLY_POLICY_BLOCKED"), {
        provider, blockingReasons: [...(plan.blockingIssues || []), ...(plan.reasons || [])].slice(0, 6).map(item => String(typeof item === "string" ? item : item.message || item.code || "Revisar política").slice(0, 200)),
        matchScore: plan.matchScore, minimumMatchScore: plan.policySnapshot?.minimumMatchScore,
      });
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
    if (["QUEUED", "WAITING_USER"].includes(current.status)) result = await this.fillWithRecovery(current.id);
    current = this.store.applications.findById(current.id);
    if (current.status !== "READY_TO_SUBMIT") {
      const escalation = current.status === "WAITING_USER" && result?.attempt?.errorCode === "REQUIRED_FIELD_UNKNOWN" && this.questionEscalation
        ? await this.questionEscalation.escalate(current.id).catch((error) => ({ status: "FAILED", reason: error.code || "QUESTION_ESCALATION_FAILED" }))
        : null;
      return { status: current.status, provider, applicationId: current.id, reason: result?.attempt?.errorCode || "USER_ACTION_REQUIRED", escalation };
    }
    const inspection = this.store.applicationInspections?.latest(current.id);
    const capability = this.applicationEngine.registry?.describe(provider, { scenario: inspection?.detectedVariant || "" }) || { canSubmit: false };
    if (!capability.canSubmit) {
      this.store.applications.updateDetails({ ...current, nextAction: "Revisar e concluir envio no portal" });
      return { status: "READY_TO_SUBMIT_MANUAL", provider, applicationId: current.id };
    }
    if (!this.submissionEnabled) {
      this.store.applications.updateDetails({ ...current, nextAction: "Habilitar Controlled Submit para concluir" });
      return { status: "READY_TO_SUBMIT", provider, applicationId: current.id, reason: "SUBMISSION_DISABLED" };
    }
    if(request.source==="ATS_THRESHOLD"&&!this.automaticSubmitVerified(provider,current.id)){
      this.store.applications.updateDetails({...current,nextAction:"Revisar envio: este portal ainda nao tem homologacao externa confirmada"});
      return {status:"READY_TO_SUBMIT_MANUAL",provider,applicationId:current.id,reason:"PORTAL_EXTERNAL_SUBMIT_NOT_VERIFIED"};
    }
    const preflight = await this.submissionPreflight.evaluate(current.id, { persist: true, fresh: true, mode: "PREVIEW" });
    const afterPreflight = this.store.applications.findById(current.id);
    if (terminal.has(afterPreflight.status)) return { status: afterPreflight.status, provider, applicationId: current.id, reused: true };
    if (!preflight.readyForConsent) throw this.error("AUTOAPPLY_FINAL_PREFLIGHT_BLOCKED");
    if(request.source==="ATS_THRESHOLD"&&!this.automaticSubmitVerified(provider,current.id)){
      this.store.applications.updateDetails({...afterPreflight,nextAction:"Revisar envio: o cenario atual nao possui homologacao vigente"});
      return {status:"READY_TO_SUBMIT_MANUAL",provider,applicationId:current.id,reason:"PORTAL_EXTERNAL_SUBMIT_NOT_VERIFIED"};
    }
    const granted = this.consentService.grant(current.id, preflight, this.authorization(request));
    const submitted = await this.controlledSubmission.submit({
      applicationId: current.id,
      consentToken: granted.token,
      idempotencyKey: `${source}:${request.id}:${provider}`,
      assertExecutionAllowed:()=>this.assertLease(current.id),
    });
    return {
      status: submitted.uncertain ? "SUBMISSION_UNCERTAIN" : submitted.attempt.status,
      provider,
      applicationId: current.id,
      receiptId: submitted.receipt?.id || "",
    };
  }

  automaticSubmitVerified(provider,applicationId){
    const registry=this.applicationEngine.registry,inspection=this.store.applicationInspections?.latest(applicationId);
    if(!inspection||inspection.adapterType!==provider||inspection.adapterVersion!==registry?.version(provider))return false;
    return registry.describe(provider,{scenario:inspection.detectedVariant}).homologation?.automaticSubmitEligible===true;
  }

  async fillWithRecovery(applicationId) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.assertLease(applicationId);
        return await this.applicationEngine.run({ applicationId, mode: "FILL_ONLY" });
      } catch (error) {
        const failureClass = classifyAutomationFailure(error);
        const current = this.store.applications.findById(applicationId);
        // Retry only a failed pre-submit fill that the engine explicitly made retryable.
        if (attempt === 3 || failureClass !== "RETRYABLE" || current?.status !== "RETRYABLE") {
          error.recoveryAttempts = attempt;
          error.failureClass = failureClass;
          throw error;
        }
        this.record(applicationId, "AUTOAPPLY_RECOVERY_SCHEDULED", {
          attempt, nextAttempt: attempt + 1, reason: error.code || "ATTEMPT_FAILED", delayMs: attempt * 1000,
        });
        await this.retryDelay(attempt * 1000);
        const latest = this.store.applications.findById(applicationId);
        if (latest?.status !== "RETRYABLE") return { application: latest, attempt: null };
        this.store.applicationService.transitionApplication(applicationId, "QUEUED", { source: "autoapply-fill-recovery", attempt: attempt + 1 });
      }
    }
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
    if (draft.status === "WAITING_USER" && this.applicationBatchService.canRetry(draft))
      draft = this.applicationBatchService.queue(draft.id, draft.mode);
    if (draft.status === "PREPARING") await this.applicationBatchService.prepare(draft);
    draft = this.store.applicationBatches.findItem(draft.id);
    const afterPreparation=this.store.applications.findById(application.id);
    if(!afterPreparation||terminal.has(afterPreparation.status)||afterPreparation.status==="SUBMITTING")return {status:afterPreparation?.status||"CANCELLED",provider:"gupy",applicationId:application.id,reused:true};
    for(let attempt=1;attempt<3&&draft.status==="FAILED"&&classifyAutomationFailure({code:draft.reason})==="RETRYABLE"&&this.applicationBatchService.canRetry(draft);attempt++){
      this.record(application.id,"AUTOAPPLY_RECOVERY_SCHEDULED",{provider:"gupy",attempt,nextAttempt:attempt+1,reason:draft.reason,delayMs:attempt*1000});
      await this.retryDelay(attempt*1000);
      const current=this.store.applications.findById(application.id);
      if(!current||terminal.has(current.status)||current.status==="SUBMITTING")return {status:current?.status||"CANCELLED",provider:"gupy",applicationId:application.id,reused:true};
      draft=this.applicationBatchService.queue(draft.id,draft.mode||"FILL_ONLY");
      await this.applicationBatchService.prepare(draft);
      draft=this.store.applicationBatches.findItem(draft.id);
    }
    if (draft.status !== "READY_TO_SUBMIT") {
      const reason=draft.reason || "USER_ACTION_REQUIRED";
      let escalation=null;
      if(draft.status==="WAITING_USER" && reason==="REQUIRED_ANSWER_UNKNOWN" && this.questionEscalation)
        escalation=await this.questionEscalation.escalate(application.id).catch(error=>({status:"FAILED",reason:error.code||"QUESTION_ESCALATION_FAILED"}));
      const current=this.store.applications.findById(application.id);
      if(!current||terminal.has(current.status)||current.status==="SUBMITTING")return {status:current?.status||"CANCELLED",provider:"gupy",applicationId:application.id,reused:true};
      if(draft.status==="WAITING_USER" && current?.status==="APPROVED")this.store.applicationService.transitionApplication(application.id,"QUEUED",{source,reason});
      if(draft.status==="WAITING_USER" && ["QUEUED","OPENING_PAGE","FILLING","VALIDATING","READY_TO_SUBMIT"].includes(this.store.applications.findById(application.id)?.status))this.store.applicationService.transitionApplication(application.id,"WAITING_USER",{source,reason});
      return { status: draft.status, provider: "gupy", applicationId: application.id, draftId: draft.id, reason:reason==="REQUIRED_ANSWER_UNKNOWN"?"REQUIRED_FIELD_UNKNOWN":reason, escalation };
    }
    for(const [from,to] of [["APPROVED","QUEUED"],["QUEUED","WAITING_USER"],["WAITING_USER","READY_TO_SUBMIT"]]){
      if(this.store.applications.findById(application.id)?.status===from)this.store.applicationService.transitionApplication(application.id,to,{source,reason:"GUPY_DRAFT_READY"});
    }
    if (!this.submissionEnabled){
      const current=this.store.applications.findById(application.id);
      this.store.applications.updateDetails({...current,nextAction:"Formulario Gupy preenchido; AutoSubmit desativado nesta instalacao"});
      return { status: "READY_TO_SUBMIT", provider: "gupy", applicationId: application.id, draftId: draft.id, reason: "SUBMISSION_DISABLED" };
    }
    const latest = this.store.applications.findById(application.id);
    if (terminal.has(latest.status)) return { status: latest.status, provider: "gupy", applicationId: application.id, reused: true };
    if(request.source==="ATS_THRESHOLD")return {status:"READY_TO_SUBMIT_MANUAL",provider:"gupy",applicationId:application.id,reason:"PORTAL_EXTERNAL_SUBMIT_NOT_VERIFIED"};
    const result = await this.applicationBatchService.submit(draft.id, {
      confirmed: true,
      idempotencyKey: `${source}:${request.id}:gupy`,
      authorization: this.authorization(request),
      assertExecutionAllowed:()=>this.assertLease(application.id),
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

  automaticRouting(application){
    const version=this.store.resumeVersions.findById(application.resumeVersionId),run=version?.tailoringRunId?this.store.resumeTailoring.findRun(version.tailoringRunId):null;
    return evaluateApplicationRoutingPolicy({score:resumeAtsScore(version||{}),policy:this.store.autoApplyPolicy.get(),qualityApproved:tailoringAllowsAutoApply(run),descriptionSufficient:jobInformationQuality(this.store.jobs.findById(application.jobId)||{}).sufficient});
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

  authorization(request={}){
    return {source:request.source==="ATS_THRESHOLD"?"ATS_THRESHOLD_POLICY":request.source||"WHATSAPP_APPROVAL",reference:String(request.id||"")};
  }
}
