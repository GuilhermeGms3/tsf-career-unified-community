import { snapshotHash } from "./submission-snapshot.mjs";
import { validateFormAnswer } from "./form-answer-format.mjs";
import {evaluateApplicationRoutingPolicy,resumeAtsScore,tailoringAllowsAutoApply} from "./application-routing-policy.mjs";
import {jobInformationQuality} from "../matching/job-information-quality.mjs";

const terminal = new Set(["SUBMITTED", "SUBMITTING", "SUBMISSION_UNCERTAIN", "CANCELLED"]);
const decisionMessages={
  DECISION_CONTEXT_STALE:"O curriculo ou a candidatura mudou. Abra a versao atual antes de decidir.",
  DECISION_VERSION_CONFLICT:"Ja existe uma decisao diferente ou desatualizada para esta versao. Confira o estado atual.",
  DECISION_REQUEST_EXPIRED:"O pedido de aprovacao expirou. Solicite uma nova revisao antes de enviar.",
  DECISION_REQUEST_STALE:"Este pedido nao corresponde mais a candidatura atual.",
  DECISION_REVISION_PENDING:"Uma alteracao do curriculo ainda esta pendente. Revise a nova versao antes de aprovar.",
  DECISION_APPLICATION_NOT_ACTIONABLE:"A candidatura esta encerrada ou com envio em andamento/incerto. Consulte seu estado antes de continuar.",
  DECISION_RESUME_NOT_READY:"O curriculo ainda nao esta pronto para aprovacao.",
  APPROVED_BASE_REQUIRED:"Esta versao nao usa a base profissional aprovada. Gere uma versao com a BASE 01.",
  QUESTION_CONTEXT_STALE:"Esta pergunta ou o curriculo mudou. Atualize a candidatura antes de responder.",
  QUESTION_ANSWER_CONFLICT:"Esta pergunta ja tem uma resposta diferente registrada. Confira a candidatura antes de alterar.",
  QUESTION_ANSWER_FORMAT_INVALID:"A resposta nao corresponde ao formato ou as opcoes desta pergunta.",
  QUESTION_APPLICATION_NOT_ACTIONABLE:"Nao e possivel responder durante um envio ou depois do encerramento da candidatura.",
  DECISION_IDEMPOTENCY_CONFLICT:"Este comando ja foi usado para outra operacao. Atualize a tela antes de tentar novamente.",
  AUTOAPPLY_RECOVERY_APPROVAL_REQUIRED:"A autorizacao anterior nao permite esta retomada. Revise o curriculo e autorize novamente.",
};
const fail = code => { throw Object.assign(new Error(decisionMessages[code]||"Nao foi possivel registrar esta decisao com seguranca. Atualize a candidatura e tente novamente."), { code, status: 409 }); };

// Channel adapters authenticate the actor. This service owns the synchronous
// transaction and persists work; it never opens a browser or sends a message.
export class ApplicationDecisionService {
  constructor({ store }) { this.store = store; }
  snapshot(application) {
    const version = this.store.resumeVersions.findById(application.resumeVersionId), job = this.store.jobs.findById(application.jobId);
    return snapshotHash({ applicationId: application.id, jobId: application.jobId, resumeVersionId: application.resumeVersionId, contentHash: version?.contentHash, artifactHash: this.store.resumeArtifacts.latest(application.resumeVersionId, "PDF")?.contentHash || "", destination: job?.applicationUrl || job?.canonicalUrl || job?.url });
  }
  isCurrent(decision) {
    const application = this.store.applications.findById(decision.applicationId);
    if(application?.resumeVersionId!==decision.resumeVersionId||this.snapshot(application)!==decision.snapshotHash)return false;
    const matched=this.store.whatsappProcesses.requests(application.jobId).find(item=>item.applicationId===application.id&&item.resumeVersionId===decision.resumeVersionId);
    const request=matched&&this.store.whatsappApprovals.findById(matched.id);
    return !request?.expiresAt||Date.parse(request.expiresAt)>Date.now();
  }
  command(input, kind, payload, mutate) {
    if (!input.actor || !["WHATSAPP", "MOBILE", "PLATFORM"].includes(input.channel)) fail("DECISION_ACTOR_REQUIRED");
    if (typeof input.idempotencyKey!=="string" || !input.idempotencyKey || input.idempotencyKey.length > 220) fail("DECISION_IDEMPOTENCY_REQUIRED");
    const command = { ...input, kind, actorHash: snapshotHash(String(input.actor)), payloadHash: snapshotHash(payload) };
    return this.store.database.transaction(() => {
      const existing = this.store.applicationDecisions.command(input.idempotencyKey);
      if (existing) {
        if (existing.applicationId !== input.applicationId || existing.actorHash !== command.actorHash || existing.payloadHash !== command.payloadHash || existing.kind !== kind) fail("DECISION_IDEMPOTENCY_CONFLICT");
        return { ...existing.result, reused: true };
      }
      const result = mutate(command);
      const receipt=input.recordChannelReceipt?.(result);
      if(receipt?.then)fail("ASYNC_DECISION_HANDLER_UNSUPPORTED");
      this.store.applicationDecisions.recordCommand(command, result);
      return result;
    });
  }
  decide(input) {
    const mode = input.mode || "AUTO_APPLY", decision = input.decision;
    if (!["APPROVE", "REJECT"].includes(decision) || !["AUTO_APPLY", "REVIEW_ONLY"].includes(mode)) fail("DECISION_INVALID");
    return this.command(input, decision, { applicationId: input.applicationId, resumeVersionId: input.resumeVersionId, decision, mode }, command => {
      let application = this.store.applications.findById(input.applicationId);
      if (!application || application.resumeVersionId !== input.resumeVersionId) fail("DECISION_CONTEXT_STALE");
      const version = this.store.resumeVersions.findById(input.resumeVersionId);
      const previous = this.store.applicationDecisions.latest(application.id, input.resumeVersionId);
      if (previous && previous.decision === decision && previous.mode === mode && this.isCurrent(previous)) return { status: terminal.has(application.status)?application.status:previous.decision === "APPROVE" ? previous.mode === "AUTO_APPLY" ? "QUEUED" : "APPROVED" : "CANCELLED", decisionId: previous.id, applicationId: application.id, reused: true };
      if (previous && (previous.decision !== decision || previous.mode === "AUTO_APPLY" || !this.isCurrent(previous))) fail("DECISION_VERSION_CONFLICT");
      if (terminal.has(application.status)) fail("DECISION_APPLICATION_NOT_ACTIONABLE");
      if (!version || !["READY", "APPROVED"].includes(version.status)) fail("DECISION_RESUME_NOT_READY");
      const baseId = this.store.database.getMetadata("default_resume_id", "");
      if (baseId && baseId !== version.resumeId) fail("APPROVED_BASE_REQUIRED");
      const requests = this.store.whatsappProcesses.requests(application.jobId).filter(item => item.applicationId === application.id && item.resumeVersionId === version.id);
      const request = input.approvalRequestId ? this.store.whatsappApprovals.findById(input.approvalRequestId) : requests[0] && this.store.whatsappApprovals.findById(requests[0].id);
      if (input.approvalRequestId && (!request || request.applicationId !== application.id || request.resumeVersionId !== version.id || !["AWAITING_APPROVAL", "APPROVED"].includes(request.status))) fail("DECISION_REQUEST_STALE");
      if (request?.expiresAt && Date.parse(request.expiresAt) <= Date.now()) fail("DECISION_REQUEST_EXPIRED");
      if (this.store.applications.events(application.id).some(event => event.eventType === "WHATSAPP_RESUME_REVISION_REQUESTED" && event.metadata?.approvalRequestId === request?.id)) fail("DECISION_REVISION_PENDING");
      const saved = this.store.applicationDecisions.create({ applicationId: application.id, resumeVersionId: version.id, decision, mode, actorHash: command.actorHash, channel: input.channel, snapshotHash: this.snapshot(application) });
      if (decision === "REJECT") application = this.store.applicationService.transitionApplication(application.id, "CANCELLED", { source: input.channel, decisionId: saved.id });
      else if (["PLANNED", "MATCHED"].includes(application.status)) application = this.store.applicationService.transitionApplication(application.id, "APPROVED", { source: input.channel, decisionId: saved.id });
      else if (application.status !== "APPROVED") fail("DECISION_STATE_CONFLICT");
      this.store.applications.updateDetails({ ...application, nextAction: decision === "REJECT" ? "Candidatura encerrada" : mode === "AUTO_APPLY" ? "AutoApply na fila persistente" : "Curriculo aprovado; aguardar decisao de envio" });
      for (const item of requests) {
        this.store.whatsappApprovals.connection.prepare("UPDATE whatsapp_approval_requests SET status=?,decided_at=?,updated_at=? WHERE id=? AND status IN ('PREPARED','AWAITING_APPROVAL')")
          .run(decision === "APPROVE" ? "APPROVED" : "DENIED", new Date().toISOString(), new Date().toISOString(), item.id);
        if (decision === "APPROVE") this.store.applications.recordEvent(application.id, "WHATSAPP_APPROVAL_MODE_SELECTED", { approvalRequestId: item.id, resumeVersionId: version.id, approvalMode: mode, decisionId: saved.id });
      }
      this.store.jobFeedback?.save(application.jobId, { userDecision: decision === "APPROVE" ? "APPLY" : "REJECT", rejectionReason: decision === "REJECT" ? "NOT_INTERESTED" : "", note: "Decisao explicita do candidato" });
      this.store.applications.recordEvent(application.id, "APPLICATION_DECISION_RECORDED", { decisionId: saved.id, decision, mode, revision: saved.revision, channel: input.channel, resumeVersionId: version.id });
      if (input.channel === "WHATSAPP") this.store.applications.recordEvent(application.id, "WHATSAPP_APPROVAL_DECISION", { approvalRequestId: request?.id, decision: decision === "APPROVE" ? "APPROVED" : "DENIED", approvalMode: mode, resumeVersionId: version.id, externalSubmission: false });
      if (decision === "APPROVE" && mode === "AUTO_APPLY") this.enqueue(saved, request);
      return { status: decision === "REJECT" ? "CANCELLED" : mode === "AUTO_APPLY" ? "QUEUED" : "APPROVED", decisionId: saved.id, applicationId: application.id, requestId: request?.id || "", reused: false };
    });
  }
  enqueue(decision, approvalRequest = null, suffix = "", {channel=decision.channel} = {}) {
    const application = this.store.applications.findById(decision.applicationId);
    if (decision.decision !== "APPROVE" || decision.mode !== "AUTO_APPLY" || !this.isCurrent(decision) || terminal.has(application.status)) fail("AUTOAPPLY_RECOVERY_APPROVAL_REQUIRED");
    const request = { id: suffix ? `${decision.id}:${suffix}` : channel === "MOBILE" ? decision.id : approvalRequest?.id || decision.id, source: channel === "MOBILE" ? "MOBILE" : "WHATSAPP_APPROVAL", approvalRequestId: approvalRequest?.id || "", decisionId: decision.id };
    return this.store.autoApplyRuns.enqueue({ requestId: request.id, applicationId: decision.applicationId, source: "decision-outbox", context: { request, resumeVersionId: decision.resumeVersionId } });
  }
  answer(input) {
    return this.command(input, "ANSWER", { applicationId: input.applicationId, questionId: input.questionId, answer: input.answer, fingerprint: input.fingerprint || "", resumeVersionId: input.resumeVersionId || "" }, () => {
      const application = this.store.applications.findById(input.applicationId), question = this.store.applicationQuestions.forApplication(input.applicationId).find(item => item.id === input.questionId);
      if (!application || terminal.has(application.status)) fail("QUESTION_APPLICATION_NOT_ACTIONABLE");
      if (input.resumeVersionId && input.resumeVersionId !== application.resumeVersionId || input.fingerprint && input.fingerprint !== question?.fingerprint) fail("QUESTION_CONTEXT_STALE");
      if (!question) fail("QUESTION_NOT_FOUND");
      const format = validateFormAnswer(question, input.answer);
      if (!format.valid) fail("QUESTION_ANSWER_FORMAT_INVALID");
      const currentAnswer = question.answerValue ?? question.answer;
      if (question.answerStatus === "KNOWN") {
        if (snapshotHash(currentAnswer) !== snapshotHash(format.value)) fail("QUESTION_ANSWER_CONFLICT");
        return { status: "ANSWERED", applicationId: application.id, questionId: question.id, reused: true };
      }
      if (question.answerStatus !== "USER_REQUIRED") fail("QUESTION_CONTEXT_STALE");
      if(input.saveAnswer){
        const saved=input.saveAnswer({application,question,answer:format.value});
        if(saved?.then)fail("ASYNC_DECISION_HANDLER_UNSUPPORTED");
      }else{
        const answered = this.store.applicationQuestions.answer(application.id, question.id, format.value, { source: input.source || "USER_CONFIRMED", reusable: false });
        this.store.candidateAnswers.saveConfirmed(answered, format.value, { reusable: false, scope: { applicationId: application.id } });
      }
      const wa = this.store.whatsappQuestions.forQuestion(application.id, question.id);
      if (wa?.status === "AWAITING_ANSWER") this.store.whatsappQuestions.resolve(wa.id, "ANSWERED");
      this.store.applications.recordEvent(application.id, "QUESTION_ANSWERED", { questionId: question.id, source: input.source || "USER_CONFIRMED", reusable: false, channel: input.channel });
      const decision = this.store.applicationDecisions.latest(application.id, application.resumeVersionId);
      if (decision?.decision === "APPROVE" && decision.mode === "AUTO_APPLY" && this.isCurrent(decision)) this.enqueue(decision, null, `answer:${question.id}:${snapshotHash(question.fingerprint || question.id).slice(0, 16)}`,{channel:input.channel});
      else if(decision?.decision==="APPROVE")this.store.applications.updateDetails({...application,nextAction:"Resposta salva; renovar aprovacao antes de retomar"});
      else if(!decision){
        const approval=this.store.whatsappProcesses.requests(application.jobId).find(item=>item.applicationId===application.id&&item.resumeVersionId===application.resumeVersionId&&item.status==="APPROVED");
        const originalApproval=approval&&this.store.whatsappApprovals.findById(approval.id);
        if(originalApproval&&(!originalApproval.expiresAt||Date.parse(originalApproval.expiresAt)>Date.now())&&this.store.applications.events(application.id).some(event=>event.eventType==="WHATSAPP_APPROVAL_MODE_SELECTED"&&event.metadata?.approvalRequestId===approval.id&&event.metadata?.approvalMode==="AUTO_APPLY")){
          const request={id:`answer:${question.id}:${snapshotHash(question.fingerprint||question.id).slice(0,16)}`,source:"WHATSAPP_QUESTION",approvalRequestId:approval.id};
          this.store.autoApplyRuns.enqueue({requestId:request.id,applicationId:application.id,source:"decision-outbox",context:{request,resumeVersionId:application.resumeVersionId}});
        }else{
          const version=this.store.resumeVersions.findById(application.resumeVersionId),run=version?.tailoringRunId?this.store.resumeTailoring.findRun(version.tailoringRunId):null;
          const routing=evaluateApplicationRoutingPolicy({score:resumeAtsScore(version||{}),policy:this.store.autoApplyPolicy.get(),qualityApproved:tailoringAllowsAutoApply(run),descriptionSufficient:jobInformationQuality(this.store.jobs.findById(application.jobId)||{}).sufficient});
          const authorized=this.store.applications.events(application.id).some(event=>event.eventType==="AUTOAPPLY_ATS_THRESHOLD_MATCHED"&&event.metadata?.resumeVersionId===application.resumeVersionId);
          if(authorized&&routing.route==="AUTO_APPLY"){
            const request={id:`ats-answer:${application.id}:${question.id}:${snapshotHash([application.resumeVersionId,question.fingerprint]).slice(0,16)}`,source:"ATS_THRESHOLD"};
            this.store.autoApplyRuns.enqueue({requestId:request.id,applicationId:application.id,source:"decision-outbox",context:{request,resumeVersionId:application.resumeVersionId}});
          }
        }
      }
      return { status: "ANSWERED", applicationId: application.id, questionId: question.id, reused: false };
    });
  }
}
