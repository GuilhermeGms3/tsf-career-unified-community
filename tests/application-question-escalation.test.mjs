import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationQuestionEscalationService } from "../src/automation/application-question-escalation-service.mjs";

function fixture({ draft = null, question = {} } = {}) {
  const events = [], prepared = [], sent = [], generated = [];
  const application = { id: "application-1", jobId: "job-1", status: "WAITING_USER" };
  const pending = {
    id: "question-1",
    applicationId: application.id,
    label: "Por que quer trabalhar aqui?",
    description: "Resposta contextual",
    fieldType: "textarea",
    required: true,
    answerStatus: "USER_REQUIRED",
    sensitive: false,
    consentType: "",
    ...question,
  };
  const store = {
    applications: {
      findById: id => id === application.id ? application : null,
      recordEvent: (_id, type, payload) => events.push({ type, payload }),
      updateDetails: value => Object.assign(application, value),
    },
    jobs: { findById: () => ({ id: "job-1", title: "Analista", company: "Acme", description: "Suporte e automação" }) },
    applicationPlans: { forApplication: () => ({ analysisId: "analysis-1" }) },
    analyses: { findById: () => ({ requirements: [], candidateEvidence: [{ id: "evidence-1", text: "Automação comprovada" }] }) },
    applicationQuestions: { forApplication: () => [pending] },
    whatsappQuestions: { active: () => null },
    generatedContent: { create: item => { const value = { id: "generated-1", ...item }; generated.push(value); return value; } },
  };
  const approvalGateway = {
    publicConfiguration: () => ({ configured: true }),
    prepareQuestion: input => { prepared.push(input); return { request: { id: "request-1" } }; },
    sendQuestion: async (...input) => { sent.push(input); return { request: { id: "request-1", status: "AWAITING_ANSWER" } }; },
  };
  const answerDrafterProvider = () => ({ draft: async () => draft });
  const service = new ApplicationQuestionEscalationService({ store, approvalGateway, answerDrafterProvider, timeoutMs: 1000 });
  return { service, events, prepared, sent, generated, application };
}

test("pergunta protegida nao impede encaminhar outra pergunta comum",async()=>{
  const f=fixture();f.service.store.applicationQuestions.forApplication=()=>[{id:"protected",required:true,answerStatus:"USER_REQUIRED",sensitive:true},{id:"normal",label:"Pergunta comum",required:true,answerStatus:"USER_REQUIRED",fieldType:"select-one"}];
  assert.equal((await f.service.escalate("application-1")).status,"AWAITING_ANSWER");assert.equal(f.prepared[0].questionId,"normal");
});

test("pedido antigo respondido nao bloqueia nova pergunta pendente",async()=>{
  const f=fixture();let retired=false;f.service.store.whatsappQuestions.active=()=>({id:"old",questionId:"old-question",status:"AWAITING_ANSWER"});f.service.store.whatsappQuestions.resolve=(id,status)=>{retired=id==="old"&&status==="DEFERRED";};
  assert.equal((await f.service.escalate("application-1")).status,"AWAITING_ANSWER");assert.equal(retired,true);assert.equal(f.prepared[0].questionId,"question-1");
});

test("falha ao obter a LLM tambem cai no WhatsApp e terminal nao envia pergunta",async()=>{
  const f=fixture();f.service.answerDrafterProvider=()=>{throw new Error("offline");};assert.equal((await f.service.escalate("application-1")).status,"AWAITING_ANSWER");
  for(const status of ["SUBMITTED","SUBMITTING","SUBMISSION_UNCERTAIN","CANCELLED"]){f.application.status=status;assert.equal((await f.service.escalate("application-1")).reason,"APPLICATION_NOT_ACTIONABLE");}
  assert.equal(f.sent.length,1);
});

test("draft vazio ou fallback envia pergunta sem sugestão", async () => {
  const f = fixture({ draft: { draft: "", generated: false, evidenceStatus: "VALID", meta: { fallback: true, errorCode: "PROVIDER_OFFLINE" } } });
  const result = await f.service.escalate("application-1");
  assert.equal(result.status, "AWAITING_ANSWER");
  assert.equal(result.suggestionAvailable, false);
  assert.equal(f.prepared[0].generatedContentId, "");
  assert.equal(f.sent.length, 1);
  assert.equal(f.events.some(item => item.type === "APPLICATION_ANSWER_DRAFT_FALLBACK"), true);
});

test("telefone e identidade pedem confirmacao sem consultar LLM", async () => {
  for (const semanticKey of ["CONTACT.PHONE", "IDENTITY.FULL_NAME", "LOCATION.CITY"]) {
    const f = fixture({ question: { semanticKey, fieldType: "text" } });
    f.service.answerDrafterProvider = () => { throw new Error("Nao deve chamar LLM para dado cadastral"); };
    const result = await f.service.escalate("application-1");
    assert.equal(result.status, "AWAITING_ANSWER");
    assert.equal(result.suggestionAvailable, false);
    assert.equal(f.sent.length, 1);
  }
});

test("draft factual válido segue para revisão no WhatsApp", async () => {
  const f = fixture({ draft: { draft: "Quero contribuir com a automação comprovada em meus projetos.", generated: true, evidenceStatus: "VALID", evidenceIds: ["evidence-1"], promptVersion: "v1", schemaVersion: "v1", meta: { fallback: false } } });
  const result = await f.service.escalate("application-1");
  assert.equal(result.suggestionAvailable, true);
  assert.equal(f.generated.length, 1);
  assert.equal(f.prepared[0].generatedContentId, "generated-1");
});

test("pergunta protegida permanece somente na plataforma", async () => {
  const f = fixture({ question: { sensitive: true } });
  const result = await f.service.escalate("application-1");
  assert.equal(result.status, "PLATFORM_REQUIRED");
  assert.equal(result.reason, "PROTECTED_QUESTION");
  assert.equal(f.sent.length, 0);
});

test("anexo adicional nao vira pergunta textual para a LLM ou WhatsApp",async()=>{
  const f=fixture({question:{fieldType:"file"}});assert.equal((await f.service.escalate("application-1")).reason,"FILE_ATTACHMENT_REQUIRED");assert.equal(f.sent.length,0);
});

test("cancelamento durante a sugestao da LLM nao envia pergunta atrasada",async()=>{
  const f=fixture();f.service.answerDrafterProvider=()=>({draft:async()=>{f.application.status="CANCELLED";return null;}});assert.equal((await f.service.escalate("application-1")).reason,"QUESTION_CONTEXT_CHANGED");assert.equal(f.sent.length,0);assert.equal(f.prepared.length,0);
});

test("pergunta PREPARED após falha de envio pode ser reenviada sem nova geração",async()=>{
  const f=fixture();
  f.service.store.whatsappQuestions.active=()=>({id:"request-1",status:"PREPARED"});
  const result=await f.service.escalate("application-1");
  assert.equal(result.status,"AWAITING_ANSWER");
  assert.equal(f.sent.length,1);
  assert.equal(f.generated.length,0);
});

test("escalonamento concorrente envia uma pergunta e falha síncrona da LLM usa fallback",async()=>{
  const f=fixture();
  f.service.answerDrafterProvider=()=>({draft(){throw Object.assign(new Error("offline"),{code:"PROVIDER_OFFLINE"});}});
  const results=await Promise.all([f.service.escalate("application-1"),f.service.escalate("application-1")]);
  assert.equal(f.sent.length,1);
  assert.equal(results[0].status,"AWAITING_ANSWER");
  assert.equal(f.events[0].payload.reason,"PROVIDER_OFFLINE");
});

test("LLM lenta cai no WhatsApp sem esperar a geração terminar",async()=>{
  const f=fixture();
  f.service.timeoutMs=20;
  f.service.answerDrafterProvider=()=>({draft:()=>new Promise(()=>{})});
  const result=await f.service.escalate("application-1");
  assert.equal(result.status,"AWAITING_ANSWER");
  assert.equal(f.events[0].payload.reason,"TIMEOUT");
});

test("envia todas as perguntas obrigatorias uma por vez sem repetir a ja respondida", async () => {
  const f = fixture();
  const questions = ["ingles", "salario-clt", "salario-pj"].map(id => ({ id, label: id, fieldType: "select", required: true, answerStatus: "USER_REQUIRED" }));
  let active = null;
  f.service.store.applicationQuestions.forApplication = () => questions;
  f.service.store.whatsappQuestions.active = () => active;
  f.service.approvalGateway.prepareQuestion = input => {
    f.prepared.push(input);
    return { request: { id: input.questionId } };
  };
  f.service.approvalGateway.sendQuestion = async id => {
    active = { id, status: "AWAITING_ANSWER" };
    f.sent.push(id);
    return { request: active };
  };
  for (const question of questions) {
    assert.equal((await f.service.escalate("application-1")).status, "AWAITING_ANSWER");
    assert.equal(f.sent.at(-1), question.id);
    assert.equal((await f.service.escalate("application-1")).reused, true);
    question.answerStatus = "KNOWN";
    active = null;
  }
  assert.deepEqual(f.sent, ["ingles", "salario-clt", "salario-pj"]);
  assert.equal((await f.service.escalate("application-1")).reason, "NO_PENDING_REQUIRED_QUESTION");
});
