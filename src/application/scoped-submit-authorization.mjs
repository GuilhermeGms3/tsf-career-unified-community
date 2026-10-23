export function assertScopedSubmitAuthorization(store, { applicationId, resumeVersionId, confirmation }) {
  if (!applicationId || confirmation !== applicationId || !resumeVersionId)
    throw Object.assign(new Error("Confirme a candidatura e a versao exata."), { code: "SCOPED_SUBMIT_CONFIRMATION_REQUIRED" });
  const application = store.applications.findById(applicationId);
  if (!application || application.resumeVersionId !== resumeVersionId || application.status !== "READY_TO_SUBMIT")
    throw Object.assign(new Error("Candidatura nao esta pronta com esta versao."), { code: "SCOPED_SUBMIT_CONTEXT_INVALID" });
  const events = store.applications.events(applicationId);
  const authorization = events.findLast(event => event.eventType === "WHATSAPP_APPROVAL_MODE_SELECTED" && event.metadata?.approvalMode === "AUTO_APPLY" && event.metadata?.resumeVersionId === resumeVersionId);
  const request = authorization && store.whatsappApprovals.findById(authorization.metadata.approvalRequestId);
  if (!request || request.status !== "APPROVED" || request.applicationId !== applicationId || request.resumeVersionId !== resumeVersionId)
    throw Object.assign(new Error("Falta aprovacao de envio para esta candidatura e versao."), { code: "SCOPED_SUBMIT_APPROVAL_REQUIRED" });
  const latest=store.whatsappProcesses.requests(application.jobId)[0];
  const revisionPending=events.some(event=>event.eventType==="WHATSAPP_RESUME_REVISION_REQUESTED"&&event.metadata?.approvalRequestId===request.id);
  if(latest?.id!==request.id||revisionPending)throw Object.assign(new Error("Pedido substituido ou alteracao pendente; nao enviar versao antiga."),{code:"SCOPED_SUBMIT_REVIEW_REQUIRED"});
  if (store.submissionReceipts.latest(applicationId) || ["UNCERTAIN", "SUBMITTING", "SUBMITTED"].includes(store.submissionAttempts.latest(applicationId)?.status))
    throw Object.assign(new Error("Envio anterior confirmado, em andamento ou incerto; nao repetir."), { code: "SCOPED_SUBMIT_DUPLICATE_BLOCKED" });
  return { application, request };
}
