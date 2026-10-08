const textualTypes = new Set(["text", "textarea"]);

const timeout = (milliseconds) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve({ timedOut: true }), milliseconds);
  timer.unref?.();
});

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
  } = {}) {
    Object.assign(this, { store, approvalGateway, answerDrafterProvider });
    this.timeoutMs = Math.min(30000, Math.max(1000, Number(timeoutMs) || 12000));
  }

  async escalate(applicationId) {
    const application = this.store.applications.findById(applicationId);
    if (!application) return { status: "SKIPPED", reason: "APPLICATION_NOT_FOUND" };
    const active = this.store.whatsappQuestions.active(application.id);
    if (active) return { status: active.status, reused: true, request: active };
    const question = this.store.applicationQuestions
      .forApplication(application.id)
      .find((item) => item.required && item.answerStatus === "USER_REQUIRED");
    if (!question) return { status: "SKIPPED", reason: "NO_PENDING_REQUIRED_QUESTION" };
    if (question.sensitive || question.consentType) {
      this.store.applications.recordEvent(application.id, "WHATSAPP_QUESTION_PROTECTED", {
        questionId: question.id,
        sensitive: question.sensitive,
        consentType: question.consentType,
      });
      return { status: "PLATFORM_REQUIRED", reason: "PROTECTED_QUESTION", questionId: question.id };
    }
    if (!this.approvalGateway.publicConfiguration().configured)
      return { status: "PLATFORM_REQUIRED", reason: "WHATSAPP_NOT_CONFIGURED", questionId: question.id };

    let generatedContent = null;
    if (textualTypes.has(question.fieldType))
      generatedContent = await this.tryDraft(application, question);
    const prepared = this.approvalGateway.prepareQuestion({
      applicationId: application.id,
      questionId: question.id,
      generatedContentId: generatedContent?.id || "",
    });
    const sent = await this.approvalGateway.sendQuestion(prepared.request.id, prepared.request.id);
    this.store.applications.updateDetails({
      ...application,
      nextAction: "Responder pergunta do formulário pelo WhatsApp ou em Candidaturas",
    });
    return {
      status: "AWAITING_ANSWER",
      request: sent.request,
      suggestionAvailable: Boolean(generatedContent),
    };
  }

  async tryDraft(application, question) {
    const drafter = this.answerDrafterProvider();
    if (!drafter) return null;
    const job = this.store.jobs.findById(application.jobId);
    const plan = this.store.applicationPlans.forApplication(application.id);
    const analysis = plan?.analysisId ? this.store.analyses.findById(plan.analysisId) : null;
    const work = Promise.resolve(drafter.draft({
      question: {
        label: question.label,
        description: question.description || question.reasonRequired || "",
        type: question.fieldType,
      },
      job,
      requirements: analysis?.requirements || [],
      evidence: analysis?.candidateEvidence || [],
    })).catch((error) => ({ error }));
    const result = await Promise.race([work, timeout(this.timeoutMs)]);
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
