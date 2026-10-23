import { createHash, randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now = () => new Date().toISOString();
const parse = (value, fallback) => parseJson(value, fallback);
const jobIdentity = (type, payload) => createHash("sha256").update(JSON.stringify(type === "BUILD_SPEC" ? [type,payload.resumeId,payload.jobId||"",payload.tailoringRunId||"",payload.templateId||"",payload.templateVersion||"",payload.language||""] : type === "RENDER" ? [type,payload.resumeVersionId,payload.rendererVersion||"tectonic-v1"] : [type,payload.resumeVersionId,payload.destination||"LOCAL",payload.exportVersion||"v1"])).digest("hex");

export class ResumeVersionRepository {
  constructor(connection) {
    this.connection = connection;
  }
  create(item) {
    const id = item.id || `resume-version-${randomUUID()}`,
      t = item.createdAt || now(),
      purpose = item.purpose || (item.jobId ? "JOB_SPECIFIC" : "GENERIC");
    this.connection
      .prepare(
        `INSERT INTO resume_versions(id,resume_id,parent_version_id,job_id,application_id,template_id,template_version,archetype_id,archetype_version,language,status,content_hash,resume_spec_json,tailoring_run_id,changeset_json,ats_before_json,ats_after_json,parseability_json,source,approved_at,created_at,updated_at,purpose,batch_run_id,batch_item_id,algorithm_metadata_json,provenance_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        item.resumeId,
        item.parentVersionId || null,
        item.jobId || null,
        item.applicationId || null,
        item.templateId,
        item.templateVersion,
        item.archetypeId || null,
        item.archetypeVersion || null,
        item.language || "pt-BR",
        item.status || "DRAFT",
        item.contentHash,
        JSON.stringify(item.resumeSpec),
        item.tailoringRunId || null,
        JSON.stringify(item.changeset || {}),
        JSON.stringify(item.atsBefore || {}),
        JSON.stringify(item.atsAfter || {}),
        JSON.stringify(item.parseability || {}),
        item.source || "USER",
        item.approvedAt || null,
        t,
        t,
        purpose,
        item.batchRunId || null,
        item.batchItemId || null,
        JSON.stringify(item.algorithmMetadata || {}),
        JSON.stringify(item.provenance || {}),
      );
    return this.findById(id);
  }
  findById(id) {
    const r = this.connection
      .prepare("SELECT * FROM resume_versions WHERE id=?")
      .get(id);
    return r ? this.map(r) : null;
  }
  findEquivalent({
    resumeId,
    jobId = "",
    purpose = "",
    contentHash,
    templateId,
    templateVersion,
    language,
  }) {
    const resolvedPurpose = purpose || (jobId ? "JOB_SPECIFIC" : "GENERIC"),
      r =
        resolvedPurpose === "JOB_SPECIFIC"
          ? this.connection
              .prepare(
                "SELECT * FROM resume_versions WHERE purpose='JOB_SPECIFIC' AND resume_id=? AND job_id=? AND content_hash=? AND template_id=? AND template_version=? AND language=? ORDER BY created_at DESC LIMIT 1",
              )
              .get(
                resumeId,
                jobId,
                contentHash,
                templateId,
                templateVersion,
                language,
              )
          : this.connection
              .prepare(
                "SELECT * FROM resume_versions WHERE purpose='GENERIC' AND resume_id=? AND content_hash=? AND template_id=? AND template_version=? AND language=? ORDER BY created_at DESC LIMIT 1",
              )
              .get(
                resumeId,
                contentHash,
                templateId,
                templateVersion,
                language,
              );
    return r ? this.map(r) : null;
  }
  list({ resumeId = "", jobId = "", status = "" } = {}) {
    const where = [],
      args = [];
    if (resumeId) {
      where.push("resume_id=?");
      args.push(resumeId);
    }
    if (jobId) {
      where.push("job_id=?");
      args.push(jobId);
    }
    if (status) {
      where.push("status=?");
      args.push(status);
    }
    return this.connection
      .prepare(
        `SELECT * FROM resume_versions${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC,rowid DESC`,
      )
      .all(...args)
      .map((r) => this.map(r));
  }
  transition(id, status, updates = {}) {
    const allowed = new Set([
      "DRAFT",
      "REVIEW_REQUIRED",
      "APPROVED",
      "REJECTED",
      "RENDERING",
      "READY",
      "FAILED",
      "ARCHIVED",
    ]);
    if (!allowed.has(status))
      throw Object.assign(new Error("Status de versao invalido."), {
        code: "INVALID_RESUME_VERSION_STATUS",
      });
    const current = this.findById(id);
    if (!current) return null;
    const approvedAt =
      status === "APPROVED"
        ? updates.approvedAt || now()
        : current.approvedAt || null;
    this.connection
      .prepare(
        "UPDATE resume_versions SET status=?,approved_at=?,ats_after_json=?,parseability_json=?,updated_at=? WHERE id=?",
      )
      .run(
        status,
        approvedAt,
        JSON.stringify(updates.atsAfter ?? current.atsAfter ?? {}),
        JSON.stringify(updates.parseability ?? current.parseability ?? {}),
        now(),
        id,
      );
    return this.findById(id);
  }
  map(r) {
    return {
      id: r.id,
      resumeId: r.resume_id,
      parentVersionId: r.parent_version_id || "",
      jobId: r.job_id || "",
      applicationId: r.application_id || "",
      templateId: r.template_id,
      templateVersion: r.template_version,
      archetypeId: r.archetype_id || "",
      archetypeVersion: r.archetype_version || "",
      language: r.language,
      status: r.status,
      contentHash: r.content_hash,
      resumeSpec: parse(r.resume_spec_json, {}),
      tailoringRunId: r.tailoring_run_id || "",
      changeset: parse(r.changeset_json, {}),
      atsBefore: parse(r.ats_before_json, {}),
      atsAfter: parse(r.ats_after_json, {}),
      parseability: parse(r.parseability_json, {}),
      source: r.source,
      purpose: r.purpose || (r.job_id ? "JOB_SPECIFIC" : "GENERIC"),
      batchRunId: r.batch_run_id || "",
      batchItemId: r.batch_item_id || "",
      algorithmMetadata: parse(r.algorithm_metadata_json, {}),
      provenance: parse(r.provenance_json, {}),
      approvedAt: r.approved_at || "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
export class ResumeArtifactRepository {
  constructor(connection) {
    this.connection = connection;
  }
  create(item) {
    const id = item.id || `resume-artifact-${randomUUID()}`;
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO resume_artifacts(id,resume_version_id,artifact_type,storage_path,content_hash,size_bytes,mime_type,status,validation_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        item.resumeVersionId,
        item.artifactType,
        item.storagePath,
        item.contentHash,
        Number(item.sizeBytes || 0),
        item.mimeType,
        item.status || "READY",
        JSON.stringify(item.validation || {}),
        item.createdAt || now(),
      );
    return this.findByContent(
      item.resumeVersionId,
      item.artifactType,
      item.contentHash,
    );
  }
  findById(id) {
    const r = this.connection
      .prepare("SELECT * FROM resume_artifacts WHERE id=?")
      .get(id);
    return r ? this.map(r) : null;
  }
  findByContent(versionId, type, hash) {
    const r = this.connection
      .prepare(
        "SELECT * FROM resume_artifacts WHERE resume_version_id=? AND artifact_type=? AND content_hash=?",
      )
      .get(versionId, type, hash);
    return r ? this.map(r) : null;
  }
  latest(versionId, type = "") {
    const r = type
      ? this.connection
          .prepare(
            "SELECT * FROM resume_artifacts WHERE resume_version_id=? AND artifact_type=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
          )
          .get(versionId, type)
      : this.connection
          .prepare(
            "SELECT * FROM resume_artifacts WHERE resume_version_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
          )
          .get(versionId);
    return r ? this.map(r) : null;
  }
  forVersion(id) {
    return this.connection
      .prepare(
        "SELECT * FROM resume_artifacts WHERE resume_version_id=? ORDER BY created_at,rowid",
      )
      .all(id)
      .map((r) => this.map(r));
  }
  map(r) {
    return {
      id: r.id,
      resumeVersionId: r.resume_version_id,
      artifactType: r.artifact_type,
      storagePath: r.storage_path,
      contentHash: r.content_hash,
      sizeBytes: r.size_bytes,
      mimeType: r.mime_type,
      status: r.status,
      validation: parse(r.validation_json, {}),
      createdAt: r.created_at,
    };
  }
}

export class ResumeRenderRunRepository {
  constructor(connection) {
    this.connection = connection;
  }
  start(item) {
    const id = item.id || `resume-render-${randomUUID()}`,
      t = now();
    this.connection
      .prepare(
        "INSERT INTO resume_render_runs(id,resume_version_id,compiler,compiler_version,status,manifest_json,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        id,
        item.resumeVersionId,
        item.compiler || "tectonic",
        item.compilerVersion || "",
        "RUNNING",
        JSON.stringify(item.manifest || {}),
        t,
      );
    return this.findById(id);
  }
  failExecution(id,{errorCode}) {
    const run=this.findById(id);
    if(!run)return null;
    const result=this.connection.prepare("UPDATE resume_render_runs SET status='FAILED',error_code=?,completed_at=? WHERE id=? AND status='RUNNING'").run(errorCode,now(),id);
    if(result.changes)this.connection.prepare("UPDATE resume_versions SET status='FAILED',updated_at=? WHERE id=? AND status='RENDERING' AND ?=(SELECT id FROM resume_render_runs WHERE resume_version_id=? ORDER BY rowid DESC LIMIT 1)").run(now(),run.resumeVersionId,id,run.resumeVersionId);
    return this.findById(id);
  }
  finish(
    id,
    { status, errorCode = "", durationMs = 0, manifest = {}, logExcerpt = "" },
  ) {
    this.connection
      .prepare(
        "UPDATE resume_render_runs SET status=?,error_code=?,duration_ms=?,manifest_json=?,log_excerpt=?,completed_at=? WHERE id=?",
      )
      .run(
        status,
        errorCode || null,
        Math.max(0, Number(durationMs || 0)),
        JSON.stringify(manifest),
        String(logExcerpt).slice(0, 8000),
        now(),
        id,
      );
    return this.findById(id);
  }
  findById(id) {
    const r = this.connection
      .prepare("SELECT * FROM resume_render_runs WHERE id=?")
      .get(id);
    return r
      ? {
          id: r.id,
          resumeVersionId: r.resume_version_id,
          compiler: r.compiler,
          compilerVersion: r.compiler_version,
          status: r.status,
          errorCode: r.error_code || "",
          durationMs: r.duration_ms,
          manifest: parse(r.manifest_json, {}),
          logExcerpt: r.log_excerpt,
          createdAt: r.created_at,
          completedAt: r.completed_at || "",
        }
      : null;
  }
  forVersion(id) {
    return this.connection
      .prepare(
        "SELECT id FROM resume_render_runs WHERE resume_version_id=? ORDER BY created_at DESC,rowid DESC",
      )
      .all(id)
      .map((x) => this.findById(x.id));
  }
}

export class DocumentExportRepository {
  constructor(connection) {
    this.connection = connection;
  }
  create(item) {
    const id = item.id || `document-export-${randomUUID()}`,
      t = now();
    this.connection
      .prepare(
        "INSERT INTO document_exports(id,resume_version_id,destination,status,artifact_id,destination_reference,error_code,metadata_json,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        item.resumeVersionId,
        item.destination,
        item.status,
        item.artifactId || null,
        item.destinationReference || "",
        item.errorCode || null,
        JSON.stringify(item.metadata || {}),
        t,
        item.completedAt ||
          ([
            "COMPLETED",
            "OVERLEAF_EXPORT_READY",
            "NOT_CONFIGURED",
            "FAILED",
          ].includes(item.status)
            ? t
            : null),
      );
    return this.findById(id);
  }
  findById(id) {
    const r = this.connection
      .prepare("SELECT * FROM document_exports WHERE id=?")
      .get(id);
    return r
      ? {
          id: r.id,
          resumeVersionId: r.resume_version_id,
          destination: r.destination,
          status: r.status,
          artifactId: r.artifact_id || "",
          destinationReference: r.destination_reference,
          errorCode: r.error_code || "",
          metadata: parse(r.metadata_json, {}),
          createdAt: r.created_at,
          completedAt: r.completed_at || "",
        }
      : null;
  }
  forVersion(id) {
    return this.connection
      .prepare(
        "SELECT id FROM document_exports WHERE resume_version_id=? ORDER BY created_at DESC,rowid DESC",
      )
      .all(id)
      .map((x) => this.findById(x.id));
  }
}

export class ResumeDocumentJobRepository {
  constructor(connection, database) {
    Object.assign(this, { connection, database });
  }
  enqueue(jobType, payload = {}) {
    const identityKey=jobIdentity(jobType,payload),active=this.connection.prepare("SELECT id FROM resume_document_jobs WHERE status IN ('QUEUED','RUNNING') AND json_extract(payload_json,'$._identityKey')=? ORDER BY created_at LIMIT 1").get(identityKey);
    if(active)return this.findById(active.id);
    const id = `resume-document-job-${randomUUID()}`,
      t = now();
    this.connection
      .prepare(
        "INSERT INTO resume_document_jobs(id,job_type,status,payload_json,available_at,created_at,updated_at) VALUES(?,?,'QUEUED',?,?,?,?)",
      )
      .run(id, jobType, JSON.stringify({...payload,_identityKey:identityKey}), t, t, t);
    return this.findById(id);
  }
  claim(workerId, {since=""} = {}) {
    return this.database.transaction(() => {
      const r = this.connection
        .prepare(
          "SELECT id FROM resume_document_jobs WHERE status='QUEUED' AND available_at<=? AND created_at>=? ORDER BY created_at LIMIT 1",
        )
        .get(now(),since);
      if (!r) return null;
      const t = now(),
        changed = this.connection
          .prepare(
            "UPDATE resume_document_jobs SET status='RUNNING',locked_at=?,locked_by=?,updated_at=? WHERE id=? AND status='QUEUED'",
          )
          .run(t, workerId, t, r.id);
      return changed.changes ? this.findById(r.id) : null;
    });
  }
  finish(id, status, result = null, error = null) {
    this.connection
      .prepare(
        "UPDATE resume_document_jobs SET status=?,result_json=?,error_code=?,error_message=?,locked_at=NULL,locked_by=NULL,completed_at=?,updated_at=? WHERE id=? AND status='RUNNING'",
      )
      .run(
        status,
        result ? JSON.stringify(result) : null,
        error?.code || null,
        error ? String(error.message || "").slice(0, 500) : null,
        now(),
        now(),
        id,
      );
    return this.findById(id);
  }
  cancel(id) {
    this.connection
      .prepare(
        "UPDATE resume_document_jobs SET status='CANCELLED',completed_at=?,updated_at=? WHERE id=? AND status='QUEUED'",
      )
      .run(now(), now(), id);
    return this.findById(id);
  }
  recover(staleBefore) {
    return this.connection
      .prepare(
        "UPDATE resume_document_jobs SET status='QUEUED',locked_at=NULL,locked_by=NULL,error_code='WORKER_CRASH_RECOVERY',updated_at=? WHERE status='RUNNING' AND locked_at<?",
      )
      .run(now(), staleBefore).changes;
  }
  findById(id) {
    const r = this.connection
      .prepare("SELECT * FROM resume_document_jobs WHERE id=?")
      .get(id);
    return r
      ? {
          id: r.id,
          jobType: r.job_type,
          status: r.status,
          payload: parse(r.payload_json, {}),
          result: r.result_json ? parse(r.result_json, null) : null,
          errorCode: r.error_code || "",
          errorMessage: r.error_message || "",
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          completedAt: r.completed_at || "",
        }
      : null;
  }
}

export class ResumeUploadAuditRepository {
  constructor(connection) {
    this.connection = connection;
  }
  record(item) {
    const id = `resume-upload-${randomUUID()}`;
    this.connection
      .prepare(
        "INSERT INTO resume_upload_audits(id,application_id,resume_version_id,artifact_id,adapter_type,attempt_id,status,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        item.applicationId,
        item.resumeVersionId,
        item.artifactId,
        item.adapterType,
        item.attemptId || null,
        item.status || "UPLOADED",
        now(),
      );
    return { id, ...item, createdAt: now() };
  }
  forApplication(id) {
    return this.connection
      .prepare(
        "SELECT * FROM resume_upload_audits WHERE application_id=? ORDER BY created_at DESC,rowid DESC",
      )
      .all(id)
      .map((r) => ({
        id: r.id,
        applicationId: r.application_id,
        resumeVersionId: r.resume_version_id,
        artifactId: r.artifact_id,
        adapterType: r.adapter_type,
        attemptId: r.attempt_id || "",
        status: r.status,
        createdAt: r.created_at,
      }));
  }
}
