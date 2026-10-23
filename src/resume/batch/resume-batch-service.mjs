import { createHash } from "node:crypto";
import { tailoringQuality } from "../../intelligence/tasks/resume-tailor.mjs";

const MAX_BATCH_SIZE = 25;
const OUTPUTS = new Set(["pdf", "latex", "overleaf"]);

export class ResumeBatchService {
  constructor({
    store,
    resumeSelector,
    comparisonService,
    tailor,
    resumeService,
    documentExportService,
    profileProvider,
    logger = null,
  } = {}) {
    Object.assign(this, {
      store,
      resumeSelector,
      comparisonService,
      resumeService,
      documentExportService,
      profileProvider,
      logger,
    });
    this.tailorEngine = tailor;
  }

  create(input = {}) {
    const jobIds = uniqueIds(input.jobIds, "jobIds"),
      comparisonResumeIds = uniqueIds(
        input.comparisonResumeIds || [],
        "comparisonResumeIds",
      ),
      baseResumeId = cleanId(input.baseResumeId);
    if (!jobIds.length)
      throw invalid(
        "Selecione ao menos uma oportunidade.",
        "RESUME_BATCH_JOBS_REQUIRED",
      );
    if (jobIds.length > MAX_BATCH_SIZE)
      throw invalid(
        `O limite seguro inicial é de ${MAX_BATCH_SIZE} oportunidades por batch.`,
        "RESUME_BATCH_LIMIT_EXCEEDED",
      );
    if (new Set([baseResumeId, ...comparisonResumeIds]).size > 10)
      throw invalid("Compare no máximo 10 currículos por lote.", "RESUME_BATCH_COMPARISON_LIMIT_EXCEEDED");
    const baseResume = baseResumeId ? this.store.resumes.findById(baseResumeId) : null,
      approvedBaseId = this.store.database?.getMetadata?.("default_resume_id", "") || "";
    if (!baseResume || baseResume.resumeKind !== "BASE" || baseResume.id !== approvedBaseId)
      throw invalid(
        "Selecione a BASE 01 aprovada. Os demais currículos são somente fontes de conhecimento.",
        "RESUME_BATCH_BASE_RESUME_INVALID",
      );
    for (const id of jobIds)
      if (!this.store.jobs.findById(id))
        throw invalid(
          `Oportunidade não encontrada: ${id}`,
          "RESUME_BATCH_JOB_NOT_FOUND",
        );
    for (const id of comparisonResumeIds)
      if (!this.store.resumes.findById(id))
        throw invalid(
          `Currículo de comparação não encontrado: ${id}`,
          "RESUME_BATCH_RESUME_NOT_FOUND",
        );
    const requestedOutputs = normalizeOutputs(input.requestedOutputs),
      templateId = cleanId(input.documentTemplateId || "BASE_01"),
      language = input.language || "pt-BR",afterReady=input.afterReady||"PREPARE_ONLY";
    if (!["pt-BR", "en"].includes(language))
      throw invalid("Idioma não suportado.", "RESUME_BATCH_LANGUAGE_INVALID");
    if(!["PREPARE_ONLY","REVIEW_OR_AUTOAPPLY"].includes(afterReady))throw invalid("Destino após a preparação inválido.","RESUME_BATCH_AFTER_READY_INVALID");
    this.resumeService.templates.get(
      templateId,
      input.documentTemplateVersion || "",
    );
    const batch = this.store.resumeBatches.create({
      jobIds,
      baseResumeId,
      comparisonResumeIds: [...new Set([baseResumeId, ...comparisonResumeIds])],
      requestedOutputs,
      comparisonStrategy: "BEST_EVIDENCE",
      tailoringPolicyVersion: "resume-tailoring-v1",
      documentTemplateId: templateId,
      documentTemplateVersion: cleanId(input.documentTemplateVersion),
      language,
      metadata: {
        acknowledgedBlockedJobIds: uniqueIds(
          input.acknowledgedBlockedJobIds || [],
          "acknowledgedBlockedJobIds",
        ),
        afterReady,
        autoApproveSafe: input.autoApproveSafe === true,
      },
    });
    this.log("RESUME_BATCH_CREATED", batch, { resultCount: batch.totalItems });
    return batch;
  }
  list() {
    return this.store.resumeBatches.list();
  }
  get(id) {
    const batch = this.store.resumeBatches.findById(id);
    if (!batch) throw notFound();
    return this.hydrate(batch);
  }
  compare(id) {
    const batch = this.store.resumeBatches.startComparing(id);
    if (!batch) throw notFound();
    this.workers?.analysis?.schedule();
    this.log("RESUME_BATCH_COMPARISON_QUEUED", batch);
    return this.hydrate(batch);
  }
  select(id, selections = []) {
    const batch = this.store.resumeBatches.findById(id);
    if (!batch) throw notFound();
    if (!Array.isArray(selections))
      throw invalid("Seleções inválidas.", "RESUME_BATCH_SELECTIONS_INVALID");
    for (const selection of selections) {
      const item = batch.items.find((x) => x.id === cleanId(selection.itemId)),
        resumeId = cleanId(selection.resumeId);
      if (
        !item ||
        !this.store.resumes.findById(resumeId) ||
        !this.store.resumeBatches
          .comparisonsForItem(item.id)
          .some((x) => x.resumeId === resumeId && x.status === "COMPLETED")
      )
        throw invalid(
          "Seleção de currículo incompatível com a matriz.",
          "RESUME_BATCH_SELECTION_INVALID",
        );
      if (!["ANALYZED", "BASE_SELECTED", "BLOCKED"].includes(item.status)) {
        if (item.finalResumeId === resumeId) continue;
        throw invalid("A seleção deste item já foi confirmada.", "RESUME_BATCH_SELECTION_LOCKED");
      }
      this.store.resumeBatches.chooseResume(item.id, resumeId);
    }
    this.store.resumeBatches.refreshRun(id);
    return this.get(id);
  }
  tailor(id, itemIds = []) {
    const batch = this.store.resumeBatches.startTailoring(id, uniqueIds(itemIds, "itemIds"));
    if (!batch) throw notFound();
    this.workers?.tailoring?.schedule();
    this.log("RESUME_BATCH_TAILORING_QUEUED", batch);
    return this.get(id);
  }
  approve(id, { phase, itemIds = [], state = "APPROVED" } = {}) {
    if (!["TAILORING", "VERSION"].includes(phase))
      throw invalid("Fase de revisão inválida.", "RESUME_BATCH_REVIEW_INVALID");
    if (!["APPROVED", "REJECTED"].includes(state))
      throw invalid("Revisão inválida.", "RESUME_BATCH_REVIEW_INVALID");
    const batch = this.store.resumeBatches.findById(id);
    if (!batch) throw notFound();
    const selected = new Set(uniqueIds(itemIds, "itemIds"));
    let changed = false;
    for (const item of batch.items.filter(
      (x) => !selected.size || selected.has(x.id),
    )) {
      if (
        phase === "TAILORING" &&
        item.status === "TAILORING_REVIEW_REQUIRED"
      ) {
        const tailoring = this.store.resumeTailoring.findRun(item.tailoringRunId),
          quality = tailoringQuality(tailoring);
        if (
          state === "APPROVED" &&
          !quality.allowed
        ) {
          this.store.resumeBatches.transitionItem(item.id, "BLOCKED", {
            reviewState: "REVIEW_REQUIRED",
            failureCode: quality.reasons[0],
            failureMessage: quality.reasons.includes("ATS_MATCH_REGRESSION")
              ? "O currículo ajustado reduziu a compatibilidade com a vaga."
              : quality.reasons.some((reason) => reason.startsWith("EVIDENCE_"))
                ? "EvidenceGuard bloqueou uma ou mais afirmações."
                : "O currículo não passou pelo gate de qualidade editorial.",
          });
          changed = true;
          continue;
        }
        if (state === "REJECTED") {
          this.store.resumeTailoring.review(item.tailoringRunId, "REJECTED");
          this.store.resumeBatches.transitionItem(item.id, "CANCELLED", {
            reviewState: "REJECTED",
          });
          changed = true;
        } else {
          this.store.resumeTailoring.review(item.tailoringRunId, "APPROVED");
          this.store.resumeBatches.transitionItem(
            item.id,
            "TAILORING_APPROVED",
            { reviewState: "APPROVED" },
          );
          this.store.resumeBatches.startBuilding(item.id);
          changed = true;
        }
      } else if (
        phase === "VERSION" &&
        item.status === "VERSION_REVIEW_REQUIRED"
      ) {
        if (state === "REJECTED") {
          this.resumeService.reject(item.resumeVersionId);
          this.store.resumeBatches.transitionItem(item.id, "CANCELLED", {
            reviewState: "REJECTED",
          });
          changed = true;
        } else {
          this.resumeService.approve(item.resumeVersionId);
          this.store.resumeBatches.transitionItem(item.id, "VERSION_APPROVED", {
            reviewState: "APPROVED",
          });
          changed = true;
        }
      }
    }
    if (!changed) return this.get(id);
    if (phase === "TAILORING" && state === "APPROVED")
      this.workers?.build?.schedule();
    this.store.resumeBatches.refreshRun(id);
    return this.get(id);
  }
  render(id, itemIds = []) {
    const batch = this.store.resumeBatches.findById(id);
    if (!batch) throw notFound();
    const selected = new Set(uniqueIds(itemIds, "itemIds"));
    const pending = batch.items.filter(
      (x) =>
        (!selected.size || selected.has(x.id)) &&
        x.status === "VERSION_APPROVED",
    );
    if (!pending.length) return this.get(id);
    for (const item of pending)
      this.store.resumeBatches.startRendering(item.id);
    this.store.resumeBatches.setRunStatus(id, "GENERATING");
    this.workers?.render?.schedule();
    return this.get(id);
  }
  retry(id, itemIds = []) {
    const batch = this.store.resumeBatches.findById(id);
    if (!batch) throw notFound();
    const selected = new Set(uniqueIds(itemIds, "itemIds"));
    for (const item of batch.items.filter(
      (x) => x.status === "FAILED" && (!selected.size || selected.has(x.id)),
    )) {
      const target = item.resumeVersionId
        ? "RENDERING"
        : item.tailoringRunId
          ? "BUILDING_VERSION"
          : item.analysisId
            ? "TAILORING"
            : "ANALYZING";
      this.store.resumeBatches.transitionItem(item.id, target, {
        failureCode: "",
        failureMessage: "",
      });
      this.workers?.[
        target === "ANALYZING"
          ? "analysis"
          : target === "TAILORING"
            ? "tailoring"
            : target === "BUILDING_VERSION"
              ? "build"
              : "render"
      ]?.schedule();
    }
    return this.get(id);
  }
  cancel(id) {
    const batch = this.store.resumeBatches.findById(id);
    if (!batch) throw notFound();
    if (["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"].includes(batch.status))
      return this.get(id);
    for (const item of batch.items)
      if (!["READY", "FAILED", "CANCELLED"].includes(item.status))
        this.store.resumeBatches.transitionItem(item.id, "CANCELLED", {
          reviewState: "REJECTED",
        });
    return this.store.resumeBatches.setRunStatus(id, "CANCELLED");
  }
  attachWorkers(workers) {
    this.workers = workers;
  }
  attachReadyDispatcher(dispatcher){this.readyDispatcher=dispatcher;}

  async analyzeItem(item) {
    const batch = this.store.resumeBatches.findById(item.batchRunId),
      resumeIds = [
        ...new Set([batch.baseResumeId, ...batch.comparisonResumeIds]),
      ],
      results = await this.comparisonService.compare(item, resumeIds),
      completed = results
        .filter((x) => x.status === "COMPLETED")
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
    if (!completed.length)
      throw Object.assign(new Error("Nenhuma comparação foi concluída."), {
        code: "RESUME_BATCH_COMPARISON_FAILED",
      });
    const recommendation = this.resumeSelector?.select?.({
      job: this.store.jobs.findById(item.jobId),
      resumes: completed.map(result => this.store.resumes.findById(result.resumeId)).filter(Boolean),
      analyses: completed.map(result => this.store.analyses.findById(result.analysisId)).filter(Boolean),
    });
    this.store.resumeBatches.transitionItem(item.id, "ANALYZED", {
      recommendedResumeId: recommendation?.selectedResumeId || completed[0].resumeId,
      analysisId: completed[0].analysisId,
    });
    const current = this.store.resumeBatches.findById(item.batchRunId);
    if (!current.items.some((x) => x.status === "ANALYZING"))
      this.store.resumeBatches.setRunStatus(
        item.batchRunId,
        "AWAITING_SELECTION",
      );
    this.log("RESUME_BATCH_ITEM_ANALYZED", current, {
      batchItemId: item.id,
      jobId: item.jobId,
      resumeId: completed[0].resumeId,
      resultCount: completed.length,
    });
  }
  async tailorItem(item) {
    const batch = this.store.resumeBatches.findById(item.batchRunId),
      job = this.store.jobs.findById(item.jobId),
      resume = this.store.resumes.findById(item.finalResumeId),
      analysis = this.store.analyses.findById(item.analysisId),
      profile = await this.profileProvider();
    if (job?.lifecycleStatus === "CLOSED") {
      this.store.resumeBatches.transitionItem(item.id, "CANCELLED", { failureCode: "JOB_CLOSED", failureMessage: "Vaga encerrada no portal; currículo não será preparado." });
      return;
    }
    const runId = `batch-tailoring-${createHash("sha256").update(`${item.id}:${item.finalResumeId}:${item.analysisId}`).digest("hex")}`;
    const existing = this.store.resumeTailoring.findRun(runId);
    if (existing) {
      this.store.resumeBatches.transitionItem(item.id, "TAILORING_REVIEW_REQUIRED", { tailoringRunId: existing.id, reviewState: "REVIEW_REQUIRED" });
      if (batch.metadata?.autoApproveSafe && existing.evidenceStatus === "VALID" && existing.quality?.status === "PASS" && tailoringQuality(existing).allowed)
        this.approve(batch.id, { phase: "TAILORING", itemIds: [item.id] });
      return;
    }
    const result = await this.tailorEngine.tailor({
      job,
      requirements: this.store.jobRequirements.forJob(job.id),
      resume: { ...resume, sections: resume.sections || {} },
      evidence: analysis?.candidateEvidence || [],
      originalScore: analysis?.overallScore ?? analysis?.score ?? null,
      scoreEvaluator: (tailored) =>
        this.comparisonService.matcher({ job, profile, resume: tailored })
          .overallScore,
    });
    if (this.store.resumeBatches.findItem(item.id)?.status !== "TAILORING") return;
    this.store.database.transaction(() => {
    const run = this.store.resumeTailoring.createRun({
      id: runId,
      jobId: job.id,
      resumeId: resume.id,
      analysisId: analysis?.id,
      state: "REVIEW_REQUIRED",
      originalScore: result.originalScore,
      tailoredScore: result.tailoredScore,
      evidenceStatus: result.evidenceStatus,
      promptVersion: result.promptVersion,
      schemaVersion: result.schemaVersion,
      quality: result.quality,
      changes: result.changes,
    });
    this.log("RESUME_BATCH_ITEM_TAILORED", this.store.resumeBatches.findById(item.batchRunId), {batchItemId:item.id,jobId:item.jobId,resumeId:item.finalResumeId});
    this.store.resumeBatches.transitionItem(
      item.id,
      "TAILORING_REVIEW_REQUIRED",
      { tailoringRunId: run.id, reviewState: "REVIEW_REQUIRED" },
    );
    });
    if (batch.metadata?.autoApproveSafe) {
      const run = this.store.resumeTailoring.findRun(runId);
      if (run.evidenceStatus === "VALID" && run.quality?.status === "PASS" && tailoringQuality(run).allowed)
        this.approve(batch.id, { phase: "TAILORING", itemIds: [item.id] });
    }
  }
  async buildItem(item) {
    const batch = this.store.resumeBatches.findById(item.batchRunId),
      version = await this.resumeService.prepare({
        resumeId: item.finalResumeId,
        jobId: item.jobId,
        templateId: batch.documentTemplateId,
        templateVersion: batch.documentTemplateVersion,
        language: batch.language,
        tailoringRunId: item.tailoringRunId,
        batchRunId: batch.id,
        batchItemId: item.id,
        source: "RESUME_BATCH",
      });
    this.store.resumeBatches.transitionItem(
      item.id,
      "VERSION_REVIEW_REQUIRED",
      { resumeVersionId: version.id, reviewState: "REVIEW_REQUIRED" },
    );
    this.log("RESUME_BATCH_VERSION_BUILT", batch, {batchItemId:item.id,jobId:item.jobId,resumeId:item.finalResumeId});
    if (batch.metadata?.autoApproveSafe) {
      const run = this.store.resumeTailoring.findRun(item.tailoringRunId);
      if (run?.evidenceStatus === "VALID" && run.quality?.status === "PASS" && tailoringQuality(run).allowed) {
        this.approve(batch.id, { phase: "VERSION", itemIds: [item.id] });
        this.render(batch.id, [item.id]);
      }
    }
  }
  async renderItem(item) {
    const batch = this.store.resumeBatches.findById(item.batchRunId),
      rendered = await this.resumeService.render(item.resumeVersionId, { pdf: Boolean(batch.requestedOutputs.pdf) }),
      outputStatus = {
        latex: !batch.requestedOutputs.latex ? "NOT_REQUESTED" :
          this.store.resumeArtifacts.latest(
            item.resumeVersionId,
            "LATEX_SOURCE",
          )?.status || "UNAVAILABLE",
        pdf: !batch.requestedOutputs.pdf ? "NOT_REQUESTED" :
          this.store.resumeArtifacts.latest(item.resumeVersionId, "PDF")
            ?.status || "UNAVAILABLE",
        overleaf: "NOT_REQUESTED",
      };
    if (rendered.version.status === "REVIEW_REQUIRED") {
      this.store.resumeBatches.transitionItem(
        item.id,
        "VERSION_REVIEW_REQUIRED",
        { reviewState: "REVIEW_REQUIRED", outputStatus },
      );
      return;
    }
    if (rendered.errorCode)
      throw Object.assign(new Error(rendered.errorCode), {
        code: rendered.errorCode,
      });
    if (batch.requestedOutputs.overleaf) {
      const exported = await this.documentExportService.export(
        item.resumeVersionId,
        "OVERLEAF",
      );
      outputStatus.overleaf = exported.status;
    }
    this.store.resumeBatches.transitionItem(item.id, "READY", {
      outputStatus,
      reviewState: "APPROVED",
    });
    this.log("RESUME_BATCH_ITEM_READY", this.store.resumeBatches.findById(item.batchRunId), {batchItemId:item.id,jobId:item.jobId,resumeId:item.finalResumeId});
    if(batch.metadata?.afterReady==="REVIEW_OR_AUTOAPPLY"&&this.readyDispatcher){
      try{await this.readyDispatcher({jobId:item.jobId,resumeVersionId:item.resumeVersionId,batchRunId:batch.id,batchItemId:item.id});this.log("RESUME_BATCH_APPLICATION_DISPATCHED",this.store.resumeBatches.findById(item.batchRunId),{batchItemId:item.id,jobId:item.jobId,resumeVersionId:item.resumeVersionId});}
      catch(error){this.log("RESUME_BATCH_APPLICATION_DISPATCH_FAILED",this.store.resumeBatches.findById(item.batchRunId),{batchItemId:item.id,jobId:item.jobId,resumeVersionId:item.resumeVersionId,failureCode:error.code||"APPLICATION_DISPATCH_FAILED"});}
    }
  }
  hydrate(batch) {
    return {
      ...batch,
      resumes: [...new Set([batch.baseResumeId, ...batch.comparisonResumeIds])].map(id => this.store.resumes.findById(id)).filter(Boolean).map(({id, title}) => ({id, title})),
      items: batch.items.map((item) => ({
        ...item,
        job: this.store.jobs.findById(item.jobId),
        selectedResume: this.store.resumes.findById(
          item.finalResumeId ||
            item.selectedBaseResumeId,
        ),
        tailoring: item.tailoringRunId
          ? this.store.resumeTailoring.findRun(item.tailoringRunId)
          : null,
        version: item.resumeVersionId
          ? this.store.resumeVersions.findById(item.resumeVersionId)
          : null,
        comparisons: this.store.resumeBatches.comparisonsForItem(item.id),
      })),
    };
  }
  log(event, batch, extra = {}) {
    this.logger?.recordMany([
      {
        category: "RESUME_BATCH",
        event,
        message: event.replaceAll("_", " "),
        runId: batch.id,
        batchRunId: batch.id,
        status: batch.status,
        ...extra,
      },
    ]);
  }
}

function cleanId(value) {
  const id = String(value || "").trim();
  if (id && !/^[A-Za-z0-9._:-]{1,200}$/.test(id))
    throw invalid("Identificador inválido.", "RESUME_BATCH_ID_INVALID");
  return id;
}
function uniqueIds(value, field) {
  if (!Array.isArray(value))
    throw invalid(`${field} deve ser uma lista.`, "RESUME_BATCH_ARRAY_INVALID");
  return [...new Set(value.map(cleanId).filter(Boolean))];
}
function normalizeOutputs(value = {}) {
  const requested = Array.isArray(value)
    ? value
    : Object.entries(value)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
  if (!requested.length) requested.push("pdf", "latex");
  for (const name of requested)
    if (!OUTPUTS.has(name))
      throw invalid(
        `Formato de saída inválido: ${name}`,
        "RESUME_BATCH_OUTPUT_INVALID",
      );
  return Object.fromEntries(
    [...OUTPUTS].map((name) => [name, requested.includes(name)]),
  );
}
function invalid(message, code) {
  return Object.assign(new Error(message), { code, status: 400 });
}
function notFound() {
  return Object.assign(new Error("Batch de currículos não encontrado."), {
    code: "RESUME_BATCH_NOT_FOUND",
    status: 404,
  });
}
export { MAX_BATCH_SIZE };
