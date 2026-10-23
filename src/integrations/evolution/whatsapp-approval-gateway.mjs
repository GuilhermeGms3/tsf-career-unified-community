import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { WhatsappProcessCommands } from "./whatsapp-process-commands.mjs";
import { resolveAutomationEntryUrl } from "../../automation/automation-validation.mjs";
import { isCandidateContactQuestion } from "../../application/question-semantics.mjs";
import { WhatsappMenu } from "./whatsapp-menu.mjs";
import { isOutboundText } from "./outbound-message-guard.mjs";
import { evaluateApplicationRoutingPolicy, resumeAtsScore } from "../../application/application-routing-policy.mjs";

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
  const decision = text.match(/^(APROVAR|ENVIAR|SALVAR|NEGAR|ANALISAR)\s+([A-Z0-9-]{3,64})$/i);
  if (decision) {
    const verb = decision[1].toUpperCase(), approving = ["APROVAR", "ENVIAR", "SALVAR"].includes(verb);
    return { action: approving ? "APROVAR" : verb, token: decision[2].toUpperCase(), observation: "", approvalMode: approving ? verb === "SALVAR" ? "REVIEW_ONLY" : "AUTO_APPLY" : null };
  }
  const revision = text.match(/^(?:1|ALTERAR)\s+([A-Z0-9-]{3,64})\s+([\s\S]{3,800})$/i);
  if (revision) return { action: "REVISAR", token: revision[1].toUpperCase(), observation: clean(revision[2]) };
  const utility = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").match(/^(STATUS|CURRICULO|VERIFICAR|MANUAL|JA\s+ENVIEI|CONTINUAR|CANCELAR)\s+([A-Z0-9-]{3,64})$/i);
  if (utility) return { action: utility[1].toUpperCase().replace(/\s+/g, "_"), token: utility[2].toUpperCase(), utility: true };
  const discard = text.match(/^2\s+([A-Z0-9-]{3,64})$/i);
  return discard ? { action: "DESCARTAR", token: discard[1].toUpperCase(), observation: "" } : null;
};
const questionCommandOf = (value) => {
  const text = clean(value);
  const reminder = text.match(/^(?:RESPONDER\s+)?(PERG-[A-Z0-9-]{6,64})$/i);
  if (reminder) return { action: "ORIENTAR", token: reminder[1].toUpperCase(), answer: "" };
  const use = text.match(/^USAR\s+(PERG-[A-Z0-9-]{6,64})$/i);
  if (use) return { action: "USAR", token: use[1].toUpperCase(), answer: "" };
  const answer = text.match(/^RESPONDER\s+(PERG-[A-Z0-9-]{6,64})\s+([\s\S]{1,2000})$/i);
  if (answer) return { action: "RESPONDER", token: answer[1].toUpperCase(), answer: clean(answer[2]) };
  const defer = text.match(/^PULAR\s+(PERG-[A-Z0-9-]{6,64})$/i);
  return defer ? { action: "PULAR", token: defer[1].toUpperCase(), answer: "" } : null;
};
const handoffCommandOf = (value) => {
  const match = clean(value).match(/^CONTINUAR\s+(ACAO-[A-F0-9]{6})$/i);
  return match ? { action: "CONTINUAR", token: match[1].toUpperCase() } : null;
};
const handoffToken = (applicationId) => `ACAO-${digest(applicationId).slice(0, 6).toUpperCase()}`;
const handoffReasons = new Set([
  "CAPTCHA_REQUIRED",
  "MFA_REQUIRED",
  "LOGIN_REQUIRED",
  "AUTH_REQUIRED",
  "SESSION_EXPIRED",
  "EMAIL_VERIFICATION_REQUIRED",
]);

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
    handoffResumeHandler = null,
    applicationBaseUrl = process.env.CAREER_PUBLIC_URL || `http://127.0.0.1:${process.env.HUB_PORT || 7123}`,
    policyProvider = () => ({ enabled: false }),
  } = {}) {
    Object.assign(this, { store, evolutionService, target, approver, webhookSecret, approvalHandler, revisionHandler, rejectionHandler, questionAnswerHandler, questionResumeHandler, handoffResumeHandler, policyProvider });
    this.applicationBaseUrl = clean(applicationBaseUrl).replace(/\/$/, "");
    this.processCommands = new WhatsappProcessCommands({ gateway: this, availabilityService: null });
    this.menu = new WhatsappMenu(this);
  }

  startsAutoApply(request) {
    const selected = this.store.applications.events(request.applicationId).findLast(event =>
      event.eventType === "WHATSAPP_APPROVAL_MODE_SELECTED" && event.metadata?.approvalRequestId === request.id);
    if (selected) return selected.metadata.approvalMode === "AUTO_APPLY";
    const prepared = this.store.applications.events(request.applicationId).find((event) =>
      event.eventType === "WHATSAPP_APPROVAL_PREPARED" &&
      event.metadata?.approvalRequestId === request.id);
    if (typeof prepared?.metadata?.autoApplyOnApproval === "boolean")
      return prepared.metadata.autoApplyOnApproval;
    const policy = this.policyProvider();
    if (policy?.enabled !== true) return true;
    const version = this.store.resumeVersions.findById(request.resumeVersionId);
    const routing=evaluateApplicationRoutingPolicy({score:resumeAtsScore(version||{}),policy,qualityApproved:true});
    return ["AUTO_ELIGIBLE","HUMAN_REVIEW"].includes(routing.band);
  }

  publicConfiguration() {
    const targetJid = jid(this.target), approverJid = jid(this.approver);
    return {
      configured: Boolean(targetJid && this.webhookSecret && (approverJid || !targetJid.endsWith("@g.us"))),
      targetConfigured: Boolean(targetJid),
      approverConfigured: Boolean(approverJid || (targetJid && !targetJid.endsWith("@g.us"))),
      externalSendAutomatic: false,
      menuCommand: "MENU",
      commands: ["ENVIAR ID", "SALVAR ID", "APROVAR ID", "NEGAR ID", "ANALISAR ID", "STATUS ID", "CURRÍCULO ID", "ALTERAR ID observação", "VERIFICAR ID", "MANUAL ID", "JÁ ENVIEI ID", "CONTINUAR ID", "CANCELAR ID", "1 ID observação", "2 ID", "USAR PERG-ID", "RESPONDER PERG-ID resposta", "PULAR PERG-ID", "CONTINUAR ACAO-ID"],
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
      const previousApplication = this.store.applications.findById(previous.applicationId);
      if (previousApplication?.status === "PLANNED" && previous.applicationId !== application.id)
        this.store.applicationService.transitionApplication(previous.applicationId, "CANCELLED", {
          source: "whatsapp-approval-gateway", reason: "RESUME_SUPERSEDED",
          replacementApplicationId: application.id,
        });
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
    if (["SUBMITTED","SUBMITTING","SUBMISSION_UNCERTAIN","CANCELLED"].includes(application.status)) throw this.error("Candidatura encerrada ou com envio em andamento/incerto.", "WHATSAPP_QUESTION_APPLICATION_NOT_ACTIONABLE", 409);
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
    const receivedAt = Date.now();
    this.verifySecret(secret);
    const data = payload.data || {}, key = data.key || payload.key || {};
    const event = clean(payload.event).toUpperCase().replaceAll(".", "_").replaceAll("-", "_");
    const rawText = textOf(data), questionCommand = questionCommandOf(rawText), handoffCommand = handoffCommandOf(rawText);
    let command = commandOf(rawText);
    if (event !== "MESSAGES_UPSERT" || !rawText) return { handled: false };
    const instance = clean(payload.instance || payload.instanceName || data.instance);
    if (instance !== this.evolutionService.instance) throw this.error("Instância do webhook não confere.", "WHATSAPP_APPROVAL_INSTANCE_MISMATCH", 403);
    const fromMe = key.fromMe === true || data.fromMe === true;
    if (fromMe && isOutboundText(instance,rawText)) return {handled:false,outcome:"OUTBOUND_ECHO"};
    // Long self-authored notices may come from n8n, outside this client's echo registry.
    if (fromMe && !command && !questionCommand && !handoffCommand && (rawText.includes("\n") || rawText.length>160)) return {handled:false};
    const messageId = clean(key.id || data.id || payload.id);
    if (!messageId) throw this.error("Evento sem messageId.", "WHATSAPP_APPROVAL_MESSAGE_ID_REQUIRED", 400);
    const messageHash = digest(`${instance}:${messageId}`);
    if ((!command?.utility || handoffCommand) && this.store.whatsappApprovals.hasReceipt(messageHash)) return { handled: true, outcome: "DUPLICATE" };

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
      if (!command && !questionCommand && !handoffCommand) return {handled:false};
      const receipts = questionCommand ? this.store.whatsappQuestions : this.store.whatsappApprovals;
      receipts.recordReceipt({ messageHash, action: "REJEITADO", outcome: "UNAUTHORIZED_CONTEXT" });
      throw this.error("Comando recebido fora do contexto autorizado.", "WHATSAPP_APPROVAL_UNAUTHORIZED", 403);
    }

    if (questionCommand)
      return this.ingestQuestion({ command: questionCommand, messageHash, targetJid, actor:senderJid });
    if (handoffCommand)
      return this.ingestHandoff({ command: handoffCommand, messageHash });

    if (!command) {
      if (!this.menu.repository.claim(messageHash)) return {handled:true,outcome:"DUPLICATE"};
      let result;
      try { result = await this.menu.handle(rawText, digest(targetJid)); }
      catch (error) { this.menu.repository.release(messageHash); throw error; }
      if (!result.command) return result;
      command = commandOf(result.command);
    }

    const action = command.action;
    let request = this.store.whatsappApprovals.findByToken(command.token);
    if (!request && /^\d{4,6}$/.test(command.token))
      request = this.store.whatsappApprovals.findByToken(`VAGA-${command.token}`);
    if (!request || request.targetHash !== digest(targetJid)) {
      this.store.whatsappApprovals.recordReceipt({ messageHash, action: "REJEITADO", outcome: "REQUEST_NOT_FOUND" });
      await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, `ID ${command.token} não encontrado nesta conversa. Confira o número na mensagem da vaga e tente novamente.`).catch(()=>{});
      throw this.error("Pedido de aprovação não encontrado.", "WHATSAPP_APPROVAL_NOT_FOUND", 404);
    }
    if (command.utility) {
      const application = this.store.applications.findById(request.applicationId);
      if (!application || application.jobId !== request.jobId) throw this.error("Processo não encontrado.", "WHATSAPP_APPROVAL_APPLICATION_MISMATCH", 409);
      return this.processCommands.execute({ command, request, application, messageHash });
    }
    if (request.status !== "AWAITING_APPROVAL") {
      const current = this.store.applications.findById(request.applicationId);
      if (request.status === "APPROVED" && current?.status === "APPROVED" && command.approvalMode === "AUTO_APPLY" && !this.startsAutoApply(request))
        return this.promoteSavedApproval(request, current, messageHash, senderJid);
      this.store.whatsappApprovals.recordReceipt({ requestId: request.id, messageHash, action: this.receiptAction(action), outcome: "ALREADY_DECIDED" });
      const application = this.store.applications.findById(request.applicationId);
      if (application) await this.sendAcknowledgement(application.id, request, action==="ANALISAR"?this.analysisMessage(request,this.store.jobs.findById(request.jobId),this.store.resumeVersions.findById(request.resumeVersionId)):[...this.processCommands.context(request, application), "Decisão já registrada; nenhuma execução repetida."].join("\n"));
      const autoApply = null;
      return { handled: true, outcome: "ALREADY_DECIDED", request: this.publicRequest(request), autoApply };
    }
    const application = this.store.applications.findById(request.applicationId);
    if (!application || application.jobId !== request.jobId || application.resumeVersionId !== request.resumeVersionId)
      throw this.error("A candidatura não corresponde ao pedido preparado.", "WHATSAPP_APPROVAL_APPLICATION_MISMATCH", 409);

    if (action === "ANALISAR") {
      const job = this.store.jobs.findById(request.jobId), version = this.store.resumeVersions.findById(request.resumeVersionId);
      const sendStartedAt = Date.now();
      await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, this.analysisMessage(request, job, version));
      const messageTimestamp = Number(data.messageTimestamp);
      this.store.applications.recordEvent(application.id, "WHATSAPP_APPROVAL_ANALYZED", {
        approvalRequestId: request.id, resumeVersionId: request.resumeVersionId,
        processingMs: Date.now() - receivedAt, sendMs: Date.now() - sendStartedAt,
        inboundAgeMs: Number.isFinite(messageTimestamp) && messageTimestamp > 0
          ? Math.max(0, receivedAt - messageTimestamp * 1000) : null,
      });
      this.store.whatsappApprovals.recordReceipt({ requestId: request.id, messageHash, action, outcome: "ANALYSIS_SENT" });
      return { handled: true, outcome: "ANALYSIS_SENT", request: this.publicRequest(request) };
    }

    if (action === "REVISAR") {
      const previous = this.store.applications.events(application.id).find(event => event.eventType === "WHATSAPP_RESUME_REVISION_REQUESTED" && event.metadata?.observationHash === digest(command.observation));
      if (previous) {
        this.store.whatsappApprovals.recordReceipt({ requestId: request.id, messageHash, action: "ANALISAR", outcome: "REVISION_ALREADY_REQUESTED" });
        await this.sendAcknowledgement(application.id, request, `Alteração já registrada para a vaga ${request.commandToken}. Acompanhe em ${this.applicationBaseUrl}/processes/${encodeURIComponent(request.jobId)}. Nenhuma revisão duplicada foi criada.`);
        return { handled: true, outcome: "REVISION_ALREADY_REQUESTED" };
      }
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

    if(action==="APROVAR"&&this.store.applications.events(application.id).some(event=>event.eventType==="WHATSAPP_RESUME_REVISION_REQUESTED"&&event.metadata?.approvalRequestId===request.id)){
      this.store.whatsappApprovals.recordReceipt({requestId:request.id,messageHash,action:"APROVAR",outcome:"REVISION_PENDING"});
      await this.sendAcknowledgement(application.id,request,`Vaga ${request.commandToken}: há uma alteração solicitada neste currículo. Revise os ajustes e gere a nova versão antes de aprovar. O PDF antigo não será enviado. Abrir: ${this.applicationBaseUrl}/opportunities/${encodeURIComponent(request.jobId)}?tab=resume`);
      return {handled:true,outcome:"REVISION_PENDING"};
    }
    const startsAutoApply = action === "APROVAR" && command.approvalMode === "AUTO_APPLY";
    this.store.applicationDecisionService.decide({
      applicationId:application.id,resumeVersionId:request.resumeVersionId,decision:action==="APROVAR"?"APPROVE":"REJECT",
      mode:command.approvalMode||"REVIEW_ONLY",actor:senderJid,channel:"WHATSAPP",idempotencyKey:messageHash,approvalRequestId:request.id,
      recordChannelReceipt:()=>this.store.whatsappApprovals.recordReceipt({requestId:request.id,messageHash,action,outcome:action==="APROVAR"?"APPROVED":"DENIED"})
    });
    const updatedRequest=this.store.whatsappApprovals.findById(request.id),applicationWithNextAction=this.store.applications.findById(application.id);
    this.feedbackChanged?.();
    await this.sendAcknowledgement(application.id, updatedRequest, this.decisionMessage(updatedRequest, applicationWithNextAction));
    const autoApply = startsAutoApply ? await this.dispatchApproval(updatedRequest, applicationWithNextAction) : null;
    return { handled: true, outcome: updatedRequest.status, request: this.publicRequest(updatedRequest), application: applicationWithNextAction, autoApply };
  }

  async promoteSavedApproval(request, application, messageHash, actor) {
    const latest = this.store.whatsappProcesses.requests(request.jobId)[0], version = this.store.resumeVersions.findById(request.resumeVersionId), base = approvedBase(this.store);
    const revisionPending = this.store.applications.events(application.id).some(event => event.eventType === "WHATSAPP_RESUME_REVISION_REQUESTED" && event.metadata?.approvalRequestId === request.id);
    if (latest?.id !== request.id || !version || version.resumeId !== base?.id || application.resumeVersionId !== version.id || !["READY", "APPROVED"].includes(version.status) || revisionPending) {
      this.store.whatsappApprovals.recordReceipt({ requestId: request.id, messageHash, action: "APROVAR", outcome: "CURRENT_RESUME_REVIEW_REQUIRED" });
      await this.sendAcknowledgement(application.id, request, [...this.processCommands.context(request, application), "Revise a versão atual antes de autorizar. Este pedido foi substituído, arquivado ou possui alterações pendentes."].join("\n"));
      return { handled: true, outcome: "CURRENT_RESUME_REVIEW_REQUIRED" };
    }
    this.store.applicationDecisionService.decide({applicationId:application.id,resumeVersionId:request.resumeVersionId,decision:"APPROVE",mode:"AUTO_APPLY",actor,channel:"WHATSAPP",idempotencyKey:messageHash,approvalRequestId:request.id,
      recordChannelReceipt:()=>this.store.whatsappApprovals.recordReceipt({requestId:request.id,messageHash,action:"APROVAR",outcome:"AUTO_APPLY_AUTHORIZED"})});
    const updated=this.store.applications.findById(application.id);
    await this.sendAcknowledgement(application.id, request, this.decisionMessage(request, updated));
    const autoApply = await this.dispatchApproval(request, updated);
    return { handled: true, outcome: "AUTO_APPLY_AUTHORIZED", autoApply };
  }

  async ingestQuestion({ command, messageHash, targetJid, actor }) {
    if (this.store.whatsappQuestions.hasReceipt(messageHash)) return { handled: true, outcome: "DUPLICATE" };
    const receiptAction = command.action === "ORIENTAR" ? "REJEITADO" : command.action;
    const request = this.store.whatsappQuestions.findByToken(command.token);
    if (!request || request.targetHash !== digest(targetJid)) {
      this.store.whatsappQuestions.recordReceipt({ messageHash, action: "REJEITADO", outcome: "REQUEST_NOT_FOUND" });
      await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, `Pergunta ${command.token} não encontrada nesta conversa. Confira o ID na mensagem da pergunta.`);
      throw this.error("Pedido de pergunta não encontrado.", "WHATSAPP_QUESTION_REQUEST_NOT_FOUND", 404);
    }
    if (request.status !== "AWAITING_ANSWER") {
      this.store.whatsappQuestions.recordReceipt({ requestId: request.id, messageHash, action: receiptAction, outcome: "ALREADY_RESOLVED" });
      await this.sendAcknowledgement(request.applicationId, request, `Pergunta ${request.commandToken}: ${request.status === "ANSWERED" ? "resposta já registrada" : "pergunta adiada ou encerrada"}. Nenhum novo envio foi iniciado. Consulte a candidatura no TSF para acompanhar as próximas pendências.`);
      return { handled: true, outcome: "ALREADY_RESOLVED", request: this.publicQuestionRequest(request) };
    }
    const application = this.store.applications.findById(request.applicationId);
    const question = this.store.applicationQuestions.forApplication(request.applicationId).find((item) => item.id === request.questionId);
    if (!application || !question || !question.required || question.answerStatus !== "USER_REQUIRED" || ["SUBMITTED","SUBMITTING","SUBMISSION_UNCERTAIN","CANCELLED"].includes(application.status)) {
      await this.sendAcknowledgement(request.applicationId, request, `A pergunta ${request.commandToken} não está mais pendente neste formulário. Confira a candidatura no TSF antes de responder; nenhum envio foi iniciado.`);
      throw this.error("A pergunta não corresponde mais à candidatura pendente.", "WHATSAPP_QUESTION_CONTEXT_STALE", 409);
    }

    if (command.action === "ORIENTAR") {
      this.store.whatsappQuestions.recordReceipt({ requestId: request.id, messageHash, action: receiptAction, outcome: "ANSWER_INSTRUCTIONS" });
      await this.sendAcknowledgement(application.id, request, this.questionMessage(request, application, question));
      return { handled: true, outcome: "ANSWER_INSTRUCTIONS", request: this.publicQuestionRequest(request) };
    }

    if (command.action === "PULAR") {
      const deferred = this.store.whatsappQuestions.resolve(request.id, "DEFERRED");
      this.store.whatsappQuestions.recordReceipt({ requestId: request.id, messageHash, action: command.action, outcome: "DEFERRED" });
      this.store.applications.recordEvent(application.id, "WHATSAPP_QUESTION_DEFERRED", { questionId: question.id, questionRequestId: request.id });
      await this.sendAcknowledgement(application.id, request, `Pergunta adiada: ${request.commandToken}\nEla continua disponível em Candidaturas e nenhum envio foi feito.`);
      return { handled: true, outcome: "DEFERRED", request: this.publicQuestionRequest(deferred) };
    }

    let answer=clean(command.answer),source="USER_CONFIRMED",generated=null;
    if(command.action==="USAR"){
      generated=this.store.generatedContent.findById(request.generatedContentId);
      if(!generated||generated.applicationId!==application.id||generated.questionId!==question.id||generated.state!=="REVIEW_REQUIRED"||!clean(generated.draft))
        throw this.error("Sugestao nao disponivel para esta pergunta.","WHATSAPP_QUESTION_SUGGESTION_NOT_AVAILABLE",409);
      answer=generated.draft;source="LLM_APPROVED";
    }
    if(!answer)throw this.error("Resposta vazia.","WHATSAPP_QUESTION_ANSWER_REQUIRED",400);
    try{
      this.store.applicationDecisionService.answer({applicationId:application.id,resumeVersionId:application.resumeVersionId,questionId:question.id,fingerprint:question.fingerprint,answer,source,
        actor:actor||targetJid,channel:"WHATSAPP",idempotencyKey:messageHash,
        saveAnswer:command.action!=="USAR"&&typeof this.questionAnswerHandler==="function"?context=>this.questionAnswerHandler({request,...context}):undefined,
        recordChannelReceipt:()=>{
          if(generated)this.store.generatedContent.review(generated.id,"APPROVED");
          this.store.whatsappQuestions.recordReceipt({requestId:request.id,messageHash,action:command.action,outcome:"ANSWERED"});
          this.store.applications.recordEvent(application.id,"WHATSAPP_QUESTION_ANSWERED",{questionId:question.id,questionRequestId:request.id,source});
        }
      });
    }catch(error){
      this.store.applications.recordEvent(application.id,"WHATSAPP_QUESTION_ANSWER_FAILED",{questionRequestId:request.id,errorCode:error.code||"QUESTION_ANSWER_FAILED"});
      await this.sendAcknowledgement(application.id,request,`Não consegui registrar sua resposta. Confira o formato e as opções abaixo; se persistir, responda pelo TSF.\n\n${this.questionMessage(request,application,question)}`);
      return {handled:true,outcome:"ANSWER_NOT_SAVED",request:this.publicQuestionRequest(request)};
    }
    const answered=this.store.whatsappQuestions.findById(request.id);
    await this.sendAcknowledgement(application.id, request, `Resposta registrada: ${request.commandToken}\nVou conferir as próximas pendências. Nenhuma candidatura foi enviada por esta confirmação.`);
    let resumed = null;
    if (typeof this.questionResumeHandler === "function") {
      try {
        resumed = await this.questionResumeHandler({ request: answered, application: this.store.applications.findById(application.id) });
        if (resumed?.status === "FAILED") throw this.error("Não foi possível retomar.", resumed.errorCode || "QUESTION_RESUME_FAILED", 409);
        if (resumed?.status === "PLATFORM_REQUIRED") await this.sendAcknowledgement(application.id, request, `A próxima pergunta precisa ser respondida no TSF por envolver consentimento, dado sensível ou indisponibilidade do canal. Nenhuma candidatura foi enviada. Abrir: ${this.applicationBaseUrl}/applications/${encodeURIComponent(application.id)}`);
      } catch (error) {
        this.store.applications.recordEvent(application.id, "WHATSAPP_QUESTION_RESUME_FAILED", { questionRequestId: request.id, errorCode: error.code || "QUESTION_RESUME_FAILED" });
        await this.sendAcknowledgement(application.id, request, `Sua resposta ${request.commandToken} está salva, mas não consegui retomar o AutoApply. Nenhum novo envio foi confirmado. Abra a candidatura no TSF para verificar o impedimento: ${this.applicationBaseUrl}/applications/${encodeURIComponent(application.id)}`);
        return { handled: true, outcome: "ANSWERED_RESUME_FAILED", request: this.publicQuestionRequest(answered) };
      }
    }
    return { handled: true, outcome: "ANSWERED", request: this.publicQuestionRequest(answered), resumed };
  }

  async ingestHandoff({ command, messageHash }) {
    const application = this.store.applications.all().find((item) =>
      item.status === "WAITING_USER" && handoffToken(item.id) === command.token);
    if (!application) {
      this.store.whatsappApprovals.recordReceipt({ messageHash, action: "ANALISAR", outcome: "HANDOFF_NOT_FOUND" });
      throw this.error("A pendência já foi resolvida ou não existe mais.", "WHATSAPP_HANDOFF_NOT_FOUND", 404);
    }
    this.store.whatsappApprovals.recordReceipt({ messageHash, action: "ANALISAR", outcome: "HANDOFF_RESUME_REQUESTED" });
    this.store.applications.recordEvent(application.id, "WHATSAPP_HANDOFF_RESUME_REQUESTED", { commandToken: command.token });
    await this.sendAcknowledgement(application.id, {}, `Validação iniciada: ${command.token}\nVou conferir novamente o portal e retomar o AutoApply. Se a pendência continuar, aviso sem repetir o envio.`);
    const resumed = typeof this.handoffResumeHandler === "function"
      ? await this.handoffResumeHandler({ application, token: command.token })
      : { status: "NOT_CONFIGURED" };
    return { handled: true, outcome: "HANDOFF_RESUME_REQUESTED", application, resumed };
  }

  questionMessage(request, application, question) {
    const job = application ? this.store.jobs.findById(application.jobId) : null;
    const generated = request.generatedContentId ? this.store.generatedContent.findById(request.generatedContentId) : null;
    const options = (question?.options || []).slice(0, 10).map((item) => item.label || item.value || item).filter(Boolean);
    const remaining = application ? this.store.applicationQuestions.forApplication(application.id).filter(item => item.required && item.answerStatus === "USER_REQUIRED").length : 0;
    return [
      "Pergunta pendente na candidatura",
      job ? `${job.title} — ${job.company}` : "Vaga não identificada",
      `ID: ${request.commandToken}`,
      remaining > 1 ? `Perguntas obrigatórias restantes: ${remaining}. Vou enviar uma por vez.` : "",
      "",
      question?.label || "Pergunta do formulário",
      question?.reasonRequired || "",
      options.length ? `Opções: ${options.join(" | ")}` : "",
      ["select-multiple","checkbox-group"].includes(question?.fieldType)?"Pode escolher mais de uma opção; separe as escolhas por |.":"",
      generated?.draft ? `Sugestão da IA: ${generated.draft}` : isCandidateContactQuestion(question)
        ? "Confirme este dado cadastral para esta candidatura. A IA não deve adivinhar dados pessoais."
        : "Não há sugestão validada da IA. Responda com a informação que deseja usar.",
      "",
      generated?.draft ? `USAR ${request.commandToken}` : "",
      `RESPONDER ${request.commandToken} sua resposta`,
      `PULAR ${request.commandToken}`,
      "A resposta será salva nesta candidatura; o envio só continua após as demais conferências de segurança.",
    ].filter(Boolean).join("\n");
  }

  publicQuestionRequest(request) {
    return request ? { id: request.id, commandToken: request.commandToken, applicationId: request.applicationId, questionId: request.questionId, status: request.status, sentAt: request.sentAt, answeredAt: request.answeredAt, createdAt: request.createdAt, updatedAt: request.updatedAt } : null;
  }

  message(request, job, version) {
    const score = Number(version.atsAfter?.overallScore ?? version.atsAfter?.score ?? 0);
    return ["Currículo para sua decisão", `${job.title} — ${job.company}`, job.location || "Local não informado", score ? `Match recalculado: ${score}%` : "Match disponível no TSF Career", `ID: ${request.commandToken}`, "", `ENVIAR ${request.commandToken} — aprovar e iniciar candidatura`, `SALVAR ${request.commandToken} — aprovar sem enviar`, `NEGAR ${request.commandToken}`, `ANALISAR ${request.commandToken}`, "Envio depende da disponibilidade do portal, dos bloqueios de segurança e da configuração do sistema."].join("\n");
  }

  analysisMessage(request, job, version) {
    const score = Number(version.atsAfter?.overallScore ?? version.atsAfter?.score ?? 0);
    const internalUrl = `${this.applicationBaseUrl}/opportunities/${encodeURIComponent(job.id)}?tab=resume`;
    return [`Análise aberta: ${request.commandToken}`, `${job.title} — ${job.company}`, `Versão: ${version.id.slice(-8)}`, score ? `Match: ${score}%` : "Match: consulte o dashboard", `Revisar no TSF: ${internalUrl}`, `Fonte: ${job.applicationUrl || job.url || "sem URL"}`, "", `ENVIAR ${request.commandToken} — aprovar e iniciar candidatura`, `SALVAR ${request.commandToken} — aprovar sem enviar`, `ALTERAR ${request.commandToken} sua observação (ou 1 ID observação)`, `2 ${request.commandToken} — desaprovar somente o currículo`, `CURRÍCULO ${request.commandToken} — receber PDF atual`, `VERIFICAR ${request.commandToken} — conferir disponibilidade`, `MANUAL ${request.commandToken} — concluir no portal`, `JÁ ENVIEI ${request.commandToken} — informar envio manual`, `CONTINUAR ${request.commandToken} — retomar após resolver pendências`, `CANCELAR ${request.commandToken} — parar o processamento pendente`, "", "Este comando apenas consulta; não envia uma nova candidatura."].join("\n");
  }

  decisionMessage(request, application, autoApply = null) {
    const job = this.store.jobs.findById(application.jobId);
    if (request.status === "APPROVED" && !["SUBMITTED", "SUBMISSION_UNCERTAIN", "SUBMITTING"].includes(application.status) && (job?.lifecycleStatus === "CLOSED" || job?.availability?.status === "CLOSED"))
      return this.autoApplyResultMessage(application, { reason: "JOB_CLOSED" });
    if (request.status === "APPROVED")
      return this.startsAutoApply(request)
        ? [`Aprovado: ${request.commandToken}`, ...this.processCommands.context(request, application), "O AutoApply foi iniciado no TSF Career.", autoApply?.status === "FAILED" ? `Falha inicial: ${autoApply.errorCode}` : "O sistema continuará até concluir ou encontrar uma ação que precise de você."].join("\n")
        : [`Salvo: ${request.commandToken}`, ...this.processCommands.context(request, application), "Currículo aprovado sem iniciar envio.", `Para iniciar: ENVIAR ${request.commandToken}`].join("\n");
    return [`Negado: ${request.commandToken}`, ...this.processCommands.context(request, application), "A candidatura foi encerrada no TSF Career. Sua decisão sobre esta vaga foi registrada; vagas semelhantes não serão bloqueadas automaticamente."].join("\n");
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
    const reason = String(result.reason || result.errorCode || "").toUpperCase();
    let portalUrl = "";
    try { portalUrl = resolveAutomationEntryUrl(job?.applicationUrl || job?.canonicalUrl || job?.url); } catch {}
    const diagnoses = {
      ADAPTER_NOT_AVAILABLE: ["Envio manual necessário", "Este portal ainda não possui AutoApply/AutoSubmit disponível no TSF. Abra a vaga e envie manualmente."],
      ADAPTER_UNSUPPORTED_LAYOUT: ["Formulário não reconhecido; concluir manualmente", "O TSF tem integração com este portal, mas não reconheceu o formulário desta vaga. Parou antes de preencher ou enviar. Abra o portal, anexe o currículo aprovado e conclua manualmente."],
      FORM_CHANGED_REVIEW_REQUIRED: ["O formulário mudou durante o preenchimento", "Novos campos obrigatórios apareceram. Existem dados conhecidos, mas este fluxo precisa de conferência no portal antes de continuar; nenhuma candidatura foi enviada. Abra o link da vaga para conferir e concluir manualmente."],
      FORM_FIELD_FILL_FAILED: ["Não consegui preencher um campo obrigatório", "O campo não aceitou o preenchimento. O TSF parou antes do envio, mesmo que o formulário pareça preenchido. Confira a pendência e conclua pelo link do portal."],
      FIELD_TIMEOUT: ["O portal não disponibilizou um campo a tempo", "As tentativas limitadas de preenchimento não resolveram a demora. Nenhuma candidatura foi enviada. Abra o portal para conferir o campo ou retome mais tarde."],
      OPTION_NOT_FOUND: ["A opção exata não foi encontrada no formulário", "Não escolhi uma opção aproximada. Confira as alternativas e conclua pelo link do portal; nenhuma candidatura foi enviada."],
      COMBOBOX_OPTIONS_UNAVAILABLE: ["A lista de opções do portal não foi reconhecida", "O TSF não conseguiu identificar a lista com segurança. Confira esse campo no portal e conclua manualmente; nenhuma candidatura foi enviada."],
      SUBMISSION_DISABLED: ["AutoSubmit desativado nesta instalação", "O portal possui envio controlado, mas o envio externo está desligado no sistema. Habilite-o na configuração ou conclua manualmente."],
      PORTAL_EXTERNAL_SUBMIT_NOT_VERIFIED: ["Envio automático ainda não homologado neste portal", "O TSF possui envio controlado implementado, mas ainda não tem confirmação externa suficiente para autorizar o envio por nota neste portal. O preenchimento foi preparado; confira e conclua manualmente."],
      AUTOAPPLY_RECOVERY_CONTEXT_STALE: ["Currículo mudou antes da retomada", "A autorização antiga não cobre esta versão. Confira o currículo atual e aprove novamente; nenhum reenvio foi iniciado."],
      DECISION_CONTEXT_STALE: ["Autorização desatualizada", "O currículo ou o prazo da aprovação mudou. Confira a versão atual e renove a autorização antes de continuar."],
      AUTOAPPLY_RECOVERY_APPROVAL_REQUIRED: ["Autorização precisa ser renovada", "A aprovação está ausente, expirada ou não corresponde à versão atual. Revise a candidatura e autorize novamente antes de retomar."],
      AUTOAPPLY_RECOVERY_LIMIT_REACHED: ["Retomadas automáticas esgotadas", "O TSF atingiu o limite de recuperação desta execução. Confira o histórico e resolva a causa antes de continuar ou concluir manualmente."],
      AUTOAPPLY_LEASE_LOST: ["Execução interrompida por segurança", "Esta execução perdeu a permissão de processamento. Confira o estado atual no sistema; não inicie outra candidatura se o envio estiver incerto."],
      AUTOAPPLY_POLICY_REVALIDATION_REQUIRED: ["Política alterada antes do envio", "A nota ou as regras atuais não permitem mais este avanço automático. Confira a candidatura e decida como continuar."],
      PRIVATE_DISCOVERY_TARGET: ["Destino de rede bloqueado", "O link tentou acessar uma rede privada ou endereço interno. O TSF bloqueou a navegação; confira o endereço público da vaga antes de continuar."],
      AUTOAPPLY_RESUME_QUALITY_REVIEW_REQUIRED: ["Currículo precisa de revisão", "A versão ainda não passou pelas verificações de qualidade e evidências. Revise ou gere uma nova versão antes de enviar."],
      AUTOAPPLY_FINAL_PREFLIGHT_BLOCKED: ["Conferência final encontrou pendências", "Abra a candidatura para conferir perguntas, sessão, currículo e os bloqueios identificados. Não houve envio confirmado."],
      AUTOAPPLY_ANALYSIS_NOT_FOUND: ["Análise da vaga não encontrada", "Recalcule a análise desta vaga com o currículo selecionado antes de continuar."],
      REQUIRED_FIELD_UNKNOWN: ["Falta uma resposta no formulário", result.escalation?.status === "AWAITING_ANSWER"
        ? "Um campo obrigatório ainda precisa de uma resposta confirmada. Responda à pergunta enviada pelo TSF; depois retome a candidatura. Se preferir, conclua pelo link do portal."
        : result.escalation?.status === "FAILED"
          ? "Há um campo obrigatório sem resposta, mas não foi possível encaminhar a pergunta pelo WhatsApp. Responda em Candidaturas ou conclua pelo link do portal. Não houve envio confirmado."
          : "Um campo obrigatório ainda precisa de uma resposta confirmada. Confira as perguntas em Candidaturas ou conclua pelo link do portal. Dados protegidos e consentimentos precisam da sua decisão."],
      RESUME_UPLOAD_NOT_CONFIRMED: ["Anexo do currículo não confirmado", "O portal não confirmou o anexo da versão aprovada. Não é seguro enviar sem ele. Confira o PDF e anexe-o manualmente no portal, ou retome após corrigir a pendência."],
      OPTION_NOT_FOUND: ["Opção do formulário não encontrada", "A resposta salva não corresponde às opções oferecidas pelo portal. Escolha uma opção válida na candidatura ou conclua manualmente; o TSF não escolheu outra por conta própria."],
      FORM_NOT_FOUND: ["Formulário não localizado", "O portal abriu, mas o formulário esperado não apareceu. Pode haver redirecionamento ou mudança na página. Abra o link e confira como se candidatar; não houve confirmação de envio."],
      PORTAL_TEMPORARILY_UNAVAILABLE: ["Portal temporariamente indisponível", `O portal respondeu com erro de servidor.${result.recoveryAttempts > 1 ? ` O TSF tentou recuperar o preenchimento ${result.recoveryAttempts} vezes.` : ""} Não foi possível avançar. Tente mais tarde ou abra o link para concluir manualmente quando o portal voltar.`],
      PORTAL_ACCESS_RESTRICTED: ["Portal restringiu o acesso", "O portal recusou a abertura automatizada. Isso não prova que a vaga encerrou. Entre pelo Cofre ou confira o link no navegador; depois retome. O TSF não tenta burlar o bloqueio."],
      PORTAL_RATE_LIMITED: ["Portal pediu uma pausa", "O portal limitou temporariamente as requisições. O TSF interrompeu as tentativas para não agravar o bloqueio. Aguarde antes de retomar ou confira a vaga manualmente."],
      PREFLIGHT_BLOCKED: ["Conferência de segurança impediu o preenchimento", "Há uma pendência de currículo, sessão, perguntas ou elegibilidade. Veja o motivo na candidatura antes de retomar. O link do portal está abaixo para conferir ou concluir manualmente."],
      ANTI_BOT_CHALLENGE: ["Portal pediu uma verificação humana", "O portal interrompeu o acesso automatizado. Abra-o e conclua a verificação pessoalmente; depois use CONTINUAR. O TSF não tenta burlar essa proteção."],
      AUTOAPPLY_POLICY_BLOCKED: ["Candidatura bloqueada pela política", Number.isFinite(result.matchScore) && Number.isFinite(result.minimumMatchScore) && result.matchScore < result.minimumMatchScore
        ? `Nota ${result.matchScore}; mínimo do planner ${result.minimumMatchScore}. A aprovação do currículo foi registrada, mas a política atual impediu o avanço.`
        : "Uma regra de seleção, elegibilidade ou duplicidade impediu o avanço. Isso não significa falta de AutoSubmit no portal."],
    };
    if (diagnoses[reason]) {
      const [heading, explanation] = diagnoses[reason];
      return [heading, job ? `${job.title} — ${job.company}` : "Vaga não identificada", `Portal: ${provider}`, explanation,
        ...(result.blockingReasons || []).slice(0, 6).map(item => `Motivo: ${String(item).slice(0, 200)}`),
        `Diagnóstico: ${reason}`, `Próxima ação: ${["ADAPTER_NOT_AVAILABLE", "ADAPTER_UNSUPPORTED_LAYOUT", "FORM_NOT_FOUND"].includes(reason) ? "concluir no portal" : "revisar a pendência na candidatura"}.`,
        `Candidatura: ${this.applicationBaseUrl}/applications/${encodeURIComponent(application.id)}`,
        portalUrl ? `Conferir no portal: ${portalUrl}` : "", "Nenhum envio foi confirmado por este resultado."].filter(Boolean).join("\n");
    }
    if (["JOB_CLOSED", "JOB_AVAILABILITY_UNCONFIRMED"].includes(reason)) {
      const closed = reason === "JOB_CLOSED";
      return [closed ? "Vaga encerrada no portal" : "Disponibilidade da vaga não confirmada",
        job ? `${job.title} — ${job.company}` : "Vaga não identificada",
        closed ? "O portal não está aceitando candidaturas para esta vaga. O AutoApply foi interrompido; nenhuma candidatura foi enviada."
          : "A consulta ao portal foi inconclusiva. Isso não significa que a vaga expirou. O AutoApply está aguardando verificação; nenhuma candidatura foi enviada.",
        "O currículo e o histórico foram preservados.",
        `Candidatura: ${this.applicationBaseUrl}/applications/${encodeURIComponent(application.id)}`,
        job?.applicationUrl || job?.url ? `Conferir no portal: ${job.applicationUrl || job.url}` : "",
      ].filter(Boolean).join("\n");
    }
    if (result.status === "WAITING_USER" && handoffReasons.has(reason)) {
      const token = handoffToken(application.id);
      const copy = {
        CAPTCHA_REQUIRED: [`A ${provider} pediu CAPTCHA.`, "Resolva o desafio diretamente no portal."],
        MFA_REQUIRED: [`A ${provider} pediu autenticação em duas etapas.`, "Conclua o código ou aprovação no portal."],
        LOGIN_REQUIRED: [`A sessão da ${provider} precisa ser renovada.`, "Entre novamente pelo Cofre protegido."],
        AUTH_REQUIRED: [`A sessão da ${provider} precisa ser conectada.`, "Entre pelo Cofre protegido."],
        SESSION_EXPIRED: [`A sessão da ${provider} expirou.`, "Renove a conexão pelo Cofre protegido."],
        EMAIL_VERIFICATION_REQUIRED: [`A ${provider} pediu confirmação por e-mail.`, "Confirme o e-mail no portal antes de continuar."],
      }[reason];
      const resolveUrl = ["LOGIN_REQUIRED", "AUTH_REQUIRED", "SESSION_EXPIRED"].includes(reason)
        ? `${this.applicationBaseUrl}/vaults`
        : job?.applicationUrl || `${this.applicationBaseUrl}/applications/${encodeURIComponent(application.id)}`;
      return [copy[0], job ? `${job.title} — ${job.company}` : "Vaga não identificada", copy[1], `Resolver agora: ${resolveUrl}`, "", `Quando terminar, responda: CONTINUAR ${token}`, "O TSF revalidará a sessão antes de retomar; nenhum sucesso será presumido."].join("\n");
    }
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
        : result.status === "FAILED" ? /TIMEOUT|NAVIGATION|BROWSER|TARGET_CLOSED/.test(reason) || result.failureClass === "RETRYABLE"
          ? `Falha técnica: o portal demorou demais ou a conexão do navegador foi interrompida.${result.recoveryAttempts > 1 ? ` Foram realizadas ${result.recoveryAttempts} tentativas de preenchimento, sem recuperação.` : ""} Não houve envio confirmado. Você pode retomar mais tarde ou preencher manualmente pelo link abaixo.`
          : "Falha técnica: o TSF não conseguiu concluir esta etapa com segurança. O motivo ainda não foi classificado; não vamos afirmar que o portal não tem AutoSubmit. Confira a tentativa no sistema ou preencha manualmente pelo link abaixo. Nenhum envio foi confirmado."
        : "Existe uma pendência que precisa de conferência. Abra a candidatura para ver a próxima ação; se preferir, use o link do portal para concluir manualmente. Nenhum envio foi confirmado.";
    return [heading, job ? `${job.title} — ${job.company}` : "Vaga não identificada", `Portal: ${provider}`, detail,
      result.status === "FAILED" ? `Referência técnica: ${reason || "AUTOAPPLY_FAILED"}` : "",
      `Candidatura: ${this.applicationBaseUrl}/applications/${encodeURIComponent(application.id)}`,
      ["READY_TO_SUBMIT_MANUAL", "FAILED", "WAITING_USER"].includes(result.status) && portalUrl ? `Preencher manualmente: ${portalUrl}` : ""].filter(Boolean).join("\n");
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
    const mode = ["LLM", "OFFLINE_LIBRARY", "BASE_UNCHANGED"].includes(payload.generationMode) ? payload.generationMode : "UNKNOWN";
    const heading = mode === "LLM" ? "Revisão da IA pronta para conferir" : mode === "OFFLINE_LIBRARY" ? "Prévia offline pronta para conferir" : mode === "BASE_UNCHANGED" ? "Nenhuma alteração validada" : "Prévia de revisão pronta para conferir";
    const explanation = mode === "OFFLINE_LIBRARY" ? "Foram usados textos locais. Confira se a prévia atende sua observação; uma instrução personalizada pode não ter sido atendida integralmente."
      : mode === "BASE_UNCHANGED" ? "O conteúdo foi preservado. Não foi encontrada uma alteração segura; revise a observação ou tente novamente com a IA disponível." : "";
    const message = [`${heading} · ID ${request.commandToken}`, job ? `${job.title} — ${job.company}` : "Vaga não identificada", score, explanation,
      payload.qualityStatus === "BLOCKED" ? "A prévia não passou nas verificações de qualidade e não pode seguir para envio." : "",
      `Abrir: ${this.applicationBaseUrl}/opportunities/${encodeURIComponent(request.jobId)}?tab=resume`, "Revise os ajustes e gere a nova versão para receber um novo pedido de aprovação. A aprovação anterior não cobre mudanças. Nenhuma candidatura foi enviada."].filter(Boolean).join("\n");
    try {
      await this.evolutionService.client.sendText(this.evolutionService.instance, this.target, message);
      this.store.applications.recordEvent(request.applicationId, "WHATSAPP_RESUME_REVISION_READY", { approvalRequestId: request.id, resumeVersionId: request.resumeVersionId, tailoringRunId: clean(payload.tailoringRunId), generationMode: mode });
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
      const durable=this.store.autoApplyRuns?.find(request.id)?.context?.request;
      return await this.approvalHandler({ request: {...this.publicRequest(request),...durable}, application });
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
