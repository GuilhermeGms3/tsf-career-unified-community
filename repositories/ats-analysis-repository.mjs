import { BaseRepository, parseJson } from "./base-repository.mjs";
import { isCurrentAtsAnalysis, withAtsAnalysisStatus } from "../src/matching/analysis-version.mjs";

export class AtsAnalysisRepository extends BaseRepository {
  constructor(connection) {
    super(connection, {
      table: "ats_analyses",
      columns: [
        "id",
        "job_id",
        "resume_id",
        "score",
        "matched_json",
        "missing_json",
        "suggestions_json",
        "created_at",
        "updated_at",
        "overall_score",
        "eligibility",
        "dimension_scores_json",
        "blocking_issues_json",
        "warnings_json",
        "unknown_requirements_json",
        "resume_parseability_json",
        "candidate_evidence_json",
        "algorithm_version",
        "semantic_enhancement_json",
        "matcher_version",
        "scoring_model_version",
        "requirement_extractor_version",
      ],
      toRow: (item) => ({
        id: item.id,
        job_id: item.jobId,
        resume_id: item.resumeId || null,
        score: Number(item.score ?? item.overallScore ?? 0),
        matched_json: JSON.stringify(item.matched || []),
        missing_json: JSON.stringify(item.missing || []),
        suggestions_json: JSON.stringify(item.suggestions || []),
        created_at: item.createdAt,
        updated_at: item.updatedAt || item.createdAt,
        overall_score: item.overallScore ?? item.score ?? null,
        eligibility: item.eligibility || null,
        dimension_scores_json: JSON.stringify(item.dimensions || {}),
        blocking_issues_json: JSON.stringify(item.blockingIssues || []),
        warnings_json: JSON.stringify(item.warnings || []),
        unknown_requirements_json: JSON.stringify(
          item.unknownRequirements || [],
        ),
        resume_parseability_json: JSON.stringify(item.resumeParseability || {}),
        candidate_evidence_json: JSON.stringify(item.candidateEvidence || []),
        algorithm_version: item.algorithmVersion || "ats-matcher-v1",
        semantic_enhancement_json: JSON.stringify(
          item.semanticEnhancement || {},
        ),
        matcher_version: item.matcherVersion || null,
        scoring_model_version: item.scoringModelVersion || null,
        requirement_extractor_version: item.requirementExtractorVersion || null,
      }),
      fromRow: (row) => {
        const dimensions = parseJson(row.dimension_scores_json, {});
        const overallScore = row.overall_score ?? row.score;
        const versions = {
          matcherVersion: row.matcher_version || "",
          scoringModelVersion: row.scoring_model_version || "",
          requirementExtractorVersion: row.requirement_extractor_version || "",
        };
        const current = isCurrentAtsAnalysis(versions);
        return withAtsAnalysisStatus({
          id: row.id,
          jobId: row.job_id,
          resumeId: row.resume_id || null,
          score: row.score,
          overallScore,
          historicalOverallScore: overallScore,
          knownEvidenceMatch: current ? dimensions.evidenceQuality?.knownEvidenceMatch ?? null : null,
          calibratedMatchScore: current ? dimensions.evidenceQuality?.calibratedMatchScore ?? null : null,
          technicalMatch: current ? dimensions.evidenceQuality?.calibratedMatchScore ?? overallScore : null,
          evidenceCoverage:
            dimensions.evidenceQuality?.evidenceCoverage ?? null,
          matchConfidence: dimensions.evidenceQuality?.matchConfidence ?? null,
          confidenceBand: dimensions.evidenceQuality?.confidenceBand || "",
          hardRequirementsScore: dimensions.hardRequirements?.score ?? null,
          skillsScore: dimensions.skills?.score ?? null,
          experienceScore: dimensions.experience?.score ?? null,
          seniorityScore: dimensions.seniority?.score ?? null,
          educationScore: dimensions.education?.score ?? null,
          certificationsScore: dimensions.certifications?.score ?? null,
          languagesScore: dimensions.languages?.score ?? null,
          locationScore: dimensions.location?.score ?? null,
          resumeAtsScore: dimensions.resumeAts?.score ?? null,
          documentAtsCompatibility: {
            score: dimensions.resumeAts?.score ?? null,
            status: dimensions.resumeAts?.status || "NOT_EVALUATED",
            evaluated: dimensions.resumeAts?.status !== "NOT_EVALUATED",
          },
          dimensions,
          eligibility: row.eligibility || null,
          blockingIssues: parseJson(row.blocking_issues_json, []),
          warnings: parseJson(row.warnings_json, []),
          unknownRequirements: parseJson(row.unknown_requirements_json, []),
          resumeParseability: parseJson(row.resume_parseability_json, {}),
          candidateEvidence: parseJson(row.candidate_evidence_json, []),
          algorithmVersion: row.algorithm_version || "ats-matcher-v1",
          ...versions,
          semanticEnhancement: parseJson(row.semantic_enhancement_json, {}),
          matched: parseJson(row.matched_json, []),
          missing: parseJson(row.missing_json, []),
          suggestions: parseJson(row.suggestions_json, []),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      },
    });
  }

  forJob(jobId) {
    return this.connection
      .prepare("SELECT * FROM ats_analyses WHERE job_id = ? ORDER BY created_at DESC")
      .all(jobId)
      .map(this.fromRow);
  }

  latestPerJob() {
    return this.connection
      .prepare(`
        WITH ranked AS (
          SELECT rowid AS source_rowid,
            ROW_NUMBER() OVER (
              PARTITION BY job_id
              ORDER BY updated_at DESC, rowid DESC
            ) AS projection_rank
          FROM ats_analyses
        )
        SELECT ats_analyses.*
        FROM ats_analyses
        INNER JOIN ranked ON ranked.source_rowid = ats_analyses.rowid
        WHERE ranked.projection_rank = 1
      `)
      .all()
      .map(this.fromRow);
  }

  latestProjectionPerJob() {
    const projections = this.connection
      .prepare(`
        WITH ranked AS (
          SELECT
            id,
            job_id,
            resume_id,
            score,
            created_at,
            updated_at,
            overall_score,
            eligibility,
            algorithm_version,
            matcher_version,
            scoring_model_version,
            requirement_extractor_version,
            ROW_NUMBER() OVER (
              PARTITION BY job_id
              ORDER BY updated_at DESC, rowid DESC
            ) AS projection_rank
          FROM ats_analyses INDEXED BY ats_analyses_projection_idx
        )
        SELECT
          id,
          job_id,
          resume_id,
          score,
          created_at,
          updated_at,
          overall_score,
          eligibility,
          algorithm_version,
          matcher_version,
          scoring_model_version,
          requirement_extractor_version
        FROM ranked
        WHERE projection_rank = 1
      `)
      .all();
    const detailsById = new Map();
    for (let offset = 0; offset < projections.length; offset += 500) {
      const ids = projections.slice(offset, offset + 500).map((item) => item.id);
      const details = this.connection
        .prepare(`
          SELECT id, matched_json, dimension_scores_json, blocking_issues_json,
            unknown_requirements_json
          FROM ats_analyses
          WHERE id IN (${ids.map(() => "?").join(", ")})
        `)
        .all(...ids);
      for (const detail of details) detailsById.set(detail.id, detail);
    }
    return projections.map((row) => this.fromRow({
      ...row,
      ...detailsById.get(row.id),
      missing_json: "[]",
      suggestions_json: "[]",
      warnings_json: "[]",
      resume_parseability_json: "{}",
      candidate_evidence_json: "[]",
      semantic_enhancement_json: "{}",
    }));
  }

  pruneOperationalHistory({ baseResumeId }) {
    if (!baseResumeId)
      throw Object.assign(
        new Error("Defina o currículo base antes de executar a retenção ATS."),
        { code: "ATS_RETENTION_BASE_REQUIRED" },
      );
    const before = this.connection
      .prepare("SELECT COUNT(*) AS count FROM ats_analyses")
      .get().count;
    const removed = this.connection.prepare(`
      WITH preserved AS (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY job_id ORDER BY updated_at DESC, rowid DESC
          ) AS position
          FROM ats_analyses
          WHERE resume_id IS NULL
        ) WHERE position = 1
        UNION
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY job_id ORDER BY updated_at DESC, rowid DESC
          ) AS position
          FROM ats_analyses
          WHERE resume_id = ?
        ) WHERE position = 1
        UNION SELECT analysis_id FROM application_plans WHERE analysis_id IS NOT NULL
        UNION SELECT analysis_id FROM resume_tailoring_runs WHERE analysis_id IS NOT NULL
        UNION SELECT analysis_id FROM resume_batch_items WHERE analysis_id IS NOT NULL
        UNION SELECT analysis_id FROM resume_batch_comparisons WHERE analysis_id IS NOT NULL
      )
      DELETE FROM ats_analyses
      WHERE id NOT IN (SELECT id FROM preserved)
    `).run(baseResumeId).changes;
    const after = this.connection
      .prepare("SELECT COUNT(*) AS count FROM ats_analyses")
      .get().count;
    return { before, after, removed };
  }
}
