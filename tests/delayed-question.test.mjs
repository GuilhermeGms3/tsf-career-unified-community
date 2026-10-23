import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {DelayedQuestionService,DELAYED_QUESTION_TASK,extractiveAnswerAllowed} from "../src/automation/delayed-question-service.mjs";
import {IntelligenceWorker} from "../src/intelligence/intelligence-worker.mjs";
import {ApplicationQuestionEscalationService} from "../src/automation/application-question-escalation-service.mjs";
import {gupyConfirmedAnswers} from "../src/application/gupy-question-bridge.mjs";
import {normalizeApplicationField,resolveApplicationFields} from "../src/application/application-field-schema.mjs";
import {WhatsappApprovalGateway} from "../src/integrations/evolution/whatsapp-approval-gateway.mjs";

test("Gupy reutiliza trecho factual sem atribuir consentimento ou autoria humana",()=>{
  const field=normalizeApplicationField({externalKey:"experience",semanticKey:"PROFESSIONAL.SKILL_EXPERIENCE",label:"Descreva experiencia com Python",type:"textarea",required:true,confidence:.9});
  const store={applicationQuestions:{forApplication:()=>[{externalKey:`gupy:${field.questionIdentity}`,fingerprint:field.questionIdentity,answerStatus:"KNOWN",answerSource:"LLM_EXTRACTIVE",answerValue:text}]}};
  const answers=gupyConfirmedAnswers(store,{applicationId:"app",answers:{}});
  const resolved=resolveApplicationFields([field],{answers})[0];
  assert.equal(resolved.answer,text);assert.equal(resolved.answerProvenance.source,"LLM_EXTRACTIVE");
  assert.equal(resolved.explicitConfirmation,false);assert.equal(resolved.autofillAuthority.verificationStatus,"IMPORTED_CONFIRMED");
  for(const raw of [{semanticKey:"CONTACT.PHONE"},{sensitive:true},{consentType:"PRIVACY"}]){
    const protectedField=normalizeApplicationField({externalKey:"protected",semanticKey:"PROFESSIONAL.SKILL_EXPERIENCE",label:"Protegida",type:"text",required:true,...raw});
    const result=resolveApplicationFields([protectedField],{answers:{[protectedField.questionIdentity]:{value:text,source:"LLM_EXTRACTIVE"}}})[0];
    assert.equal(result.answerState,"WAITING_USER");
  }
});

const text="Automacao de tarefas administrativas com Python e monitoramento de redes.";
async function fixture(t) {
  const dir=await mkdtemp(path.join(os.tmpdir(),"delayed-question-"));
  let store=await new UnifiedStateStore({dataDir:dir}).initialize();
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const at=new Date().toISOString();
  store.jobs.upsert({id:"job",title:"Suporte",company:"Fixture",description:"Suporte e Python",url:"https://example.test/job",createdAt:at,updatedAt:at});
  store.resumes.upsert({id:"base",title:"BASE 01",resumeKind:"BASE",text,sections:{experience:[text]},createdAt:at,updatedAt:at});
  store.database.setMetadata("default_resume_id","base");
  store.applications.create({id:"app",jobId:"job",resumeId:"base",status:"PLANNED",createdAt:at,updatedAt:at});
  store.resumeVersions.create({id:"version",resumeId:"base",jobId:"job",applicationId:"app",templateId:"ATS_STRICT",templateVersion:"ats-strict-v1",language:"pt-BR",status:"READY",contentHash:"v1",resumeSpec:{},source:"USER",approvedAt:at});
  store.applications.updateDetails({...store.applications.findById("app"),resumeVersionId:"version"});
  store.applicationDecisionService.decide({applicationId:"app",resumeVersionId:"version",decision:"APPROVE",mode:"AUTO_APPLY",actor:"fixture",channel:"WHATSAPP",idempotencyKey:"approve"});
  const first=store.autoApplyRuns.pending(1)[0];store.autoApplyRuns.claim({requestId:first.requestId,applicationId:"app",source:"fixture",workerId:"fixture"});store.autoApplyRuns.complete(first.requestId,{status:"WAITING_USER"},{workerId:"fixture",generation:1});
  store.applicationQuestions.sync("app",[{externalKey:"experience",semanticKey:"PROFESSIONAL.SKILL_EXPERIENCE",label:"Descreva sua experiencia com Python",type:"textarea",required:true,fingerprint:"fingerprint-v1",answerCategory:"FACT"}]);
  const question=store.applicationQuestions.forApplication("app")[0];
  let request=store.whatsappQuestions.prepare({applicationId:"app",questionId:question.id,commandToken:"PERG-12345",targetHash:"synthetic"});
  request=store.whatsappQuestions.markSent(request.id);
  store.questionFallbackPolicy.save({enabled:true,waitMinutes:20,autoFillEnabled:true});
  let calls=0,notifications=[];
  const result={draft:text,evidenceIds:["resume:base:experience:0"],evidenceStatus:"VALID",generated:true,promptVersion:"v1",schemaVersion:"v1",meta:{fallback:false,model:"qwen-test"}};
  const service=new DelayedQuestionService({store,approvalGateway:{sendAcknowledgement:async(_id,_request,message)=>notifications.push(message),questionMessage:(...args)=>new WhatsappApprovalGateway({store}).questionMessage(...args)},drafterProvider:()=>({draft:async()=>{calls++;return result;}}),routing:()=>({route:"AUTO_APPLY"}),modelProvider:async()=>"qwen-test",clock:()=>Date.now()+21*60000});
  return {get store(){return store;},service,question,request,result,notifications,get calls(){return calls;},restart:async()=>{store.close();store=await new UnifiedStateStore({dataDir:dir}).initialize();service.store=store;}};
}

test("WhatsApp primeiro nao chama LLM antes da pergunta enviada",async()=>{
  const order=[],application={id:"app",jobId:"job"},question={id:"q",label:"Descreva",fieldType:"text",required:true,answerStatus:"USER_REQUIRED",fingerprint:"fp"};
  const service=new ApplicationQuestionEscalationService({store:{questionFallbackPolicy:{get:()=>({enabled:true,waitMinutes:20})},applications:{findById:()=>application,updateDetails:()=>{}},applicationQuestions:{forApplication:()=>[question]},whatsappQuestions:{active:()=>null}},approvalGateway:{publicConfiguration:()=>({configured:true}),prepareQuestion:()=>({request:{id:"r"}}),sendQuestion:async()=>{order.push("whatsapp");return {request:{id:"r",commandToken:"PERG-1"}};}},answerDrafterProvider:()=>{throw new Error("LLM nao deve rodar antes");}});
  service.delayedQuestions={schedule:()=>{order.push("schedule");return {};},notify:async()=>order.push("ack")};
  assert.equal((await service.escalate("app")).status,"AWAITING_ANSWER");assert.deepEqual(order,["whatsapp","schedule","ack"]);
});

test("prazo de 20 minutos persiste, deduplica e sobrevive ao reinicio",async t=>{
  const f=await fixture(t),one=f.service.schedule(f.request),two=f.service.schedule(f.request);
  assert.equal(one.id,two.id);assert.equal(Date.parse(one.availableAt)-Date.parse(f.request.sentAt),20*60000);
  assert.equal(f.store.intelligenceJobs.claim("early"),null);await f.restart();assert.equal(f.store.intelligenceJobs.findById(one.id).status,"QUEUED");
  assert.equal(f.calls,0);
});

test("trecho literal preenche sem inventar confirmacao humana e enfileira retomada",async t=>{
  const f=await fixture(t),job=f.service.schedule(f.request);
  assert.equal((await f.service.execute(job.payload)).source,"LLM_EXTRACTIVE");
  const question=f.store.applicationQuestions.forApplication("app")[0];
  assert.equal(question.answerSource,"LLM_EXTRACTIVE");assert.equal(question.answerValue,text);
  assert.equal(f.store.candidateAnswers.all().length,0);assert.equal(f.store.autoApplyRuns.pending(10).length,1);
  assert.equal((await f.service.execute(job.payload)).status,"SKIPPED");assert.equal(f.calls,1);
  assert.equal(f.store.submissionReceipts.latest("app"),null);
});

for(const kind of ["answered","cancelled","fingerprint","base","policy","score"])test(`timeout nao atua sobre contexto alterado: ${kind}`,async t=>{
  const f=await fixture(t),job=f.service.schedule(f.request);
  if(kind==="answered")f.store.applicationQuestions.answer("app",f.question.id,"Resposta humana");
  if(kind==="cancelled")f.store.applicationService.transitionApplication("app","CANCELLED");
  if(kind==="fingerprint")f.store.applicationQuestions.connection.prepare("UPDATE application_questions SET fingerprint='changed'").run();
  if(kind==="base")f.store.resumes.upsert({...f.store.resumes.findById("base"),text:"Changed source"});
  if(kind==="policy")f.store.questionFallbackPolicy.save({enabled:false});
  if(kind==="score")f.service.routing=()=>({route:"WHATSAPP_REVIEW"});
  assert.equal((await f.service.execute(job.payload)).status,"SKIPPED");assert.equal(f.calls,0);
});

test("resposta humana durante LLM ganha a corrida",async t=>{
  const f=await fixture(t),job=f.service.schedule(f.request);
  f.service.drafterProvider=()=>({draft:async()=>{f.store.applicationQuestions.answer("app",f.question.id,"Resposta humana");return f.result;}});
  assert.equal((await f.service.execute(job.payload)).status,"SKIPPED");assert.equal(f.store.applicationQuestions.forApplication("app")[0].answerValue,"Resposta humana");
});

test("falha da LLM depois da resposta humana nao envia aviso de pendencia falso",async t=>{
  const f=await fixture(t),job=f.service.schedule(f.request);
  f.service.modelProvider=async()=>{f.store.applicationQuestions.answer("app",f.question.id,"Resposta humana");throw new Error("offline");};
  assert.equal((await f.service.execute(job.payload)).status,"SKIPPED");assert.equal(f.notifications.length,0);
});

test("texto novo ou evidencia inexistente fica para revisao",async t=>{
  const f=await fixture(t),job=f.service.schedule(f.request);f.result.draft="Minha contribuicao para a equipe seria valiosa com tecnologia.";
  assert.equal((await f.service.execute(job.payload)).status,"REVIEW_REQUIRED");assert.equal(f.store.whatsappQuestions.findById(f.request.id).status,"AWAITING_ANSWER");
  assert.ok(f.notifications[0].includes(f.result.draft));assert.ok(f.notifications[0].includes(f.question.label));
  assert.match(f.notifications[0],/USAR PERG-12345/);
  assert.equal(f.store.autoApplyRuns.pending(10).length,0);
});

test("LLM indisponivel nao cria loop e avisa pendencia",async t=>{
  const f=await fixture(t),job=f.service.schedule(f.request);f.service.modelProvider=async()=>"";
  f.store.intelligenceJobs.connection.prepare("UPDATE intelligence_jobs SET available_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),job.id);
  const worker=new IntelligenceWorker({repository:f.store.intelligenceJobs,handlers:{[DELAYED_QUESTION_TASK]:payload=>f.service.execute(payload)}});
  await worker.runOne();assert.equal(f.store.intelligenceJobs.findById(job.id).result.reason,"QUESTION_MODEL_NOT_AVAILABLE");
  assert.equal(f.service.schedule(f.request).id,job.id);assert.equal(f.store.intelligenceJobs.claim("again"),null);assert.equal(f.notifications.length,1);
});

test("salario, consentimento, opcoes e dados pessoais nunca sao inferidos",async t=>{
  const f=await fixture(t);
  for(const change of [{semanticKey:"COMPENSATION.EXPECTED_SALARY"},{sensitive:true},{consentType:"PRIVACY_POLICY"},{fieldType:"select-one"},{semanticKey:"CONTACT.PHONE"}])assert.equal(extractiveAnswerAllowed({...f.question,...change},f.result,[{id:"resume:base:experience:0",text}]),false);
});

test("pesquisa nao envia acervo nem aceita URL privada como evidencia",async t=>{
  const f=await fixture(t);let query;f.service.researchProvider={search:async q=>{query=q;return [{title:"Company",url:"http://127.0.0.1/private",excerpt:"injetado"},{title:"Public",url:"https://example.test/about",excerpt:"Contexto externo"}];}};
  const results=await f.service.research(f.store.jobs.findById("job"),{researchEnabled:true},"app");assert.equal(query,"Fixture Suporte");assert.equal(results.length,1);assert.match(results[0].trust,/NOT_CANDIDATE_EVIDENCE/);
});

test("politica valida tipos, prazo e defaults sem ativar sozinha",async t=>{
  const f=await fixture(t);for(const waitMinutes of [0,121,NaN,1.5])assert.throws(()=>f.store.questionFallbackPolicy.save({waitMinutes}));
  assert.throws(()=>f.store.questionFallbackPolicy.save({autoFillEnabled:"true"}));assert.equal(f.store.questionFallbackPolicy.get().waitMinutes,20);
});

test("retomada ATS apos resposta usa politica atual e nao inventa aprovacao humana",async t=>{
  const f=await fixture(t),at=new Date().toISOString();
  f.store.jobs.upsert({...f.store.jobs.findById("job"),description:"Atendimento de suporte com Python para automatizar tarefas administrativas e operacao de redes corporativas com registro de incidentes e documentacao tecnica. ".repeat(3)});
  const run=f.store.resumeTailoring.createRun({jobId:"job",resumeId:"base",state:"APPROVED",evidenceStatus:"VALID",promptVersion:"fixture",schemaVersion:"fixture",quality:{status:"PASS",autoApplyEligible:true}});
  f.store.resumeVersions.create({id:"ats-version",resumeId:"base",jobId:"job",applicationId:"app",templateId:"ATS_STRICT",templateVersion:"ats-strict-v1",language:"pt-BR",status:"READY",contentHash:"ats-v1",resumeSpec:{},source:"USER",approvedAt:at,tailoringRunId:run.id,atsAfter:{overallScore:95}});
  f.store.applications.updateDetails({...f.store.applications.findById("app"),resumeVersionId:"ats-version"});
  f.store.autoApplyPolicy.save({enabled:true,minimumAtsScore:80,whatsappMinimumAtsScore:60,whatsappMaximumAtsScore:79});
  f.store.applications.recordEvent("app","AUTOAPPLY_ATS_THRESHOLD_MATCHED",{resumeVersionId:"ats-version"});
  f.store.applicationDecisionService.answer({applicationId:"app",questionId:f.question.id,answer:"Resposta factual",actor:"fixture",channel:"WHATSAPP",idempotencyKey:"ats-answer"});
  assert.equal(f.store.autoApplyRuns.pending(10)[0].context.request.source,"ATS_THRESHOLD");
  assert.equal(f.store.applicationDecisions.latest("app","ats-version"),null);
});

test("trecho sobre outra stack nao recebe permissao automatica",()=>{
  assert.equal(extractiveAnswerAllowed({fieldType:"textarea",answerCategory:"FACT",semanticKey:"PROFESSIONAL.SKILL_EXPERIENCE",label:"Descreva experiencia com Java"},{draft:text,evidenceIds:["e"],generated:true,evidenceStatus:"VALID",meta:{fallback:false}},[{id:"e",text}]),false);
});
