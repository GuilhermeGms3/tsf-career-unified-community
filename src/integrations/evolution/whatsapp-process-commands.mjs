import { resolveAutomationEntryUrl } from "../../automation/automation-validation.mjs";

const labels = { PLANNED: "Currículo em revisão", APPROVED: "Aprovada", QUEUED: "Na fila", OPENING_PAGE: "Abrindo o portal", FILLING: "Preenchendo formulário", VALIDATING: "Validando formulário", WAITING_USER: "Aguardando sua ação", READY_TO_SUBMIT: "Preenchida, ainda não enviada", SUBMITTING: "Envio em andamento", SUBMITTED: "Enviada", SUBMISSION_UNCERTAIN: "Envio incerto: não repetir", CANCELLED: "Encerrada", BLOCKED: "Bloqueada", FAILED: "Falha", RETRYABLE: "Pode tentar novamente" };
const protectedStates = new Set(["SUBMITTED", "SUBMITTING", "SUBMISSION_UNCERTAIN"]);

export class WhatsappProcessCommands {
  constructor({ gateway, availabilityService, onChange = () => {} }) { Object.assign(this, { gateway, availabilityService, onChange }); this.store = gateway.store; }
  context(request, application) {
    const job = this.store.jobs.findById(request.jobId || application.jobId), version = request.resumeVersionId ? this.store.resumeVersions.findById(request.resumeVersionId) : null, base = version && this.store.resumes.findById(version.resumeId);
    return [`Vaga ${request.commandToken}: ${job?.title || "Vaga"} — ${job?.company || "Empresa"}`, `Currículo: ${base?.title || "Base não encontrada"} · versão ${String(request.resumeVersionId || "não vinculada").slice(-8)}`, `Estado: ${labels[application.status] || application.status}`, `Próxima ação: ${application.nextAction || "Consultar processo"}`];
  }
  async execute({ command, request, application, messageHash }) {
    const journal = this.store.whatsappProcesses, gateway = this.gateway;
    if (!journal.claim({ messageHash, requestId: request.id, applicationId: application.id, action: command.action })) {
      await gateway.sendAcknowledgement(application.id, request, [...this.context(request, this.store.applications.findById(application.id)), "Comando já registrado; nenhuma ação repetida."].join("\n"));
      return { handled: true, outcome: "DUPLICATE" };
    }
    let outcome = command.action, lines = this.context(request, application), resumeDispatched = false;
    this.store.applications.recordEvent(application.id,"WHATSAPP_PROCESS_COMMAND_STARTED",{action:command.action,approvalRequestId:request.id,resumeVersionId:request.resumeVersionId});
    const job = this.store.jobs.findById(request.jobId);
    const events = this.store.applications.events(application.id);
    const manualSent = events.some(event => event.eventType === "WHATSAPP_MANUAL_SUBMISSION_REPORTED");
    try {
      const newest = this.store.whatsappProcesses.requests(job.id)[0];
      if (newest && newest.id !== request.id && ["JA_ENVIEI", "CONTINUAR", "CANCELAR"].includes(command.action)) throw Object.assign(new Error(`Este pedido foi substituído. Use o ID ${newest.token} para atuar na versão atual.`), { code: "APPROVAL_SUPERSEDED" });
      if (command.action === "CURRICULO") {
        const currentRequest = newest ? this.store.whatsappApprovals.findById(newest.id) : request;
        if (currentRequest.targetHash !== request.targetHash) throw Object.assign(new Error("Pedido fora do contexto autorizado."), { code: "APPROVAL_TARGET_CHANGED" });
        const currentVersion = this.store.resumeVersions.findById(currentRequest.resumeVersionId), artifact = this.store.resumeArtifacts.findById(currentRequest.artifactId);
        const defaultBase = this.store.database.getMetadata("default_resume_id", "");
        if (!currentVersion || currentVersion.resumeId !== defaultBase || !artifact || ["ARCHIVED", "REJECTED"].includes(currentVersion.status)) throw Object.assign(new Error("Esta versão foi arquivada ou usa uma base antiga. Abra a vaga para preparar outra."), { code: "RESUME_ARCHIVED" });
        const pdf = await this.store.resumeArtifactService.readAllowed(artifact, currentVersion.resumeId);
        if (pdf.length > 10 * 1024 * 1024) throw Object.assign(new Error("PDF excede o limite de envio."), { code: "PDF_TOO_LARGE" });
        await gateway.evolutionService.client.sendMedia(gateway.evolutionService.instance, gateway.target, { mediatype: "document", mimetype: "application/pdf", media: pdf.toString("base64"), fileName: `curriculo-${currentRequest.commandToken}.pdf`, caption: [...this.context(currentRequest, this.store.applications.findById(currentRequest.applicationId)), `Pontuação: ${currentVersion.atsAfter?.overallScore ?? "não calculada"}`, "Reenvio da versão atual desta vaga; nenhuma candidatura enviada por este comando."].join("\n") });
      } else if (command.action === "VERIFICAR") {
        const result = await this.availabilityService.verify(job.id);
        lines.push(result.availability.status === "CLOSED" ? "Vaga encerrada no portal." : result.availability.status === "AVAILABLE" ? "Vaga confirmada como ativa." : "Disponibilidade não confirmada; não significa encerramento.", `Motivo: ${result.availability.reason}`, "A verificação não iniciou candidatura.");
      } else if (command.action === "MANUAL") {
        lines.push(`Enviar no portal: ${resolveAutomationEntryUrl(job.applicationUrl || job.canonicalUrl || job.url)}`, `Currículo e pendências: ${gateway.applicationBaseUrl}/applications/${encodeURIComponent(application.id)}?tab=resume`, `Depois de concluir, responda: JÁ ENVIEI ${request.commandToken}`);
      } else if (command.action === "CONTINUAR") {
        if (manualSent || protectedStates.has(application.status) || application.status === "CANCELLED") lines.push("Este processo não será reenviado automaticamente.");
        else if (request.status !== "APPROVED") lines.push(`O currículo ainda precisa de aprovação: APROVAR ${request.commandToken}`);
        else if(request.expiresAt&&Date.parse(request.expiresAt)<=Date.now())lines.push("A autorização expirou. Abra a candidatura e solicite uma nova aprovação antes de retomar.");
        else if (events.some(event => event.eventType === "WHATSAPP_RESUME_REVISION_REQUESTED" && event.metadata?.approvalRequestId === request.id)) lines.push("Há uma alteração de currículo pendente. Revise a prévia e aprove a nova versão antes de retomar.");
        else if (application.status === "APPROVED" && (!gateway.startsAutoApply(request) || !["FAILED", "WAITING_USER"].includes(this.store.autoApplyRuns?.find(request.id)?.result?.status))) lines.push("Não há uma falha pendente para retomar. Use ENVIAR para autorizar um pedido salvo; uma execução ativa não será duplicada.");
        else if (!["APPROVED", "WAITING_USER", "READY_TO_SUBMIT", "FAILED", "RETRYABLE", "BLOCKED"].includes(application.status)) lines.push("O processo já está em andamento; nenhuma execução duplicada foi iniciada.");
        else {
          const result = await this.availabilityService.verify(job.id);
          if (result.availability.status !== "AVAILABLE") lines.push("Não foi possível confirmar abertura da vaga. O processo não foi retomado.");
          else {
            const current = this.store.applications.findById(application.id);
            if (!current || protectedStates.has(current.status) || current.status === "CANCELLED") throw Object.assign(new Error("O processo mudou durante a verificação e não pode ser retomado. Consulte STATUS antes de avançar."), { code: "APPLICATION_NO_LONGER_RESUMABLE" });
            if(typeof gateway.handoffResumeHandler!=="function")throw Object.assign(new Error("Retomada não configurada. Abra a candidatura para continuar."),{code:"RESUME_HANDLER_UNAVAILABLE"});
            if(application.status==="BLOCKED")this.store.applicationService.transitionApplication(application.id,"WAITING_USER",{source:"whatsapp",reason:"USER_REQUESTED_REVALIDATION"});
            await gateway.sendAcknowledgement(application.id, request, [...lines, "Retomada solicitada. O portal, as respostas e a sessão serão revalidados."].join("\n"));
            const resumed = await gateway.handoffResumeHandler?.({ application: current, token: request.commandToken, approvalRequest: request, commandHash: messageHash });
            if (["FAILED", "NOT_CONFIGURED"].includes(resumed?.status)) throw Object.assign(new Error("Não foi possível encaminhar a retomada. Abra a candidatura para conferir a pendência."), { code: resumed.errorCode || "RESUME_HANDLER_UNAVAILABLE" });
            resumeDispatched = resumed?.status === "STARTED";
            lines.push("Retomada encaminhada; o envio só será declarado após confirmação.");
          }
        }
      } else if (["CANCELAR", "JA_ENVIEI"].includes(command.action)) {
        if (protectedStates.has(application.status)) lines.push("Há envio confirmado, em andamento ou incerto. Este comando não desfaz nem repete a candidatura. Confira o portal.");
        else if (manualSent) lines.push("Envio manual já registrado por você. Nenhuma automação será repetida.");
        else {
          if (application.status !== "CANCELLED") this.store.applicationService.transitionApplication(application.id, "CANCELLED", { source: "whatsapp", reason: command.action });
          if(request.status==="AWAITING_APPROVAL")this.store.whatsappApprovals.decide(request.id,"DENIED");
          await gateway.cancelHandler?.(application.id);
          if (command.action === "JA_ENVIEI") {
            this.store.applications.recordEvent(application.id, "WHATSAPP_MANUAL_SUBMISSION_REPORTED", { approvalRequestId: request.id, resumeVersionId: request.resumeVersionId });
            this.store.applications.recordEvent(application.id, "APPLICATION_OUTCOME_RECORDED", { outcome: "SUBMITTED", source: "USER_REPORTED", occurredAt: new Date().toISOString() });
            lines.push("Envio manual informado por você. Automação encerrada para evitar duplicidade. Não é um recibo confirmado pelo portal.");
          } else lines.push("Processamento pendente cancelado. Histórico preservado. Não desfaz uma candidatura já enviada.");
        }
      } else if (manualSent) lines.push("Envio manual informado por você, sem recibo automático do portal.");
      this.store.applications.recordEvent(application.id, "WHATSAPP_PROCESS_COMMAND", { action: command.action, approvalRequestId: request.id, resumeVersionId: request.resumeVersionId });
      journal.finish(messageHash, outcome);
      if (["CANCELAR","JA_ENVIEI","VERIFICAR","CONTINUAR"].includes(command.action)) this.onChange();
      if (command.action !== "CURRICULO" && !resumeDispatched) await gateway.sendAcknowledgement(application.id, request, [...this.context(request, this.store.applications.findById(application.id)), ...lines.slice(4)].join("\n"));
      return { handled: true, outcome };
    } catch (error) {
      journal.finish(messageHash, error.code || "COMMAND_FAILED", true);
      this.store.applications.recordEvent(application.id, "WHATSAPP_PROCESS_COMMAND_FAILED", { action: command.action, errorCode: error.code || "COMMAND_FAILED" });
      await gateway.sendAcknowledgement(application.id, request, [...lines, `Não concluído: ${error.message}`, `Abrir processo: ${gateway.applicationBaseUrl}/processes/${encodeURIComponent(job.id)}`].join("\n"));
      return { handled: true, outcome: "FAILED", errorCode: error.code || "COMMAND_FAILED" };
    }
  }
}
