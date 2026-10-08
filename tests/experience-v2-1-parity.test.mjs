import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";
import {
  ExperienceService,
  buildApplicationJourney,
} from "../src/product/experience-service.mjs";
import { NextActionEngine } from "../src/product/next-action-engine.mjs";

const day = 86_400_000;
const now = new Date("2026-08-21T12:00:00.000Z");
const event = (eventType, createdAt, metadata = {}) => ({
  id: `${eventType}-${createdAt}`,
  eventType,
  createdAt,
  metadata,
});

test("registro ATS é a única autoridade de capability de candidatura", () => {
  const registry = new AdapterRegistry();
  const service = new ExperienceService({ adapterRegistry: registry });
  assert.deepEqual(service.applicationCapabilities(), registry.listCapabilities());
  const lever = registry.describe("lever");
  assert.equal(lever.level, "CONTROLLED_SUBMIT");
  assert.equal(lever.canFill, true);
  assert.equal(lever.canSubmit, true);
  const ashby = registry.describe("ashby");
  assert.equal(ashby.level, "CONTROLLED_SUBMIT");
  assert.equal(ashby.canFill, true);
  assert.equal(ashby.canSubmit, true);
  assert.equal(registry.describe("greenhouse").level, "CONTROLLED_SUBMIT");
  assert.equal(registry.describe("greenhouse").canSubmit, true);
  assert.equal(registry.describe("gupy").level, "READY_TO_SUBMIT_MANUAL");
  assert.equal(registry.describe("gupy").canSubmit, false);
  assert.equal(registry.describe("workday").level, "ASSISTED_FILL");
  assert.equal(registry.describe("workday").canFill, true);
  assert.equal(registry.describe("workday").canSubmit, false);
});

test("currículo padrão é persistido e validado pela biblioteca", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "career-default-resume-")),
    store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  try {
    store.resumes.upsert({
      id: "resume-base-01",
      title: "BASE 01",
      text: "Experiência confirmada",
      sections: {},
      extraction: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    store.resumes.upsert({
      id: "resume-source",
      title: "Currículo antigo",
      text: "Outra fonte de conhecimento",
      sections: {},
      extraction: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const service = new ExperienceService({ store });
    const saved = service.setDefaultResumeId("resume-base-01");
    assert.equal(saved.resumeId, "resume-base-01");
    assert.equal(service.defaultResumeId(), "resume-base-01");
    assert.equal(
      store.database.getMetadata("default_resume_id"),
      "resume-base-01",
    );
    assert.equal(store.resumes.findById("resume-base-01").resumeKind, "BASE");
    assert.equal(store.resumes.findById("resume-source").resumeKind, "DERIVED");
    assert.throws(
      () => service.setDefaultResumeId("resume-inexistente"),
      (error) => error.code === "RESUME_NOT_FOUND" && error.status === 404,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("workspace expõe tailoring pendente e próxima ação de revisão", async () => {
  const tailoring = {
      id: "tailoring-v21",
      jobId: "job-v21-tailoring",
      resumeId: "resume-v21",
      state: "REVIEW_REQUIRED",
      evidenceStatus: "VALID",
      changes: [],
      updatedAt: "2026-08-21T12:00:00.000Z",
    },
    store = {
      resumeVersions: { list: () => [] },
      resumeTailoring: { latestFor: () => tailoring },
      applicationQuestions: { forApplication: () => [] },
      resumeArtifacts: { forVersion: () => [] },
    },
    job = {
      id: tailoring.jobId,
      title: "Platform Intern",
      url: "https://jobs.ashbyhq.com/example/1",
      createdAt: "2026-08-21T10:00:00.000Z",
    },
    analysis = {
      id: "analysis-v21",
      updatedAt: "2026-08-21T11:00:00.000Z",
      algorithmVersion: "ats-matcher-v2",
    },
    service = new ExperienceService({
      store,
      opportunityService: {
        list: async () => [
          { job, analysis, requirements: [], items: [], application: null },
        ],
      },
      nextAction: new NextActionEngine(),
    });
  service.resumeRecommendation = () => ({
    selectedResumeId: tailoring.resumeId,
  });
  const workspace = await service.opportunityWorkspace(job.id);
  assert.equal(workspace.resumeTailoring.id, tailoring.id);
  assert.equal(workspace.nextAction.code, "REVIEW_TAILORING");
});

test("workspace respeita o currículo base explicitamente escolhido", async () => {
  const selected = { id: "tailoring-selected", jobId: "job-choice", resumeId: "resume-selected", state: "REVIEW_REQUIRED", evidenceStatus: "VALID", changes: [], updatedAt: "2026-08-22T12:00:00.000Z" };
  const store = {
    resumeVersions: { list: () => [
      { id: "version-other", jobId: "job-choice", resumeId: "resume-other", updatedAt: "2026-08-23T12:00:00.000Z" },
      { id: "version-selected", jobId: "job-choice", resumeId: "resume-selected", updatedAt: "2026-08-22T13:00:00.000Z" },
    ] },
    resumeTailoring: { latestFor: (_jobId, resumeId) => resumeId === "resume-selected" ? selected : null },
    applicationQuestions: { forApplication: () => [] },
    resumeArtifacts: { forVersion: () => [] },
  };
  const service = new ExperienceService({
    store,
    opportunityService: { list: async () => [{ job: { id: "job-choice", title: "Support", createdAt: "2026-08-22T10:00:00.000Z" }, analysis: null, requirements: [], items: [], application: null }] },
    nextAction: new NextActionEngine(),
  });
  service.resumeRecommendation = (_job, _analysis, resumeId) => ({ selectedResumeId: resumeId });
  const workspace = await service.opportunityWorkspace("job-choice", { resumeId: "resume-selected" });
  assert.equal(workspace.resumeTailoring.id, "tailoring-selected");
  assert.equal(workspace.resumeVersion.id, "version-selected");
});

test("workspace prefere BASE 01 pronta quando uma prévia alternativa é mais recente", async () => {
  const store = {
    resumeVersions: { list: () => [
      { id: "version-base-01", jobId: "job-template-default", resumeId: "resume-base", templateId: "BASE_01", status: "READY", updatedAt: "2026-08-22T13:00:00.000Z" },
      { id: "version-overleaf", jobId: "job-template-default", resumeId: "resume-base", templateId: "OVERLEAF_CLASSIC", status: "READY", updatedAt: "2026-08-23T13:00:00.000Z" },
    ] },
    resumeTailoring: { latestFor: () => null },
    applicationQuestions: { forApplication: () => [] },
    resumeArtifacts: { forVersion: () => [] },
  };
  const service = new ExperienceService({
    store,
    opportunityService: { list: async () => [{ job: { id: "job-template-default", title: "Support", createdAt: "2026-08-22T10:00:00.000Z" }, analysis: null, requirements: [], items: [], application: null }] },
    nextAction: new NextActionEngine(),
  });
  service.resumeRecommendation = () => ({ selectedResumeId: "resume-base" });

  const workspace = await service.opportunityWorkspace("job-template-default");

  assert.equal(workspace.resumeVersion.id, "version-base-01");
  assert.equal(workspace.resumeVersion.templateId, "BASE_01");
});

test("workspace exibe a versão exata vinculada à candidatura ativa", async () => {
  const store = {
    resumeVersions: { list: () => [
      { id: "version-archived", jobId: "job-active-version", resumeId: "resume-base", status: "ARCHIVED", updatedAt: "2026-08-24T12:00:00.000Z" },
      { id: "version-active", jobId: "job-active-version", resumeId: "resume-base", status: "READY", updatedAt: "2026-08-23T12:00:00.000Z" },
    ] },
    resumeTailoring: { latestFor: () => null },
    applications: {
      all: () => [{ id: "application-active", jobId: "job-active-version", resumeVersionId: "version-active", status: "PLANNED", updatedAt: "2026-08-24T13:00:00.000Z" }],
      events: () => [],
    },
    applicationQuestions: { forApplication: () => [] },
    resumeArtifacts: { forVersion: () => [] },
  };
  const service = new ExperienceService({
    store,
    opportunityService: { list: async () => [{ job: { id: "job-active-version", title: "Support", createdAt: "2026-08-22T10:00:00.000Z" }, analysis: null, requirements: [], items: [], application: null }] },
    nextAction: new NextActionEngine(),
  });
  service.resumeRecommendation = () => ({ selectedResumeId: "resume-base" });
  const workspace = await service.opportunityWorkspace("job-active-version");
  assert.equal(workspace.application.id, "application-active");
  assert.equal(workspace.resumeVersion.id, "version-active");
  assert.equal(workspace.resumeVersion.status, "READY");
});

test("follow-up nunca nasce antes do envio", () => {
  for (const status of ["DISCOVERED", "READY_TO_SUBMIT", "WAITING_USER"]) {
    const journey = buildApplicationJourney(
      {
        status,
        createdAt: new Date(now.getTime() - 30 * day).toISOString(),
        updatedAt: new Date(now.getTime() - 30 * day).toISOString(),
      },
      [],
      now,
    );
    assert.equal(journey.postSubmit, false);
    assert.equal(journey.followUpDue, false);
  }
});

test("follow-up usa evento significativo e janela de sete dias", () => {
  const appliedAt = new Date(now.getTime() - 8 * day).toISOString();
  const application = { status: "SUBMITTED", appliedAt, createdAt: appliedAt };
  assert.equal(buildApplicationJourney(application, [], now).followUpDue, true);

  const contactedYesterday = event(
    "FOLLOW_UP_CONTACT_RECORDED",
    now.toISOString(),
    { occurredAt: new Date(now.getTime() - day).toISOString() },
  );
  assert.equal(
    buildApplicationJourney(application, [contactedYesterday], now).followUpDue,
    false,
  );
});

test("resultado terminal encerra follow-up e entrevista permanece rastreável", () => {
  const appliedAt = new Date(now.getTime() - 20 * day).toISOString();
  const events = [
    event("APPLICATION_OUTCOME_RECORDED", appliedAt, {
      outcome: "REJECTED",
      occurredAt: new Date(now.getTime() - 8 * day).toISOString(),
    }),
    event("INTERVIEW_RECORDED", appliedAt, {
      occurredAt: new Date(now.getTime() - 10 * day).toISOString(),
      scheduledAt: new Date(now.getTime() - 9 * day).toISOString(),
      type: "TECHNICAL_INTERVIEW",
    }),
  ];
  const journey = buildApplicationJourney(
    { status: "SUBMITTED", appliedAt, createdAt: appliedAt },
    events,
    now,
  );
  assert.equal(journey.stage, "REJECTED");
  assert.equal(journey.terminal, true);
  assert.equal(journey.followUpDue, false);
  assert.equal(journey.interviews.length, 1);
});

test("ações humanas persistem como eventos append-only sem mudar status técnico", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-v21-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  try {
    const createdAt = "2026-08-01T12:00:00.000Z";
    store.jobs.upsert({
      id: "job-v21",
      title: "Platform Engineer",
      company: "Acme",
      description: "Linux",
      url: "https://example.test/job-v21",
      status: "open",
      createdAt,
      updatedAt: createdAt,
    });
    store.applications.create({
      id: "application-v21",
      jobId: "job-v21",
      status: "PLANNED",
      createdAt,
      updatedAt: createdAt,
    });
    const service = new ExperienceService({ store });
    service.recordApplicationAction("application-v21", {
      action: "REGISTER_OUTCOME",
      outcome: "SCREENING",
      occurredAt: "2026-08-10T12:00:00.000Z",
    });
    service.recordApplicationAction("application-v21", {
      action: "REGISTER_INTERVIEW",
      scheduledAt: "2026-08-25T15:00:00.000Z",
      type: "TECHNICAL_INTERVIEW",
    });
    const events = store.applications.events("application-v21");
    assert.equal(events.some((item) => item.eventType === "APPLICATION_OUTCOME_RECORDED"), true);
    assert.equal(events.some((item) => item.eventType === "INTERVIEW_RECORDED"), true);
    assert.equal(store.applications.findById("application-v21").status, "PLANNED");
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("candidatura pode avançar e sair da fila sem apagar histórico", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-actions-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  try {
    const createdAt = "2026-08-01T12:00:00.000Z";
    store.jobs.upsert({ id: "job-actions", title: "Support", company: "Acme", description: "Linux", url: "https://example.test/actions", status: "open", createdAt, updatedAt: createdAt });
    store.applications.create({ id: "application-actions", jobId: "job-actions", status: "PLANNED", createdAt, updatedAt: createdAt });
    const service = new ExperienceService({ store });
    assert.equal(service.recordApplicationAction("application-actions", { action: "ADVANCE_APPLICATION" }).application.status, "APPROVED");
    assert.equal(service.recordApplicationAction("application-actions", { action: "CANCEL_APPLICATION" }).application.status, "CANCELLED");
    assert.equal(store.applications.events("application-actions").length > 0, true);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("funil de candidaturas reúne interesse, currículo preparado e envio sem criar candidatura falsa", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-funnel-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  try {
    const createdAt = "2026-09-27T12:00:00.000Z";
    for (const id of ["interest", "prepared", "submitted"])
      store.jobs.upsert({ id: `job-${id}`, title: `Vaga ${id}`, company: "Acme", description: "Linux", url: `https://example.test/${id}`, status: "open", createdAt, updatedAt: createdAt });
    store.resumes.upsert({ id: "resume-funnel", title: "Base", text: "Linux", sections: { summary: "Linux" }, createdAt, updatedAt: createdAt });
    store.jobFeedback.save("job-interest", { userDecision: "APPLY" });
    store.jobFeedback.save("job-prepared", { userDecision: "APPLY" });
    store.resumeTailoring.createRun({ jobId: "job-prepared", resumeId: "resume-funnel", state: "REVIEW_REQUIRED", originalScore: 60, tailoredScore: 72, evidenceStatus: "VALID", promptVersion: "test", schemaVersion: "test", changes: [] });
    store.applications.create({ id: "application-submitted", jobId: "job-submitted", status: "SUBMITTED", createdAt, updatedAt: createdAt }, {}, { allowHistorical: true });
    const service = new ExperienceService({ store }), applications = service.applications(), funnel = service.applicationFunnel(applications);
    assert.deepEqual(new Set(funnel.interested.map((item) => item.job.id)), new Set(["job-interest", "job-prepared"]));
    assert.deepEqual(funnel.prepared.map((item) => item.job.id), ["job-prepared"]);
    assert.deepEqual(funnel.submitted.map((item) => item.job.id), ["job-submitted"]);
    assert.equal(funnel.interested[0].application, null);
    assert.equal(store.applications.all().length, 1);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("funil não promove geração órfã para candidaturas", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-funnel-orphan-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  try {
    const createdAt = "2026-09-27T12:00:00.000Z";
    store.jobs.upsert({ id: "job-orphan", title: "Vaga órfã", company: "Acme", description: "Linux", url: "https://example.test/orphan", status: "open", createdAt, updatedAt: createdAt });
    store.resumes.upsert({ id: "resume-orphan", title: "Fonte", text: "Linux", sections: {}, createdAt, updatedAt: createdAt });
    store.resumeTailoring.createRun({ jobId: "job-orphan", resumeId: "resume-orphan", state: "REVIEW_REQUIRED", originalScore: 50, tailoredScore: 55, evidenceStatus: "VALID", promptVersion: "test", schemaVersion: "test", changes: [] });
    const service = new ExperienceService({ store });
    const funnel = service.applicationFunnel(service.applications());
    assert.equal(funnel.prepared.length, 0);
    assert.equal(funnel.recent.length, 0);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("reanálise atual preserva análise legada", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-v21-analysis-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  try {
    const createdAt = "2026-07-01T12:00:00.000Z";
    const legacy = {
      id: "analysis-v1",
      jobId: "job-analysis",
      resumeId: "resume-analysis",
      score: 50,
      overallScore: 50,
      algorithmVersion: "ats-matcher-v1",
      createdAt,
      updatedAt: createdAt,
    };
    store.jobs.upsert({
      id: legacy.jobId,
      title: "Platform Engineer",
      company: "Acme",
      description: "Linux Docker",
      url: "https://example.test/job-analysis",
      status: "open",
      createdAt,
      updatedAt: createdAt,
    });
    store.resumes.upsert({
      id: legacy.resumeId,
      title: "Platform",
      text: "Platform Engineer com Linux e Docker em produção.",
      createdAt,
      updatedAt: createdAt,
    });
    store.analyses.upsert(legacy);
    const current = runAtsMatcherV2({
      job: {
        id: legacy.jobId,
        title: "Platform Engineer",
        description: "Linux Docker",
      },
      resume: {
        id: legacy.resumeId,
        text: "Platform Engineer com Linux e Docker em produção.",
      },
      profile: {},
      now: "2026-08-21T12:00:00.000Z",
    });
    store.analyses.upsert(current);
    const analyses = store.analyses.all().filter((item) => item.jobId === legacy.jobId);
    assert.equal(analyses.length, 2);
    assert.equal(analyses.some((item) => item.algorithmVersion === "ats-matcher-v1"), true);
    assert.equal(analyses.some((item) => item.algorithmVersion === "ats-matcher-v2"), true);
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("frontend V2.1 usa contratos reais e mantém semânticas separadas", async () => {
  const [resumes, opportunities, autopilot] = await Promise.all([
    readFile(new URL("../public/features/resumes/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/features/opportunities/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/features/autopilot/page.js", import.meta.url), "utf8"),
  ]);
  assert.match(resumes, /\/api\/resume-documents\/templates/);
  assert.match(resumes, /Importar curr[ií]culo/i);
  assert.match(opportunities, /Empresa encontrada/);
  assert.match(opportunities, /analysisStatus/);
  assert.match(autopilot, /Somente watchlists explicitamente adicionadas/);
  assert.match(autopilot, /data-test-source/);
  assert.match(autopilot, /data-test-profile/);
});

test("exportador de auditoria possui allowlist, manifesto e bloqueios sensíveis", async () => {
  const [exporter, validator] = await Promise.all([
    readFile(new URL("../scripts/export-audit.ps1", import.meta.url), "utf8"),
    readFile(new URL("../scripts/validate-audit-export.ps1", import.meta.url), "utf8"),
  ]);
  assert.match(exporter, /\$allowedRoots/);
  assert.match(exporter, /AUDIT_MANIFEST\.md/);
  assert.match(exporter, /\.env\.example/);
  assert.match(exporter, /browser-profiles/);
  assert.match(validator, /node_modules/);
  assert.match(validator, /sqlite-wal/);
  assert.match(validator, /qrcode/);
});
