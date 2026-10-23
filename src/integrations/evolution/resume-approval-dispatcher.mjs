import { randomUUID } from "node:crypto";
import { jobInformationQuality } from "../../matching/job-information-quality.mjs";
import { evaluateApplicationRoutingPolicy, resumeAtsScore, tailoringAllowsAutoApply } from "../../application/application-routing-policy.mjs";

const keyFor = (jobId, resumeVersionId) => `${jobId}:${resumeVersionId}`;
const atsScoreOf = resumeAtsScore;
const approvedBase = (store) => {
  const resumeId = store.database?.getMetadata?.("default_resume_id", "") || "";
  const resume = resumeId ? store.resumes.findById(resumeId) : null;
  return resume?.resumeKind === "BASE" ? resume : null;
};

export class ResumeApprovalDispatcher {
  constructor({
    store,
    approvalGateway,
    policyProvider = () => ({
      enabled: false,
      minimumAtsScore: 80,
      whatsappMinimumAtsScore: 60,
      whatsappMaximumAtsScore: 79,
    }),
    autoApplyHandler = null,
  } = {}) {
    Object.assign(this, {
      store,
      approvalGateway,
      policyProvider,
      autoApplyHandler,
    });
    this.inFlight = new Map();
  }

  dispatch({ jobId = "", resumeVersionId = "", allowWhatsApp = true, reviewOnly = false } = {}) {
    const key = keyFor(jobId, resumeVersionId);
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const work = this.execute({ jobId, resumeVersionId, allowWhatsApp, reviewOnly })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work);
    return work;
  }

  async execute({ jobId, resumeVersionId, allowWhatsApp = true, reviewOnly = false }) {
    const version = this.store.resumeVersions.findById(String(resumeVersionId || ""));
    if (!version?.jobId)
      return { sent: false, status: "SKIPPED", reason: "JOB_SPECIFIC_VERSION_REQUIRED" };
    if (jobId && version.jobId !== jobId)
      return { sent: false, status: "SKIPPED", reason: "JOB_VERSION_MISMATCH" };
    if (version.status !== "READY")
      return { sent: false, status: "SKIPPED", reason: "RESUME_VERSION_NOT_READY" };
    const base = approvedBase(this.store);
    if (!base || version.resumeId !== base.id)
      return { sent: false, status: "SKIPPED", reason: "APPROVED_BASE_REQUIRED" };

    const job = this.store.jobs.findById(version.jobId);
    if (!job)
      return { sent: false, status: "SKIPPED", reason: "JOB_NOT_FOUND" };
    if (job.lifecycleStatus === "CLOSED" || job.availability?.status === "CLOSED")
      return { handled: true, sent: false, status: "SKIPPED", reason: "JOB_CLOSED" };
    const submitted = this.store.applications.all().find((item) =>
      item.jobId === job.id &&
      item.resumeVersionId === version.id &&
      item.status === "SUBMITTED");
    if (submitted)
      return {
        sent: false,
        status: "SKIPPED",
        reason: "APPLICATION_ALREADY_SUBMITTED",
        application: submitted,
      };

    const artifact = this.store.resumeArtifacts.latest(version.id, "PDF");
    if (!artifact || artifact.status !== "READY")
      return { sent: false, status: "SKIPPED", reason: "READY_PDF_REQUIRED" };

    const policy=this.policyProvider(),atsScore=atsScoreOf(version),tailoring=version.tailoringRunId?this.store.resumeTailoring?.findRun?.(version.tailoringRunId):null;
    if(reviewOnly)return this.queueForReview({job,version,atsScore});
    const routing=evaluateApplicationRoutingPolicy({score:atsScore,policy,qualityApproved:tailoringAllowsAutoApply(tailoring),descriptionSufficient:jobInformationQuality(job).sufficient});
    if(routing.route==="AUTO_APPLY")return this.dispatchAutoApply({job,version,policy,atsScore});
    if(routing.route==="PLATFORM_ANALYSIS")return {...this.queueForReview({job,version,atsScore}),reason:routing.reasons[0]||"ROUTING_REVIEW_REQUIRED"};

    if (!allowWhatsApp)
      return { handled: false, sent: false, status: "WHATSAPP_DEFERRED", atsScore };

    const prepared = this.approvalGateway.prepare({
      jobId: job.id,
      resumeVersionId: version.id,
      artifactId: artifact.id,
    });
    if (prepared.request.status === "AWAITING_APPROVAL")
      return {
        handled: true,
        sent: true,
        reused: true,
        status: "AWAITING_APPROVAL",
        request: prepared.request,
        application: prepared.application,
      };
    const sent = await this.approvalGateway.send(
      prepared.request.id,
      prepared.request.id,
    );
    return {
      ...sent,
      handled: true,
      status: "AWAITING_APPROVAL",
      request: sent.request,
      application: prepared.application,
    };
  }

  queueForReview({ job, version, atsScore }) {
    let application = this.store.applications.all().find((item) =>
      item.jobId === job.id && item.resumeVersionId === version.id &&
      !["CANCELLED", "SUBMITTED"].includes(item.status));
    if (!application) {
      const timestamp = new Date().toISOString();
      application = this.store.applications.create({
        id: `application-${randomUUID()}`,
        jobId: job.id,
        resumeId: version.resumeId,
        resumeVersionId: version.id,
        status: "PLANNED",
        nextAction: "Revisar currículo na fila de candidaturas",
        notes: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { source: "ats-score-review-queue" });
      this.store.applications.recordEvent(application.id, "AUTOAPPLY_ATS_REVIEW_QUEUED", {
        atsScore,
        resumeVersionId: version.id,
      });
    }
    return { handled: true, sent: false, status: "QUEUED_FOR_REVIEW", atsScore, application };
  }

  dispatchAutoApply({ job, version, policy, atsScore }) {
    if (!this.autoApplyHandler)
      throw Object.assign(new Error("AutoApply não está disponível."), {
        code: "AUTO_APPLY_HANDLER_UNAVAILABLE",
      });
    let application = this.store.applications.all().find((item) =>
      item.jobId === job.id &&
      item.resumeVersionId === version.id &&
      !["CANCELLED", "SUBMITTED"].includes(item.status));
    if (!application) {
      const timestamp = new Date().toISOString();
      application = this.store.applications.create({
        id: `application-${randomUUID()}`,
        jobId: job.id,
        resumeId: version.resumeId,
        resumeVersionId: version.id,
        status: "PLANNED",
        nextAction: "AutoApply autorizado pela nota ATS",
        notes: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { source: "ats-threshold-autoapply" });
    }
    if (application.status === "PLANNED")
      application = this.store.applicationService.transitionApplication(
        application.id,
        "APPROVED",
        {
          source: "ats-threshold-autoapply",
          atsScore,
          minimumAtsScore: policy.minimumAtsScore,
          standingConsent: true,
        },
      );
    application = this.store.applications.updateDetails({
      ...application,
      nextAction: "AutoApply iniciado pela nota ATS",
    });
    this.store.applications.recordEvent(
      application.id,
      "AUTOAPPLY_ATS_THRESHOLD_MATCHED",
      {
        atsScore,
        minimumAtsScore: policy.minimumAtsScore,
        resumeVersionId: version.id,
        standingConsent: true,
      },
    );
    const request = {
      id: `ats-threshold:${application.id}:${version.id}`,
      source: "ATS_THRESHOLD",
    };
    const autoApply = this.autoApplyHandler({ request, application });
    return {
      handled: true,
      sent: false,
      bypassedApproval: true,
      status: "AUTOAPPLY_STARTED",
      atsScore,
      minimumAtsScore: policy.minimumAtsScore,
      request,
      application,
      autoApply,
    };
  }
}
