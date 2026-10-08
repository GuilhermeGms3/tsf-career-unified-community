import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

const clean = (value) => String(value || "").trim();
const digest = (value) => createHash("sha256").update(clean(value)).digest("hex");
const jid = (value) => {
  const raw = clean(value).toLowerCase();
  if (/^\d+@(s\.whatsapp\.net|g\.us)$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : "";
};
const jidAliases = (value) => {
  const normalized = jid(value);
  if (!normalized.endsWith("@s.whatsapp.net")) return new Set([normalized]);
  const digits = normalized.split("@")[0], aliases = new Set([normalized]);
  if (/^55\d{2}9\d{8}$/.test(digits)) aliases.add(`${digits.slice(0, 4)}${digits.slice(5)}@s.whatsapp.net`);
  if (/^55\d{10}$/.test(digits)) aliases.add(`${digits.slice(0, 4)}9${digits.slice(4)}@s.whatsapp.net`);
  return aliases;
};
const sameJid = (left, right) => {
  const leftAliases = jidAliases(left), rightAliases = jidAliases(right);
  return [...leftAliases].some((candidate) => rightAliases.has(candidate));
};
const textOf = (data = {}) => {
  const message = data.message || data.data?.message || {};
  return clean(message.conversation || message.extendedTextMessage?.text || data.body || data.text);
};
const commandToken = () => String(randomInt(0, 100_000)).padStart(5, "0");
const questionToken = () => `PERG-${String(randomInt(0, 1_000_000)).padStart(6, "0")}`;
const approvedBase = (store) => {
  const resumeId = store.database?.getMetadata?.("default_resume_id", "") || "";
  const resume = resumeId ? store.resumes.findById(resumeId) : null;
  return resume?.resumeKind === "BASE" ? resume : null;
};
const commandOf = (value) => {
  const text = clean(value);
  const decision = text.match(/^(APROVAR|NEGAR|ANALISAR)\s+([A-Z0-9-]{4,64})$/i);
  if (decision) return { action: decision[1].toUpperCase(), token: decision[2].toUpperCase(), observation: "" };
  const revision = text.match(/^1\s+([A-Z0-9-]{4,64})\s+([\s\S]{3,800})$/i);
  if (revision) return { action: "REVISAR", token: revision[1].toUpperCase(), observation: clean(revision[2]) };
  const discard = text.match(/^2\s+([A-Z0-9-]{4,64})$/i);
  return discard ? { action: "DESCARTAR", token: discard[1].toUpperCase(), observation: "" } : null;
};
const questionCommandOf = (value) => {
  const text = clean(value);
  const use = text.match(/^USAR\s+(PERG-[A-Z0-9-]{6,64})$/i);
  if (use) return { action: "USAR", token: use[1].toUpperCase(), answer: "" };
  const answer = text.match(/^RESPONDER\s+(PERG-[A-Z0-9-]{6,64})\s+([\s\S]{1,2000})$/i);
  if (answer) return { action: "RESPONDER", token: answer[1].toUpperCase(), answer: clean(answer[2]) };
  const defer = text.match(/^PULAR\s+(PERG-[A-Z0-9-]{6,64})$/i);
  return defer ? { action: "PULAR", token: defer[1].toUpperCase(), answer: "" } : null;
};

export class WhatsappApprovalGateway {
  constructor({
    store,
    evolutionService,
    target = process.env.CAREER_WHATSAPP_TARGET || "",
    approver = process.env.CAREER_WHATSAPP_APPROVER || "",
    webhookSecret = process.env.CAREER_EVOLUTION_WEBHOOK_SECRET || "",
    approvalHandler = null,
    revisionHandler = null,
    rejectionHandler = null,
    questionAnswerHandler = null,
    questionResumeHandler = null,
    applicationBaseUrl = process.env.CAREER_PUBLIC_URL || `http://127.0.0.1:${process.env.HUB_PORT || 7123}`,
    policyProvider = () => ({ enabled: false }),
  } = {}) {
    Object.assign(this, { store, evolutionService, target, approver, webhookSecret, approvalHandler, revisionHandler, rejectionHandler, questionAnswerHandler, questionResumeHandler, policyProvider });
    this.applicationBaseUrl = clean(applicationBaseUrl).replace(/\/$/, "");
  }

  startsAutoApply(request) {
    const prepared = this.store.applications.events(request.applicationId).find((event) =>
      event.eventType === "WHATSAPP_APPROVAL_PREPARED" &&
      event.metadata?.approvalRequestId === request.id);
    if (typeof prepared?.metadata?.autoApplyOnApproval === "boolean")
      return prepared.metadata.autoApplyOnApproval;
    const policy = this.policyProvider();
    if (policy?.enabled !== true) return true;
    const version = this.store.resumeVersions.findById(request.resumeVersionId);
    const score = Number(version?.atsAfter?.overallScore ?? version?.atsAfter?.score ?? version?.atsAfter?.comparison?.afterScore);
    return Number.isFinite(score) && score >= 80;
  }

  publicConfiguration() {
    const targetJid = jid(this.target), approverJid = jid(this.approver);
    return {
      configured: Boolean(targetJid && this.webhookSecret && (approverJid || !targetJid.endsWith("@g.us"))),
      targetConfigured: Boolean(targetJid),
      approverConfigured: Boolean(approverJid || (targetJid && !targetJid.endsWith("@g.us"))),
      externalSendAutomatic: false,
      commands: ["APROVAR ID", "NEGAR ID", "ANALISAR ID", "1 ID observação", "2 ID", "USAR PERG-ID", "RESPONDER PERG-ID resposta", "PULAR PERG-ID"],
    };
  }

  prepare({ jobId, resumeVersionId, artifactId }) {
    const job = this.store.jobs.findById(clean(jobId));
    const version = this.store.resumeVersions.findById(clean(resumeVersionId));
    const artifact = this.store.resumeArtifacts.findById(clean(artifactId));
    const targetJid = jid(this.target);
    if (!job) throw this.error("Vaga não encontrada.", "WHATSAPP_APPROVAL_JOB_NOT_FOUND", 404);
    if (!version || version.jobId !== job.id || version.status !== "READY")
      throw this.error("A versão pronta do currículo não corresponde à vaga.", "WHATSAPP_APPROVAL_VERSION_INVALID", 409);
    const base = approvedBase(this.store);
    if (!base || version.resumeId !== base.id)
      throw this.error("Somente uma versão gerada a partir da BASE 01 aprovada pode seguir para o WhatsApp.", "WHATSAPP_APPROVAL_BASE_INVALID", 409);
    if (!artifact || artifact.resumeVersionId !== version.id || artifact.artifactType !== "PDF" || artifact.status !== "READY")
      throw this.error("PDF pronto não encontrado para a versão selecionada.", "WHATSAPP_APPROVAL_PDF_INVALID", 409);
    if (!targetJid) throw this.error("Destino do WhatsApp não configurado.", "WHATSAPP_TARGET_NOT_CONFIGURED", 503);

    let application = this.store.applications.all().find((item) =>
      item.jobId === job.id && item.resumeVersionId === version.id && !["CANCELLED", "SUBMITTED"].includes(item.status));
    if (!application) {
      const timestamp = new Date().toISOString();
      application = this.store.applications.create({
        id: `application-${randomUUID()}`,
        jobId: job.id,
        resumeId: version.resumeId,
        resumeVersionId: version.id,
        status: "PLANNED",
        nextAction: "Aguardar aprovação no WhatsApp",
        notes: "",
        createdAt: timestamp,
        updatedAt: timestamp,
      }, { source: "whatsapp-approval-gateway" });
    }
    const active = this.store.whatsappApprovals.active(application.id, version.id);
    if (active) return { request: active, application, job, version, artifact, message: this.message(active, job, version) };
    const superseded = this.store.whatsappApprovals.supersedeActive(job.id, version.id);
    for (const previous of superseded) {
      this.store.applications.recordEvent(previous.applicationId, "WHATSAPP_APPROVAL_SUPERSEDED", {
        approvalRequestId: previous.id,
        previousResumeVersionId: previous.resumeVersionId,
        replacementResumeVersionId: version.id,
        reason: "NEW_RESUME_VERSION_PREPARED",
      });
    }
    let nextToken = commandToken();
    while (this.store.whatsappApprovals.findByToken(nextToken)) nextToken = commandToken();
    const request = this.store.whatsappApprovals.prepare({
      commandToken: nextToken,
      applicationId: application.id,
      jobId: job.id,
      resumeVersionId: version.id,
      artifactId: artifact.id,
      targetHash: digest(targetJid),
    });
    this.store.applications.recordEvent(application.id, "WHATSAPP_APPROVAL_PREPARED", {
      approvalRequestId: request.id,
      resumeVersionId: version.id,
      autoApplyOnApproval: this.startsAutoApply(request),
    });
    return { request, application, job, version, artifact, message: this.message(request, job, version) };
  }

  async send(requestId, confirmation) {
    const request = this.store.whatsappApprovals.findById(clean(requestId));
    if (!request) throw this.error("Pedido de aprovação não encontrado.", "WHATSAPP_APPROVAL_NOT_FOUND", 404);
    if (confirmation !== request.id) throw this.error("Confirmação explícita não confere.", "WHATSAPP_APPROVAL_CONFIRMATION_REQUIRED", 400);
    if (request.status !== "PREPARED") throw this.error("O pedido não está pronto para envio.", "WHATSAPP_APPROVAL_NOT_PREPARED", 409);
    const configuration = this.publicConfiguration();
    if (!configuration.configured) throw this.error("Gateway de aprovação incompleto.", "WHATSAPP_APPROVAL_NOT_CONFIGURED", 503);
    const state = await this.evolutionService.connectionState();
    if (state.connectionState !== "CONNECTED") throw this.error("WhatsApp não está conectado.", "WHATSAPP_NOT_CONNECTED", 409);
    const job = this.store.jobs.findById(request.jobId), version = this.store.resumeVersions.findById(request.resumeVersionId), artifact = this.store.resumeArtifacts.findById(request.artifactId);
    const base = approvedBase(this.store);
    if (!version || !base || version.resumeId !== base.id)
      throw this.error("A base aprovada mudou ou esta versão não foi gerada pela BASE 01.", "WHATSAPP_APPROVAL_BASE_STALE", 409);
    const pdf = await this.store.resumeArtifactService.readAllowed(artifact, version.resumeId);
    if (pdf.length > 10 * 1024 * 1024) throw this.error("PDF excede o limite de 10 MB do gateway.", "WHATSAPP_APPROVAL_PDF_TOO_LARGE", 413);
    await this.evolutionService.client.sendMedia(this.evolutionService.instance, this.target, {
      mediatype: "document",
      mimetype: "application/pdf",
      media: pdf.toString("base64"),
      fileName: `curriculo-${request.commandToken}.pdf`,
      caption: this.message(request, job, version),
    });
    const sent = this.store.whatsappApprovals.markSent(request.id);
    this.store.applications.recordEvent(request.applicationId, "WHATSAPP_APPROVAL_SENT", {
      approvalRequestId: request.id,
      resumeVersionId: request.resumeVersionId,
    });
    return { request: sent, sent: true };
  }

  prepareQuestion({ applicationId, questionId, generatedContentId = "" }) {
    const application = this.store.applications.findById(clean(applicationId));
    const question = application
      ? this.store.applicationQuestions.forApplication(application.id).find((item) => item.id === clean(questionId))
      : null;
    const targetJid = jid(this.target);
    if (!application) throw this.error("Candidatura não encontrada.", "WHATSAPP_QUESTION_APPLICATION_NOT_FOUND", 404);
    if (!question || question.answerStatus !== "USER_REQUIRED")
      throw this.error("Pergunta pendente não encontrada.", "WHATSAPP_QUESTION_NOT_PENDING", 409);
    if (question.sensitive || question.consentType)
      throw this.error("Pergunta sensível ou de consentimento deve ser respondida no sistema.", "WHATSAPP_QUESTION_PROTECTED", 409);
    if (!targetJid) throw this.error("Destino do WhatsApp não configurado.", "WHATSAPP_TARGET_NOT_CONFIGURED", 503);
    const existing = this.store.whatsappQuestions.forQuestion(application.id, question.id);
    if (existing && ["PREPARED", "AWAITING_ANSWER"].includes(existing.status))
      return { request: existing, application, question, message: this.questionMessage(existing, application, question) };
    let nextToken = questionToken();
    while (this.store.whatsappQuestions.findByToken(nextToken)) nextToken = questionToken();
    const request = this.store.whatsappQuestions.prepare({
      commandToken: nextToken,
      applicationId: application.id,
      questionId: question.id,
      generatedContentId,
      targetHash: digest(targetJid),
    });
    this.store.applications.recordEvent(application.id, "WHATSAPP_QUESTION_PREPARED", {
      questionId: question.id,
      questionRequestId: request.id,
      suggestionAvailable: Boolean(generatedContentId),
    });
    return { request, application, question, message: this.questionMessage(request, application, question) };
  }

  async sendQuestion(requestId, confirmation) {
    const request = this.store.whatsappQuestions.findById(clean(requestId));
    if (!request) throw this.error("Pedido de pergunta não encontrado.", "WHATSAPP_QUESTION_REQUEST_NOT_FOUND", 404);
    if (confirmation !== request.id) throw this.error("Confirmação explícita não confere.", "WHATSAPP_QUESTION_CONFIRMATION_REQUIRED", 400);
    if (request.status !== "PREPARED") return { request, sent: request.status === "AWAITING_ANSWER", reused: true };
    if (!this.publicConfiguration().configured) throw this.error("Gateway do WhatsApp incompleto.", "WHATSAPP_APPROVAL_NOT_CONFIGURED", 503);
    const state = await this.evolutionService.connectionState();
    if (state.connectionState !== "CONNECTED") throw this.error("WhatsApp não está conectado.", "WHATSAPP_NOT_CONNECTED", 409);
    const application = this.store.applications.findById(request.applicationId);
    const question = this.store.applicationQuestions.forApplication(request.applicationId).find((item) => item.id === request.questionId);
    await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, this.questionMessage(request, application, question));
    const sent = this.store.whatsappQuestions.markSent(request.id);
    this.store.applications.recordEvent(request.applicationId, "WHATSAPP_QUESTION_SENT", { questionId: request.questionId, questionRequestId: request.id });
    return { request: sent, sent: true, reused: false };
  }

  async ingest(payload = {}, secret = "") {
    this.verifySecret(secret);
    const data = payload.data || {}, key = data.key || payload.key || {};
    const event = clean(payload.event).toUpperCase().replaceAll(".", "_").replaceAll("-", "_");
    const rawText = textOf(data), questionCommand = questionCommandOf(rawText), command = commandOf(rawText);
    if (event !== "MESSAGES_UPSERT" || (!command && !questionCommand)) return { handled: false };
    const instance = clean(payload.instance || payload.instanceName || data.instance);
    if (instance !== this.evolutionService.instance) throw this.error("Instância do webhook não confere.", "WHATSAPP_APPROVAL_INSTANCE_MISMATCH", 403);
    const fromMe = key.fromMe === true || data.fromMe === true;
    const messageId = clean(key.id || data.id || payload.id);
    if (!messageId) throw this.error("Evento sem messageId.", "WHATSAPP_APPROVAL_MESSAGE_ID_REQUIRED", 400);
    const messageHash = digest(`${instance}:${messageId}`);
    if (this.store.whatsappApprovals.hasReceipt(messageHash)) return { handled: true, outcome: "DUPLICATE" };

    const conversationJid = jid(key.remoteJid || data.remoteJid || payload.remoteJid);
    const alternateConversationJid = jid(key.remoteJidAlt || data.remoteJidAlt || payload.remoteJidAlt);
    const targetJid = jid(this.target);
    const approverJid = jid(this.approver) || (!targetJid.endsWith("@g.us") ? targetJid : "");
    const selfConversation = fromMe && (
      sameJid(conversationJid, targetJid) ||
      (!targetJid.endsWith("@g.us") && sameJid(alternateConversationJid, targetJid))
    );
    const senderJid = selfConversation
      ? targetJid
      : jid(key.participant || data.participant || payload.participant || conversationJid);
    const correctConversation = selfConversation || sameJid(conversationJid, targetJid);
    const authorizedSender = selfConversation || Boolean(approverJid && sameJid(senderJid, approverJid));
    if (!targetJid || !correctConversation || !authorizedSender) {
      const receipts = questionCommand ? this.store.whatsappQuestions : this.store.whatsappApprovals;
      receipts.recordReceipt({ messageHash, action: "REJEITADO", outcome: "UNAUTHORIZED_CONTEXT" });
      throw this.error("Comando recebido fora do contexto autorizado.", "WHATSAPP_APPROVAL_UNAUTHORIZED", 403);
    }

    if (questionCommand)
      return this.ingestQuestion({ command: questionCommand, messageHash, targetJid });

    const action = command.action;
    let request = this.store.whatsappApprovals.findByToken(command.token);
    if (!request && /^\d{4,6}$/.test(command.token))
      request = this.store.whatsappApprovals.findByToken(`VAGA-${command.token}`);
    if (!request || request.targetHash !== digest(targetJid)) {
      this.store.whatsappApprovals.recordReceipt({ messageHash, action: "REJEITADO", outcome: "REQUEST_NOT_FOUND" });
      throw this.error("Pedido de aprovação não encontrado.", "WHATSAPP_APPROVAL_NOT_FOUND", 404);
    }
    if (request.status !== "AWAITING_APPROVAL") {
      this.store.whatsappApprovals.recordReceipt({ requestId: request.id, messageHash, action: this.receiptAction(action), outcome: "ALREADY_DECIDED" });
      const application = this.store.applications.findById(request.applicationId);
      const autoApply = action === "APROVAR" && request.status === "APPROVED" && this.startsAutoApply(request)
        ? await this.dispatchApproval(request, application)
        : null;
      return { handled: true, outcome: "ALREADY_DECIDED", request: this.publicRequest(request), autoApply };
    }
    const application = this.store.applications.findById(request.applicationId);
    if (!application || application.jobId !== request.jobId || application.resumeVersionId !== request.resumeVersionId)
      throw this.error("A candidatura não corresponde ao pedido preparado.", "WHATSAPP_APPROVAL_APPLICATION_MISMATCH", 409);

    if (action === "ANALISAR") {
      const job = this.store.jobs.findById(request.jobId), version = this.store.resumeVersions.findById(request.resumeVersionId);
      await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, this.analysisMessage(request, job, version));
      this.store.applications.recordEvent(application.id, "WHATSAPP_APPROVAL_ANALYZED", { approvalRequestId: request.id, resumeVersionId: request.resumeVersionId });
      this.store.whatsappApprovals.recordReceipt({ requestId: request.id, messageHash, action, outcome: "ANALYSIS_SENT" });
      return { handled: true, outcome: "ANALYSIS_SENT", request: this.publicRequest(request) };
    }

    if (action === "REVISAR") {
      const revision = await this.dispatchRevision(request, application, command.observation);
      this.store.whatsappApprovals.recordReceipt({ requestId: request.id, messageHash, action: "ANALISAR", outcome: "REVISION_REQUESTED" });
      this.store.applications.recordEvent(application.id, "WHATSAPP_RESUME_REVISION_REQUESTED", {
        approvalRequestId: request.id,
        resumeVersionId: request.resumeVersionId,
        intelligenceJobId: revision?.jobId || "",
        observationHash: digest(command.observation),
      });
      await this.sendAcknowledgement(application.id, request, this.revisionMessage(request, revision));
      return { handled: true, outcome: "REVISION_REQUESTED", request: this.publicRequest(request), revision };
    }

    if (action === "DESCARTAR") {
      const rejected = await this.dispatchRejection(request, application);
      const cancelled = this.store.applicationService.transitionApplication(application.id, "CANCELLED", {
        source: "whatsapp-approval-gateway",
        approvalRequestId: request.id,
        resumeVersionId: request.resumeVersionId,
        reason: "RESUME_REJECTED",
      });
      const updatedApplication = this.store.applications.updateDetails({ ...cancelled, nextAction: "Currículo rejeitado; candidatura encerrada" });
      const updatedRequest = this.store.whatsappApprovals.decide(request.id, "DENIED");
      this.store.whatsappApprovals.recordReceipt({ requestId: request.id, messageHash, action: "NEGAR", outcome: "RESUME_ARCHIVED" });
      this.store.applications.recordEvent(application.id, "WHATSAPP_RESUME_REJECTED", {
        approvalRequestId: request.id,
        resumeVersionId: request.resumeVersionId,
        archived: rejected?.status === "ARCHIVED",
      });
      await this.sendAcknowledgement(application.id, request, this.discardMessage(updatedRequest));
      return { handled: true, outcome: "RESUME_ARCHIVED", request: this.publicRequest(updatedRequest), application: updatedApplication, version: rejected };
    }

    const startsAutoApply = action === "APROVAR" && this.startsAutoApply(request);
    const targetStatus = action === "APROVAR" ? "APPROVED" : "CANCELLED";
    const updatedApplication = this.store.applicationService.transitionApplication(application.id, targetStatus, {
      source: "whatsapp-approval-gateway",
      approvalRequestId: request.id,
      resumeVersionId: request.resumeVersionId,
      externalSubmission: false,
    });
    const applicationWithNextAction = this.store.applications.updateDetails({
      ...updatedApplication,
      nextAction: action === "APROVAR" ? (startsAutoApply ? "AutoApply iniciado" : "Revisar candidatura no sistema") : "Candidatura encerrada",
    });
    const updatedRequest = this.store.whatsappApprovals.decide(request.id, action === "APROVAR" ? "APPROVED" : "DENIED");
    this.store.whatsappApprovals.recordReceipt({ requestId: request.id, messageHash, action, outcome: updatedRequest.status });
    this.store.applications.recordEvent(application.id, "WHATSAPP_APPROVAL_DECISION", {
      approvalRequestId: request.id,
      decision: updatedRequest.status,
      resumeVersionId: request.resumeVersionId,
      externalSubmission: false,
    });
    const autoApply = startsAutoApply ? await this.dispatchApproval(updatedRequest, applicationWithNextAction) : null;
    try {
      await this.evolutionService.client.sendText(
        this.evolutionService.instance,
        this.target,
        this.decisionMessage(updatedRequest, applicationWithNextAction, autoApply),
      );
    } catch {
      this.store.applications.recordEvent(application.id, "WHATSAPP_APPROVAL_ACK_FAILED", {
        approvalRequestId: request.id,
        decision: updatedRequest.status,
      });
    }
    return { handled: true, outcome: updatedRequest.status, request: this.publicRequest(updatedRequest), application: applicationWithNextAction, autoApply };
  }

  async ingestQuestion({ command, messageHash, targetJid }) {
    if (this.store.whatsappQuestions.hasReceipt(messageHash)) return { handled: true, outcome: "DUPLICATE" };
    const request = this.store.whatsappQuestions.findByToken(command.token);
    if (!request || request.targetHash !== digest(targetJid)) {
      this.store.whatsappQuestions.recordReceipt({ messageHash, action: "REJEITADO", outcome: "REQUEST_NOT_FOUND" });
      throw this.error("Pedido de pergunta não encontrado.", "WHATSAPP_QUESTION_REQUEST_NOT_FOUND", 404);
    }
    if (request.status !== "AWAITING_ANSWER") {
      this.store.whatsappQuestions.recordReceipt({ requestId: request.id, messageHash, action: command.action, outcome: "ALREADY_RESOLVED" });
      return { handled: true, outcome: "ALREADY_RESOLVED", request: this.publicQuestionRequest(request) };
    }
    const application = this.store.applications.findById(request.applicationId);
    const question = this.store.applicationQuestions.forApplication(request.applicationId).find((item) => item.id === request.questionId);
    if (!application || !question || question.answerStatus !== "USER_REQUIRED")
      throw this.error("A pergunta não corresponde mais à candidatura pendente.", "WHATSAPP_QUESTION_CONTEXT_STALE", 409);

    if (command.action === "PULAR") {
      const deferred = this.store.whatsappQuestions.resolve(request.id, "DEFERRED");
      this.store.whatsappQuestions.recordReceipt({ requestId: request.id, messageHash, action: command.action, outcome: "DEFERRED" });
      this.store.applications.recordEvent(application.id, "WHATSAPP_QUESTION_DEFERRED", { questionId: question.id, questionRequestId: request.id });
      await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, `Pergunta adiada: ${request.commandToken}\nEla continua disponível em Candidaturas e nenhum envio foi feito.`);
      return { handled: true, outcome: "DEFERRED", request: this.publicQuestionRequest(deferred) };
    }

    let answer, source;
    if (command.action === "USAR") {
      const generated = this.store.generatedContent.findById(request.generatedContentId);
      if (!generated || generated.applicationId !== application.id || generated.questionId !== question.id || generated.state !== "REVIEW_REQUIRED" || !clean(generated.draft))
        throw this.error("Sugestão da IA não está disponível para esta pergunta.", "WHATSAPP_QUESTION_SUGGESTION_NOT_AVAILABLE", 409);
      this.store.generatedContent.review(generated.id, "APPROVED");
      answer = generated.draft;
      source = "LLM_APPROVED";
      this.store.applicationQuestions.answer(application.id, question.id, answer, { source, reusable: false });
    } else {
      answer = clean(command.answer);
      if (!answer) throw this.error("Resposta vazia.", "WHATSAPP_QUESTION_ANSWER_REQUIRED", 400);
      source = "USER_CONFIRMED";
      if (typeof this.questionAnswerHandler === "function") await this.questionAnswerHandler({ request, application, question, answer });
      else this.store.applicationQuestions.answer(application.id, question.id, answer, { source, reusable: false });
    }
    const answered = this.store.whatsappQuestions.resolve(request.id, "ANSWERED");
    this.store.whatsappQuestions.recordReceipt({ requestId: request.id, messageHash, action: command.action, outcome: "ANSWERED" });
    this.store.applications.recordEvent(application.id, "WHATSAPP_QUESTION_ANSWERED", { questionId: question.id, questionRequestId: request.id, source });
    const resumed = typeof this.questionResumeHandler === "function"
      ? await this.questionResumeHandler({ request: answered, application: this.store.applications.findById(application.id) })
      : null;
    await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, `Resposta registrada: ${request.commandToken}\nO AutoApply foi retomado. Se houver outra pendência, eu aviso por aqui.`);
    return { handled: true, outcome: "ANSWERED", request: this.publicQuestionRequest(answered), resumed };
  }

  questionMessage(request, application, question) {
    const job = application ? this.store.jobs.findById(application.jobId) : null;
    const generated = request.generatedContentId ? this.store.generatedContent.findById(request.generatedContentId) : null;
    const options = (question?.options || []).slice(0, 10).map((item) => item.label || item.value || item).filter(Boolean);
    return [
      "Pergunta pendente na candidatura",
      job ? `${job.title} — ${job.company}` : "Vaga não identificada",
      `ID: ${request.commandToken}`,
      "",
      question?.label || "Pergunta do formulário",
      options.length ? `Opções: ${options.join(" | ")}` : "",
      generated?.draft ? `Sugestão da IA: ${generated.draft}` : "A IA não retornou uma sugestão confiável a tempo.",
      "",
      generated?.draft ? `USAR ${request.commandToken}` : "",
      `RESPONDER ${request.commandToken} sua resposta`,
      `PULAR ${request.commandToken}`,
      "A resposta será salva na candidatura; o envio só continua depois dos demais gates.",
    ].filter(Boolean).join("\n");
  }

  publicQuestionRequest(request) {
    return request ? { id: request.id, commandToken: request.commandToken, applicationId: request.applicationId, questionId: request.questionId, status: request.status, sentAt: request.sentAt, answeredAt: request.answeredAt, createdAt: request.createdAt, updatedAt: request.updatedAt } : null;
  }

  message(request, job, version) {
    const score = Number(version.atsAfter?.overallScore ?? version.atsAfter?.score ?? 0);
    return [`Currículo preparado para aprovação`, `${job.title} — ${job.company}`, job.location || "Local não informado", score ? `Match recalculado: ${score}%` : "Match disponível no TSF Career", `ID: ${request.commandToken}`, "", `APROVAR ${request.commandToken}`, `NEGAR ${request.commandToken}`, `ANALISAR ${request.commandToken}`, this.startsAutoApply(request) ? "Aprovar inicia o AutoApply conforme a capacidade do portal." : "Aprovar mantém esta candidatura para revisão no sistema; nenhum envio automático será iniciado."].join("\n");
  }

  analysisMessage(request, job, version) {
    const score = Number(version.atsAfter?.overallScore ?? version.atsAfter?.score ?? 0);
    const internalUrl = `${this.applicationBaseUrl}/opportunities/${encodeURIComponent(job.id)}?tab=resume`;
    return [`Análise aberta: ${request.commandToken}`, `${job.title} — ${job.company}`, `Versão: ${version.id}`, score ? `Match: ${score}%` : "Match: consulte o dashboard", `Revisar no TSF: ${internalUrl}`, `Fonte: ${job.applicationUrl || job.url || "sem URL"}`, "", "1 — pedir uma alteração ao gerador", `Responda: 1 ${request.commandToken} sua observação`, "", "2 — desaprovar e retirar esta versão da fila ativa", `Responda: 2 ${request.commandToken}`, "", "Nenhuma candidatura foi enviada."].join("\n");
  }

  decisionMessage(request, application, autoApply = null) {
    if (request.status === "APPROVED")
      return this.startsAutoApply(request)
        ? [`Aprovado: ${request.commandToken}`, "O AutoApply foi iniciado no TSF Career.", autoApply?.status === "FAILED" ? `Falha inicial: ${autoApply.errorCode}` : "O sistema continuará até concluir ou encontrar uma ação que precise de você."].join("\n")
        : [`Aprovado: ${request.commandToken}`, "Candidatura disponível para revisão no TSF Career. Nenhum envio automático foi iniciado."].join("\n");
    const job = this.store.jobs.findById(application.jobId);
    return [`Negado: ${request.commandToken}`, job ? `${job.title} — ${job.company}` : "Vaga não identificada", "A candidatura foi encerrada no TSF Career."].join("\n");
  }

  revisionMessage(request, revision) {
    return [`Observação recebida: ${request.commandToken}`, revision?.status === "QUEUED" ? "A revisão entrou na fila da IA." : "A revisão foi registrada.", "O currículo continuará bloqueado para envio até a nova versão passar pelos gates e ser aprovada.", `Acompanhar: ${this.applicationBaseUrl}/opportunities/${encodeURIComponent(request.jobId)}?tab=resume`].join("\n");
  }

  discardMessage(request) {
    const job = this.store.jobs.findById(request.jobId);
    return [`Currículo desaprovado: ${request.commandToken}`, job ? `${job.title} — ${job.company}` : "Vaga não identificada", "A versão saiu da fila ativa e a candidatura foi encerrada.", "O artefato mínimo de auditoria foi preservado para evitar perda de histórico."].join("\n");
  }

  autoApplyResultMessage(application, result = {}) {
    const job = this.store.jobs.findById(application.jobId), provider = result.provider || "portal não identificado";
    const heading = result.status === "SUBMITTED"
      ? "Candidatura enviada e confirmada"
      : result.status === "SUBMISSION_UNCERTAIN"
        ? "Envio sem confirmação conclusiva"
        : result.status === "READY_TO_SUBMIT_MANUAL"
          ? "Preenchimento pronto; envio manual necessário"
        : result.status === "FAILED"
          ? "AutoApply interrompido"
          : "AutoApply precisa de revisão";
    const detail = result.status === "SUBMITTED"
      ? `Recibo: ${result.receiptId || "registrado no TSF"}`
      : result.status === "SUBMISSION_UNCERTAIN"
        ? "Não haverá nova tentativa automática. Confira o portal antes de qualquer reenvio."
        : result.status === "READY_TO_SUBMIT_MANUAL"
          ? "O formulário foi preenchido, mas este portal ainda não possui clique final homologado. Abra, confira e envie manualmente."
        : `Estado: ${result.status || "desconhecido"}${result.reason || result.errorCode ? ` · ${result.reason || result.errorCode}` : ""}`;
    return [heading, job ? `${job.title} — ${job.company}` : "Vaga não identificada", `Portal: ${provider}`, detail, `Candidatura: ${this.applicationBaseUrl}/applications/${encodeURIComponent(application.id)}`, result.status === "READY_TO_SUBMIT_MANUAL" && job?.applicationUrl ? `Abrir portal: ${job.applicationUrl}` : ""].filter(Boolean).join("\n");
  }

  async notifyAutoApplyResult(context = {}, result = {}) {
    const application = this.store.applications.findById(context.application?.id || result.applicationId);
    if (!application || !jid(this.target)) return { sent: false, reason: "WHATSAPP_TARGET_NOT_CONFIGURED" };
    if (result.escalation?.status === "AWAITING_ANSWER")
      return { sent: false, reason: "QUESTION_MESSAGE_ALREADY_SENT" };
    try {
      await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, this.autoApplyResultMessage(application, result));
      this.store.applications.recordEvent(application.id, "AUTOAPPLY_WHATSAPP_RESULT_SENT", { status: result.status || "UNKNOWN", provider: result.provider || "", receiptId: result.receiptId || "" });
      return { sent: true };
    } catch (error) {
      this.store.applications.recordEvent(application.id, "AUTOAPPLY_WHATSAPP_RESULT_FAILED", { status: result.status || "UNKNOWN", errorCode: error.code || "WHATSAPP_RESULT_SEND_FAILED" });
      return { sent: false, reason: error.code || "WHATSAPP_RESULT_SEND_FAILED" };
    }
  }

  async notifyResumeRevisionReady(payload = {}) {
    const request = this.store.whatsappApprovals.findById(clean(payload.approvalRequestId));
    if (!request || request.status !== "AWAITING_APPROVAL" || !jid(this.target)) return { sent: false, reason: "APPROVAL_NOT_ACTIVE" };
    const job = this.store.jobs.findById(request.jobId);
    const before = payload.atsBefore === null || payload.atsBefore === undefined || payload.atsBefore === "" ? null : Number(payload.atsBefore);
    const after = payload.atsAfter === null || payload.atsAfter === undefined || payload.atsAfter === "" ? null : Number(payload.atsAfter);
    const score = Number.isFinite(before) && Number.isFinite(after) ? `Compatibilidade: ${before}% → ${after}%` : "Compatibilidade disponível no TSF";
    const message = ["Revisão da IA pronta para conferir", job ? `${job.title} — ${job.company}` : "Vaga não identificada", score, `Abrir: ${this.applicationBaseUrl}/opportunities/${encodeURIComponent(request.jobId)}?tab=resume`, "Revise os ajustes antes de aprovar. Nenhuma candidatura foi enviada."].join("\n");
    try {
      await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, message);
      return { sent: true };
    } catch (error) {
      this.store.applications.recordEvent(request.applicationId, "WHATSAPP_REVISION_READY_ACK_FAILED", { approvalRequestId: request.id, errorCode: error.code || "WHATSAPP_RESULT_SEND_FAILED" });
      return { sent: false, reason: error.code || "WHATSAPP_RESULT_SEND_FAILED" };
    }
  }

  publicRequest(request) {
    if (!request) return null;
    const { targetHash, ...safe } = request;
    return safe;
  }

  async dispatchApproval(request, application) {
    if (typeof this.approvalHandler !== "function") return { status: "NOT_CONFIGURED" };
    try {
      return await this.approvalHandler({ request: this.publicRequest(request), application });
    } catch (error) {
      this.store.applications.recordEvent(application.id, "AUTOAPPLY_DISPATCH_FAILED", {
        approvalRequestId: request.id,
        errorCode: error.code || "AUTOAPPLY_DISPATCH_FAILED",
      });
      return { status: "FAILED", errorCode: error.code || "AUTOAPPLY_DISPATCH_FAILED" };
    }
  }

  async dispatchRevision(request, application, observation) {
    if (typeof this.revisionHandler !== "function") throw this.error("Revisão por IA não configurada.", "WHATSAPP_REVISION_NOT_CONFIGURED", 503);
    return this.revisionHandler({ request: this.publicRequest(request), application, observation });
  }

  async dispatchRejection(request, application) {
    if (typeof this.rejectionHandler === "function") return this.rejectionHandler({ request: this.publicRequest(request), application });
    return this.store.resumeVersions.transition(request.resumeVersionId, "ARCHIVED");
  }

  async sendAcknowledgement(applicationId, request, message) {
    try {
      await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, message);
    } catch {
      this.store.applications.recordEvent(applicationId, "WHATSAPP_APPROVAL_ACK_FAILED", { approvalRequestId: request.id });
    }
  }

  receiptAction(action) {
    if (action === "REVISAR") return "ANALISAR";
    if (action === "DESCARTAR") return "NEGAR";
    return action;
  }

  verifySecret(value) {
    const expected = Buffer.from(this.webhookSecret), received = Buffer.from(clean(value));
    if (!expected.length || expected.length !== received.length || !timingSafeEqual(expected, received))
      throw this.error("Webhook de aprovação não autorizado.", "WHATSAPP_APPROVAL_WEBHOOK_UNAUTHORIZED", 401);
  }

  error(message, code, status = 400) {
    return Object.assign(new Error(message), { code, status });
  }
}
