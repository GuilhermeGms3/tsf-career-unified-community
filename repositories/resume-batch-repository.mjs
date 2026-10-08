import { randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now = () => new Date().toISOString();
const RUN_STATES = new Set([
  "DRAFT",
  "ANALYZING",
  "AWAITING_SELECTION",
  "TAILORING",
  "AWAITING_REVIEW",
  "GENERATING",
  "PARTIAL_SUCCESS",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
const ITEM_TRANSITIONS = Object.freeze({
  SELECTED: ["ANALYZING", "CANCELLED", "BLOCKED"],
  ANALYZING: ["ANALYZED", "FAILED", "CANCELLED"],
  ANALYZED: ["BASE_SELECTED", "CANCELLED", "BLOCKED"],
  BASE_SELECTED: ["TAILORING", "CANCELLED", "BLOCKED"],
  TAILORING: ["TAILORING_REVIEW_REQUIRED", "FAILED", "CANCELLED"],
  TAILORING_REVIEW_REQUIRED: ["TAILORING_APPROVED", "CANCELLED", "BLOCKED"],
  TAILORING_APPROVED: ["BUILDING_VERSION", "CANCELLED"],
  BUILDING_VERSION: ["VERSION_REVIEW_REQUIRED", "FAILED", "CANCELLED"],
  VERSION_REVIEW_REQUIRED: ["VERSION_APPROVED", "CANCELLED", "BLOCKED"],
  VERSION_APPROVED: ["RENDERING", "READY", "CANCELLED"],
  RENDERING: ["READY", "VERSION_REVIEW_REQUIRED", "FAILED", "CANCELLED"],
  FAILED: [
    "ANALYZING",
    "TAILORING",
    "BUILDING_VERSION",
    "RENDERING",
    "CANCELLED",
  ],
  BLOCKED: ["BASE_SELECTED", "CANCELLED"],
  READY: [],
  CANCELLED: [],
});
const WORK_STATES = new Set([
  "ANALYZING",
  "TAILORING",
  "BUILDING_VERSION",
  "RENDERING",
]);

export class ResumeBatchRepository {
  constructor(connection, database) {
    Object.assign(this, { connection, database });
  }

  create(input) {
    return this.database.transaction(() => {
      const id = input.id || `resume-batch-${randomUUID()}`,
        timestamp = now();
      this.connection
        .prepare(
          `INSERT INTO resume_batch_runs(id,status,source,base_resume_id,comparison_resume_ids_json,requested_outputs_json,comparison_strategy,tailoring_policy_version,document_template_id,document_template_version,language,total_items,metadata_json,created_at,updated_at) VALUES(?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          input.source || "USER",
          input.baseResumeId,
          JSON.stringify(input.comparisonResumeIds || []),
          JSON.stringify(input.requestedOutputs || {}),
          input.comparisonStrategy || "BEST_EVIDENCE",
          input.tailoringPolicyVersion || "resume-tailoring-v1",
          input.documentTemplateId || "ATS_CLEAN",
          input.documentTemplateVersion || "",
          input.language || "pt-BR",
          input.jobIds.length,
          JSON.stringify(input.metadata || {}),
          timestamp,
          timestamp,
        );
      const insert = this.connection.prepare(
        `INSERT INTO resume_batch_items(id,batch_run_id,job_id,selected_base_resume_id,status,review_state,output_status_json,created_at,updated_at) VALUES(?,?,?,?,'SELECTED','PENDING','{}',?,?)`,
      );
      for (const jobId of input.jobIds)
        insert.run(
          `resume-batch-item-${randomUUID()}`,
          id,
          jobId,
          input.baseResumeId,
          timestamp,
          timestamp,
        );
      return this.findById(id);
    });
  }

  findById(id) {
    const row = this.connection
      .prepare("SELECT * FROM resume_batch_runs WHERE id=?")
      .get(id);
    if (!row) return null;
    return {
      ...this.mapRun(row),
      items: this.items(id),
      comparisons: this.comparisons(id),
    };
  }
  list(limit = 50) {
    return this.connection
      .prepare(
        "SELECT * FROM resume_batch_runs ORDER BY created_at DESC,rowid DESC LIMIT ?",
      )
      .all(Math.min(200, Math.max(1, Number(limit) || 50)))
      .map((row) => this.mapRun(row));
  }
  items(batchRunId) {
    return this.connection
      .prepare(
        "SELECT * FROM resume_batch_items WHERE batch_run_id=? ORDER BY created_at,rowid",
      )
      .all(batchRunId)
      .map((row) => this.mapItem(row));
  }
  findItem(id) {
    const row = this.connection
      .prepare("SELECT * FROM resume_batch_items WHERE id=?")
      .get(id);
    return row ? this.mapItem(row) : null;
  }
  comparisons(batchRunId) {
    return this.connection
      .prepare(
        "SELECT * FROM resume_batch_comparisons WHERE batch_run_id=? ORDER BY created_at,rowid",
      )
      .all(batchRunId)
      .map((row) => this.mapComparison(row));
  }
  comparisonsForItem(itemId) {
    return this.connection
      .prepare(
        "SELECT * FROM resume_batch_comparisons WHERE batch_item_id=? ORDER BY score DESC,created_at",
      )
      .all(itemId)
      .map((row) => this.mapComparison(row));
  }

  setRunStatus(id, status) {
    if (!RUN_STATES.has(status))
      throw Object.assign(new Error("Estado de batch inválido."), {
        code: "RESUME_BATCH_STATUS_INVALID",
      });
    const completedAt = [
      "PARTIAL_SUCCESS",
      "COMPLETED",
      "FAILED",
      "CANCELLED",
    ].includes(status)
      ? now()
      : null;
    this.connection
      .prepare(
        "UPDATE resume_batch_runs SET status=?,completed_at=?,updated_at=? WHERE id=?",
      )
      .run(status, completedAt, now(), id);
    return this.findById(id);
  }

  transitionItem(id, status, updates = {}, { allowSame = true } = {}) {
    const current = this.findItem(id);
    if (!current) return null;
    if (current.status === status && allowSame) return current;
    if (!(ITEM_TRANSITIONS[current.status] || []).includes(status))
      throw Object.assign(
        new Error(`Transição ${current.status} → ${status} não permitida.`),
        { code: "RESUME_BATCH_ITEM_TRANSITION_INVALID" },
      );
    const terminal = ["READY", "FAILED", "CANCELLED"].includes(status);
    this.connection
      .prepare(
        `UPDATE resume_batch_items SET status=?,recommended_resume_id=?,final_resume_id=?,analysis_id=?,tailoring_run_id=?,resume_version_id=?,review_state=?,output_status_json=?,failure_code=?,failure_message=?,locked_at=NULL,locked_by=NULL,completed_at=?,updated_at=? WHERE id=?`,
      )
      .run(
        status,
        updates.recommendedResumeId || current.recommendedResumeId || null,
        updates.finalResumeId || current.finalResumeId || null,
        updates.analysisId || current.analysisId || null,
        updates.tailoringRunId || current.tailoringRunId || null,
        updates.resumeVersionId || current.resumeVersionId || null,
        updates.reviewState || current.reviewState,
        JSON.stringify(updates.outputStatus ?? current.outputStatus ?? {}),
        updates.failureCode || null,
        String(updates.failureMessage || "").slice(0, 500) || null,
        terminal ? now() : null,
        now(),
        id,
      );
    this.refreshRun(current.batchRunId);
    return this.findItem(id);
  }

  chooseResume(itemId, resumeId) {
    const item = this.findItem(itemId);
    if (
      !item ||
      !["ANALYZED", "BASE_SELECTED", "BLOCKED"].includes(item.status)
    )
      return null;
    const comparison = this.connection
      .prepare("SELECT analysis_id FROM resume_batch_comparisons WHERE batch_item_id=? AND resume_id=? AND status='COMPLETED'")
      .get(itemId, resumeId);
    if (!comparison) return null;
    if (item.status === "ANALYZED")
      return this.transitionItem(itemId, "BASE_SELECTED", {
        finalResumeId: resumeId,
        analysisId: comparison.analysis_id,
        reviewState: "NOT_REQUIRED",
      });
    this.connection
      .prepare(
        "UPDATE resume_batch_items SET final_resume_id=?,analysis_id=?,status='BASE_SELECTED',review_state='NOT_REQUIRED',failure_code=NULL,failure_message=NULL,updated_at=? WHERE id=?",
      )
      .run(resumeId, comparison.analysis_id, now(), itemId);
    return this.findItem(itemId);
  }

  claim(status, workerId) {
    if (!WORK_STATES.has(status))
      throw new Error("Estado de trabalho inválido.");
    return this.database.transaction(() => {
      const row = this.connection
        .prepare(
          "SELECT id FROM resume_batch_items WHERE status=? AND locked_at IS NULL ORDER BY created_at,rowid LIMIT 1",
        )
        .get(status);
      if (!row) return null;
      const timestamp = now(),
        changed = this.connection
          .prepare(
            "UPDATE resume_batch_items SET locked_at=?,locked_by=?,updated_at=? WHERE id=? AND status=? AND locked_at IS NULL",
          )
          .run(timestamp, workerId, timestamp, row.id, status);
      return changed.changes ? this.findItem(row.id) : null;
    });
  }

  release(id) {
    this.connection
      .prepare(
        "UPDATE resume_batch_items SET locked_at=NULL,locked_by=NULL,updated_at=? WHERE id=?",
      )
      .run(now(), id);
  }
  recover(staleBefore) {
    return this.connection
      .prepare(
        "UPDATE resume_batch_items SET locked_at=NULL,locked_by=NULL,failure_code=COALESCE(failure_code,'WORKER_CRASH_RECOVERY'),updated_at=? WHERE locked_at IS NOT NULL AND locked_at<? AND status IN ('ANALYZING','TAILORING','BUILDING_VERSION','RENDERING')",
      )
      .run(now(), staleBefore).changes;
  }

  startComparing(batchRunId) {
    return this.database.transaction(() => {
      const batch = this.findById(batchRunId);
      if (!batch) return null;
      const pending = batch.items.filter((x) => x.status === "SELECTED");
      if (!pending.length) return batch;
      for (const item of pending)
        this.transitionItem(item.id, "ANALYZING");
      return this.setRunStatus(batchRunId, "ANALYZING");
    });
  }
  startTailoring(batchRunId, itemIds = []) {
    return this.database.transaction(() => {
      const selected = new Set(itemIds);
      const pending = this.items(batchRunId).filter(
        (x) =>
          (!selected.size || selected.has(x.id)) &&
          x.status === "BASE_SELECTED",
      );
      if (!pending.length) return this.findById(batchRunId);
      for (const item of pending)
        this.transitionItem(item.id, "TAILORING");
      return this.setRunStatus(batchRunId, "TAILORING");
    });
  }
  startBuilding(itemId) {
    return this.transitionItem(itemId, "BUILDING_VERSION", {
      reviewState: "APPROVED",
    });
  }
  startRendering(itemId) {
    return this.transitionItem(itemId, "RENDERING", {
      reviewState: "APPROVED",
    });
  }

  upsertComparison(input) {
    const existing = this.connection
      .prepare(
        "SELECT id,identity_key FROM resume_batch_comparisons WHERE batch_run_id=? AND job_id=? AND resume_id=?",
      )
      .get(input.batchRunId, input.jobId, input.resumeId);
    if (existing) {
      if (existing.identity_key !== input.identityKey)
        this.connection.prepare("UPDATE resume_batch_comparisons SET identity_key=?,status='RUNNING',analysis_id=NULL,score=NULL,result_json='{}',reused=0,updated_at=? WHERE id=?").run(input.identityKey, now(), existing.id);
      return this.findComparison(existing.id);
    }
    const id = `resume-batch-comparison-${randomUUID()}`,
      timestamp = now();
    this.connection
      .prepare(
        `INSERT INTO resume_batch_comparisons(id,batch_run_id,batch_item_id,job_id,resume_id,identity_key,status,result_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'RUNNING','{}',?,?)`,
      )
      .run(
        id,
        input.batchRunId,
        input.batchItemId,
        input.jobId,
        input.resumeId,
        input.identityKey,
        timestamp,
        timestamp,
      );
    return this.findComparison(id);
  }
  findComparison(id) {
    const row = this.connection
      .prepare("SELECT * FROM resume_batch_comparisons WHERE id=?")
      .get(id);
    return row ? this.mapComparison(row) : null;
  }
  findCachedComparison(identityKey) {
    const row = this.connection
      .prepare(
        "SELECT * FROM resume_batch_comparisons WHERE identity_key=? AND status='COMPLETED' ORDER BY completed_at DESC,rowid DESC LIMIT 1",
      )
      .get(identityKey);
    return row ? this.mapComparison(row) : null;
  }
  finishComparison(
    id,
    {
      analysisId = "",
      score = null,
      result = {},
      reused = false,
      error = null,
    } = {},
  ) {
    const status = error ? "FAILED" : "COMPLETED",
      timestamp = now();
    this.connection
      .prepare(
        "UPDATE resume_batch_comparisons SET status=?,analysis_id=?,score=?,result_json=?,reused=?,failure_code=?,failure_message=?,completed_at=?,updated_at=? WHERE id=?",
      )
      .run(
        status,
        analysisId || null,
        score,
        JSON.stringify(result),
        reused ? 1 : 0,
        error?.code || null,
        String(error?.message || "").slice(0, 500) || null,
        timestamp,
        timestamp,
        id,
      );
    return this.findComparison(id);
  }

  refreshRun(id) {
    const rows = this.items(id),
      completed = rows.filter((x) => x.status === "READY").length,
      failed = rows.filter((x) => x.status === "FAILED").length,
      reviews = rows.filter((x) =>
        [
          "TAILORING_REVIEW_REQUIRED",
          "VERSION_REVIEW_REQUIRED",
          "BLOCKED",
        ].includes(x.status),
      ).length;
    this.connection
      .prepare(
        "UPDATE resume_batch_runs SET completed_items=?,failed_items=?,review_required_items=?,updated_at=? WHERE id=?",
      )
      .run(completed, failed, reviews, now(), id);
    const active = rows.some((x) => WORK_STATES.has(x.status)),
      terminal = rows.every((x) =>
        ["READY", "FAILED", "CANCELLED"].includes(x.status),
      );
    if (terminal)
      this.setRunStatus(
        id,
        completed === rows.length
          ? "COMPLETED"
          : completed
            ? "PARTIAL_SUCCESS"
            : failed
              ? "FAILED"
              : "CANCELLED",
      );
    else {
      const status = active
        ? rows.some(x => x.status === "ANALYZING") ? "ANALYZING" : rows.some(x => x.status === "TAILORING") ? "TAILORING" : "GENERATING"
        : reviews ? "AWAITING_REVIEW"
        : rows.some(x => ["ANALYZED", "BASE_SELECTED"].includes(x.status)) ? "AWAITING_SELECTION"
        : rows.some(x => x.status === "VERSION_APPROVED") ? "GENERATING" : "DRAFT";
      this.connection.prepare("UPDATE resume_batch_runs SET status=?,completed_at=NULL,updated_at=? WHERE id=?").run(status, now(), id);
    }
  }

  mapRun(r) {
    return {
      id: r.id,
      status: r.status,
      source: r.source,
      baseResumeId: r.base_resume_id,
      comparisonResumeIds: parseJson(r.comparison_resume_ids_json, []),
      requestedOutputs: parseJson(r.requested_outputs_json, {}),
      comparisonStrategy: r.comparison_strategy,
      tailoringPolicyVersion: r.tailoring_policy_version,
      documentTemplateId: r.document_template_id,
      documentTemplateVersion: r.document_template_version,
      language: r.language,
      totalItems: r.total_items,
      completedItems: r.completed_items,
      failedItems: r.failed_items,
      reviewRequiredItems: r.review_required_items,
      metadata: parseJson(r.metadata_json, {}),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || "",
    };
  }
  mapItem(r) {
    return {
      id: r.id,
      batchRunId: r.batch_run_id,
      jobId: r.job_id,
      selectedBaseResumeId: r.selected_base_resume_id || "",
      recommendedResumeId: r.recommended_resume_id || "",
      finalResumeId: r.final_resume_id || "",
      analysisId: r.analysis_id || "",
      tailoringRunId: r.tailoring_run_id || "",
      resumeVersionId: r.resume_version_id || "",
      status: r.status,
      reviewState: r.review_state,
      outputStatus: parseJson(r.output_status_json, {}),
      failureCode: r.failure_code || "",
      failureMessage: r.failure_message || "",
      lockedAt: r.locked_at || "",
      lockedBy: r.locked_by || "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || "",
    };
  }
  mapComparison(r) {
    return {
      id: r.id,
      batchRunId: r.batch_run_id,
      batchItemId: r.batch_item_id,
      jobId: r.job_id,
      resumeId: r.resume_id,
      identityKey: r.identity_key,
      status: r.status,
      analysisId: r.analysis_id || "",
      score: r.score,
      result: parseJson(r.result_json, {}),
      reused: Boolean(r.reused),
      failureCode: r.failure_code || "",
      failureMessage: r.failure_message || "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      completedAt: r.completed_at || "",
    };
  }
}

export const RESUME_BATCH_ITEM_TRANSITIONS = ITEM_TRANSITIONS;
