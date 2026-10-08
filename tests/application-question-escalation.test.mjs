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

test("draft vazio ou fallback envia pergunta sem sugestão", async () => {
  const f = fixture({ draft: { draft: "", generated: false, evidenceStatus: "VALID", meta: { fallback: true, errorCode: "PROVIDER_OFFLINE" } } });
  const result = await f.service.escalate("application-1");
  assert.equal(result.status, "AWAITING_ANSWER");
  assert.equal(result.suggestionAvailable, false);
  assert.equal(f.prepared[0].generatedContentId, "");
  assert.equal(f.sent.length, 1);
  assert.equal(f.events.some(item => item.type === "APPLICATION_ANSWER_DRAFT_FALLBACK"), true);
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
