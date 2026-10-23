import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { EvolutionClient } from "../src/integrations/evolution/evolution-client.mjs";
import { WhatsappApprovalGateway } from "../src/integrations/evolution/whatsapp-approval-gateway.mjs";
import { whatsappProcessDetail } from "../src/integrations/evolution/whatsapp-process-read-model.mjs";
import {WhatsappMenuRepository} from "../repositories/whatsapp-menu-repository.mjs";
import {rememberOutboundText} from "../src/integrations/evolution/outbound-message-guard.mjs";

test("CONTINUAR nao renova uma autorizacao expirada silenciosamente",async()=>{
  const f=await fixture();try{
    const g=f.gateway(async()=>({status:"STARTED"})),prepared=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
    await g.send(prepared.request.id,prepared.request.id);
    await g.ingest(inbound(`ENVIAR ${prepared.request.commandToken}`,"expire-approve"),"webhook-secret");
    f.store.database.connection.prepare("UPDATE whatsapp_approval_requests SET expires_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),prepared.request.id);
    let resumes=0;g.handoffResumeHandler=async()=>{resumes++;return {status:"STARTED"};};
    await g.ingest(inbound(`CONTINUAR ${prepared.request.commandToken}`,"expire-resume"),"webhook-secret");
    assert.equal(resumes,0);assert.match(f.calls.at(-1)[3],/autoriza.*expirou/i);
  }finally{await f.close();}
});

test("central WhatsApp abre com texto livre, navega e nunca aprova por numero",async()=>{
  const f=await fixture();try{
    let approvals=0;const g=f.gateway(async()=>{approvals++;return {status:"STARTED"};});
    const p=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});await g.send(p.request.id,p.request.id);
    assert.equal((await g.ingest(inbound("a","menu-root"),"webhook-secret")).outcome,"MENU_SENT");
    assert.match(f.calls.at(-1)[3],/Central TSF/);
    await g.ingest(inbound("1","menu-pending"),"webhook-secret");assert.match(f.calls.at(-1)[3],/Pendentes de aprovação · 1/);
    await g.ingest(inbound("1","menu-detail"),"webhook-secret");assert.match(f.calls.at(-1)[3],/BASE 01/);
    await g.ingest(inbound("4","menu-authorize-help"),"webhook-secret");assert.match(f.calls.at(-1)[3],new RegExp(`ENVIAR ${p.request.commandToken}`));
    assert.equal(approvals,0);assert.equal(f.store.whatsappApprovals.findById(p.request.id).status,"AWAITING_APPROVAL");
    await g.ingest(inbound(`ENVIAR ${p.request.commandToken}`,"menu-explicit-authorize"),"webhook-secret");assert.equal(approvals,1);
    await g.ingest(inbound("0","menu-return"),"webhook-secret");assert.match(f.calls.at(-1)[3],/Central TSF/);
  }finally{await f.close();}
});

test("central respeita autorizacao, replay, eco proprio e expiracao sem capturar notificacoes",async()=>{
  const f=await fixture();try{
    const g=f.gateway();const before=f.calls.length;
    assert.equal((await g.ingest(inbound("oi","menu-intruder","5511888880000@s.whatsapp.net"),"webhook-secret")).handled,false);
    assert.equal(f.calls.length,before);
    await assert.rejects(g.ingest(inbound("oi","menu-bad-secret"),"wrong"));
    await g.ingest(inboundFromSelf("abc","menu-self"),"webhook-secret");const sent=f.calls.at(-1)[3],count=f.calls.length;
    assert.equal((await g.ingest(inboundFromSelf(sent,"menu-echo"),"webhook-secret")).outcome,"OUTBOUND_ECHO");assert.equal(f.calls.length,count);
    assert.equal((await g.ingest(inboundFromSelf("abc","menu-self"),"webhook-secret")).outcome,"DUPLICATE");
    rememberOutboundText("career-unified","Atualização automática enviada");
    assert.equal((await g.ingest(inboundFromSelf("Atualização automática enviada","menu-other-echo"),"webhook-secret")).handled,false);
    assert.equal((await g.ingest(inboundFromSelf("Aviso n8n\nVaga nova","menu-n8n"),"webhook-secret")).handled,false);
    g.menu.state.expires=0;await g.ingest(inbound("4","menu-expired"),"webhook-secret");assert.match(f.calls.at(-1)[3],/Central TSF/);
  }finally{await f.close();}
});

test("central mantem comandos diretos, respostas de perguntas e avisos independentes",async()=>{
  const f=await fixture();try{
    const g=f.gateway(),p=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
    await g.send(p.request.id,p.request.id);
    await g.ingest(inbound("menu","menu-independent"),"webhook-secret");
    await g.ingest(inbound("1","menu-list-independent"),"webhook-secret");
    await g.sendAcknowledgement(p.application.id,p.request,"Aviso automático de progresso");
    assert.equal(g.menu.state.view,"LIST");
    await g.ingest(inbound("1","menu-selected-independent"),"webhook-secret");
    assert.equal((await g.ingest(inbound("1","menu-status-number"),"webhook-secret")).outcome,"STATUS");
    assert.match(f.calls.at(-1)[3],new RegExp(`Vaga ${p.request.commandToken}`));
    const context=g.menu.state;
    await g.ingest(inbound(`STATUS ${p.request.commandToken}`,"menu-direct-status"),"webhook-secret");
    assert.equal(g.menu.state,context);
    await assert.rejects(g.ingest(inbound("PERG-999999","menu-question-priority"),"webhook-secret"),e=>e.code==="WHATSAPP_QUESTION_REQUEST_NOT_FOUND");
  }finally{await f.close();}
});

test("central inclui automacao sem pedido WhatsApp, exige recibo e pagina consultas",async()=>{
  const f=await fixture();try{
    const repo=new WhatsappMenuRepository(f.store.database.connection),targetHash=createHash("sha256").update("5561999991234@s.whatsapp.net").digest("hex"),now=new Date().toISOString();
    for(let i=0;i<7;i++)f.store.applications.create({id:`menu-app-${i}`,jobId:f.jobId,resumeId:"resume-base",resumeVersionId:f.versionId,status:"PLANNED",createdAt:now,updatedAt:now});
    f.store.applications.recordEvent("menu-app-0","AUTOAPPLY_ATS_THRESHOLD_MATCHED",{});
    assert.equal(repo.list({category:"automatic",targetHash}).total,0);
    assert.equal(repo.list({category:"history",targetHash}).total,7);
    assert.equal(repo.list({category:"history",targetHash}).items.length,5);
    assert.equal(repo.list({category:"history",targetHash,offset:5}).items.length,2);
    const g=f.gateway();await g.ingest(inbound("menu","menu-page-root"),"webhook-secret");await g.ingest(inbound("6","menu-page-history"),"webhook-secret");
    assert.match(f.calls.at(-1)[3],/MAIS/);await g.ingest(inbound("MAIS","menu-page-next"),"webhook-secret");assert.equal(g.menu.state.page.offset,5);
    await g.ingest(inbound("1","menu-auto-detail"),"webhook-secret");assert.match(f.calls.at(-1)[3],/Abrir candidatura:/);assert.doesNotMatch(f.calls.at(-1)[3],/4\. Aprovar envio/);
    assert.throws(()=>repo.list({category:"invalid",targetHash}));
  }finally{await f.close();}
});

const response = (data, status = 201) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

test("central distingue recibo automatico de declaracao manual e isola pedidos de outro destino",async()=>{
  const f=await fixture();try{
    const g=f.gateway(),now=new Date().toISOString(),repo=g.menu.repository,targetHash=createHash("sha256").update("5561999991234@s.whatsapp.net").digest("hex"),applicationId="menu-receipted";
    f.store.applications.create({id:applicationId,jobId:f.jobId,resumeId:"resume-base",resumeVersionId:f.versionId,status:"SUBMITTED",createdAt:now,updatedAt:now},{},{allowHistorical:true});
    f.store.applications.recordEvent(applicationId,"AUTOAPPLY_ATS_THRESHOLD_MATCHED",{});
    const preflight=f.store.submissionPreflights.create({applicationId,adapterType:"nerdin",status:"READY",snapshotHash:"test",version:"test"});
    const consent=f.store.submissionConsents.create({applicationId,preflightId:preflight.id,resumeVersionId:f.versionId,answerSnapshotHash:"test",preflightSnapshotHash:"test",tokenHash:"test-menu",expiresAt:new Date(Date.now()+60000).toISOString(),authorizationSource:"ATS_THRESHOLD_POLICY",authorizationReference:"test",authorizationSnapshotHash:"test"});
    const attempt=f.store.submissionAttempts.begin({applicationId,consentId:consent.id,preflightId:preflight.id,idempotencyKey:"test-menu",adapterType:"nerdin"}).attempt;
    const receipt=f.store.submissionReceipts.create({applicationId,submissionAttemptId:attempt.id,provider:"nerdin",confirmationText:"Synthetic fixture: application received",submittedAt:now,receiptHash:"test",resumeVersionId:f.versionId,answerSnapshotHash:"test"});
    assert.equal(repo.list({category:"automatic",targetHash}).items[0].receiptId,receipt.id);
    await g.ingest(inbound("menu","menu-confirmed-root"),"webhook-secret");await g.ingest(inbound("3","menu-confirmed-section"),"webhook-secret");await g.ingest(inbound("1","menu-confirmed-detail"),"webhook-secret");assert.match(f.calls.at(-1)[3],/Envio confirmado pelo portal/);
    const p=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});await g.send(p.request.id,p.request.id);
    await g.ingest(inbound(`JÁ ENVIEI ${p.request.commandToken}`,"menu-manual-report"),"webhook-secret");
    assert.equal(repo.list({category:"automatic",targetHash}).total,1);
    assert.equal(repo.list({category:"results",targetHash}).total,2);
    const otherHash=createHash("sha256").update("other-destination").digest("hex");assert.equal(repo.list({category:"results",targetHash:otherHash}).total,1);
    assert.equal(f.store.database.connection.prepare("PRAGMA integrity_check").get().integrity_check,"ok");assert.equal(f.store.database.connection.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{await f.close();}
});

test("central mostra falha do AutoApply mesmo quando candidatura ficou aprovada",async()=>{
  const f=await fixture();try{
    const g=f.gateway(),p=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});await g.send(p.request.id,p.request.id);
    await g.ingest(inbound(`SALVAR ${p.request.commandToken}`,"menu-saved-failure"),"webhook-secret");
    f.store.autoApplyRuns.claim({requestId:p.request.id,applicationId:p.application.id,source:"whatsapp-autoapply"});f.store.autoApplyRuns.complete(p.request.id,{status:"FAILED",errorCode:"FORM_TIMEOUT"});
    const targetHash=p.request.targetHash;
    assert.equal(g.menu.repository.list({category:"attention",targetHash}).total,1);
    assert.equal(g.menu.repository.list({category:"running",targetHash}).total,0);
  }finally{await f.close();}
});

test("central permite repetir menu apos falha de transporte e elimina deduplicacao vencida",async()=>{
  const f=await fixture();try{
    const g=f.gateway(),original=g.evolutionService.client.sendText;
    g.evolutionService.client.sendText=async()=>{throw new Error("offline");};
    await assert.rejects(g.ingest(inbound("menu","menu-offline"),"webhook-secret"));
    g.evolutionService.client.sendText=original;
    assert.equal((await g.ingest(inbound("menu","menu-offline"),"webhook-secret")).outcome,"MENU_SENT");
    f.store.database.connection.prepare("INSERT INTO whatsapp_menu_receipts VALUES(?,?)").run("old-menu", "2020-01-01T00:00:00.000Z");
    g.menu.repository.claim("new-menu");assert.equal(f.store.database.connection.prepare("SELECT COUNT(*) AS count FROM whatsapp_menu_receipts WHERE message_hash='old-menu'").get().count,0);
  }finally{await f.close();}
});

test("revisao concluida informa biblioteca offline ou ausencia de alteracao sem atribuir a LLM", async () => {
  const f = await fixture();
  try {
    const g = f.gateway(), p = g.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await g.send(p.request.id, p.request.id);
    for (const generationMode of ["OFFLINE_LIBRARY", "BASE_UNCHANGED", "LLM"]) {
      const result = await g.notifyResumeRevisionReady({ approvalRequestId: p.request.id, generationMode, atsBefore: 60, atsAfter: 60 });
      assert.equal(result.sent, true);
      const message = f.calls.at(-1)[3];
      assert.match(message, /novo pedido de aprovação/);
      if (generationMode === "OFFLINE_LIBRARY") {
        assert.match(message, /Prévia offline/);
        assert.match(message, /pode não ter sido atendida/);
        assert.doesNotMatch(message, /Revisão da IA pronta/);
      } else if (generationMode === "BASE_UNCHANGED") {
        assert.match(message, /Nenhuma alteração validada/);
        assert.match(message, /conteúdo foi preservado/);
      } else assert.match(message, /Revisão da IA pronta/);
    }
    assert.equal(f.store.applications.events(p.application.id).filter(event => event.eventType === "WHATSAPP_RESUME_REVISION_READY").length, 3);
  } finally { await f.close(); }
});

test("CONTINUAR retoma falha anterior sem tratar aprovacao salva como autorizacao", async () => {
  const f = await fixture();
  try {
    const g = f.gateway(async () => ({ status: "STARTED" })), p = g.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await g.send(p.request.id, p.request.id);
    await g.ingest(inbound(`SALVAR ${p.request.commandToken}`, "save-for-retry"), "webhook-secret");
    let resumed = 0;
    g.processCommands.availabilityService = { verify: async () => ({ availability: { status: "AVAILABLE" } }) };
    g.handoffResumeHandler = async context => {
      assert.equal(context.approvalRequest.id, p.request.id);
      assert.equal(context.commandHash.length, 64);
      const claim = f.store.autoApplyRuns.claim({ requestId: context.commandHash, applicationId: p.application.id, source: "whatsapp-handoff" });
      if (!claim.reused) resumed++;
    };
    await g.ingest(inbound(`CONTINUAR ${p.request.commandToken}`, "continue-saved"), "webhook-secret");
    assert.equal(resumed, 0);
    await g.ingest(inbound(`ENVIAR ${p.request.commandToken}`, "authorize-retry"), "webhook-secret");
    f.store.autoApplyRuns.claim({ requestId: p.request.id, applicationId: p.application.id, source: "whatsapp-autoapply" });
    f.store.autoApplyRuns.complete(p.request.id, { status: "FAILED", errorCode: "AUTOAPPLY_POLICY_BLOCKED" });
    await g.ingest(inbound(`CONTINUAR ${p.request.commandToken}`, "continue-failed"), "webhook-secret");
    assert.equal(resumed, 1);
    await g.ingest(inbound(`CONTINUAR ${p.request.commandToken}`, "continue-failed-other-message"), "webhook-secret");
    assert.equal(resumed, 1);
  } finally { await f.close(); }
});

test("feedback distingue falta de adapter, envio desligado, politica e falha tecnica", async () => {
  const f = await fixture();
  try {
    const g = f.gateway(), p = g.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    const manual = g.autoApplyResultMessage(p.application, { status: "WAITING_USER", reason: "ADAPTER_NOT_AVAILABLE", provider: "unknown" });
    assert.match(manual, /não possui AutoApply\/AutoSubmit/);
    assert.match(manual, /Conferir no portal:/);
    const disabled = g.autoApplyResultMessage(p.application, { status: "READY_TO_SUBMIT", reason: "SUBMISSION_DISABLED", provider: "nerdin" });
    assert.match(disabled, /possui envio controlado/);
    assert.match(disabled, /envio externo está desligado/);
    const policy = g.autoApplyResultMessage(p.application, { status: "FAILED", errorCode: "AUTOAPPLY_POLICY_BLOCKED", provider: "nerdin", matchScore: 60, minimumMatchScore: 65 });
    assert.match(policy, /Nota 60; mínimo do planner 65/);
    assert.doesNotMatch(policy, /não possui AutoApply/);
    const failed = g.autoApplyResultMessage(p.application, { status: "FAILED", errorCode: "FORM_TIMEOUT", provider: "nerdin" });
    assert.match(failed, /Falha técnica/);
    assert.match(failed, /FORM_TIMEOUT/);
    assert.match(failed, /Preencher manualmente:/);
    const exhausted = g.autoApplyResultMessage(p.application, { status: "FAILED", errorCode: "ATTEMPT_FAILED", failureClass: "RETRYABLE", recoveryAttempts: 3 });
    assert.match(exhausted, /3 tentativas/);
    assert.match(exhausted, /conexão do navegador/);
    const contact = g.questionMessage({ commandToken: "PERG-123" }, p.application, { label: "Telefone", semanticKey: "CONTACT.PHONE" });
    assert.match(contact, /Confirme este dado cadastral/);
    assert.doesNotMatch(contact, /não retornou uma sugestão/);
    const questionFailed = g.autoApplyResultMessage(p.application, { status: "WAITING_USER", reason: "REQUIRED_FIELD_UNKNOWN", escalation: { status: "FAILED" } });
    assert.match(questionFailed, /não foi possível encaminhar/);
    assert.doesNotMatch(questionFailed, /pergunta enviada/);
  } finally { await f.close(); }
});

test("SALVAR aprova sem envio; ENVIAR promove uma unica vez para AutoApply", async () => {
  const f = await fixture();
  try {
    let dispatched = 0;
    const g = f.gateway(async () => { dispatched++; return { status: "STARTED" }; });
    const p = g.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await g.send(p.request.id, p.request.id);
    const saved = await g.ingest(inbound(`SALVAR ${p.request.commandToken}`, "save-only"), "webhook-secret");
    assert.equal(saved.outcome, "APPROVED");
    assert.equal(saved.autoApply, null);
    assert.equal(dispatched, 0);
    assert.equal(g.startsAutoApply(p.request), false);
    assert.match(f.calls.at(-1)[3], /Currículo aprovado sem iniciar envio/);
    const sent = await g.ingest(inbound(`ENVIAR ${p.request.commandToken}`, "send-saved"), "webhook-secret");
    assert.equal(sent.outcome, "AUTO_APPLY_AUTHORIZED");
    assert.equal(dispatched, 1);
    assert.equal(g.startsAutoApply(p.request), true);
    await g.ingest(inbound(`ENVIAR ${p.request.commandToken}`, "send-saved-again"), "webhook-secret");
    assert.equal(dispatched, 1);
    assert.equal(f.store.database.connection.prepare("SELECT COUNT(*) AS n FROM submission_receipts").get().n, 0);
  } finally { await f.close(); }
});

test("APROVAR explicito autoriza AutoApply mesmo quando o snapshot antigo era somente revisao", async () => {
  const f = await fixture();
  try {
    let dispatched = 0;
    const g = f.gateway(async () => { dispatched++; return { status: "STARTED" }; });
    g.policyProvider = () => ({ enabled: true, minimumAtsScore: 100, whatsappMinimumAtsScore: 99, whatsappMaximumAtsScore: 99 });
    const p = g.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    assert.equal(g.startsAutoApply(p.request), false);
    await g.send(p.request.id, p.request.id);
    await g.ingest(inbound(`APROVAR ${p.request.commandToken}`, "approve-explicit"), "webhook-secret");
    assert.equal(dispatched, 1);
    assert.equal(g.startsAutoApply(p.request), true);
  } finally { await f.close(); }
});

test("ENVIAR nao promove aprovacao salva se a versao tem alteracao pendente", async () => {
  const f = await fixture();
  try {
    let dispatched = 0;
    const g = f.gateway(async () => { dispatched++; return { status: "STARTED" }; });
    const p = g.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await g.send(p.request.id, p.request.id);
    await g.ingest(inbound(`SALVAR ${p.request.commandToken}`, "save-before-revision"), "webhook-secret");
    f.store.applications.recordEvent(p.application.id, "WHATSAPP_RESUME_REVISION_REQUESTED", { approvalRequestId: p.request.id });
    const result = await g.ingest(inbound(`ENVIAR ${p.request.commandToken}`, "send-old-revision"), "webhook-secret");
    assert.equal(result.outcome, "CURRENT_RESUME_REVIEW_REQUIRED");
    assert.equal(dispatched, 0);
  } finally { await f.close(); }
});

test("Processos pagina e minimiza o historico de comandos por vaga", async () => {
  const f = await fixture();
  try {
    const g = f.gateway(), prepared = g.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await g.send(prepared.request.id, prepared.request.id);
    await g.ingest(inbound(`STATUS ${prepared.request.commandToken}`, "process-history"), "webhook-secret");
    f.store.applications.recordEvent(prepared.application.id, "WHATSAPP_PROCESS_COMMAND", { action: "STATUS", observation: "private-observation", answer: "private-answer", sender: "private-sender" });
    const page = f.store.whatsappProcesses.list({ offset: "Infinity", limit: 200 });
    assert.equal(page.offset, 0);
    assert.equal(page.limit, 50);
    assert.equal(page.total, 1);
    assert.equal(page.items[0].jobId, f.jobId);
    const detail = whatsappProcessDetail(f.store, f.jobId);
    assert.equal(detail.request.token, prepared.request.commandToken);
    assert.ok(detail.timeline.some(event => event.action === "STATUS"));
    assert.doesNotMatch(JSON.stringify(detail), /private-observation|private-answer|private-sender|webhook-secret/);
    assert.equal(whatsappProcessDetail(f.store, "nonexistent"), null);
  } finally { await f.close(); }
});

test("comandos simples consultam status, PDF, portal e disponibilidade sem aprovar", async () => {
  const f = await fixture();
  try {
    const g=f.gateway(),prepared=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
    await g.send(prepared.request.id,prepared.request.id);
    g.processCommands.availabilityService={verify:async()=>({availability:{status:"INCONCLUSIVE",reason:"HTTP_403"}})};
    for(const [index,command] of ["STATUS","CURRÍCULO","MANUAL","VERIFICAR"].entries()){
      const result=await g.ingest(inbound(`${command} ${prepared.request.commandToken}`,`utility-${index}`),"webhook-secret");
      assert.notEqual(result.outcome,"FAILED");
    }
    assert.equal(f.store.applications.findById(prepared.application.id).status,"PLANNED");
    assert.match(f.calls.at(-1)[3],/não significa encerramento/);
    assert.equal(f.calls.filter(item=>item[0]==="media").length,2);
    assert.equal((await g.ingest(inbound(`STATUS ${prepared.request.commandToken}`,"utility-0"),"webhook-secret")).outcome,"DUPLICATE");
  } finally { await f.close(); }
});

test("envio manual informado interrompe automação sem criar recibo do portal", async () => {
  const f = await fixture();
  try {
    const g=f.gateway(),prepared=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
    await g.send(prepared.request.id,prepared.request.id);
    const result=await g.ingest(inbound(`JÁ ENVIEI ${prepared.request.commandToken}`,"manual-sent"),"webhook-secret");
    assert.equal(result.outcome,"JA_ENVIEI");
    assert.equal(f.store.applications.findById(prepared.application.id).status,"CANCELLED");
    assert.equal(f.store.database.connection.prepare("SELECT COUNT(*) AS n FROM submission_receipts").get().n,0);
    assert.match(f.calls.at(-1)[3],/Não é um recibo confirmado/);
    await g.ingest(inbound(`JÁ ENVIEI ${prepared.request.commandToken}`,"manual-sent-again"),"webhook-secret");
    assert.equal(f.store.applications.events(prepared.application.id).filter(e=>e.eventType==="WHATSAPP_MANUAL_SUBMISSION_REPORTED").length,1);
  } finally { await f.close(); }
});

test("NEGAR calibra a vaga; opção 2 rejeita somente o currículo", async () => {
  for(const command of ["NEGAR","2"]){
    const f=await fixture();
    try {
      const g=f.gateway(),prepared=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
      await g.send(prepared.request.id,prepared.request.id);
      await g.ingest(inbound(`${command} ${prepared.request.commandToken}`),"webhook-secret");
      assert.equal(f.store.jobFeedback.forJob(f.jobId)?.userDecision||null,command==="NEGAR"?"REJECT":null);
    } finally { await f.close(); }
  }
});

test("ALTERAR direto não duplica observação nem aprova a versão", async () => {
  const f=await fixture();
  try {
    const g=f.gateway(),prepared=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
    let revisions=0;g.revisionHandler=async()=>{revisions++;return {status:"QUEUED",jobId:"revision"};};
    await g.send(prepared.request.id,prepared.request.id);
    await g.ingest(inbound(`ALTERAR ${prepared.request.commandToken} enfatizar redes`,"revision-one"),"webhook-secret");
    await g.ingest(inbound(`ALTERAR ${prepared.request.commandToken} enfatizar redes`,"revision-two"),"webhook-secret");
    assert.equal(revisions,1);
    assert.equal(f.store.whatsappApprovals.findById(prepared.request.id).status,"AWAITING_APPROVAL");
  } finally { await f.close(); }
});

test("cancelar não desfaz envio nem transforma incerteza em falha", async () => {
  const f=await fixture();
  try {
    const g=f.gateway(),prepared=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
    await g.send(prepared.request.id,prepared.request.id);
    for(const status of ["SUBMITTED","SUBMITTING","SUBMISSION_UNCERTAIN"]){
      const actual=f.store.applications.findById(prepared.application.id);
      f.store.database.connection.prepare("UPDATE applications SET status=? WHERE id=?").run(status,actual.id);
      await g.ingest(inbound(`CANCELAR ${prepared.request.commandToken}`,`cancel-${status}`),"webhook-secret");
      assert.equal(f.store.applications.findById(actual.id).status,status);
    }
  } finally { await f.close(); }
});

test("CONTINUAR pelo ID curto exige aprovação e rechecagem antes da retomada",async()=>{
  const f=await fixture();
  try {
    const g=f.gateway(async()=>({status:"STARTED"})),prepared=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
    let resumed=0,verified=0;
    g.processCommands.availabilityService={verify:async()=>{verified++;return {availability:{status:"AVAILABLE"}};}};
    g.handoffResumeHandler=async()=>{resumed++;return {status:"STARTED"};};
    await g.send(prepared.request.id,prepared.request.id);
    await g.ingest(inbound(`CONTINUAR ${prepared.request.commandToken}`,"before-approval"),"webhook-secret");
    assert.equal(resumed,0);
    await g.ingest(inbound(`APROVAR ${prepared.request.commandToken}`,"approval"),"webhook-secret");
    f.store.applicationService.transitionApplication(prepared.application.id,"QUEUED",{});
    f.store.applicationService.transitionApplication(prepared.application.id,"WAITING_USER",{});
    await g.ingest(inbound(`CONTINUAR ${prepared.request.commandToken}`,"resume"),"webhook-secret");
    assert.equal(verified,1);assert.equal(resumed,1);
    await g.ingest(inbound(`CONTINUAR ${prepared.request.commandToken}`,"resume"),"webhook-secret");
    assert.equal(resumed,1);
    g.processCommands.availabilityService = { verify: async () => {
      f.store.applicationService.transitionApplication(prepared.application.id, "CANCELLED", {});
      return { availability: { status: "AVAILABLE" } };
    } };
    const cancelled = await g.ingest(inbound(`CONTINUAR ${prepared.request.commandToken}`, "resume-cancelled-during-check"), "webhook-secret");
    assert.equal(cancelled.errorCode, "APPLICATION_NO_LONGER_RESUMABLE");
    assert.equal(resumed, 1);
  } finally {await f.close();}
});

test("aprovação não envia o PDF antigo enquanto alteração está pendente",async()=>{
  const f=await fixture();
  try {
    let applied=0;const g=f.gateway(async()=>{applied++;return {status:"STARTED"};}),prepared=g.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
    g.revisionHandler=async()=>({status:"QUEUED",jobId:"revision"});
    await g.send(prepared.request.id,prepared.request.id);
    await g.ingest(inbound(`ALTERAR ${prepared.request.commandToken} focar infraestrutura`,"rev"),"webhook-secret");
    assert.equal((await g.ingest(inbound(`APROVAR ${prepared.request.commandToken}`,"approve-old"),"webhook-secret")).outcome,"REVISION_PENDING");
    assert.equal(applied,0);
  }finally{await f.close();}
});

test("WhatsApp distingue vaga encerrada de verificação inconclusiva", async () => {
  const f = await fixture();
  try {
    const application = { id: "application-closed", jobId: f.jobId };
    const closed = f.gateway().autoApplyResultMessage(application, { status: "CANCELLED", reason: "JOB_CLOSED" });
    assert.match(closed, /Vaga encerrada no portal/);
    assert.match(closed, /nenhuma candidatura foi enviada/);
    assert.doesNotMatch(closed, /layout|CONTINUAR/);
    const uncertain = f.gateway().autoApplyResultMessage(application, { status: "WAITING_USER", reason: "JOB_AVAILABILITY_UNCONFIRMED" });
    assert.match(uncertain, /não significa que a vaga expirou/);
    assert.doesNotMatch(uncertain, /Vaga encerrada no portal/);
    const job = f.store.jobs.findById(f.jobId);
    f.store.jobs.upsert({ ...job, lifecycleStatus: "CLOSED" });
    assert.match(f.gateway().decisionMessage({ status: "APPROVED" }, application), /Vaga encerrada no portal/);
    application.status = "SUBMITTED";
    assert.doesNotMatch(f.gateway().decisionMessage({ status: "APPROVED", applicationId: application.id }, application), /nenhuma candidatura foi enviada/);
  } finally { await f.close(); }
});

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
    assert.match(f.calls[0][3].caption, new RegExp(`ENVIAR ${prepared.request.commandToken}`));
    const result = await gateway.ingest(inbound(`APROVAR ${prepared.request.commandToken}`), "webhook-secret");
    assert.equal(result.outcome, "APPROVED");
    assert.equal(f.store.applications.findById(prepared.application.id).status, "APPROVED");
    assert.equal(f.store.applications.findById(prepared.application.id).nextAction, "AutoApply na fila persistente");
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
    assert.equal(f.store.applications.findById(old.application.id).status, "CANCELLED");
    assert.equal(f.store.applications.findById(current.application.id).status, "PLANNED");
    assert.equal(current.request.status, "PREPARED");
    assert.notEqual(current.request.commandToken, old.request.commandToken);
    assert.equal((await gateway.ingest(inbound(`APROVAR ${old.request.commandToken}`, "old-token"), "webhook-secret")).outcome, "ALREADY_DECIDED");
    const event = f.store.applications.events(old.application.id).find((item) => item.eventType === "WHATSAPP_APPROVAL_SUPERSEDED");
    assert.equal(event?.metadata?.replacementResumeVersionId, versionId);
  } finally { await f.close(); }
});

test("faixa WhatsApp exige aprovação humana e depois inicia AutoApply mesmo abaixo do limite automático", async () => {
  const f = await fixture();
  try {
    f.store.autoApplyPolicy.save({ enabled: true, minimumAtsScore: 95 });
    const dispatched = [];
    const gateway = f.gateway(async context => { dispatched.push(context); return { status: "STARTED" }; });
    gateway.policyProvider = () => f.store.autoApplyPolicy.get();
    const prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await gateway.send(prepared.request.id, prepared.request.id);
    assert.match(f.calls[0][3].caption, /ENVIAR .*aprovar e iniciar candidatura/i);
    assert.equal(dispatched.length, 0);
    f.store.autoApplyPolicy.save({ enabled: false, minimumAtsScore: 95 });
    const approved = await gateway.ingest(inbound(`APROVAR ${prepared.request.commandToken}`), "webhook-secret");
    assert.equal(approved.outcome, "APPROVED");
    assert.equal(approved.autoApply.status, "STARTED");
    assert.equal(dispatched.length, 1);
    assert.equal(f.store.applications.findById(prepared.application.id).nextAction, "AutoApply na fila persistente");
    const repeated = await gateway.ingest(inbound(`APROVAR ${prepared.request.commandToken}`, "message-2"), "webhook-secret");
    assert.equal(repeated.outcome, "ALREADY_DECIDED");
    assert.equal(repeated.autoApply, null);
    assert.equal(dispatched.length, 1);
  } finally { await f.close(); }
});

test("confirma aprovação antes de aguardar AutoApply lento", async () => {
  const f = await fixture();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  try {
    const gateway = f.gateway(async () => {
      assert.match(f.calls.at(-1)[3], /Aprovado:/);
      await blocked;
      return { status: "STARTED" };
    });
    const prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await gateway.send(prepared.request.id, prepared.request.id);
    const pending = gateway.ingest(inbound(`APROVAR ${prepared.request.commandToken}`), "webhook-secret");
    await new Promise(resolve => setImmediate(resolve));
    assert.match(f.calls.at(-1)[3], /Aprovado:/);
    release();
    assert.equal((await pending).outcome, "APPROVED");
  } finally { release(); await f.close(); }
});

test("gateway rejeita remetente fora da conversa autorizada e ANALISAR não muda estado", async () => {
  const f = await fixture();
  try {
    const prepared = f.gateway().prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    await f.gateway().send(prepared.request.id, prepared.request.id);
    await assert.rejects(f.gateway().ingest(inbound(`APROVAR ${prepared.request.commandToken}`, "intruder", "5511888880000@s.whatsapp.net"), "webhook-secret"), error => error.code === "WHATSAPP_APPROVAL_UNAUTHORIZED");
    const payload = inbound(`ANALISAR ${prepared.request.commandToken}`, "analysis");
    payload.data.messageTimestamp = Math.floor(Date.now() / 1000) - 20;
    const result = await f.gateway().ingest(payload, "webhook-secret");
    assert.equal(result.outcome, "ANALYSIS_SENT");
    assert.equal(f.store.applications.findById(prepared.application.id).status, "PLANNED");
    const event = f.store.database.connection.prepare("SELECT metadata_json FROM application_events WHERE event_type='WHATSAPP_APPROVAL_ANALYZED'").get();
    const timing = JSON.parse(event.metadata_json);
    assert.ok(timing.inboundAgeMs >= 20000);
    assert.ok(timing.processingMs >= timing.sendMs);
    assert.equal(JSON.stringify(timing).includes("ANALISAR"), false);
    assert.equal(f.calls.at(-1)[0], "text");
    assert.match(f.calls.at(-1)[3], new RegExp(`/opportunities/${f.jobId}\\?tab=resume`));
    assert.match(f.calls.at(-1)[3], new RegExp(`ALTERAR ${prepared.request.commandToken} sua observação`));
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

test("handoff de CAPTCHA explica a ação e retoma somente a candidatura ainda pendente", async () => {
  const f = await fixture();
  try {
    const resumed = [], gateway = f.gateway();
    gateway.handoffResumeHandler = async (context) => { resumed.push(context); return { status: "STARTED" }; };
    const prepared = gateway.prepare({ jobId: f.jobId, resumeVersionId: f.versionId, artifactId: f.artifactId });
    f.store.applicationService.transitionApplication(prepared.application.id, "APPROVED", { source: "test" });
    f.store.applicationService.transitionApplication(prepared.application.id, "QUEUED", { source: "test" });
    f.store.applicationService.transitionApplication(prepared.application.id, "WAITING_USER", { source: "test" });

    await gateway.notifyAutoApplyResult({ application: prepared.application }, { status: "WAITING_USER", provider: "gupy", reason: "CAPTCHA_REQUIRED" });
    const message = f.calls.at(-1)[3], token = message.match(/CONTINUAR (ACAO-[A-F0-9]{6})/)[1];
    assert.match(message, /pediu CAPTCHA/);
    assert.match(message, /Resolver agora: https:\/\/example\.test\/job/);

    const result = await gateway.ingest(inbound(`CONTINUAR ${token}`, "handoff-1"), "webhook-secret");
    assert.equal(result.outcome, "HANDOFF_RESUME_REQUESTED");
    assert.equal(resumed.length, 1);
    assert.equal(resumed[0].application.id, prepared.application.id);
    assert.match(f.calls.at(-1)[3], /Validação iniciada/);
    assert.equal((await gateway.ingest(inbound(`CONTINUAR ${token}`, "handoff-1"), "webhook-secret")).outcome, "DUPLICATE");
    assert.equal(resumed.length, 1);
  } finally { await f.close(); }
});

test("falha da confirmação WhatsApp não impede retomar o handoff",async()=>{
  const f=await fixture();
  try{
    const gateway=f.gateway(),prepared=gateway.prepare({jobId:f.jobId,resumeVersionId:f.versionId,artifactId:f.artifactId});
    for(const state of ["APPROVED","QUEUED","WAITING_USER"])f.store.applicationService.transitionApplication(prepared.application.id,state,{source:"test"});
    await gateway.notifyAutoApplyResult({application:prepared.application},{status:"WAITING_USER",provider:"gupy",reason:"CAPTCHA_REQUIRED"});
    const token=f.calls.at(-1)[3].match(/CONTINUAR (ACAO-[A-F0-9]{6})/)[1];
    gateway.evolutionService.client.sendText=async()=>{throw new Error("offline");};
    let resumed=0;
    gateway.handoffResumeHandler=async()=>{resumed++;return {status:"STARTED"};};
    const result=await gateway.ingest(inbound(`CONTINUAR ${token}`,"handoff-offline"),"webhook-secret");
    assert.equal(result.outcome,"HANDOFF_RESUME_REQUESTED");
    assert.equal(resumed,1);
    assert.equal(f.store.applications.events(prepared.application.id).at(-1).eventType,"WHATSAPP_APPROVAL_ACK_FAILED");
  }finally{await f.close();}
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
    assert.match(prepared.message, /Não há sugestão validada da IA/);
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

test("ID de pergunta sozinho ou RESPONDER sem texto reenvia instrucoes sem salvar resposta", async () => {
  const f = await fixture();
  try {
    const context = await pendingQuestion(f), gateway = f.gateway();
    const prepared = gateway.prepareQuestion({ applicationId: context.application.id, questionId: context.question.id });
    await gateway.sendQuestion(prepared.request.id, prepared.request.id);
    for (const [index, text] of [prepared.request.commandToken.toLowerCase(), `RESPONDER ${prepared.request.commandToken}`].entries()) {
      const result = await gateway.ingest(inbound(text, `question-help-${index}`), "webhook-secret");
      assert.equal(result.outcome, "ANSWER_INSTRUCTIONS");
      assert.match(f.calls.at(-1)[3], new RegExp(`RESPONDER ${prepared.request.commandToken} sua resposta`));
      assert.equal(f.store.whatsappQuestions.findById(prepared.request.id).status, "AWAITING_ANSWER");
      assert.equal(f.store.applicationQuestions.forApplication(context.application.id)[0].answerStatus, "USER_REQUIRED");
    }
  } finally { await f.close(); }
});

test("confirma resposta antes de retomar e informa falha sem perder resposta", async () => {
  const f = await fixture();
  try {
    const context = await pendingQuestion(f), gateway = f.gateway();
    const prepared = gateway.prepareQuestion({ applicationId: context.application.id, questionId: context.question.id });
    await gateway.sendQuestion(prepared.request.id, prepared.request.id);
    gateway.questionResumeHandler = async () => {
      assert.match(f.calls.at(-1)[3], /Resposta registrada/);
      throw new Error("portal unavailable");
    };
    const result = await gateway.ingest(inbound(`RESPONDER ${prepared.request.commandToken} Resposta real`, "question-resume-fails"), "webhook-secret");
    assert.equal(result.outcome, "ANSWERED_RESUME_FAILED");
    assert.equal(f.store.whatsappQuestions.findById(prepared.request.id).status, "ANSWERED");
    assert.match(f.calls.at(-1)[3], /está salva, mas não consegui retomar/);
    const replay = await gateway.ingest(inbound(`RESPONDER ${prepared.request.commandToken} Outra resposta`, "question-resolved-repeat"), "webhook-secret");
    assert.equal(replay.outcome, "ALREADY_RESOLVED");
    assert.match(f.calls.at(-1)[3], /resposta já registrada/);
  } finally { await f.close(); }
});

test("ID de pergunta desconhecido retorna orientacao sem expor perguntas de outra conversa", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.gateway().ingest(inbound("PERG-999999", "question-missing"), "webhook-secret"), error => error.code === "WHATSAPP_QUESTION_REQUEST_NOT_FOUND");
    assert.match(f.calls.at(-1)[3], /não encontrada nesta conversa/);
  } finally { await f.close(); }
});

test("resposta invalida informa erro e preserva pergunta pendente", async () => {
  const f = await fixture();
  try {
    const context = await pendingQuestion(f), gateway = f.gateway();
    const prepared = gateway.prepareQuestion({ applicationId: context.application.id, questionId: context.question.id });
    await gateway.sendQuestion(prepared.request.id, prepared.request.id);
    gateway.questionAnswerHandler = () => { throw Object.assign(new Error("invalid option"), { code: "INVALID_OPTION" }); };
    gateway.questionResumeHandler = () => { throw new Error("Must not resume"); };
    const result = await gateway.ingest(inbound(`RESPONDER ${prepared.request.commandToken} Invalida`, "question-invalid-answer"), "webhook-secret");
    assert.equal(result.outcome, "ANSWER_NOT_SAVED");
    assert.equal(f.store.whatsappQuestions.findById(prepared.request.id).status, "AWAITING_ANSWER");
    assert.match(f.calls.at(-1)[3], /Não consegui registrar sua resposta/);
  } finally { await f.close(); }
});

test("sync reabre resposta antiga incompativel preservando o valor para auditoria", async () => {
  const f = await fixture();
  try {
    const {application,question} = await pendingQuestion(f);
    f.store.answerApplicationQuestion(application.id,question.id,"A combinar");
    f.store.applicationQuestions.sync(application.id,[{externalKey:question.externalKey,semanticKey:question.semanticKey,fingerprint:question.fingerprint,label:question.label,type:"number",required:true,answer:"A combinar",answerStatus:"USER_REQUIRED",answerFormatInvalid:true,reasonRequired:"Este campo exige um numero."}]);
    const updated=f.store.applicationQuestions.forApplication(application.id)[0];
    assert.equal(updated.answerStatus,"USER_REQUIRED");
    assert.equal(updated.answerValue,"A combinar");
    assert.throws(()=>f.store.answerApplicationQuestion(application.id,question.id,"A combinar"),error=>error.code==="QUESTION_ANSWER_FORMAT_INVALID");
    f.store.answerApplicationQuestion(application.id,question.id,"0");
    assert.equal(f.store.applicationQuestions.forApplication(application.id)[0].answerStatus,"KNOWN");
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
