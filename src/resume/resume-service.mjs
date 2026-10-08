import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ResumeSpecBuilder, hashResumeSpec } from "./resume-spec-builder.mjs";
import { ResumeVersionService } from "./resume-version-service.mjs";
import { ResumeDocumentValidator } from "./resume-document-validator.mjs";
import { TemplateRegistry } from "./templates/template-registry.mjs";
import { TemplatePolicy } from "./templates/template-policy.mjs";
import { LatexTemplateRenderer } from "./templates/latex-template-renderer.mjs";
import { LocalLatexCompiler } from "./compiler/latex-compiler.mjs";
import { PdfValidator } from "./validation/pdf-validator.mjs";
import { AtsDocumentValidator } from "./validation/ats-document-validator.mjs";
import { assertTailoringApprovable } from "../intelligence/tasks/resume-tailor.mjs";
import { buildResumeSourceEvidence } from "./resume-source-evidence.mjs";

export class ResumeService {
  constructor({
    store,
    dataDir,
    profileProvider = async () => ({}),
    eventBus = null,
    compiler = null,
    pdfTextExtractor = null,
    matcher = null,
    writeSource = writeFile,
    policy = {},
  } = {}) {
    this.store = store;
    this.writeSource = writeSource;
    this.dataDir = dataDir;
    this.profileProvider = profileProvider;
    this.eventBus = eventBus;
    this.policy = new TemplatePolicy(policy);
    this.templates = new TemplateRegistry();
    this.builder = new ResumeSpecBuilder();
    this.validator = new ResumeDocumentValidator({
      policy: this.policy.policy,
    });
    this.versionService = new ResumeVersionService({
      versions: store.resumeVersions,
    });
    this.renderer = new LatexTemplateRenderer();
    this.compiler = compiler || new LocalLatexCompiler();
    this.pdfValidator = new PdfValidator({
      extractText: pdfTextExtractor,
      maxPages: this.policy.policy.maximumResumePages,
    });
    this.atsValidator = new AtsDocumentValidator({ matcher });
    this.artifactService = store.resumeArtifactService;
    this.rendering = new Map();
    this.renderSlots = 0;
    this.renderWaiters = [];
  }
  async prepare({
    resumeId,
    jobId = "",
    applicationId = "",
    templateId = "",
    templateVersion = "",
    archetypeId = "GENERAL",
    language = "pt-BR",
    tailoringRunId = "",
    batchRunId = "",
    batchItemId = "",
    source = "USER",
  } = {}) {
    const resume = this.store.resumes.findById(resumeId);
    if (!resume)
      throw Object.assign(new Error("Curriculo base nao encontrado."), {
        code: "RESUME_NOT_FOUND",
      });
    const job = jobId ? this.store.jobs.findById(jobId) : null,
      analysis = jobId
        ? this.store.analyses
            .all()
            .filter((x) => x.jobId === jobId && x.resumeId === resumeId)
            .sort(
              (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
            )[0]
        : null,
      tailoring = tailoringRunId
        ? this.store.resumeTailoring.findRun(tailoringRunId)
        : null;
    if (
      tailoring &&
      (tailoring.jobId !== jobId || tailoring.resumeId !== resumeId)
    )
      throw Object.assign(
        new Error("Os ajustes aprovados pertencem a outra vaga ou currículo base."),
        { code: "TAILORING_CONTEXT_MISMATCH" },
      );
    if (tailoring && tailoring.state !== "APPROVED")
      throw Object.assign(
        new Error("Revise e aprove o changeset antes de gerar a versao."),
        { code: "TAILORING_REVIEW_REQUIRED" },
      );
    if (
      tailoring &&
      (tailoring.evidenceStatus !== "VALID" ||
        tailoring.changes?.some(
          (change) => change.validationStatus !== "VALID",
        ))
    )
      throw Object.assign(
        new Error(
          "Changeset contem afirmacao sem evidencia e nao pode gerar versao.",
        ),
        { code: "EVIDENCE_VIOLATION" },
      );
    if (tailoring) assertTailoringApprovable(tailoring);
    const profile = await this.profileProvider(),
      evidence = [
        ...(analysis?.candidateEvidence || []),
        ...buildResumeSourceEvidence(resume, profile),
      ],
      selection = this.policy.select({
        purpose: job ? "APPLICATION" : "GENERAL",
        requestedTemplateId: templateId,
        language,
      }),
      template = this.templates.get(selection.templateId, templateVersion),
      archetype =
        this.store.resumeArchetypes?.find(archetypeId) ||
        this.store.resumeArchetypes?.find("GENERAL") ||
        null,
      spec = this.builder.build({
        profile,
        resume,
        changeset: tailoring,
        evidence,
        language: selection.language,
        archetype,
      }),
      validation = this.validator.validateSpec(spec, {
        evidence,
        requireEvidence: this.policy.policy.requireEvidenceValidation,
      });
    if (!validation.valid)
      throw Object.assign(
        new Error(
          `ResumeSpec reprovado pela validacao factual: ${validation.errors.join("; ")}`,
        ),
        { code: "RESUME_SPEC_INVALID", validation },
      );
    this.eventBus?.emit("RESUME_TAILORING_STARTED", {
      resumeId,
      jobId,
      applicationId,
      templateId: template.id,
    });
    const version = this.versionService.createDraft({
      resumeId,
      parentVersionId: "",
      jobId,
      applicationId,
      purpose: jobId ? "JOB_SPECIFIC" : "GENERIC",
      batchRunId,
      batchItemId,
      templateId: template.id,
      templateVersion: template.version,
      archetypeId: archetype?.id || "GENERAL",
      archetypeVersion: archetype?.version || "general-v1",
      language: selection.language,
      resumeSpec: spec,
      contentHash: hashResumeSpec(spec),
      tailoringRunId: tailoring?.id || "",
      changeset: tailoring || {},
      atsBefore: analysis || {},
      parseability: {},
      algorithmMetadata: {
        builder: "resume-spec-v1",
        tailoringPolicy: "resume-tailoring-v1",
      },
      provenance: { source, batchRunId, batchItemId },
      source,
      status: "REVIEW_REQUIRED",
    });
    if (spec.normalization?.requiresReview && !version.reused)
      this.store.resumeNormalizationReviews?.create({
        resumeId,
        resumeVersionId: version.id,
        confidence: spec.normalization.confidence,
        warnings: spec.normalization.warnings,
        normalizedSnapshot: {
          sectionCounts: Object.fromEntries(
            [
              "experiences",
              "projects",
              "education",
              "certifications",
              "skills",
              "languages",
            ].map((key) => [key, spec[key]?.length || 0]),
          ),
        },
      });
    this.eventBus?.emit("RESUME_TAILORING_REVIEW_REQUIRED", {
      resumeVersionId: version.id,
      resumeId,
      jobId,
      templateId: template.id,
      atsBefore: Number(analysis?.overallScore || analysis?.score || 0),
    });
    return { ...version, validation, reused: Boolean(version.reused) };
  }
  approve(id) {
    let version = this.versionService.approve(id);
    if (version.tailoringRunId)
      this.store.resumeTailoring.linkApprovedVersion?.(
        version.tailoringRunId,
        version.id,
      );
    if (this.store.resumeArtifacts.latest(id, "PDF")?.status === "READY")
      version = this.store.resumeVersions.transition(id, "READY");
    this.eventBus?.emit("RESUME_VERSION_APPROVED", {
      resumeVersionId: version.id,
      resumeId: version.resumeId,
      jobId: version.jobId,
      templateId: version.templateId,
    });
    return version;
  }
  reject(id) {
    return this.versionService.reject(id);
  }
  archive(id) {
    return this.versionService.archive(id);
  }
  async revise(id, { resumeSpec } = {}) {
    const parent = this.store.resumeVersions.findById(id);
    if (!parent)
      throw Object.assign(new Error("Versao de curriculo nao encontrada."), {
        code: "RESUME_VERSION_NOT_FOUND",
        status: 404,
      });
    if (!resumeSpec || typeof resumeSpec !== "object" || Array.isArray(resumeSpec))
      throw Object.assign(new Error("O conteudo editado do curriculo e obrigatorio."), {
        code: "RESUME_SPEC_REQUIRED",
        status: 400,
      });
    const resume = this.store.resumes.findById(parent.resumeId),
      profile = await this.profileProvider(),
      analysis = parent.jobId
        ? this.store.analyses
            .all()
            .filter(
              (item) =>
                item.jobId === parent.jobId && item.resumeId === parent.resumeId,
            )
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
        : null,
      evidence = [
        ...(analysis?.candidateEvidence || []),
        ...buildResumeSourceEvidence(resume || {}, profile),
      ],
      validation = this.validator.validateSpec(resumeSpec, {
        evidence,
        requireEvidence: this.policy.policy.requireEvidenceValidation,
      });
    if (!validation.valid)
      throw Object.assign(
        new Error(
          "A edicao inclui informacoes sem evidencia confirmada. Ajuste o texto ou atualize o Conhecimento antes de salvar.",
        ),
        { code: "RESUME_SPEC_INVALID", status: 422, validation },
      );
    const version = this.versionService.createRevision(parent, {
      resumeSpec: structuredClone(resumeSpec),
      tailoringRunId: "",
      changeset: {
        changes: [],
        source: "USER_EDIT",
        parentVersionId: parent.id,
      },
      atsAfter: {},
      parseability: {},
      source: "USER_EDIT",
      provenance: {
        ...(parent.provenance || {}),
        source: "USER_EDIT",
        parentVersionId: parent.id,
      },
    });
    this.eventBus?.emit("RESUME_VERSION_EDITED", {
      resumeVersionId: version.id,
      parentVersionId: parent.id,
      resumeId: version.resumeId,
      jobId: version.jobId,
    });
    return { ...version, validation };
  }
  metrics() {
    const versions = this.store.resumeVersions.list(),
      runs = versions.flatMap((version) =>
        this.store.resumeRenderRuns.forVersion(version.id),
      ),
      exports = versions.flatMap((version) =>
        this.store.documentExports.forVersion(version.id),
      ),
      templateUsage = Object.fromEntries(
        [...new Set(versions.map((x) => x.templateId))].map((id) => [
          id,
          versions.filter((x) => x.templateId === id).length,
        ]),
      ),
      deltas = versions
        .map(
          (x) =>
            Number(x.atsAfter?.overallScore ?? x.atsAfter?.score ?? 0) -
            Number(x.atsBefore?.overallScore ?? x.atsBefore?.score ?? 0),
        )
        .filter(Number.isFinite),
      tailoringEvidenceFailures = this.store.database.connection
        .prepare(
          "SELECT COUNT(*) count FROM resume_tailoring_runs WHERE evidence_status='EVIDENCE_VIOLATION'",
        )
        .get().count,
      n8nDocumentEvents = this.store.database.connection
        .prepare(
          "SELECT COUNT(*) count FROM integration_outbox WHERE event_type LIKE 'RESUME_%' OR event_type='COVER_LETTER_READY'",
        )
        .get().count;
    return {
      versionCount: versions.length,
      tailoringCount: this.store.database.connection
        .prepare("SELECT COUNT(*) count FROM resume_tailoring_runs")
        .get().count,
      renderSuccessCount: runs.filter((x) => x.status === "COMPLETED").length,
      renderFailureCount: runs.filter((x) =>
        ["FAILED", "UNAVAILABLE"].includes(x.status),
      ).length,
      averageCompileMs: runs.length
        ? Math.round(
            runs.reduce((sum, x) => sum + x.durationMs, 0) / runs.length,
          )
        : 0,
      averageAtsDelta: deltas.length
        ? Number(
            (deltas.reduce((sum, x) => sum + x, 0) / deltas.length).toFixed(2),
          )
        : 0,
      templateUsage,
      evidenceFailureCount: tailoringEvidenceFailures,
      exportCount: exports.length,
      n8nDocumentEventCount: n8nDocumentEvents,
    };
  }
  async render(id, options = {}) {
    if (this.rendering.has(id)) {
      await this.rendering.get(id).catch(() => undefined);
      return this.render(id, options);
    }
    const work = (async () => {
      if (this.renderSlots >= 2) await new Promise(resolve => this.renderWaiters.push(resolve));
      else this.renderSlots++;
      try { return await this.renderDocument(id, options); }
      finally { const next = this.renderWaiters.shift(); if (next) next(); else this.renderSlots--; }
    })();
    this.rendering.set(id, work);
    try { return await work; }
    finally { if (this.rendering.get(id) === work) this.rendering.delete(id); }
  }
  async renderDocument(id, { pdf = true } = {}) {
    let version = this.store.resumeVersions.findById(id);
    if (!version)
      throw Object.assign(new Error("Versao nao encontrada."), {
        code: "RESUME_VERSION_NOT_FOUND",
      });
    const retryableFailure =
      version.status === "FAILED" && Boolean(version.approvedAt);
    if (!["APPROVED", "READY"].includes(version.status) && !retryableFailure)
      throw Object.assign(
        new Error("A versao precisa estar aprovada antes do render."),
        { code: "RESUME_VERSION_NOT_APPROVED" },
      );
    const existing = this.store.resumeArtifacts.latest(id, "PDF");
    if (!pdf && this.store.resumeArtifacts.latest(id, "LATEX_SOURCE")?.status === "READY")
      return { version, artifacts: this.store.resumeArtifacts.forVersion(id), reused: true, sourceOnly: true };
    if (version.status === "READY" && existing?.status === "READY")
      return {
        version,
        artifacts: this.store.resumeArtifacts.forVersion(id),
        reused: true,
      };
    const template = this.templates.get(
        version.templateId,
        version.templateVersion,
      ),
      rendered = this.renderer.render(version.resumeSpec, { template }),
      latexArtifact = await this.artifactService.write({
        resumeId: version.resumeId,
        resumeVersionId: id,
        artifactType: "LATEX_SOURCE",
        content: rendered.source,
        validation: { safe: true, templateVersion: template.version },
      });
    if (!pdf) return { version, artifacts: this.store.resumeArtifacts.forVersion(id), sourceOnly: true };
    const health = await this.compiler.health(),
      run = this.store.resumeRenderRuns.start({
        resumeVersionId: id,
        compiler: "tectonic",
        compilerVersion: health.version || "",
        manifest: {
          specHash: version.contentHash,
          texHash: latexArtifact.contentHash,
          template: { id: template.id, version: template.version },
        },
      });
    let workDir;
    try {
    version = this.store.resumeVersions.transition(id, "RENDERING");
    this.eventBus?.emit("RESUME_RENDER_STARTED", {
      resumeVersionId: id,
      resumeId: version.resumeId,
      templateId: version.templateId,
    });
    workDir = await this.artifactService.createRenderWorkDir(
        version.resumeId,
        id,
      );
    const workSource = path.join(workDir, "resume.tex");
    await this.writeSource(workSource, rendered.source, "utf8");
    const outputDir = this.artifactService.versionDir(version.resumeId, id);
    let compiled;
    try {
      compiled = await this.compiler.compile({
        sourcePath: workSource,
        outputDir,
        workDir,
      });
    } finally {
      await this.artifactService.cleanupWorkDir(workDir);
      workDir = null;
    }
    if (!compiled.ok) {
      const manifest = {
        specHash: version.contentHash,
        texHash: latexArtifact.contentHash,
        pdfHash: "",
        template: { id: template.id, version: template.version },
        compiler: { name: "tectonic", version: health.version || "" },
        renderedAt: new Date().toISOString(),
      };
      await this.artifactService.writeManifest(version.resumeId, id, manifest);
      this.store.resumeRenderRuns.finish(run.id, {
        status: compiled.status === "UNAVAILABLE" ? "UNAVAILABLE" : "FAILED",
        errorCode: compiled.errorCode,
        durationMs: compiled.durationMs,
        manifest,
        logExcerpt: compiled.log,
      });
      version = this.store.resumeVersions.transition(id, "FAILED");
      this.eventBus?.emit("RESUME_RENDER_FAILED", {
        resumeVersionId: id,
        resumeId: version.resumeId,
        templateId: version.templateId,
        errorCode: compiled.errorCode,
      });
      return {
        version,
        artifacts: this.store.resumeArtifacts.forVersion(id),
        errorCode: compiled.errorCode,
        compilerHealth: health,
      };
    }
    const pdfValidation = await this.pdfValidator.validate(compiled.pdfPath, {
      expectedName: version.resumeSpec.candidate?.fullName,
      requiredSections:
        version.language === "en"
          ? ["Experience", "Skills"]
          : ["Experiencia", "Competencias"],
      compilerLog: compiled.log,
    });
    if (!pdfValidation.valid) {
      this.store.resumeRenderRuns.finish(run.id, {
        status: "FAILED",
        errorCode: "PDF_VALIDATION_FAILED",
        durationMs: compiled.durationMs,
        manifest: {},
        logExcerpt: compiled.log,
      });
      version = this.store.resumeVersions.transition(id, "FAILED");
      this.eventBus?.emit("RESUME_RENDER_FAILED", {
        resumeVersionId: id,
        resumeId: version.resumeId,
        errorCode: "PDF_VALIDATION_FAILED",
      });
      return {
        version,
        artifacts: this.store.resumeArtifacts.forVersion(id),
        errorCode: "PDF_VALIDATION_FAILED",
        pdfValidation,
      };
    }
    const pdfArtifact = await this.artifactService.importFile({
        resumeId: version.resumeId,
        resumeVersionId: id,
        artifactType: "PDF",
        sourcePath: compiled.pdfPath,
        validation: pdfValidation,
      }),
      textArtifact = await this.artifactService.write({
        resumeId: version.resumeId,
        resumeVersionId: id,
        artifactType: "EXTRACTED_TEXT",
        content: pdfValidation.text,
        validation: { pageCount: pdfValidation.pageCount },
      }),
      job = version.jobId ? this.store.jobs.findById(version.jobId) : null,
      ats = this.atsValidator.evaluate({
        text: pdfValidation.text,
        spec: version.resumeSpec,
        job,
        profile: await this.profileProvider(),
        before: version.atsBefore,
      }),
      regression = this.policy.regression({
        before: version.atsBefore?.resumeParseability || {},
        after: ats.parseability,
        matchBefore: ats.comparison.beforeScore,
        matchAfter: ats.comparison.afterScore,
        essentialBefore: true,
        essentialAfter: Boolean(
          version.resumeSpec.experiences?.length &&
          version.resumeSpec.candidate?.fullName,
        ),
      }),
      status = regression.allowed ? "READY" : "REVIEW_REQUIRED",
      manifest = {
        specHash: version.contentHash,
        texHash: latexArtifact.contentHash,
        pdfHash: pdfArtifact.contentHash,
        template: { id: template.id, version: template.version },
        compiler: { name: "tectonic", version: compiled.compilerVersion || "" },
        renderedAt: new Date().toISOString(),
      };
    await this.artifactService.writeManifest(version.resumeId, id, manifest);
    this.store.database.transaction(()=>{
      this.store.resumeRenderRuns.finish(run.id, {
        status: "COMPLETED",
        durationMs: compiled.durationMs,
        manifest,
        logExcerpt: compiled.log,
      });
      version = this.store.resumeVersions.transition(id, status, {
        atsAfter: ats.match || { comparison: ats.comparison },
        parseability: ats.parseability,
      });
    });
    this.eventBus?.emit("RESUME_RENDER_READY", {
      resumeVersionId: id,
      resumeId: version.resumeId,
      jobId: version.jobId,
      templateId: version.templateId,
      atsBefore: ats.comparison.beforeScore,
      atsAfter: ats.comparison.afterScore,
      atsDelta: ats.comparison.delta,
      parseability: ats.parseability.score,
    });
    return {
      version,
      artifacts: [latexArtifact, pdfArtifact, textArtifact],
      pdfValidation,
      ats,
      regression,
      reused: false,
    };
    } catch (error) {
      const errorCode=/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code||"")?error.code:"RESUME_RENDER_INFRASTRUCTURE_FAILED";
      this.store.database.transaction(()=>this.store.resumeRenderRuns.failExecution(run.id,{errorCode}));
      this.store.structuredLogs?.record({category:"RESUME_RENDER",level:"ERROR",eventCode:"RESUME_RENDER_FAILED",resumeVersionId:id,correlationId:run.id,errorCode,metadata:{renderRunId:run.id}});
      if(workDir){try{await this.artifactService.cleanupWorkDir(workDir);}catch(cleanupError){this.store.structuredLogs?.record({category:"RESUME_RENDER",level:"ERROR",eventCode:"RESUME_RENDER_CLEANUP_FAILED",resumeVersionId:id,correlationId:run.id,errorCode:"RENDER_CLEANUP_FAILED",metadata:{renderRunId:run.id}});}}
      throw Object.assign(error,{code:errorCode,renderRunId:run.id});
    }
  }
}
