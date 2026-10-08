export const CURRENT_MATCHER_VERSION = "ats-matcher-v2";
export const CURRENT_SCORING_MODEL_VERSION = "confidence-calibrated-v1";
export const CURRENT_REQUIREMENT_EXTRACTOR_VERSION = "requirements-v3";

export const ATS_ANALYSIS_STATUS = Object.freeze({
  CURRENT: "CURRENT",
  LEGACY: "LEGACY",
  RECALCULATION_REQUIRED: "RECALCULATION_REQUIRED",
});

export function atsAnalysisStatus(analysis) {
  if (!analysis) return ATS_ANALYSIS_STATUS.LEGACY;
  const matcherVersion = analysis.matcherVersion || "";
  const scoringModelVersion = analysis.scoringModelVersion || "";
  const requirementExtractorVersion = analysis.requirementExtractorVersion || "";
  if (
    matcherVersion === CURRENT_MATCHER_VERSION &&
    scoringModelVersion === CURRENT_SCORING_MODEL_VERSION &&
    requirementExtractorVersion === CURRENT_REQUIREMENT_EXTRACTOR_VERSION
  ) return ATS_ANALYSIS_STATUS.CURRENT;
  return matcherVersion || scoringModelVersion || requirementExtractorVersion
    ? ATS_ANALYSIS_STATUS.RECALCULATION_REQUIRED
    : ATS_ANALYSIS_STATUS.LEGACY;
}

export function isCurrentAtsAnalysis(analysis) {
  return atsAnalysisStatus(analysis) === ATS_ANALYSIS_STATUS.CURRENT;
}

export function withAtsAnalysisStatus(analysis) {
  if (!analysis) return null;
  return { ...analysis, analysisStatus: atsAnalysisStatus(analysis) };
}
