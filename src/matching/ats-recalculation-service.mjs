import { isCurrentAtsAnalysis } from "./analysis-version.mjs";

const timestamp = (item) => Date.parse(item.updatedAt || item.createdAt || "") || 0;

export class AtsRecalculationService {
  constructor({ store, reanalyze } = {}) { Object.assign(this, { store, reanalyze }); }

  candidates() {
    const latest = new Map();
    for (const analysis of this.store.analyses.all()) {
      const previous = latest.get(analysis.jobId);
      if (!previous || timestamp(analysis) > timestamp(previous)) latest.set(analysis.jobId, analysis);
    }
    return [...latest.values()].filter((analysis) => !isCurrentAtsAnalysis(analysis));
  }

  async run({ limit = 500 } = {}) {
    const candidates = this.candidates().slice(0, Math.max(1, Math.min(5000, Number(limit) || 500)));
    const report = { found: candidates.length, recalculated: 0, failed: 0, insufficientData: 0, failures: [] };
    for (const analysis of candidates) {
      const job = this.store.jobs.findById(analysis.jobId);
      const resume = analysis.resumeId ? this.store.resumes.findById(analysis.resumeId) : null;
      if (!job || !String(job.title || "").trim() || !String(job.description || "").trim() || (analysis.resumeId && !resume)) {
        report.insufficientData++;
        report.failures.push({ jobId: analysis.jobId, analysisId: analysis.id, code: "SOURCE_DATA_INSUFFICIENT" });
        continue;
      }
      try {
        const result = await this.reanalyze({ jobId: job.id, resumeId: resume?.id || null });
        if (!result?.ok) throw Object.assign(new Error(result?.error || "Reanálise falhou."), { code: result?.code || "REANALYSIS_FAILED" });
        report.recalculated++;
      } catch (error) {
        report.failed++;
        report.failures.push({ jobId: analysis.jobId, analysisId: analysis.id, code: error.code || "REANALYSIS_FAILED", message: error.message });
      }
    }
    return { ...report, completedAt: new Date().toISOString() };
  }
}
