import { isCandidateContactQuestion } from "../application/question-semantics.mjs";

const textualTypes = new Set(["text", "textarea"]);

const usefulDraft = (result) =>
  result?.generated === true &&
  result?.evidenceStatus === "VALID" &&
  result?.meta?.fallback !== true &&
  String(result.draft || "").trim().length >= 12;

export class ApplicationQuestionEscalationService {
  constructor({
    store,
    approvalGateway,
    answerDrafterProvider = () => null,
    timeoutMs = Number(process.env.CAREER_QUESTION_LLM_TIMEOUT_MS || 12000),
    notificationsEnabled = true,
  } = {}) {
    Object.assign(this, { store, approvalGateway, answerDrafterProvider, notificationsEnabled });
    this.timeoutMs = Math.min(30000, Math.max(1000, Number(timeoutMs) || 12000));
    this.inFlight = new Map();
    this.delayedQuestions = null;
  }

  escalate(applicationId) {
    if (this.inFlight.has(applicationId)) return this.inFlight.get(applicationId);
    const work = this.execute(applicationId).finally(() => this.inFlight.delete(applicationId));
    this.inFlight.set(applicationId, work);
    return work;
  }

  async execute(applicationId) {
    const application = this.store.applications.findById(applicationId);
    if (!application) return { status: "SKIPPED", reason: "APPLICATION_NOT_FOUND" };
    if(["SUBMITTED","SUBMITTING","SUBMISSION_UNCERTAIN","CANCELLED"].includes(application.status))return {status:"SKIPPED",reason:"APPLICATION_NOT_ACTIONABLE"};
    const pending=this.store.applicationQuestions.forApplication(application.id).filter(item=>item.required&&item.answerStatus==="USER_REQUIRED");
    if(!this.notificationsEnabled)return {status:"PLATFORM_REQUIRED",reason:"MOBILE_QUESTION_REQUIRED",questionId:pending[0]?.id||""};
    const active = this.store.whatsappQuestions.active(application.id);
    if (active?.status === "AWAITING_ANSWER" && pending.some(question=>question.id===active.questionId||!active.questionId)) {
      this.delayedQuestions?.schedule(active);
      return { status: active.status, reused: true, request: active };
    }
    if(active?.status==="AWAITING_ANSWER")this.store.whatsappQuestions.resolve(active.id,"DEFERRED");
    const question = pending.find(item=>!item.sensitive&&!item.consentType&&item.fieldType!=="file")||pending[0];
    if (!question) return { status: "SKIPPED", reason: "NO_PENDING_REQUIRED_QUESTION" };
    if (question.sensitive || question.consentType) {
      this.store.applications.recordEvent(application.id, "WHATSAPP_QUESTION_PROTECTED", {
        questionId: question.id,
        sensitive: question.sensitive,
        consentType: question.consentType,
      });
      return { status: "PLATFORM_REQUIRED", reason: "PROTECTED_QUESTION", questionId: question.id };
    }
    if(question.fieldType==="file")return {status:"PLATFORM_REQUIRED",reason:"FILE_ATTACHMENT_REQUIRED",questionId:question.id};
    if (!this.approvalGateway.publicConfiguration().configured)
      return { status: "PLATFORM_REQUIRED", reason: "WHATSAPP_NOT_CONFIGURED", questionId: question.id };

    let generatedContent = null;
    const humanFirst=this.store.questionFallbackPolicy?.get().enabled===true;
    if (!humanFirst && !active && textualTypes.has(question.fieldType) && !isCandidateContactQuestion(question))
      generatedContent = await this.tryDraft(application, question);
    const latest=this.store.applications.findById(application.id),currentQuestion=this.store.applicationQuestions.forApplication(application.id).find(item=>item.id===question.id);
    if(!latest||["SUBMITTED","SUBMITTING","SUBMISSION_UNCERTAIN","CANCELLED"].includes(latest.status)||!currentQuestion?.required||currentQuestion.answerStatus!=="USER_REQUIRED"||currentQuestion.fingerprint!==question.fingerprint)return {status:"SKIPPED",reason:"QUESTION_CONTEXT_CHANGED"};
    const prepared = this.approvalGateway.prepareQuestion({
      applicationId: application.id,
      questionId: question.id,
      generatedContentId: generatedContent?.id || "",
    });
    const sent = await this.approvalGateway.sendQuestion(prepared.request.id, prepared.request.id);
    const delayed=this.delayedQuestions?.schedule(sent.request);
    if(delayed)await this.delayedQuestions.notify({application,question,request:sent.request},`Voce tem ${this.store.questionFallbackPolicy.get().waitMinutes} minutos para responder ${sent.request.commandToken}. Depois a IA tentara ajudar; dados pessoais e consentimentos continuam dependendo de voce.`);
    this.store.applications.updateDetails({
      ...latest,
      nextAction: "Responder pergunta do formulário pelo WhatsApp ou em Candidaturas",
    });
    return {
      status: "AWAITING_ANSWER",
      request: sent.request,
      suggestionAvailable: Boolean(generatedContent),
    };
  }

  async tryDraft(application, question) {
    const job = this.store.jobs.findById(application.jobId);
    const plan = this.store.applicationPlans.forApplication(application.id);
    const analysis = plan?.analysisId ? this.store.analyses.findById(plan.analysisId) : null;
    const work = Promise.resolve().then(() => this.answerDrafterProvider()?.draft({
      question: {
        label: question.label,
        description: question.description || question.reasonRequired || "",
        type: question.fieldType,
      },
      job,
      requirements: analysis?.requirements || [],
      evidence: analysis?.candidateEvidence || [],
    })).catch((error) => ({ error }));
    let timer;
    const deadline = new Promise(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), this.timeoutMs); });
    let result;
    try { result = await Promise.race([work, deadline]); }
    finally { clearTimeout(timer); }
    if (!usefulDraft(result)) {
      this.store.applications.recordEvent(application.id, "APPLICATION_ANSWER_DRAFT_FALLBACK", {
        questionId: question.id,
        reason: result?.timedOut ? "TIMEOUT" : result?.error?.code || result?.meta?.errorCode || "EMPTY_OR_WEAK_DRAFT",
      });
      return null;
    }
    return this.store.generatedContent.create({
      applicationId: application.id,
      questionId: question.id,
      contentType: "ANSWER_DRAFT",
      state: "REVIEW_REQUIRED",
      draft: result.draft,
      evidenceIds: result.evidenceIds,
      promptVersion: result.promptVersion,
      schemaVersion: result.schemaVersion,
    });
  }
}
