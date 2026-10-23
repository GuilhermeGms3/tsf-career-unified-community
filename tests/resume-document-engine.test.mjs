import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import {
  ResumeSpecBuilder,
  hashResumeSpec,
} from "../src/resume/resume-spec-builder.mjs";
import { LatexTemplateRenderer } from "../src/resume/templates/latex-template-renderer.mjs";
import {
  LatexSafetyValidator,
  escapeLatex,
} from "../src/resume/validation/latex-safety-validator.mjs";
import { LocalLatexCompiler } from "../src/resume/compiler/latex-compiler.mjs";
import { PdfValidator } from "../src/resume/validation/pdf-validator.mjs";
import { ResumeService } from "../src/resume/resume-service.mjs";
import { DocumentExportService } from "../src/resume/export/document-export-service.mjs";
import { AutomationRequestAuth } from "../src/integrations/automation-request-auth.mjs";
import { EventBus } from "../src/integrations/event-bus.mjs";
import { validateResumeArtifact } from "../src/automation/automation-validation.mjs";
import { TemplatePolicy } from "../src/resume/templates/template-policy.mjs";
import { assertTailoringApprovable, tailoringQuality } from "../src/intelligence/tasks/resume-tailor.mjs";

test("template solicitado é respeitado e regressão ATS bloqueia o documento", () => {
  const policy = new TemplatePolicy({ minimumResumeParseability: 65 });
  assert.equal(policy.select({ purpose: "APPLICATION", requestedTemplateId: "ATS_TECH" }).templateId, "ATS_TECH");
  const regression = policy.regression({ before: { score: 90 }, after: { score: 90 }, matchBefore: 78, matchAfter: 72 });
  assert.equal(regression.allowed, false);
  assert.ok(regression.reasons.includes("ATS_MATCH_REGRESSION"));
});

test("tailoring com score menor não pode ser aprovado", () => {
  const run = { originalScore: 82, tailoredScore: 76, evidenceStatus: "VALID", changes: [] };
  assert.deepEqual(tailoringQuality(run).reasons, ["ATS_MATCH_REGRESSION"]);
  assert.throws(() => assertTailoringApprovable(run), (error) => error.code === "ATS_MATCH_REGRESSION");
});

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-resume-doc-"));
  return {
    dataDir,
    store: await new UnifiedStateStore({ dataDir }).initialize(),
    async close() {
      this.store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
function seedResume(store) {
  const now = new Date().toISOString();
  store.resumes.upsert({
    id: "resume-1",
    title: "Base",
    text: "Resumo\nAtendi chamados e documentei incidentes.\nLinux\nUniversidade X",
    focus: "Suporte",
    sections: {
      summary: "Profissional de suporte",
      experience: "Atendi chamados e documentei incidentes.",
      skills: ["Linux"],
      education: "Universidade X",
    },
    extraction: { method: "text" },
    createdAt: now,
    updatedAt: now,
  });
}
const profile = {
  personal: {
    fullName: "Pessoa Teste",
    email: "pessoa@example.test",
    city: "Sao Paulo",
    country: "Brasil",
    linkedin: "https://linkedin.example/test",
  },
  career: { headline: "Analista de Suporte", skills: ["Linux"] },
};

test("schema atual preserva document engine e archetypes", async () => {
  const f = await fixture();
  try {
    assert.equal(
      f.store.database.connection
        .prepare("SELECT MAX(version) version FROM schema_migrations")
        .get().version,
      59,
    );
    for (const table of [
      "resume_versions",
      "resume_artifacts",
      "resume_templates",
      "resume_render_runs",
      "document_exports",
      "document_destination_settings",
      "resume_document_jobs",
      "resume_upload_audits",
      "automation_request_nonces",
      "job_hunt_profiles",
    ])
      assert.ok(
        f.store.database.connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table),
      );
    assert.ok(
      f.store.database.connection
        .prepare("PRAGMA table_info(applications)")
        .all()
        .some((x) => x.name === "resume_version_id"),
    );
    assert.deepEqual(
      f.store.database.connection
        .prepare("SELECT id FROM resume_templates WHERE id IN ('ATS_BALANCED','ATS_EARLY_CAREER','ATS_IMPACT') ORDER BY id")
        .all()
        .map((item) => item.id),
      ["ATS_BALANCED", "ATS_EARLY_CAREER", "ATS_IMPACT"],
    );
  } finally {
    await f.close();
  }
});

test("ResumeSpec e hash sao deterministas e independentes de LaTeX", () => {
  const evidence = [
      { id: "e-summary", text: "Profissional de suporte" },
      { id: "e-exp", text: "Atendi chamados e documentei incidentes." },
      { id: "e-skill", text: "Linux" },
      { id: "e-edu", text: "Universidade X" },
    ],
    resume = {
      id: "r",
      title: "Base",
      focus: "Suporte",
      sections: {
        summary: evidence[0].text,
        experience: evidence[1].text,
        skills: ["Linux"],
        education: "Universidade X",
      },
    },
    builder = new ResumeSpecBuilder(),
    a = builder.build({ profile, resume, evidence }),
    b = builder.build({ profile, resume, evidence });
  assert.deepEqual(a, b);
  assert.equal(hashResumeSpec(a), hashResumeSpec(b));
  assert.equal(JSON.stringify(a).includes("\\usepackage"), false);
});

test("escaping protege caracteres e comandos injetados", () => {
  assert.equal(escapeLatex("Java & Spring_100%"), "Java \\& Spring\\_100\\%");
  const rendered = new LatexTemplateRenderer().render({
    language: "pt-BR",
    candidate: { fullName: "Nome \\input{segredo}", email: "x@y.test" },
    summary: { text: "Java & Spring", evidenceIds: ["e"] },
    experiences: [
      {
        title: "Dev",
        company: "A",
        bullets: [{ text: "100% seguro \\write18{calc}", evidenceIds: ["e"] }],
      },
    ],
    skills: [],
    projects: [],
    education: [],
    certifications: [],
    languages: [],
  });
  assert.match(rendered.source, /textbackslash/);
  assert.doesNotMatch(rendered.source, /\\input\{segredo\}/);
  assert.doesNotMatch(rendered.source, /\\write18\{calc\}/);
});

test("renderer remove separadores importados sem apagar hifens humanos", () => {
  const rendered = new LatexTemplateRenderer().render({
    language: "pt-BR",
    candidate: { fullName: "Nome" },
    summary: {
      text: "Infraestrutura -------------------------------- automacao",
    },
    experiences: [
      {
        title: "Service Desk N1-N2",
        company: "Empresa",
        bullets: [{ text: "Suporte === redes" }],
      },
    ],
    skills: [],
    projects: [],
    education: [],
    certifications: [],
    languages: [],
  });
  assert.doesNotMatch(rendered.source, /---|===/);
  assert.match(rendered.source, /N1-N2/);
});

test("validator bloqueia include, pacote, shell escape e path injection", () => {
  const validator = new LatexSafetyValidator();
  for (const source of [
    "\\input{x}",
    "\\include{x}",
    "\\write18{x}",
    "\\usepackage{evil}",
    "../secret.tex",
    "C:\\secret.tex",
  ])
    assert.equal(validator.validateSource(source).valid, false);
});

test("compilador ausente retorna fallback controlado", async () => {
  const compiler = new LocalLatexCompiler({
    executable: "definitely-not-installed-tectonic",
  });
  assert.equal((await compiler.health()).status, "NOT_INSTALLED");
  const result = await compiler.compile({
    sourcePath: path.join(os.tmpdir(), "missing.tex"),
    outputDir: os.tmpdir(),
    workDir: os.tmpdir(),
  });
  assert.equal(result.errorCode, "PDF_COMPILER_NOT_AVAILABLE");
});

test("PDF validator verifica header, texto, nome e paginas", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "career-pdf-validator-")),
    file = path.join(dir, "resume.pdf");
  try {
    await writeFile(file, "%PDF-1.4\n/Type /Page\n%%EOF");
    const result = await new PdfValidator({
      extractText: async () => ({
        text: "Pessoa Teste Experiencia Competencias",
        pages: 1,
      }),
    }).validate(file, {
      expectedName: "Pessoa Teste",
      requiredSections: ["Experiencia"],
    });
    assert.equal(result.valid, true);
    assert.equal(result.pageCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("versoes sao append-only, persistem no restart e ligam candidatura exata", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const spec = {
        candidate: { fullName: "Pessoa Teste" },
        experiences: [{ bullets: [] }],
        skills: [],
      },
      base = {
        resumeId: "resume-1",
        templateId: "ATS_CLEAN",
        templateVersion: "ats-clean-v1",
        language: "pt-BR",
        resumeSpec: spec,
        contentHash: hashResumeSpec(spec),
        source: "TEST",
      },
      first = f.store.resumeVersions.create({
        ...base,
        status: "REVIEW_REQUIRED",
      });
    assert.equal(
      f.store.resumeVersions.transition(first.id, "APPROVED").status,
      "APPROVED",
    );
    const changed = { ...spec, candidate: { fullName: "Pessoa Teste 2" } },
      second = f.store.resumeVersions.create({
        ...base,
        resumeSpec: changed,
        contentHash: hashResumeSpec(changed),
        parentVersionId: first.id,
        status: "REVIEW_REQUIRED",
      });
    assert.notEqual(first.id, second.id);
    f.store.close();
    f.store = await new UnifiedStateStore({ dataDir: f.dataDir }).initialize();
    assert.equal(
      f.store.resumeVersions.list({ resumeId: "resume-1" }).length,
      2,
    );
  } finally {
    await f.close();
  }
});

test("edicao manual cria versao filha e preserva validacao factual", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const service = new ResumeService({
        store: f.store,
        dataDir: f.dataDir,
        profileProvider: async () => profile,
      }),
      parent = await service.prepare({ resumeId: "resume-1" }),
      editedSpec = structuredClone(parent.resumeSpec);
    editedSpec.candidate.headline = "Analista de Suporte Técnico";
    const revision = await service.revise(parent.id, {
      resumeSpec: editedSpec,
    });
    assert.notEqual(revision.id, parent.id);
    assert.equal(revision.parentVersionId, parent.id);
    assert.equal(revision.status, "REVIEW_REQUIRED");
    assert.equal(revision.source, "USER_EDIT");
    assert.equal(
      f.store.resumeVersions.findById(parent.id).resumeSpec.candidate.headline,
      "Suporte",
    );

    const unsupported = structuredClone(revision.resumeSpec);
    unsupported.summary.text = "Especialista AWS";
    await assert.rejects(
      service.revise(revision.id, { resumeSpec: unsupported }),
      (error) =>
        error.code === "RESUME_SPEC_INVALID" &&
        error.validation.errors.some((item) =>
          item.includes("EVIDENCE_VIOLATION"),
        ),
    );
  } finally {
    await f.close();
  }
});

test("ApplicationPlanner persiste resume_version_id aprovado exato", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const now = new Date().toISOString(),
      spec = {
        candidate: { fullName: "Pessoa Teste" },
        experiences: [{ bullets: [] }],
        skills: [],
      },
      version = f.store.resumeVersions.create({
        resumeId: "resume-1",
        templateId: "ATS_CLEAN",
        templateVersion: "ats-clean-v1",
        language: "pt-BR",
        status: "APPROVED",
        contentHash: hashResumeSpec(spec),
        resumeSpec: spec,
        source: "BASE",
      });
    f.store.jobs.upsert({
      id: "job-1",
      title: "Suporte",
      company: "Acme",
      description: "Linux",
      url: "https://example.test/jobs/1",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    f.store.analyses.upsert({
      id: "analysis-1",
      jobId: "job-1",
      resumeId: "resume-1",
      score: 90,
      overallScore: 90,
      calibratedMatchScore: 90,
      eligibility: "ELIGIBLE",
      blockingIssues: [],
      warnings: [],
      unknownRequirements: [],
      algorithmVersion: "ats-matcher-v2",
      matcherVersion: "ats-matcher-v2",
      scoringModelVersion: "confidence-calibrated-v2",
      requirementExtractorVersion: "requirements-v3",
      createdAt: now,
      updatedAt: now,
    });
    f.store.applications.create({
      id: "application-1",
      jobId: "job-1",
      resumeId: "resume-1",
      status: "PLANNED",
      appliedAt: "",
      nextAction: "",
      notes: "",
      createdAt: now,
      updatedAt: now,
    });
    const plan = f.store.planApplication("application-1", "analysis-1", {
      personal: { fullName: "Pessoa Teste", email: "pessoa@example.test" },
    });
    assert.equal(plan.selectedResumeVersionId, version.id);
    assert.equal(
      f.store.applications.findById("application-1").resumeVersionId,
      version.id,
    );
  } finally {
    await f.close();
  }
});

test("ResumeService direciona cabeçalho somente na nova versão específica", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const timestamp = new Date().toISOString();
    f.store.jobs.upsert({ id: "headline-job", title: "Analista de Infraestrutura Júnior", company: "Empresa", url: "https://example.test/job", description: "Infraestrutura", createdAt: timestamp, updatedAt: timestamp });
    const service = new ResumeService({ store: f.store, dataDir: f.dataDir, profileProvider: async () => profile });
    const general = await service.prepare({ resumeId: "resume-1" });
    const targeted = await service.prepare({ resumeId: "resume-1", jobId: "headline-job" });
    assert.equal(targeted.resumeSpec.candidate.headline, "Infraestrutura de TI");
    assert.equal(f.store.resumeVersions.findById(general.id).resumeSpec.candidate.headline, general.resumeSpec.candidate.headline);
    assert.equal(f.store.resumes.findById("resume-1").focus, "Suporte");
  } finally { await f.close(); }
});

test("ResumeService exige review e preserva LaTeX quando compilador falta", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const events = [],
      bus = new EventBus({ outbox: null });
    bus.on("RESUME_RENDER_FAILED", (event) => events.push(event));
    const service = new ResumeService({
        store: f.store,
        dataDir: f.dataDir,
        profileProvider: async () => profile,
        eventBus: bus,
        compiler: new LocalLatexCompiler({ executable: "missing-tectonic" }),
      }),
      draft = await service.prepare({
        resumeId: "resume-1",
        templateId: "ATS_CLEAN",
      });
    assert.equal(draft.status, "REVIEW_REQUIRED");
    service.approve(draft.id);
    const rendered = await service.render(draft.id);
    assert.equal(rendered.errorCode, "PDF_COMPILER_NOT_AVAILABLE");
    assert.ok(f.store.resumeArtifacts.latest(draft.id, "LATEX_SOURCE"));
    assert.equal(f.store.resumeArtifacts.latest(draft.id, "PDF"), null);
    assert.equal(events.length, 1);
  } finally {
    await f.close();
  }
});

test("render idempotente reutiliza PDF READY", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    let calls = 0;
    const fake = {
        health: async () => ({ status: "HEALTHY", version: "fake-1" }),
        compile: async ({ outputDir }) => {
          calls++;
          const pdf = path.join(outputDir, "resume.pdf");
          await writeFile(pdf, "%PDF-1.4\n/Type /Page\n%%EOF");
          return {
            ok: true,
            status: "COMPLETED",
            pdfPath: pdf,
            compilerVersion: "fake-1",
            durationMs: 1,
            log: "",
          };
        },
      },
      service = new ResumeService({
        store: f.store,
        dataDir: f.dataDir,
        profileProvider: async () => profile,
        compiler: fake,
        pdfTextExtractor: async () => ({
          text: "Pessoa Teste pessoa@example.test Experiencia 2022 Atendi chamados e documentei incidentes Competencias Linux Formacao Universidade X https://linkedin.example/test",
          pages: 1,
        }),
        policy: { minimumResumeParseability: 0 },
      }),
      draft = await service.prepare({ resumeId: "resume-1" });
    service.approve(draft.id);
    const first = await service.render(draft.id),
      second = await service.render(draft.id);
    assert.equal(first.version.status, "READY");
    assert.equal(second.reused, true);
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});

test("saída LaTeX sem PDF não consulta compilador e é idempotente", async () => {
  const f=await fixture();
  try {
    seedResume(f.store);
    const service=new ResumeService({store:f.store,dataDir:f.dataDir,profileProvider:async()=>profile,compiler:{health:()=>{throw new Error("compiler must not be probed");}}});
    const version=await service.prepare({resumeId:"resume-1"});service.approve(version.id);
    const first=await service.render(version.id,{pdf:false}),second=await service.render(version.id,{pdf:false});
    assert.equal(first.sourceOnly,true);assert.equal(second.reused,true);
    assert.ok(f.store.resumeArtifacts.latest(version.id,"LATEX_SOURCE"));assert.equal(f.store.resumeArtifacts.latest(version.id,"PDF"),null);
  } finally {await f.close();}
});

test("limite de render compartilhado preenche dois slots sem ultrapassar", async () => {
  const service=new ResumeService({store:{resumeArtifactService:{}},dataDir:"."});
  let active=0,peak=0;
  service.renderDocument=async id=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,15));active--;return {id};};
  await Promise.all(Array.from({length:6},(_,index)=>service.render(`version-${index}`)));
  assert.equal(peak,2);assert.equal(service.renderSlots,0);assert.equal(service.rendering.size,0);
});

test("artefato exato valida raiz, hash e estado READY", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const spec = { candidate: { fullName: "Pessoa Teste" }, experiences: [{}] },
      version = f.store.resumeVersions.create({
        resumeId: "resume-1",
        templateId: "ATS_CLEAN",
        templateVersion: "ats-clean-v1",
        language: "pt-BR",
        status: "READY",
        contentHash: hashResumeSpec(spec),
        resumeSpec: spec,
        source: "TEST",
      }),
      artifact = await f.store.resumeArtifactService.write({
        resumeId: "resume-1",
        resumeVersionId: version.id,
        artifactType: "PDF",
        content: "%PDF-1.4\n%%EOF",
      }),
      selected = await validateResumeArtifact({
        version,
        artifact,
        dataDir: f.dataDir,
      });
    assert.equal(selected.path, artifact.storagePath);
    await writeFile(artifact.storagePath, "tampered");
    await assert.rejects(
      () => validateResumeArtifact({ version, artifact, dataDir: f.dataDir }),
      (error) => error.code === "RESUME_ARTIFACT_HASH_MISMATCH",
    );
  } finally {
    await f.close();
  }
});

test("cenario E2E 6: Overleaf gera somente bundle exportavel sem integracao privada", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const spec = { candidate: { fullName: "Pessoa Teste" }, experiences: [{}] },
      version = f.store.resumeVersions.create({
        resumeId: "resume-1",
        templateId: "ATS_CLEAN",
        templateVersion: "ats-clean-v1",
        language: "pt-BR",
        status: "APPROVED",
        contentHash: hashResumeSpec(spec),
        resumeSpec: spec,
        source: "TEST",
      });
    await f.store.resumeArtifactService.write({
      resumeId: "resume-1",
      resumeVersionId: version.id,
      artifactType: "LATEX_SOURCE",
      content: "\\documentclass{article}\\begin{document}Teste\\end{document}",
    });
    const service = new DocumentExportService({
        versions: f.store.resumeVersions,
        artifacts: f.store.resumeArtifacts,
        exports: f.store.documentExports,
        artifactService: f.store.resumeArtifactService,
      }),
      exported = await service.export(version.id, "OVERLEAF"),
      bundle = f.store.resumeArtifacts.findById(exported.artifactId);
    assert.equal(exported.status, "OVERLEAF_EXPORT_READY");
    assert.equal(bundle.mimeType, "application/zip");
    assert.equal(
      (await readFile(bundle.storagePath)).subarray(0, 2).toString(),
      "PK",
    );
  } finally {
    await f.close();
  }
});

test("eventos de documento minimizam PII mas preservam IDs", () => {
  let seen;
  const bus = new EventBus();
  bus.on("RESUME_RENDER_READY", (event) => (seen = event));
  bus.emit("RESUME_RENDER_READY", {
    resumeVersionId: "v1",
    resumeId: "r1",
    email: "private@example.test",
    resumeSpec: { secret: "x" },
    atsDelta: 5,
  });
  assert.equal(seen.payload.resumeVersionId, "v1");
  assert.equal("email" in seen.payload, false);
  assert.equal("resumeSpec" in seen.payload, false);
});

test("HMAC de automacao rejeita replay e corpo alterado", async () => {
  const f = await fixture();
  process.env.CAREER_N8N_ACTION_SECRET = "test-secret";
  try {
    const raw = '{"jobType":"RENDER","resumeVersionId":"v1"}',
      timestamp = new Date().toISOString(),
      nonce = "event-12345678",
      signature = createHmac("sha256", "test-secret")
        .update(`${timestamp}.${raw}`)
        .digest("hex"),
      auth = new AutomationRequestAuth({
        connection: f.store.database.connection,
      });
    assert.equal(
      auth.verify({
        rawBody: raw,
        headers: {
          "x-career-timestamp": timestamp,
          "x-career-event-id": nonce,
          "x-career-signature": `sha256=${signature}`,
        },
      }).authenticated,
      true,
    );
    assert.throws(
      () =>
        auth.verify({
          rawBody: raw,
          headers: {
            "x-career-timestamp": timestamp,
            "x-career-event-id": nonce,
            "x-career-signature": `sha256=${signature}`,
          },
        }),
      (error) => error.code === "AUTOMATION_REPLAY_REJECTED",
    );
  } finally {
    delete process.env.CAREER_N8N_ACTION_SECRET;
    await f.close();
  }
});

test("cenario E2E 2: EvidenceGuard impede changeset aprovado com afirmacao inventada", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const now = new Date().toISOString();
    f.store.jobs.upsert({
      id: "job-e2e-2",
      title: "SRE",
      company: "Acme",
      description: "Kubernetes",
      url: "https://example.test/jobs/e2e-2",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    const tailoring = f.store.resumeTailoring.createRun({
      jobId: "job-e2e-2",
      resumeId: "resume-1",
      state: "APPROVED",
      originalScore: 50,
      tailoredScore: 90,
      evidenceStatus: "EVIDENCE_VIOLATION",
      promptVersion: "test",
      schemaVersion: "test",
      changes: [
        {
          type: "ADD_SKILL",
          sourceEvidenceIds: [],
          original: "",
          proposed: "Kubernetes avancado",
          reason: "vaga",
          validationStatus: "EVIDENCE_VIOLATION",
        },
      ],
    });
    const service = new ResumeService({
      store: f.store,
      dataDir: f.dataDir,
      profileProvider: async () => profile,
    });
    await assert.rejects(
      () =>
        service.prepare({
          resumeId: "resume-1",
          jobId: "job-e2e-2",
          tailoringRunId: tailoring.id,
        }),
      (error) => error.code === "EVIDENCE_VIOLATION",
    );
    assert.equal(f.store.resumeVersions.list().length, 0);
  } finally {
    await f.close();
  }
});

test("curriculo base pode ser preparado apos tailoring rejeitado", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const now = new Date().toISOString();
    f.store.jobs.upsert({
      id: "job-rejected-tailoring",
      title: "Analista de Suporte",
      company: "Acme",
      description: "Atendimento e Linux",
      url: "https://example.test/jobs/rejected-tailoring",
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    f.store.resumeTailoring.createRun({
      jobId: "job-rejected-tailoring",
      resumeId: "resume-1",
      state: "REJECTED",
      originalScore: 67,
      tailoredScore: 64,
      evidenceStatus: "VALID",
      promptVersion: "test",
      schemaVersion: "test",
      changes: [],
    });
    const service = new ResumeService({
        store: f.store,
        dataDir: f.dataDir,
        profileProvider: async () => profile,
      }),
      version = await service.prepare({
        resumeId: "resume-1",
        jobId: "job-rejected-tailoring",
      });
    assert.equal(version.status, "REVIEW_REQUIRED");
    assert.equal(version.tailoringRunId, "");
  } finally {
    await f.close();
  }
});

test("cenario E2E 4: n8n offline deixa evento RETRYABLE sem invalidar versao READY", async () => {
  const f = await fixture();
  process.env.CAREER_RESUME_E2E_N8N_SECRET = "secret";
  try {
    seedResume(f.store);
    const spec = { candidate: { fullName: "Pessoa Teste" }, experiences: [{}] },
      version = f.store.resumeVersions.create({
        resumeId: "resume-1",
        templateId: "ATS_CLEAN",
        templateVersion: "ats-clean-v1",
        language: "pt-BR",
        status: "READY",
        contentHash: hashResumeSpec(spec),
        resumeSpec: spec,
        source: "TEST",
      });
    f.store.integrationSettings.save({
      enabled: true,
      webhookUrl: "https://n8n.example.test/webhook",
      secretEnvName: "CAREER_RESUME_E2E_N8N_SECRET",
      eventAllowlist: ["RESUME_RENDER_READY"],
    });
    const event = new EventBus({ outbox: f.store.outbox }).emit(
        "RESUME_RENDER_READY",
        { resumeVersionId: version.id, resumeId: "resume-1" },
      ),
      { WebhookDispatcher } =
        await import("../src/integrations/webhook-dispatcher.mjs"),
      result = await new WebhookDispatcher({
        outbox: f.store.outbox,
        settings: f.store.integrationSettings,
        fetchImpl: async () => {
          throw Object.assign(new Error("offline"), { code: "OFFLINE" });
        },
      }).drainOne();
    assert.equal(result.status, "RETRYABLE");
    assert.equal(f.store.outbox.findById(event.id).status, "RETRYABLE");
    assert.equal(f.store.resumeVersions.findById(version.id).status, "READY");
  } finally {
    delete process.env.CAREER_RESUME_E2E_N8N_SECRET;
    await f.close();
  }
});

test("render FAILED aprovado pode ser repetido apos instalar compilador", async () => {
  const f = await fixture();
  try {
    seedResume(f.store);
    const service = new ResumeService({
        store: f.store,
        dataDir: f.dataDir,
        profileProvider: async () => profile,
        compiler: new LocalLatexCompiler({ executable: "missing-tectonic" }),
        pdfTextExtractor: async () => ({
          text: "Pessoa Teste Experiencia Atendi chamados Competencias Linux",
          pages: 1,
        }),
        policy: { minimumResumeParseability: 0 },
      }),
      draft = await service.prepare({ resumeId: "resume-1" });
    service.approve(draft.id);
    assert.equal((await service.render(draft.id)).version.status, "FAILED");
    service.compiler = {
      health: async () => ({ status: "HEALTHY", version: "fake" }),
      compile: async ({ outputDir }) => {
        const pdf = path.join(outputDir, "resume.pdf");
        await writeFile(pdf, "%PDF-1.4\n/Type /Page\n%%EOF");
        return {
          ok: true,
          status: "COMPLETED",
          pdfPath: pdf,
          compilerVersion: "fake",
          durationMs: 1,
          log: "",
        };
      },
    };
    assert.equal((await service.render(draft.id)).version.status, "READY");
  } finally {
    await f.close();
  }
});

test("changeset aprovado altera conteudo estruturado sem usar requisitos como fatos", () => {
  const builder = new ResumeSpecBuilder(),
    original = "Automatizei rotinas com Python",
    proposed = "Automatizei rotinas operacionais com Python",
    evidence = [{ id: "exp-1", text: proposed }],
    spec = builder.build({
      profile,
      resume: {
        id: "r",
        title: "Base",
        sections: {
          experience: [
            { title: "Analista", company: "Acme", bullets: [original] },
          ],
          skills: ["Python"],
        },
      },
      changeset: {
        state: "APPROVED",
        changes: [{ original, proposed, validationStatus: "VALID" }],
      },
      evidence,
    });
  assert.equal(spec.experiences[0].bullets[0].text, proposed);
  assert.equal(JSON.stringify(spec).includes("Kubernetes"), false);
  assert.deepEqual(spec.experiences[0].bullets[0].evidenceIds, ["exp-1"]);
});

test("changeset aprovado aplica texto apesar de quebras de linha do PDF", () => {
  const original = "Profissional de suporte com experiência em Service Desk e troubleshooting.",
    proposed = "Profissional de suporte técnico com foco em incidentes e atendimento a usuários.",
    spec = new ResumeSpecBuilder().build({
      profile,
      resume: {
        id: "r",
        title: "Base PDF",
        sections: {
          summary: "Profissional de suporte com experiência\nem Service Desk e troubleshooting.",
          experience: [{ title: "Analista", company: "Acme", bullets: ["Atendi chamados técnicos por sistema de tickets."] }],
        },
      },
      changeset: {
        state: "APPROVED",
        changes: [{ original, proposed, sourceEvidenceIds: ["summary-evidence"], validationStatus: "VALID" }],
      },
      evidence: [{ id: "summary-evidence", text: "Experiência em suporte técnico, incidentes e atendimento a usuários." }],
    });
  assert.equal(spec.summary.text, proposed);
  assert.deepEqual(spec.summary.evidenceIds, ["summary-evidence"]);
});
