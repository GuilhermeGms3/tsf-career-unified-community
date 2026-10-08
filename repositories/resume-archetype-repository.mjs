import { randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now = () => new Date().toISOString();

export class ResumeArchetypeRepository {
  constructor(connection) {
    this.connection = connection;
  }
  list({ enabledOnly = true } = {}) {
    return this.connection
      .prepare(
        `SELECT * FROM resume_archetypes${enabledOnly ? " WHERE enabled=1" : ""} ORDER BY CASE id WHEN 'INFRA_NOC' THEN 1 WHEN 'CLOUD_DEVOPS' THEN 2 WHEN 'CYBER_SOC' THEN 3 WHEN 'BACKEND_PYTHON' THEN 4 ELSE 5 END,version`,
      )
      .all()
      .map((row) => this.map(row));
  }
  find(id, version = "") {
    const row = version
      ? this.connection
          .prepare("SELECT * FROM resume_archetypes WHERE id=? AND version=?")
          .get(id, version)
      : this.connection
          .prepare(
            "SELECT * FROM resume_archetypes WHERE id=? AND enabled=1 ORDER BY created_at DESC,rowid DESC LIMIT 1",
          )
          .get(id);
    return row ? this.map(row) : null;
  }
  map(row) {
    return {
      id: row.id,
      version: row.version,
      name: row.name,
      targetDomains: parseJson(row.target_domains_json, []),
      targetTitles: parseJson(row.target_titles_json, []),
      prioritySkills: parseJson(row.priority_skills_json, []),
      preferredSections: parseJson(row.preferred_sections_json, []),
      sectionOrder: parseJson(row.section_order_json, []),
      summaryStrategy: row.summary_strategy,
      projectStrategy: row.project_strategy,
      skillGrouping: parseJson(row.skill_grouping_json, {}),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
    };
  }
}

export class ResumeArchetypeAssignmentRepository {
  constructor(connection) {
    this.connection = connection;
  }
  save(item) {
    const current = this.find(
        item.archetypeId,
        item.resumeId,
        item.archetypeVersion,
      ),
      timestamp = now(),
      id =
        current?.id || item.id || `resume-archetype-assignment-${randomUUID()}`,
      status = item.status || current?.status || "REVIEW_REQUIRED";
    this.connection
      .prepare(
        `INSERT INTO resume_archetype_assignments(id,archetype_id,archetype_version,resume_id,status,evidence_coverage,evidence_ids_json,reasons_json,content_selection_json,created_at,updated_at,approved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(archetype_id,archetype_version,resume_id) DO UPDATE SET status=excluded.status,evidence_coverage=excluded.evidence_coverage,evidence_ids_json=excluded.evidence_ids_json,reasons_json=excluded.reasons_json,content_selection_json=excluded.content_selection_json,updated_at=excluded.updated_at,approved_at=CASE WHEN excluded.status='APPROVED' THEN COALESCE(resume_archetype_assignments.approved_at,excluded.updated_at) ELSE resume_archetype_assignments.approved_at END`,
      )
      .run(
        id,
        item.archetypeId,
        item.archetypeVersion,
        item.resumeId,
        status,
        Math.max(0, Math.min(1, Number(item.evidenceCoverage || 0))),
        JSON.stringify(item.evidenceIds || []),
        JSON.stringify(item.reasons || []),
        JSON.stringify(item.contentSelection || {}),
        current?.createdAt || timestamp,
        timestamp,
        status === "APPROVED" ? current?.approvedAt || timestamp : null,
      );
    return (
      this.findById(id) ||
      this.find(item.archetypeId, item.resumeId, item.archetypeVersion)
    );
  }
  review(id, status) {
    if (!["APPROVED", "REJECTED", "ARCHIVED"].includes(status))
      throw Object.assign(new Error("Estado de base invalido."), {
        code: "INVALID_ARCHETYPE_ASSIGNMENT_STATUS",
      });
    const timestamp = now();
    this.connection
      .prepare(
        "UPDATE resume_archetype_assignments SET status=?,approved_at=CASE WHEN ?='APPROVED' THEN COALESCE(approved_at,?) ELSE approved_at END,updated_at=? WHERE id=? AND status IN ('REVIEW_REQUIRED','APPROVED','REJECTED')",
      )
      .run(status, status, timestamp, timestamp, id);
    return this.findById(id);
  }
  findById(id) {
    const row = this.connection
      .prepare("SELECT * FROM resume_archetype_assignments WHERE id=?")
      .get(id);
    return row ? this.map(row) : null;
  }
  find(archetypeId, resumeId, version = "") {
    const row = version
      ? this.connection
          .prepare(
            "SELECT * FROM resume_archetype_assignments WHERE archetype_id=? AND archetype_version=? AND resume_id=?",
          )
          .get(archetypeId, version, resumeId)
      : this.connection
          .prepare(
            "SELECT * FROM resume_archetype_assignments WHERE archetype_id=? AND resume_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1",
          )
          .get(archetypeId, resumeId);
    return row ? this.map(row) : null;
  }
  list({ archetypeId = "", resumeId = "", status = "" } = {}) {
    const where = [],
      args = [];
    if (archetypeId) {
      where.push("archetype_id=?");
      args.push(archetypeId);
    }
    if (resumeId) {
      where.push("resume_id=?");
      args.push(resumeId);
    }
    if (status) {
      where.push("status=?");
      args.push(status);
    }
    return this.connection
      .prepare(
        `SELECT * FROM resume_archetype_assignments${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY evidence_coverage DESC,updated_at DESC,rowid DESC`,
      )
      .all(...args)
      .map((row) => this.map(row));
  }
  map(row) {
    return {
      id: row.id,
      archetypeId: row.archetype_id,
      archetypeVersion: row.archetype_version,
      resumeId: row.resume_id,
      status: row.status,
      evidenceCoverage: row.evidence_coverage,
      evidenceIds: parseJson(row.evidence_ids_json, []),
      reasons: parseJson(row.reasons_json, []),
      contentSelection: parseJson(row.content_selection_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      approvedAt: row.approved_at || "",
    };
  }
}

export class ResumeNormalizationReviewRepository {
  constructor(connection) {
    this.connection = connection;
  }
  create(item) {
    const id = item.id || `resume-normalization-${randomUUID()}`;
    this.connection
      .prepare(
        "INSERT INTO resume_normalization_reviews(id,resume_id,resume_version_id,status,confidence,warnings_json,normalized_snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        item.resumeId || null,
        item.resumeVersionId || null,
        item.status || "REVIEW_REQUIRED",
        Math.max(0, Math.min(1, Number(item.confidence || 0))),
        JSON.stringify(item.warnings || []),
        JSON.stringify(item.normalizedSnapshot || {}),
        now(),
      );
    return this.findById(id);
  }
  findById(id) {
    const row = this.connection
      .prepare("SELECT * FROM resume_normalization_reviews WHERE id=?")
      .get(id);
    return row
      ? {
          id: row.id,
          resumeId: row.resume_id || "",
          resumeVersionId: row.resume_version_id || "",
          status: row.status,
          confidence: row.confidence,
          warnings: parseJson(row.warnings_json, []),
          normalizedSnapshot: parseJson(row.normalized_snapshot_json, {}),
          createdAt: row.created_at,
          reviewedAt: row.reviewed_at || "",
        }
      : null;
  }
  latestForResume(resumeId) {
    const row = this.connection
      .prepare(
        "SELECT id FROM resume_normalization_reviews WHERE resume_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
      )
      .get(resumeId);
    return row ? this.findById(row.id) : null;
  }
}

export class TemplateBenchmarkRepository {
  constructor(connection) {
    this.connection = connection;
  }
  save(item) {
    const id = item.id || `template-benchmark-${randomUUID()}`;
    this.connection
      .prepare(
        `INSERT OR IGNORE INTO template_benchmarks(id,template_id,template_version,language,compiler,compiler_version,parseability_score,page_count,missing_facts_json,detected_sections_json,character_checks_json,pdf_hash,measured_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        item.templateId,
        item.templateVersion,
        item.language,
        item.compiler || "tectonic",
        item.compilerVersion,
        Number(item.parseabilityScore || 0),
        Number(item.pageCount || 0),
        JSON.stringify(item.missingFacts || []),
        JSON.stringify(item.detectedSections || []),
        JSON.stringify(item.characterChecks || {}),
        item.pdfHash,
        item.measuredAt || now(),
      );
    return this.latest(item.templateId, item.templateVersion, item.language);
  }
  latest(templateId, templateVersion, language) {
    const row = this.connection
      .prepare(
        "SELECT * FROM template_benchmarks WHERE template_id=? AND template_version=? AND language=? ORDER BY measured_at DESC,rowid DESC LIMIT 1",
      )
      .get(templateId, templateVersion, language);
    return row ? this.map(row) : null;
  }
  list() {
    return this.connection
      .prepare(
        "SELECT * FROM template_benchmarks ORDER BY measured_at DESC,rowid DESC",
      )
      .all()
      .map((row) => this.map(row));
  }
  map(row) {
    return {
      id: row.id,
      templateId: row.template_id,
      templateVersion: row.template_version,
      language: row.language,
      compiler: row.compiler,
      compilerVersion: row.compiler_version,
      parseabilityScore: row.parseability_score,
      pageCount: row.page_count,
      missingFacts: parseJson(row.missing_facts_json, []),
      detectedSections: parseJson(row.detected_sections_json, []),
      characterChecks: parseJson(row.character_checks_json, {}),
      pdfHash: row.pdf_hash,
      measuredAt: row.measured_at,
    };
  }
}
