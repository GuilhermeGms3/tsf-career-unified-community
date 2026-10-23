import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { AutoApplyOrchestrator } from "../src/automation/auto-apply-orchestrator.mjs";
import { ResumeApprovalDispatcher } from "../src/integrations/evolution/resume-approval-dispatcher.mjs";
import { WhatsappApprovalGateway } from "../src/integrations/evolution/whatsapp-approval-gateway.mjs";

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "resume-approval-dispatcher-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  const calls = [];
  const evolutionService = {
    instance: "career-unified",
    connectionState: async () => ({ connectionState: "CONNECTED" }),
    client: {
      sendMedia: async (...args) => calls.push(["media", ...args]),
      sendText: async (...args) => calls.push(["text", ...args]),
    },
  };
  const gateway = new WhatsappApprovalGateway({
    store,
    evolutionService,
    target: "5561999991234",
    approver: "5561999991234",
    webhookSecret: "webhook-secret",
  });
  const dispatcher = new ResumeApprovalDispatcher({ store, approvalGateway: gateway });
  return {
    dataDir,
    store,
    calls,
    gateway,
    dispatcher,
    close: async () => {
      store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("vaga encerrada não envia PDF antigo ao WhatsApp nem dispara política automática", async () => {
  const f = await fixture();
  try {
    const ready = await addReadyVersion(f, "closed", "nerdin", 99);
    const job = f.store.jobs.findById(ready.jobId);
    f.store.jobs.upsert({ ...job, lifecycleStatus: "CLOSED" });
    assert.equal((await f.dispatcher.dispatch(ready)).reason, "JOB_CLOSED");
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test("reviewOnly cria candidatura para Caixa sem WhatsApp nem envio por nota alta",async()=>{
  const f=await fixture();
  try{
    const ready=await addReadyVersion(f,'manual','nerdin',99);
    f.dispatcher.policyProvider=()=>({enabled:true,minimumAtsScore:80,whatsappMinimumAtsScore:60,whatsappMaximumAtsScore:79});
    f.dispatcher.autoApplyHandler=()=>{throw Error('must not start automatic apply');};
    const result=await f.dispatcher.dispatch({...ready,reviewOnly:true,allowWhatsApp:false});
    assert.equal(result.status,'QUEUED_FOR_REVIEW');assert.equal(result.application.status,'PLANNED');assert.equal(f.calls.length,0);
    assert.equal(f.store.autoApplyRuns.pending(10).length,0);
  }finally{await f.close();}
});

async function addReadyVersion(f, id, origin, atsScore = 0, quality = null) {
  const timestamp = new Date().toISOString();
  const jobId = `job-${id}`, resumeId = "resume-base", versionId = `version-${id}`;
  f.store.jobs.upsert({
    id: jobId,
    title: `Analista ${id}`,
    company: "Acme",
    description: "Atendimento de suporte técnico aos colaboradores, administração de sistemas Linux e Windows, diagnóstico de incidentes de infraestrutura e manutenção de containers Docker em ambiente corporativo.",
    location: "Brasil",
    source: origin,
    url: `https://careers.example.test/${id}`,
    applicationUrl: `https://careers.example.test/${id}`,
    lifecycleStatus: "OPEN",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  f.store.resumes.upsert({
    id: resumeId,
    title: "BASE 01",
    text: "Linux Docker suporte infraestrutura",
    resumeKind: "BASE",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  f.store.database.setMetadata("default_resume_id", resumeId);
  const tailoringRun = quality
    ? f.store.resumeTailoring.createRun({
        id: `tailoring-${id}`,
        jobId,
        resumeId,
        state: "APPROVED",
        originalScore: Math.max(0, atsScore - 2),
        tailoredScore: atsScore,
        evidenceStatus: "VALID",
        promptVersion: "fixture-v1",
        schemaVersion: "fixture-v1",
        quality,
        changes: [],
      })
    : null;
  f.store.resumeVersions.create({
    id: versionId,
    resumeId,
    jobId,
    templateId: "ATS_TECH",
    templateVersion: "ats-tech-v1",
    language: "pt-BR",
    status: "READY",
    contentHash: `spec-${id}`,
    resumeSpec: { candidate: { fullName: "Alex" } },
    source: origin,
    tailoringRunId: tailoringRun?.id || "",
    atsAfter: atsScore ? { overallScore: atsScore } : {},
    approvedAt: timestamp,
  });
  const artifactDir = path.join(f.dataDir, "resumes", resumeId, "versions", versionId);
  const pdf = Buffer.from(`%PDF-1.4 ${id}`), pdfPath = path.join(artifactDir, "resume.pdf");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(pdfPath, pdf);
  f.store.resumeArtifacts.create({
    id: `artifact-${id}`,
    resumeVersionId: versionId,
    artifactType: "PDF",
    storagePath: pdfPath,
    contentHash: createHash("sha256").update(pdf).digest("hex"),
    sizeBytes: pdf.length,
    mimeType: "application/pdf",
    status: "READY",
  });
  return { jobId, resumeVersionId: versionId };
}

const inbound = (text) => ({
  event: "messages.upsert",
  instance: "career-unified",
  data: {
    key: {
      id: `message-${Date.now()}`,
      remoteJid: "5561999991234@s.whatsapp.net",
      fromMe: false,
    },
    message: { conversation: text },
  },
});

test("Mass Hunt, busca específica e link usam o mesmo pedido idempotente e aparecem em Candidaturas", async () => {
  const f = await fixture();
  try {
    const inputs = await Promise.all([
      addReadyVersion(f, "mass-hunt", "MASS_HUNT_AUTOAPPLY"),
      addReadyVersion(f, "specific-search", "MANUAL_SEARCH"),
      addReadyVersion(f, "public-link", "MANUAL_ANALYSIS"),
    ]);
    const results = await Promise.all(inputs.map((input) => f.dispatcher.dispatch(input)));
    assert.deepEqual(results.map((item) => [item.status, item.reason || ""]), [
      ["AWAITING_APPROVAL", ""],
      ["AWAITING_APPROVAL", ""],
      ["AWAITING_APPROVAL", ""],
    ]);
    assert.equal(f.calls.filter(([type]) => type === "media").length, 3);
    assert.equal(f.store.applications.all().length, 3);
    assert.equal(f.store.applications.all().every((item) =>
      item.status === "PLANNED" && item.nextAction === "Aguardar aprovação no WhatsApp"), true);

    const repeated = await f.dispatcher.dispatch(inputs[0]);
    assert.equal(repeated.reused, true);
    assert.equal(f.calls.filter(([type]) => type === "media").length, 3);
  } finally {
    await f.close();
  }
});

test("aprovação recebida no WhatsApp alcança o AutoApply e avança a candidatura", async () => {
  const f = await fixture();
  try {
    const input = await addReadyVersion(f, "link-flow", "MANUAL_ANALYSIS");
    const orchestrator = new AutoApplyOrchestrator({ store: f.store });
    f.gateway.approvalHandler = (context) => orchestrator.start(context);
    const dispatched = await f.dispatcher.dispatch(input);
    const approved = await f.gateway.ingest(
      inbound(`APROVAR ${dispatched.request.commandToken}`),
      "webhook-secret",
    );
    const result = await orchestrator.wait(dispatched.request.id);
    const application = f.store.applications.findById(dispatched.application.id);

    assert.equal(approved.outcome, "APPROVED");
    assert.equal(approved.autoApply.status, "STARTED");
    assert.equal(result.status, "WAITING_USER");
    assert.equal(result.reason, "ADAPTER_NOT_AVAILABLE");
    assert.equal(application.status, "APPROVED");
    assert.match(application.nextAction, /candidatura manual/i);
    assert.equal(f.store.applications.events(application.id).some((item) =>
      item.eventType === "AUTOAPPLY_MANUAL_HANDOFF"), true);
  } finally {
    await f.close();
  }
});

test("nota ATS acima da política pula WhatsApp e inicia AutoApply para qualquer origem", async () => {
  const f = await fixture();
  try {
    f.store.autoApplyPolicy.save({ enabled: true, minimumAtsScore: 90, whatsappMaximumAtsScore: 89 });
    f.dispatcher.policyProvider = () => f.store.autoApplyPolicy.get();
    const orchestrator = new AutoApplyOrchestrator({ store: f.store });
    f.dispatcher.autoApplyHandler = (context) => orchestrator.start(context);
    const inputs = await Promise.all([
      addReadyVersion(f, "auto-mass-hunt", "MASS_HUNT_AUTOAPPLY", 94, { status: "PASS", autoApplyEligible: true }),
      addReadyVersion(f, "auto-specific-search", "MANUAL_SEARCH", 93, { status: "PASS", autoApplyEligible: true }),
      addReadyVersion(f, "auto-public-link", "MANUAL_ANALYSIS", 92, { status: "PASS", autoApplyEligible: true }),
    ]);
    const results = [];
    for (const input of inputs) {
      const dispatched = await f.dispatcher.dispatch(input);
      const completed = await orchestrator.wait(dispatched.request.id);
      results.push({ dispatched, completed });
    }

    assert.equal(f.calls.length, 0);
    assert.equal(results.every(({ dispatched }) =>
      dispatched.status === "AUTOAPPLY_STARTED" &&
      dispatched.bypassedApproval === true &&
      dispatched.handled === true), true);
    assert.equal(results.every(({ completed }) =>
      completed.status === "WAITING_USER" &&
      completed.reason === "ADAPTER_NOT_AVAILABLE"), true);
    assert.equal(f.store.applications.all().length, 3);
    assert.equal(f.store.applications.all().every((item) => item.status === "APPROVED"), true);
    assert.equal(f.store.applications.all().every((item) =>
      f.store.applications.events(item.id).some((event) =>
        event.eventType === "AUTOAPPLY_ATS_THRESHOLD_MATCHED")), true);
  } finally {
    await f.close();
  }
});

test("nota ATS alta com descrição vazia não pula para AutoApply", async () => {
  const f = await fixture();
  try {
    f.store.autoApplyPolicy.save({ enabled: true, minimumAtsScore: 80 });
    f.dispatcher.policyProvider = () => f.store.autoApplyPolicy.get();
    f.dispatcher.autoApplyHandler = () => { throw new Error("não deveria iniciar"); };
    const input = await addReadyVersion(f, "no-description", "MANUAL_SEARCH", 96, { status: "PASS", autoApplyEligible: true });
    const job = f.store.jobs.findById("job-no-description");
    f.store.jobs.upsert({ ...job, description: "" });
    const result = await f.dispatcher.dispatch(input);
    assert.equal(result.status, "QUEUED_FOR_REVIEW");
    assert.equal(result.reason, "JOB_DESCRIPTION_INSUFFICIENT");
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test("nota ATS alta sem revisão editorial não dispensa aprovação", async () => {
  const f = await fixture();
  try {
    f.store.autoApplyPolicy.save({ enabled: true, minimumAtsScore: 90, whatsappMaximumAtsScore: 89 });
    f.dispatcher.policyProvider = () => f.store.autoApplyPolicy.get();
    const input = await addReadyVersion(f, "no-quality", "MANUAL_SEARCH", 96);
    const result = await f.dispatcher.dispatch(input);
    assert.equal(result.status, "AWAITING_APPROVAL");
    assert.equal(result.bypassedApproval, undefined);
    assert.equal(f.calls.filter(([type]) => type === "media").length, 1);
  } finally {
    await f.close();
  }
});

test("nota ATS abaixo da política preserva aprovação pelo WhatsApp", async () => {
  const f = await fixture();
  try {
    f.store.autoApplyPolicy.save({ enabled: true, minimumAtsScore: 90, whatsappMaximumAtsScore: 89 });
    f.dispatcher.policyProvider = () => f.store.autoApplyPolicy.get();
    const input = await addReadyVersion(f, "below-threshold", "MANUAL_SEARCH", 89);
    const result = await f.dispatcher.dispatch(input);

    assert.equal(result.status, "AWAITING_APPROVAL");
    assert.equal(result.handled, true);
    assert.equal(result.bypassedApproval, undefined);
    assert.equal(f.calls.filter(([type]) => type === "media").length, 1);
    assert.equal(f.store.applications.all()[0].status, "PLANNED");
  } finally {
    await f.close();
  }
});

test("faixas configuradas enviam ao WhatsApp ou deixam na fila sem envio", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.store.autoApplyPolicy.get(), {
      ...f.store.autoApplyPolicy.get(),
      enabled: false,
      minimumAtsScore: 80,
      whatsappMinimumAtsScore: 60,
      whatsappMaximumAtsScore: 79,
    });
    assert.throws(() => f.store.autoApplyPolicy.save({ enabled: true, minimumAtsScore: 70 }),
      (error) => error.code === "AUTO_APPLY_WHATSAPP_BAND_INVALID");
    f.store.autoApplyPolicy.save({ enabled: true, minimumAtsScore: 80, whatsappMinimumAtsScore: 60, whatsappMaximumAtsScore: 79 });
    f.dispatcher.policyProvider = () => f.store.autoApplyPolicy.get();
    f.dispatcher.autoApplyHandler = (context) => ({ status: "STARTED", context });
    const quality = { status: "PASS", autoApplyEligible: true };
    const low = await addReadyVersion(f, "low-band", "MANUAL_SEARCH", 59, quality);
    const middle = await addReadyVersion(f, "whatsapp-band", "MANUAL_SEARCH", 75, quality);
    const high = await addReadyVersion(f, "whatsapp-priority", "MANUAL_SEARCH", 80, quality);
    assert.equal((await f.dispatcher.dispatch(low)).status, "QUEUED_FOR_REVIEW");
    assert.equal((await f.dispatcher.dispatch(middle)).status, "AWAITING_APPROVAL");
    const highResult = await f.dispatcher.dispatch(high);
    assert.equal(highResult.status, "AUTOAPPLY_STARTED");
    assert.equal(highResult.bypassedApproval, true);
    assert.equal(highResult.application.id,
      f.store.applications.all().find((item) => item.jobId === high.jobId).id);
    assert.equal(f.calls.filter(([type]) => type === "media").length, 1);
    assert.equal(f.store.applications.all().length, 3);
  } finally {
    await f.close();
  }
});

test("nota ATS alta não pula WhatsApp quando o gate editorial exige revisão", async () => {
  const f = await fixture();
  try {
    f.store.autoApplyPolicy.save({ enabled: true, minimumAtsScore: 90, whatsappMaximumAtsScore: 89 });
    f.dispatcher.policyProvider = () => f.store.autoApplyPolicy.get();
    const input = await addReadyVersion(
      f,
      "quality-review",
      "MASS_HUNT_AUTOAPPLY",
      96,
      {
        status: "REVIEW_REQUIRED",
        score: 86,
        autoApplyEligible: false,
        blockingReasons: [],
        warnings: ["TARGET_ROLE_ALIGNMENT"],
      },
    );
    const result = await f.dispatcher.dispatch(input);

    assert.equal(result.status, "AWAITING_APPROVAL");
    assert.equal(result.bypassedApproval, undefined);
    assert.equal(f.calls.filter(([type]) => type === "media").length, 1);
  } finally {
    await f.close();
  }
});

test("nota abaixo de 60 fica na plataforma mesmo sem gate editorial aprovado",async()=>{
  const f=await fixture();
  try{
    f.store.autoApplyPolicy.save({enabled:true});
    f.dispatcher.policyProvider=()=>f.store.autoApplyPolicy.get();
    const low=await addReadyVersion(f,"low-without-quality","MANUAL_SEARCH",50);
    assert.equal((await f.dispatcher.dispatch(low)).status,"QUEUED_FOR_REVIEW");
    assert.equal(f.calls.length,0);
    const middle=await addReadyVersion(f,"defer-whatsapp","MASS_HUNT_AUTOAPPLY",75);
    assert.equal((await f.dispatcher.dispatch({...middle,allowWhatsApp:false})).status,"WHATSAPP_DEFERRED");
    assert.equal(f.calls.length,0);
    assert.equal((await f.dispatcher.dispatch(middle)).status,"AWAITING_APPROVAL");
  }finally{await f.close();}
});

test("versão genérica ou ainda não pronta não abre candidatura", async () => {
  const f = await fixture();
  try {
    const timestamp = new Date().toISOString();
    f.store.resumes.upsert({ id: "resume-base", title: "Base", text: "Linux", createdAt: timestamp, updatedAt: timestamp });
    f.store.resumeVersions.create({
      id: "version-base",
      resumeId: "resume-base",
      jobId: "",
      templateId: "ATS_TECH",
      templateVersion: "ats-tech-v1",
      language: "pt-BR",
      status: "APPROVED",
      contentHash: "base-spec",
      resumeSpec: { candidate: { fullName: "Alex" } },
      source: "USER",
      approvedAt: timestamp,
    });
    const result = await f.dispatcher.dispatch({ resumeVersionId: "version-base" });
    assert.equal(result.reason, "JOB_SPECIFIC_VERSION_REQUIRED");
    assert.equal(f.store.applications.all().length, 0);
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
  }
});
