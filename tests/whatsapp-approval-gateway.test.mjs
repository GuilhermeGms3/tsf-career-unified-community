import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { EvolutionClient } from "../src/integrations/evolution/evolution-client.mjs";
import { WhatsappApprovalGateway } from "../src/integrations/evolution/whatsapp-approval-gateway.mjs";

const response = (data, status = 201) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

test("Evolution envia documento PDF pela rota oficial sendMedia", async () => {
  let request;
  const client = new EvolutionClient({ baseUrl: "http://evolution.test", apiKey: "secret", fetchImpl: async (url, options) => {
    request = { url: String(url), body: JSON.parse(options.body) };
    return response({ key: { id: "outbound-1" } });
  } });
  await client.sendMedia("career-unified", "5561999991234", { mediatype: "document", mimetype: "application/pdf", media: Buffer.from("pdf").toString("base64"), fileName: "resume.pdf", caption: "Aprovar" });
  assert.match(request.url, /\/message\/sendMedia\/career-unified$/);
  assert.equal(request.body.mediatype, "document");
  assert.equal(request.body.fileName, "resume.pdf");
  assert.notEqual(request.body.media, "pdf");
});

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "whatsapp-approval-"));
  let store = await new UnifiedStateStore({ dataDir }).initialize();
  const timestamp = new Date().toISOString(), jobId = "job-real", resumeId = "resume-base", versionId = "resume-version-real", artifactId = "resume-artifact-real";
  store.jobs.upsert({ id: jobId, title: "Analista de Infraestrutura DevOps", company: "Gaudium", location: "Home Office, BR", description: "Linux Docker", url: "https://example.test/job", applicationUrl: "https://example.test/job", lifecycleStatus: "OPEN", createdAt: timestamp, updatedAt: timestamp });
  store.resumes.upsert({ id: resumeId, title: "BASE 01", text: "Linux Docker", resumeKind: "BASE", createdAt: timestamp, updatedAt: timestamp });
  store.database.setMetadata("default_resume_id", resumeId);
  store.resumeVersions.create({ id: versionId, resumeId, jobId, templateId: "ATS_TECH", templateVersion: "ats-tech-v1", language: "pt-BR", status: "READY", contentHash: "spec", resumeSpec: { candidate: { fullName: "Alex" } }, atsAfter: { overallScore: 64 }, source: "USER", approvedAt: timestamp });
  const artifactDir = path.join(dataDir, "resumes", resumeId, "versions", versionId), pdf = Buffer.from("%PDF-1.4 gateway fixture"), pdfPath = path.join(artifactDir, "resume.pdf");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(pdfPath, pdf);
  store.resumeArtifacts.create({ id: artifactId, resumeVersionId: versionId, artifactType: "PDF", storagePath: pdfPath, contentHash: createHash("sha256").update(pdf).digest("hex"), sizeBytes: pdf.length, mimeType: "application/pdf", status: "READY" });
  const calls = [], evolutionService = { instance: "career-unified", connectionState: async () => ({ connectionState: "CONNECTED" }), client: { sendMedia: async (...args) => calls.push(["media", ...args]), sendText: async (...args) => calls.push(["text", ...args]) } };
  const gateway = (approvalHandler = null) => new WhatsappApprovalGateway({ store, evolutionService, target: "5561999991234", approver: "5561999991234", webhookSecret: "webhook-secret", approvalHandler });
  return { dataDir, get store() { return store; }, set store(value) { store = value; }, gateway, calls, jobId, versionId, artifactId, close: async () => { store.close(); await rm(dataDir, { recursive: true, force: true }); } };
}

const inbound = (text, id = "message-1", remoteJid = "5561999991234@s.whatsapp.net") => ({
  event: "messages.upsert",
  instance: "career-unified",
  data: { key: { id, remoteJid, fromMe: false }, message: { conversation: text } },
});

const inboundFromSelf = (text, id = "message-self") => ({
  event: "messages.upsert",
  instance: "career-unified",
  data: {
    key: {
      id,
      remoteJid: "104917746335965@lid",
      remoteJidAlt: "556199991234@s.whatsapp.net",
      fromMe: true,
    },
    message: { conversation: text },
  },
});

const inboundFromGroupSelf = (text, id = "message-group-self") => ({
  event: "messages.upsert",
  instance: "career-unified",
  data: {
    key: {
      id,
      remoteJid: "120363012345678901@g.us",
      participant: "104917746335965@lid",
      fromMe: true,
    },
    message: { conversation: text },
  },
});

test("gateway anexa PDF e inicia AutoApply somente depois da aprovação", async () => {
  const f = await fixture();
  try {
    const dispatched = [];
    const gateway = f.gateway(async context => { dispatched.push(context); return { status: "STARTED" }; });
    const prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    assert.equal(prepared.request.status, "PREPARED");
    assert.equal(prepared.application.status, "PLANNED");
    await gateway.send(prepared.request.id, prepared.request.id);
    assert.equal(f.calls[0][0], "media");
    assert.equal(f.calls[0][3].mediatype, "document");
    assert.match(f.calls[0][3].caption, new RegExp(`APROVAR ${prepared.request.commandToken}`));
    const result = await gateway.ingest(inbound(`APROVAR ${prepared.request.commandToken}`), "webhook-secret");
    assert.equal(result.outcome, "APPROVED");
    assert.equal(f.store.applications.findById(prepared.application.id).status, "APPROVED");
    assert.equal(f.store.applications.findById(prepared.application.id).nextAction, "AutoApply iniciado");
    assert.equal(f.store.database.connection.prepare("SELECT COUNT(*) AS count FROM application_queue").get().count, 0);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].request.id, prepared.request.id);
    assert.equal(result.autoApply.status, "STARTED");
    assert.equal(f.calls.at(-1)[0], "text");
    assert.match(f.calls.at(-1)[3], /AutoApply foi iniciado/);
    assert.equal((await gateway.ingest(inbound(`APROVAR ${prepared.request.commandToken}`), "webhook-secret")).outcome, "DUPLICATE");
    f.store.close();
    f.store = await new UnifiedStateStore({ dataDir: f.dataDir }).initialize();
    assert.equal(f.store.whatsappApprovals.findById(prepared.request.id).status, "APPROVED");
    assert.equal(f.store.applications.findById(prepared.application.id).status, "APPROVED");
  } finally { await f.close(); }
});

test("gateway bloqueia versão preparada quando a base aprovada mudou", async () => {
  const f = await fixture();
  try {
    const gateway = f.gateway();
    const prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    const timestamp = new Date().toISOString();
    f.store.resumes.upsert({ id: "resume-new-base", title: "BASE 01 nova", text: "Suporte", resumeKind: "BASE", createdAt: timestamp, updatedAt: timestamp });
    f.store.database.setMetadata("default_resume_id", "resume-new-base");
    await assert.rejects(
      gateway.send(prepared.request.id, prepared.request.id),
      (error) => error.code === "WHATSAPP_APPROVAL_BASE_STALE" && error.status === 409,
    );
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test("nova versão da mesma vaga invalida pedidos antigos antes de criar outro token", async () => {
  const f = await fixture();
  try {
    const gateway = f.gateway();
    const old = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await gateway.send(old.request.id, old.request.id);
    const timestamp = new Date().toISOString();
    const versionId = "resume-version-replacement", artifactId = "resume-artifact-replacement";
    f.store.resumeVersions.create({ id: versionId, resumeId: "resume-base", jobId: f.jobId, templateId: "BASE_01", templateVersion: "base-01-v4", language: "pt-BR", status: "READY", contentHash: "replacement", resumeSpec: { candidate: { fullName: "Alex" } }, atsAfter: { overallScore: 78 }, source: "USER", approvedAt: timestamp });
    const artifactDir = path.join(f.dataDir, "resumes", "resume-base", "versions", versionId), pdf = Buffer.from("%PDF-1.4 replacement"), pdfPath = path.join(artifactDir, "resume.pdf");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(pdfPath, pdf);
    f.store.resumeArtifacts.create({ id: artifactId, resumeVersionId: versionId, artifactType: "PDF", storagePath: pdfPath, contentHash: createHash("sha256").update(pdf).digest("hex"), sizeBytes: pdf.length, mimeType: "application/pdf", status: "READY" });

    const current = gateway.prepare({ jobId: f.jobId, resumeVersionId: versionId, artifactId });

    assert.equal(f.store.whatsappApprovals.findById(old.request.id).status, "DENIED");
    assert.equal(current.request.status, "PREPARED");
    assert.notEqual(current.request.commandToken, old.request.commandToken);
    assert.equal((await gateway.ingest(inbound(`APROVAR ${old.request.commandToken}`, "old-token"), "webhook-secret")).outcome, "ALREADY_DECIDED");
    const event = f.store.applications.events(old.application.id).find((item) => item.eventType === "WHATSAPP_APPROVAL_SUPERSEDED");
    assert.equal(event?.metadata?.replacementResumeVersionId, versionId);
  } finally { await f.close(); }
});

test("política ativa mantém aprovação de 60 a 79 em revisão sem iniciar AutoApply", async () => {
  const f = await fixture();
  try {
    f.store.autoApplyPolicy.save({ enabled: true, minimumAtsScore: 95 });
    const dispatched = [];
    const gateway = f.gateway(async context => { dispatched.push(context); return { status: "STARTED" }; });
    gateway.policyProvider = () => f.store.autoApplyPolicy.get();
    const prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await gateway.send(prepared.request.id, prepared.request.id);
    assert.match(f.calls[0][3].caption, /nenhum envio automático/i);
    f.store.autoApplyPolicy.save({ enabled: false, minimumAtsScore: 95 });
    const approved = await gateway.ingest(inbound(`APROVAR ${prepared.request.commandToken}`), "webhook-secret");
    assert.equal(approved.outcome, "APPROVED");
    assert.equal(approved.autoApply, null);
    assert.equal(dispatched.length, 0);
    assert.equal(f.store.applications.findById(prepared.application.id).nextAction, "Revisar candidatura no sistema");
    assert.match(f.calls.at(-1)[3], /Nenhum envio automático/);
    const repeated = await gateway.ingest(inbound(`APROVAR ${prepared.request.commandToken}`, "message-2"), "webhook-secret");
    assert.equal(repeated.outcome, "ALREADY_DECIDED");
    assert.equal(repeated.autoApply, null);
    assert.equal(dispatched.length, 0);
  } finally { await f.close(); }
});

test("gateway rejeita remetente fora da conversa autorizada e ANALISAR não muda estado", async () => {
  const f = await fixture();
  try {
    const prepared = f.gateway().prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await f.gateway().send(prepared.request.id, prepared.request.id);
    await assert.rejects(f.gateway().ingest(inbound(`APROVAR ${prepared.request.commandToken}`, "intruder", "5511888880000@s.whatsapp.net"), "webhook-secret"), error => error.code === "WHATSAPP_APPROVAL_UNAUTHORIZED");
    const result = await f.gateway().ingest(inbound(`ANALISAR ${prepared.request.commandToken}`, "analysis"), "webhook-secret");
    assert.equal(result.outcome, "ANALYSIS_SENT");
    assert.equal(f.store.applications.findById(prepared.application.id).status, "PLANNED");
    assert.equal(f.calls.at(-1)[0], "text");
    assert.match(f.calls.at(-1)[3], new RegExp(`/opportunities/${f.jobId}\\?tab=resume`));
    assert.match(f.calls.at(-1)[3], new RegExp(`1 ${prepared.request.commandToken} sua observação`));
    assert.match(f.calls.at(-1)[3], new RegExp(`2 ${prepared.request.commandToken}`));
  } finally { await f.close(); }
});

test("opção 1 vincula observação à vaga, enfileira revisão e é idempotente", async () => {
  const f = await fixture();
  try {
    const revisions = [], gateway = f.gateway();
    gateway.revisionHandler = async input => { revisions.push(input); return { status: "QUEUED", jobId: "intelligence-1" }; };
    const prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await gateway.send(prepared.request.id, prepared.request.id);
    const payload = inbound(`1 ${prepared.request.commandToken} Priorize a experiência comprovada com Docker.`, "revision-1");
    const result = await gateway.ingest(payload, "webhook-secret");
    assert.equal(result.outcome, "REVISION_REQUESTED");
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].request.id, prepared.request.id);
    assert.match(revisions[0].observation, /Docker/);
    assert.equal(f.store.whatsappApprovals.findById(prepared.request.id).status, "AWAITING_APPROVAL");
    assert.match(f.calls.at(-1)[3], /revisão entrou na fila da IA/i);
    assert.equal((await gateway.ingest(payload, "webhook-secret")).outcome, "DUPLICATE");
    assert.equal(revisions.length, 1);
  } finally { await f.close(); }
});

test("opção 2 arquiva a versão e encerra a candidatura sem apagar auditoria", async () => {
  const f = await fixture();
  try {
    const gateway = f.gateway(), prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await gateway.send(prepared.request.id, prepared.request.id);
    const result = await gateway.ingest(inbound(`2 ${prepared.request.commandToken}`, "discard-1"), "webhook-secret");
    assert.equal(result.outcome, "RESUME_ARCHIVED");
    assert.equal(f.store.resumeVersions.findById(f.versionId).status, "ARCHIVED");
    assert.equal(f.store.applications.findById(prepared.application.id).status, "CANCELLED");
    assert.equal(f.store.whatsappApprovals.findById(prepared.request.id).status, "DENIED");
    assert.ok(f.store.resumeArtifacts.findById(f.artifactId));
    assert.match(f.calls.at(-1)[3], /saiu da fila ativa/i);
  } finally { await f.close(); }
});

test("resultado do AutoSubmit informa envio confirmado ou estado incerto sem exagerar", async () => {
  const f = await fixture();
  try {
    const gateway = f.gateway(), prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await gateway.notifyAutoApplyResult({ application: prepared.application }, { status: "SUBMITTED", provider: "greenhouse", receiptId: "receipt-1" });
    assert.match(f.calls.at(-1)[3], /Candidatura enviada e confirmada/);
    assert.match(f.calls.at(-1)[3], /Analista de Infraestrutura DevOps — Gaudium/);
    await gateway.notifyAutoApplyResult({ application: prepared.application }, { status: "SUBMISSION_UNCERTAIN", provider: "lever" });
    assert.match(f.calls.at(-1)[3], /Envio sem confirmação conclusiva/);
    assert.match(f.calls.at(-1)[3], /Não haverá nova tentativa automática/);
  } finally { await f.close(); }
});

test("gateway aceita decisão enviada para a própria conta somente com remoteJidAlt autorizado", async () => {
  const f = await fixture();
  try {
    const prepared = f.gateway().prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    assert.match(prepared.request.commandToken, /^\d{5}$/);
    await f.gateway().send(prepared.request.id, prepared.request.id);
    const denied = await f.gateway().ingest(inboundFromSelf(`NEGAR ${prepared.request.commandToken}`), "webhook-secret");
    assert.equal(denied.outcome, "DENIED");
    assert.equal(f.store.applications.findById(prepared.application.id).status, "CANCELLED");
    assert.equal(f.store.applications.findById(prepared.application.id).nextAction, "Candidatura encerrada");

    const another = await fixture();
    try {
      const otherPrepared = another.gateway().prepare({ jobId: another.jobId, resumeVersionId: another.versionId, artifactId: another.artifactId });
      await another.gateway().send(otherPrepared.request.id, otherPrepared.request.id);
      const wrongConversation = inboundFromSelf(`NEGAR ${otherPrepared.request.commandToken}`, "wrong-self");
      wrongConversation.data.key.remoteJidAlt = "5511888880000@s.whatsapp.net";
      await assert.rejects(
        another.gateway().ingest(wrongConversation, "webhook-secret"),
        error => error.code === "WHATSAPP_APPROVAL_UNAUTHORIZED",
      );
    } finally { await another.close(); }
  } finally { await f.close(); }
});

test("gateway confirma comando curto enviado pela própria conta no grupo configurado", async () => {
  const f = await fixture();
  try {
    const gateway = new WhatsappApprovalGateway({
      store: f.store,
      evolutionService: { instance: "career-unified", connectionState: async () => ({ connectionState: "CONNECTED" }), client: { sendMedia: async (...args) => f.calls.push(["media", ...args]), sendText: async (...args) => f.calls.push(["text", ...args]) } },
      target: "120363012345678901@g.us",
      approver: "5561999991234",
      webhookSecret: "webhook-secret",
      approvalHandler: async () => ({ status: "STARTED" }),
    });
    const prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await gateway.send(prepared.request.id, prepared.request.id);

    const approved = await gateway.ingest(inboundFromGroupSelf(`APROVAR ${prepared.request.commandToken}`), "webhook-secret");

    assert.equal(approved.outcome, "APPROVED");
    assert.equal(f.store.whatsappApprovals.findById(prepared.request.id).status, "APPROVED");
    assert.equal(f.calls.at(-1)[0], "text");
    assert.match(f.calls.at(-1)[3], new RegExp(`Aprovado: ${prepared.request.commandToken}`));
  } finally { await f.close(); }
});

test("gateway mantém compatibilidade com número de tokens VAGA antigos", async () => {
  const f = await fixture();
  try {
    const gateway = f.gateway();
    const prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    f.store.database.connection.prepare("UPDATE whatsapp_approval_requests SET command_token=? WHERE id=?").run("VAGA-123456", prepared.request.id);
    await gateway.send(prepared.request.id, prepared.request.id);

    const denied = await gateway.ingest(inbound("NEGAR 123456"), "webhook-secret");

    assert.equal(denied.outcome, "DENIED");
    assert.equal(f.store.whatsappApprovals.findById(prepared.request.id).status, "DENIED");
  } finally { await f.close(); }
});

async function pendingQuestion(f, { sensitive = false, consentType = "", withSuggestion = false } = {}) {
  const timestamp = new Date().toISOString();
  const application = f.store.applications.create({
    id: `application-question-${Date.now()}-${Math.random()}`,
    jobId: f.jobId,
    resumeId: "resume-base",
    resumeVersionId: f.versionId,
    status: "PLANNED",
    nextAction: "Responder pergunta obrigatória",
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  }, { source: "test" });
  f.store.applicationService.transitionApplication(application.id, "APPROVED", { source: "test" });
  f.store.applicationService.transitionApplication(application.id, "QUEUED", { source: "test" });
  f.store.applicationService.transitionApplication(application.id, "WAITING_USER", { source: "test" });
  const question = f.store.applicationQuestions.sync(application.id, [{
    externalKey: "motivation",
    semanticKey: sensitive ? "DEMOGRAPHIC.SENSITIVE" : "APPLICATION.MOTIVATION",
    label: sensitive ? "Informe sua condição de saúde" : "Por que quer trabalhar aqui?",
    fieldType: "textarea",
    required: true,
    sensitive,
    consentType,
    fingerprint: `fingerprint-${application.id}`,
    answerCategory: "APPLICATION_SPECIFIC",
  }])[0];
  const generated = withSuggestion ? f.store.generatedContent.create({
    applicationId: application.id,
    questionId: question.id,
    contentType: "ANSWER_DRAFT",
    state: "REVIEW_REQUIRED",
    draft: "Quero contribuir com automação e suporte usando experiências comprovadas.",
    evidenceIds: ["evidence-1"],
    promptVersion: "test-v1",
    schemaVersion: "test-v1",
  }) : null;
  return { application, question, generated };
}

test("pergunta sem resposta confiável vai ao WhatsApp, salva resposta e retoma uma vez", async () => {
  const f = await fixture();
  try {
    const context = await pendingQuestion(f), resumed = [], gateway = f.gateway();
    gateway.questionAnswerHandler = ({ application, question, answer }) =>
      f.store.answerApplicationQuestion(application.id, question.id, answer, { reusable: false });
    gateway.questionResumeHandler = async (input) => { resumed.push(input); return { status: "STARTED" }; };
    const prepared = gateway.prepareQuestion({ applicationId: context.application.id, questionId: context.question.id });
    assert.match(prepared.request.commandToken, /^PERG-\d{6}$/);
    assert.match(prepared.message, /IA não retornou uma sugestão confiável/);
    await gateway.sendQuestion(prepared.request.id, prepared.request.id);
    const payload = inbound(`RESPONDER ${prepared.request.commandToken} Porque meu histórico combina com os desafios da vaga.`, "question-answer-1");
    const answered = await gateway.ingest(payload, "webhook-secret");
    assert.equal(answered.outcome, "ANSWERED");
    assert.equal(f.store.applicationQuestions.forApplication(context.application.id)[0].answerSource, "USER_CONFIRMED");
    assert.equal(f.store.whatsappQuestions.findById(prepared.request.id).status, "ANSWERED");
    assert.equal(resumed.length, 1);
    assert.equal((await gateway.ingest(payload, "webhook-secret")).outcome, "DUPLICATE");
    assert.equal(resumed.length, 1);
  } finally { await f.close(); }
});

test("USAR aprova sugestão da IA, mas nunca memoriza resposta contextual", async () => {
  const f = await fixture();
  try {
    const context = await pendingQuestion(f, { withSuggestion: true }), gateway = f.gateway();
    gateway.questionResumeHandler = async () => ({ status: "STARTED" });
    const prepared = gateway.prepareQuestion({ applicationId: context.application.id, questionId: context.question.id, generatedContentId: context.generated.id });
    await gateway.sendQuestion(prepared.request.id, prepared.request.id);
    const result = await gateway.ingest(inbound(`USAR ${prepared.request.commandToken}`, "question-use-1"), "webhook-secret");
    assert.equal(result.outcome, "ANSWERED");
    const question = f.store.applicationQuestions.forApplication(context.application.id)[0];
    assert.equal(question.answerSource, "LLM_APPROVED");
    assert.equal(question.reusable, false);
    assert.equal(f.store.generatedContent.findById(context.generated.id).state, "APPROVED");
  } finally { await f.close(); }
});

test("pergunta que volta a ficar pendente recebe novo token sem duplicar registro", async () => {
  const f = await fixture();
  try {
    const context = await pendingQuestion(f), gateway = f.gateway();
    const first = gateway.prepareQuestion({ applicationId: context.application.id, questionId: context.question.id });
    f.store.whatsappQuestions.markSent(first.request.id);
    f.store.whatsappQuestions.resolve(first.request.id, "DEFERRED");

    const reopened = gateway.prepareQuestion({ applicationId: context.application.id, questionId: context.question.id });
    assert.equal(reopened.request.id, first.request.id);
    assert.notEqual(reopened.request.commandToken, first.request.commandToken);
    assert.equal(reopened.request.status, "PREPARED");
    assert.equal(f.store.database.connection.prepare("SELECT COUNT(*) AS count FROM whatsapp_question_requests WHERE application_id=? AND question_id=?").get(context.application.id, context.question.id).count, 1);
  } finally { await f.close(); }
});

test("pergunta sensível ou consentimento não sai pelo WhatsApp", async () => {
  const f = await fixture();
  try {
    const context = await pendingQuestion(f, { sensitive: true }), gateway = f.gateway();
    assert.throws(
      () => gateway.prepareQuestion({ applicationId: context.application.id, questionId: context.question.id }),
      error => error.code === "WHATSAPP_QUESTION_PROTECTED",
    );
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});
