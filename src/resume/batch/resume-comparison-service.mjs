import { createHash, randomUUID } from "node:crypto";
import { ATS_ALGORITHM_VERSION } from "../../matching/constants.mjs";
import { classifyRequirementGap } from "../../matching/gap-engine.mjs";

const identity = ({ job, resume, profile, context }) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        matcher: ATS_ALGORITHM_VERSION,
        job,
        resume,
        profile,
        context,
      }),
    )
    .digest("hex");

export class ResumeComparisonService {
  constructor({ store, matcher, profileProvider, contextProvider = () => ({}) }) {
    Object.assign(this, { store, matcher, profileProvider, contextProvider });
  }
  async compare(item, resumeIds) {
    const job = this.store.jobs.findById(item.jobId);
    if (!job)
      throw Object.assign(new Error("Vaga do batch não encontrada."), {
        code: "RESUME_BATCH_JOB_NOT_FOUND",
      });
    const results = [];
    const profile = await this.profileProvider(), context = await this.contextProvider({job});
    for (const resumeId of resumeIds) {
      const resume = this.store.resumes.findById(resumeId);
      if (!resume) continue;
      const identityKey = identity({ job, resume, profile, context }),
        record = this.store.resumeBatches.upsertComparison({
          batchRunId: item.batchRunId,
          batchItemId: item.id,
          jobId: job.id,
          resumeId,
          identityKey,
        }),
        cached = this.store.resumeBatches.findCachedComparison(identityKey);
      if (record.status === "COMPLETED" && record.identityKey === identityKey) {
        results.push(record);
        continue;
      }
      if (cached && cached.id !== record.id) {
        results.push(
          this.store.resumeBatches.finishComparison(record.id, {
            analysisId: cached.analysisId,
            score: cached.score,
            result: cached.result,
            reused: true,
          }),
        );
        continue;
      }
      try {
        const analysis = this.matcher({
          job,
          profile,
          resume,
        });
        const timestamp = new Date().toISOString(),
          persisted = this.store.analyses.upsert({
            ...analysis,
            id: analysis.id || `analysis-${randomUUID()}`,
            jobId: job.id,
            resumeId: resume.id,
            createdAt: analysis.createdAt || timestamp,
            updatedAt: timestamp,
          });
        results.push(
          this.store.resumeBatches.finishComparison(record.id, {
            analysisId: persisted.id,
            score: persisted.overallScore ?? persisted.score ?? 0,
            result: {
              dimensions: persisted.dimensions,
              eligibility: persisted.eligibility,
              warnings: persisted.warnings,
              blockingIssues: persisted.blockingIssues,
              evidenceCoverage: persisted.evidenceCoverage,
              matchConfidence: persisted.matchConfidence,
              technicalMatch: persisted.technicalMatch,
              resumeAtsScore: persisted.resumeAtsScore,
              items: persisted.items,
              matched: persisted.matched,
              missing: persisted.missing,
              candidateEvidence: persisted.candidateEvidence,
              familyFit: context.familyFit || null,
              gaps: (persisted.items || []).map(item => classifyRequirementGap(item, {familyFit:context.familyFit})),
            },
          }),
        );
      } catch (error) {
        results.push(
          this.store.resumeBatches.finishComparison(record.id, { error }),
        );
      }
    }
    return results;
  }
}
