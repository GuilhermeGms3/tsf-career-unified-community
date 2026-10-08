import assert from "node:assert/strict";
import test from "node:test";
import { AutoApplyOrchestrator } from "../src/automation/auto-apply-orchestrator.mjs";
import {AdapterRegistry} from "../src/automation/ats/adapter-registry.mjs";

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
  const job = { id: "job-1", applicationUrl: `https://${host}` };
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
    analyses: { all: () => [{ id: "analysis-1", jobId: job.id, resumeId: application.resumeId, updatedAt: "2026-09-30T12:00:00.000Z" }] },
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
  test(`aprovação ${provider} usa Controlled Submit homologado`, async () => {
    const f = fixture(provider, { submissionEnabled: true });
    const result = await run(f);
    assert.equal(result.status, "SUBMITTED");
    assert.equal(f.calls[0], "fill");
    assert.equal(f.calls[1][0], "hosted-submit");
    assert.equal(f.calls[1][1].idempotencyKey, `whatsapp-autoapply:approval-1:${provider}`);
  });

test("política ATS usa origem e idempotência próprias no Greenhouse", async () => {
  const f = fixture("greenhouse", { submissionEnabled: true, resumeQuality: { status: "PASS", autoApplyEligible: true } });
  f.context.request.source = "ATS_THRESHOLD";
  const result = await run(f);
  assert.equal(result.status, "SUBMITTED");
  assert.equal(
    f.calls[1][1].idempotencyKey,
    "ats-threshold-autoapply:approval-1:greenhouse",
  );
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
