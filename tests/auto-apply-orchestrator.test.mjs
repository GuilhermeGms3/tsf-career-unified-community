import assert from "node:assert/strict";
import test from "node:test";
import { AutoApplyOrchestrator } from "../src/automation/auto-apply-orchestrator.mjs";
import {AdapterRegistry} from "../src/automation/ats/adapter-registry.mjs";

function authorizeScore(f, { status = "APPROVED", version = f.application.resumeVersionId } = {}) {
  const approval = { id: "human-approved", applicationId: f.application.id, resumeVersionId: version, status };
  f.context.request.approvalRequestId = approval.id;
  f.orchestrator.store.whatsappApprovals = { findById: id => id === approval.id ? approval : null };
  f.orchestrator.store.applications.events = () => [{ eventType: "WHATSAPP_APPROVAL_MODE_SELECTED", metadata: { approvalRequestId: approval.id, approvalMode: "AUTO_APPLY" } }];
}

test("Gupy repete falha transitoria no maximo tres vezes e nunca repete CAPTCHA ou envio incerto",async()=>{
  for(const reason of ["PORTAL_TEMPORARILY_UNAVAILABLE","CAPTCHA_REQUIRED"]){
    const f=fixture("gupy");let attempts=0;
    f.orchestrator.retryDelay=async()=>{};
    f.orchestrator.store.applicationBatches.findItem=()=>({id:"draft-1",status:"FAILED",reason,mode:"FILL_ONLY"});
    f.orchestrator.applicationBatchService.prepare=async()=>{attempts++;};
    f.orchestrator.applicationBatchService.canRetry=()=>true;
    f.orchestrator.applicationBatchService.queue=()=>({id:"draft-1",status:"PREPARING",mode:"FILL_ONLY"});
    await run(f);assert.equal(attempts,reason==="PORTAL_TEMPORARILY_UNAVAILABLE"?3:1);
  }
  const f=fixture("gupy");f.orchestrator.store.applicationBatches.findItem=()=>({id:"draft-1",status:"SUBMISSION_UNCERTAIN",reason:"GUPY_CONFIRMATION_NOT_OBSERVED"});f.orchestrator.applicationBatchService.canRetry=()=>false;
  assert.equal((await run(f)).status,"SUBMISSION_UNCERTAIN");assert.equal(f.calls.some(call=>Array.isArray(call)&&call[0]==="gupy-submit"),false);
});

test("Gupy escala perguntas pelo mesmo servico e sincroniza WAITING_USER",async()=>{
  let escalated=0;const f=fixture("gupy",{questionEscalation:{escalate:async()=>{escalated++;return {status:"AWAITING_ANSWER"};}}});
  f.orchestrator.store.applicationBatches.findItem=()=>({id:"draft-1",status:"WAITING_USER",reason:"REQUIRED_ANSWER_UNKNOWN"});
  const result=await run(f);assert.equal(result.reason,"REQUIRED_FIELD_UNKNOWN");assert.equal(result.escalation.status,"AWAITING_ANSWER");assert.equal(escalated,1);assert.equal(f.application.status,"WAITING_USER");assert.equal(f.calls.some(call=>Array.isArray(call)&&call[0]==="gupy-submit"),false);
});

test("nota aprovada no WhatsApp replana sem mudar bloqueios nem a politica global", async () => {
  const f = fixture("nerdin");
  authorizeScore(f);
  const original = { decision: "SKIP", matchScore: 60, policySnapshot: { minimumMatchScore: 65 } };
  f.orchestrator.store.applicationPlans.forApplication = () => original;
  let policy;
  f.orchestrator.store.planApplication = (_id, _analysis, _profile, input) => { policy = input; return { decision: "APPLY", matchScore: 60 }; };
  const result = await run(f);
  assert.equal(result.reason, "SUBMISSION_DISABLED");
  assert.deepEqual(policy, { minimumMatchScore: 0 });
  assert.equal(original.policySnapshot.minimumMatchScore, 65);
  assert.ok(f.calls.includes("fill"));
  assert.ok(f.events.some(event => event.type === "AUTOAPPLY_HUMAN_SCORE_APPROVAL"));
});

test("aprovação da nota nao ignora impedimento confirmado do planner", async () => {
  const f = fixture("nerdin");
  authorizeScore(f);
  f.orchestrator.store.applicationPlans.forApplication = () => ({ decision: "SKIP" });
  f.orchestrator.store.planApplication = () => ({ decision: "BLOCKED", blockingIssues: ["Empresa bloqueada"], matchScore: 60 });
  const result = await run(f);
  assert.equal(result.errorCode, "AUTOAPPLY_POLICY_BLOCKED");
  assert.deepEqual(result.blockingReasons, ["Empresa bloqueada"]);
  assert.equal(f.calls.includes("fill"), false);
});

test("aprovacao ausente, negada ou de outra versao nao libera score", async () => {
  for (const settings of [{ status: "DENIED" }, { version: "old-version" }]) {
    const f = fixture("nerdin");
    authorizeScore(f, settings);
    f.orchestrator.store.applicationPlans.forApplication = () => ({ decision: "SKIP" });
    f.orchestrator.store.planApplication = () => { throw new Error("Nao deve replanejar"); };
    assert.equal((await run(f)).errorCode, "AUTOAPPLY_POLICY_BLOCKED");
    assert.equal(f.calls.includes("fill"), false);
  }
});

test("politica automatica ATS nao herda excecao da aprovacao humana", async () => {
  const f = fixture("nerdin", { resumeQuality: { status: "PASS", autoApplyEligible: true } });
  authorizeScore(f);
  f.context.request.source = "ATS_THRESHOLD";
  f.orchestrator.store.applicationPlans.forApplication = () => ({ decision: "SKIP" });
  assert.equal((await run(f)).errorCode, "AUTOAPPLY_POLICY_BLOCKED");
  assert.equal(f.calls.includes("fill"), false);
});

test("bloqueio do planner inclui portal, nota e motivos sem preencher nem no retry", async () => {
  const f = fixture("nerdin");
  f.orchestrator.store.applicationPlans.forApplication = () => ({ decision: "SKIP", matchScore: 60, policySnapshot: { minimumMatchScore: 65 }, reasons: ["Politica de selecao nao atendida."] });
  f.orchestrator.start(f.context);
  const result = await f.orchestrator.wait(f.context.request.id);
  assert.equal(result.status, "FAILED");
  assert.equal(result.errorCode, "AUTOAPPLY_POLICY_BLOCKED");
  assert.equal(result.provider, "nerdin");
  assert.equal(result.matchScore, 60);
  assert.equal(result.minimumMatchScore, 65);
  assert.deepEqual(result.blockingReasons, ["Politica de selecao nao atendida."]);
  assert.equal(f.calls.includes("fill"), false);
});

function fixture(
  provider = "lever",
  { submissionEnabled = false, resumeQuality = null, resultHandler = null, fillStatus = "READY_TO_SUBMIT", questionEscalation = null } = {},
) {
  const host = {
    greenhouse: "job-boards.greenhouse.io/acme/jobs/42",
    lever: "jobs.lever.co/acme/42",
    ashby: "jobs.ashbyhq.com/acme/42",
    gupy: "acme.gupy.io/jobs/42",
    nerdin: "nerdin.com.br/vaga_emprego/suporte-12345.php",
    workable: "apply.workable.com/acme/j/ABC123/",
    smartrecruiters: "jobs.smartrecruiters.com/acme/123456-support-engineer",
    workday: "acme.wd1.myworkdayjobs.com/jobs/job/42",
    unknown: "careers.example.test/jobs/42",
  }[provider];
  const application = { id: "application-1", jobId: "job-1", resumeId: "resume-1", resumeVersionId: "version-1", status: "APPROVED" };
  const job = { id: "job-1", applicationUrl: `https://${host}`, description: "Atendimento de suporte técnico aos colaboradores, resolução de incidentes em Windows e Linux, documentação dos chamados e administração de usuários no Active Directory." };
  const events = [], details = [], calls = [];
  const store = {
    applications: {
      findById: id => id === application.id ? application : null,
      recordEvent: (_id, type, payload) => events.push({ type, payload }),
      updateDetails: value => { Object.assign(application, value); details.push(value); return application; },
    },
    jobs: { findById: id => id === job.id ? job : null },
    resumeVersions: {
      findById: (id) =>
        id === application.resumeVersionId && resumeQuality
          ? { id, tailoringRunId: "tailoring-1" }
          : null,
    },
    resumeTailoring: {
      findRun: (id) =>
        id === "tailoring-1" ? { id, evidenceStatus: "VALID", quality: resumeQuality } : null,
    },
    analyses: { forJob: () => [{ id: "analysis-1", jobId: job.id, resumeId: application.resumeId, updatedAt: "2026-09-30T12:00:00.000Z" }] },
    applicationPlans: { forApplication: () => ({ decision: "APPLY" }) },
    applicationService: { transitionApplication: (_id, status) => { application.status = status; return application; } },
    applicationBatches: { forApplication: () => null, findItem: () => ({ id: "draft-1", status: "READY_TO_SUBMIT", reason: "" }) },
    planApplication: () => ({ decision: "APPLY" }),
  };
  const applicationEngine = { registry:new AdapterRegistry(),run: async () => { calls.push("fill"); application.status = fillStatus; return { application, attempt: { errorCode: fillStatus === "WAITING_USER" ? "REQUIRED_FIELD_UNKNOWN" : "" } }; } };
  const applicationBatchService = {
    create: async input => { calls.push(["gupy-create", input]); return { items: [{ id: "draft-1", status: "PREPARING" }] }; },
    prepare: async () => calls.push("gupy-prepare"),
    submit: async (_id, input) => { calls.push(["gupy-submit", input]); return { attempt: { status: "SUBMITTED" }, receipt: { id: "receipt-gupy" } }; },
  };
  const submissionPreflight = { evaluate: async () => ({ id: "preflight-1", readyForConsent: true }) };
  const consentService = { grant: () => ({ token: "consent-token" }) };
  const controlledSubmission = { submit: async input => { calls.push(["hosted-submit", input]); return { attempt: { status: "SUBMITTED" }, receipt: { id: "receipt-hosted" } }; } };
  const orchestrator = new AutoApplyOrchestrator({ store, applicationEngine, applicationBatchService, submissionPreflight, consentService, controlledSubmission, submissionEnabled, resultHandler, questionEscalation });
  const context = { request: { id: "approval-1" }, application };
  return { orchestrator, context, application, events, details, calls };
}

async function run(f) {
  const started = f.orchestrator.start(f.context);
  assert.equal(started.status, "STARTED");
  return f.orchestrator.wait(f.context.request.id);
}

test("layout nao reconhecido nao escala perguntas de inspecao antiga", async () => {
  const f = fixture("nerdin", { questionEscalation: { escalate: () => { throw new Error("Pergunta antiga nao deve sair"); } } });
  f.orchestrator.applicationEngine.run = async () => {
    f.application.status = "WAITING_USER";
    return { attempt: { errorCode: "ADAPTER_UNSUPPORTED_LAYOUT" } };
  };
  const result = await run(f);
  assert.equal(result.reason, "ADAPTER_UNSUPPORTED_LAYOUT");
  assert.equal(result.escalation, null);
});

test("recupera timeout de preenchimento com backoff e no maximo tres tentativas", async () => {
  for (const recover of [true, false]) {
    const f = fixture("nerdin");
    let attempts = 0;
    const waits = [];
    f.orchestrator.retryDelay = async ms => waits.push(ms);
    f.orchestrator.applicationEngine.run = async ({ mode }) => {
      assert.equal(mode, "FILL_ONLY");
      attempts++;
      if (recover && attempts === 3) { f.application.status = "READY_TO_SUBMIT"; return { application: f.application }; }
      f.application.status = "RETRYABLE";
      throw Object.assign(new Error("Navigation Timeout"), { code: "FORM_TIMEOUT" });
    };
    const result = await run(f);
    assert.equal(attempts, 3);
    assert.deepEqual(waits, [1000, 2000]);
    assert.equal(result.reason || result.errorCode, recover ? "SUBMISSION_DISABLED" : "FORM_TIMEOUT");
    if (!recover) assert.equal(result.recoveryAttempts, 3);
    assert.equal(f.calls.some(item => Array.isArray(item) && item[0] === "hosted-submit"), false);
  }
});

test("nao repete CAPTCHA, falha desconhecida nem envio incerto", async () => {
  for (const [code, status] of [["CAPTCHA_REQUIRED", "WAITING_USER"], ["OTHER_ERROR", "RETRYABLE"], ["FORM_TIMEOUT", "SUBMISSION_UNCERTAIN"]]) {
    const f = fixture("nerdin");
    let attempts = 0;
    f.orchestrator.retryDelay = async () => { throw new Error("Nao deve esperar retry"); };
    f.orchestrator.applicationEngine.run = async () => {
      attempts++;
      f.application.status = status;
      throw Object.assign(new Error(code), { code });
    };
    await run(f);
    assert.equal(attempts, 1);
    assert.equal(f.application.status, status);
  }
});

test("cancelamento durante backoff interrompe a recuperacao", async () => {
  const f = fixture("nerdin");
  let attempts = 0;
  f.orchestrator.retryDelay = async () => { f.application.status = "CANCELLED"; };
  f.orchestrator.applicationEngine.run = async () => {
    attempts++;
    f.application.status = "RETRYABLE";
    throw Object.assign(new Error("Navigation Timeout"), { code: "FORM_TIMEOUT" });
  };
  assert.equal((await run(f)).status, "CANCELLED");
  assert.equal(attempts, 1);
});

test("verificação fresca de vaga encerrada interrompe antes de abrir ou preencher", async () => {
  const f = fixture("nerdin", { submissionEnabled: true });
  f.orchestrator.availabilityService = { verify: async () => ({ availability: { status: "CLOSED" } }) };
  const result = await run(f);
  assert.equal(result.reason, "JOB_CLOSED");
  assert.equal(f.application.status, "CANCELLED");
  assert.deepEqual(f.calls, []);
});

test("timeout de disponibilidade não vira vaga expirada nem permite preenchimento", async () => {
  const f = fixture("lever", { submissionEnabled: true });
  f.orchestrator.availabilityService = { verify: async () => { throw new Error("timeout"); } };
  const result = await run(f);
  assert.equal(result.reason, "JOB_AVAILABILITY_UNCONFIRMED");
  assert.notEqual(f.application.status, "CANCELLED");
  assert.deepEqual(f.calls, []);
});

test("verificação não cancela envio que avançou em outra execução enquanto aguardava HTTP", async () => {
  const f = fixture("lever", { submissionEnabled: true });
  f.orchestrator.availabilityService = { verify: async () => {
    f.application.status = "SUBMITTED";
    return { availability: { status: "CLOSED" } };
  } };
  const result = await run(f);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(f.application.status, "SUBMITTED");
  assert.notEqual(result.reason, "JOB_CLOSED");
});

test("aprovação Lever usa Controlled Submit quando o runtime está habilitado", async () => {
  const f = fixture("lever", { submissionEnabled: true });
  const result = await run(f);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(f.calls[0], "fill");
  assert.equal(f.calls[1][0], "hosted-submit");
  assert.equal(f.calls[1][1].idempotencyKey, "whatsapp-autoapply:approval-1:lever");
});

test("conclusão assíncrona notifica uma vez com o resultado real", async () => {
  const notifications = [];
  const f = fixture("lever", { submissionEnabled: true, resultHandler: async (context, result) => notifications.push({ context, result }) });
  const result = await run(f);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].context.application.id, "application-1");
  assert.equal(notifications[0].result.receiptId, "receipt-hosted");
});

test("aprovação Lever preenchida respeita o kill switch desligado", async () => {
  const f = fixture("lever");
  const result = await run(f);
  assert.equal(result.status, "READY_TO_SUBMIT");
  assert.deepEqual(f.calls, ["fill"]);
  assert.match(f.application.nextAction, /habilitar controlled submit/i);
});

test("aprovação Greenhouse usa preflight e idempotência estável quando submit está habilitado", async () => {
  const f = fixture("greenhouse", { submissionEnabled: true });
  const result = await run(f);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(f.calls[0], "fill");
  assert.equal(f.calls[1][0], "hosted-submit");
  assert.equal(f.calls[1][1].idempotencyKey, "whatsapp-autoapply:approval-1:greenhouse");
});

test("aprovação Ashby usa o mesmo Controlled Submit depois de resolver o destino", async () => {
  const f = fixture("ashby", { submissionEnabled: true });
  const result = await run(f);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(f.calls[0], "fill");
  assert.equal(f.calls[1][0], "hosted-submit");
  assert.equal(f.calls[1][1].idempotencyKey, "whatsapp-autoapply:approval-1:ashby");
});

for (const provider of ["smartrecruiters", "workable", "nerdin"])
  test(`aprovação ${provider} usa Controlled Submit implementado em fixture`, async () => {
    const f = fixture(provider, { submissionEnabled: true });
    const result = await run(f);
    assert.equal(result.status, "SUBMITTED");
    assert.equal(f.calls[0], "fill");
    assert.equal(f.calls[1][0], "hosted-submit");
    assert.equal(f.calls[1][1].idempotencyKey, `whatsapp-autoapply:approval-1:${provider}`);
  });

test("politica ATS nao promove Greenhouse sem homologacao externa", async () => {
  const f = fixture("greenhouse", { submissionEnabled: true, resumeQuality: { status: "PASS", autoApplyEligible: true } });
  f.context.request.source = "ATS_THRESHOLD";
  const result = await run(f);
  assert.equal(result.status, "READY_TO_SUBMIT_MANUAL");
  assert.equal(result.reason,"PORTAL_EXTERNAL_SUBMIT_NOT_VERIFIED");
  assert.deepEqual(f.calls,["fill"]);
});

test("politica ATS nao transforma recibo historico Nerdin em homologacao universal",async()=>{
  const f=fixture("nerdin",{submissionEnabled:true,resumeQuality:{status:"PASS",autoApplyEligible:true}});f.context.request.source="ATS_THRESHOLD";
  assert.equal((await run(f)).reason,"PORTAL_EXTERNAL_SUBMIT_NOT_VERIFIED");
  assert.deepEqual(f.calls,["fill"]);
});

test("politica ATS revalida cenario e versao depois do preflight fresco",async()=>{
  const f=fixture("nerdin",{submissionEnabled:true,resumeQuality:{status:"PASS",autoApplyEligible:true}});f.context.request.source="ATS_THRESHOLD";
  const inspection={adapterType:"nerdin",adapterVersion:f.orchestrator.applicationEngine.registry.version("nerdin"),detectedVariant:"synthetic-approved"};
  f.orchestrator.store.applicationInspections={latest:()=>inspection};
  const capability=f.orchestrator.applicationEngine.registry.describe("nerdin");
  f.orchestrator.applicationEngine.registry.describe=(_type,{scenario}={})=>({...capability,homologation:{automaticSubmitEligible:scenario==="synthetic-approved"}});
  f.orchestrator.submissionPreflight.evaluate=async()=>{inspection.detectedVariant="synthetic-changed";return {readyForConsent:true};};
  f.orchestrator.consentService.grant=()=>{throw new Error("Cenario alterado nao pode receber consentimento");};
  assert.equal((await run(f)).reason,"PORTAL_EXTERNAL_SUBMIT_NOT_VERIFIED");assert.deepEqual(f.calls,["fill"]);
});

test("política ATS não envia currículo sem qualidade comprovada", async () => {
  const f = fixture("greenhouse", { submissionEnabled: true });
  f.context.request.source = "ATS_THRESHOLD";
  const result = await run(f);
  assert.equal(result.errorCode, "AUTOAPPLY_RESUME_QUALITY_REVIEW_REQUIRED");
  assert.deepEqual(f.calls, []);
});

test("quality gate impede AutoApply de currículo que ainda exige revisão", async () => {
  const f = fixture("greenhouse", {
    submissionEnabled: true,
    resumeQuality: {
      status: "REVIEW_REQUIRED",
      autoApplyEligible: false,
    },
  });
  const result = await run(f);
  assert.equal(result.status, "FAILED");
  assert.equal(result.errorCode, "AUTOAPPLY_RESUME_QUALITY_REVIEW_REQUIRED");
  assert.deepEqual(f.calls, []);
});

test("aprovação Gupy inicia Application Batch mesmo com clique final desligado", async () => {
  const f = fixture("gupy");
  const result = await run(f);
  assert.equal(result.status, "READY_TO_SUBMIT");
  assert.deepEqual(f.calls.map(item => Array.isArray(item) ? item[0] : item), ["gupy-create", "gupy-prepare"]);
  assert.equal(f.calls[0][1].applications["job-1"], "application-1");
  assert.equal(f.calls[0][1].schedule, false);
});

test("portal sem adapter vira handoff explícito sem fingir envio", async () => {
  const f = fixture("unknown");
  const result = await run(f);
  assert.equal(result.status, "WAITING_USER");
  assert.equal(result.reason, "ADAPTER_NOT_AVAILABLE");
  assert.equal(f.events.some(event => event.type === "AUTOAPPLY_MANUAL_HANDOFF"), true);
  assert.deepEqual(f.calls, []);
});

test("aprovação Nerdin preenchida respeita o kill switch desligado", async () => {
  const f = fixture("nerdin");
  const result = await run(f);
  assert.equal(result.status, "READY_TO_SUBMIT");
  assert.equal(result.provider, "nerdin");
  assert.deepEqual(f.calls, ["fill"]);
  assert.match(f.application.nextAction, /habilitar controlled submit/i);
});

test("Workday usa preenchimento assistido e mantém envio manual", async () => {
  const f = fixture("workday");
  const result = await run(f);
  assert.equal(result.status, "READY_TO_SUBMIT_MANUAL");
  assert.equal(result.provider, "workday");
  assert.deepEqual(f.calls, ["fill"]);
});

test("pergunta obrigatória pausa o submit e aciona fallback WhatsApp", async () => {
  const escalated = [];
  const f = fixture("workday", {
    fillStatus: "WAITING_USER",
    questionEscalation: { escalate: async applicationId => { escalated.push(applicationId); return { status: "AWAITING_ANSWER" }; } },
  });
  const result = await run(f);
  assert.equal(result.status, "WAITING_USER");
  assert.equal(result.reason, "REQUIRED_FIELD_UNKNOWN");
  assert.equal(result.escalation.status, "AWAITING_ANSWER");
  assert.deepEqual(escalated, ["application-1"]);
  assert.deepEqual(f.calls, ["fill"]);
});
