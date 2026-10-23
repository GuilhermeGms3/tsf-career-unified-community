import { randomUUID } from "node:crypto";
import { ATS_ALGORITHM_VERSION } from "./constants.mjs";
import { extractCandidateEvidence } from "./candidate-evidence-extractor.mjs";
import { evaluateEligibility } from "./eligibility-engine.mjs";
import { extractJobRequirements } from "./job-requirement-extractor.mjs";
import { matchRequirements } from "./matching-engine.mjs";
import { evaluateResumeParseability } from "./resume-parseability.mjs";
import { jobInformationQuality } from "./job-information-quality.mjs";
import {
  calculateDimensionScores,
  calculateEvidenceQuality,
  calibrateMatchScore,
  calculateOverallScore,
  legacyLists,
} from "./scoring-engine.mjs";
import { EvidenceProviderRegistry, StaticCandidateEvidenceProvider } from "../evidence/evidence-provider.mjs";
import {
  CURRENT_MATCHER_VERSION,
  CURRENT_REQUIREMENT_EXTRACTOR_VERSION,
  CURRENT_SCORING_MODEL_VERSION,
} from "./analysis-version.mjs";

export function runAtsMatcherV2({
  job,
  profile = {},
  resume = {},
  knowledgeFacts = [],
  evidenceProviders = [],
  now = new Date().toISOString(),
}) {
  const requirements = extractJobRequirements(job);
  const resolvedEvidence=new EvidenceProviderRegistry([new StaticCandidateEvidenceProvider(extractCandidateEvidence),...evidenceProviders]).resolve({profile,resume,knowledgeFacts,job,requirements});
  const candidateEvidence = resolvedEvidence.evidence;
  const items = matchRequirements(requirements, candidateEvidence,resolvedEvidence.diagnostics);
  const resumeParseability = evaluateResumeParseability(resume);
  const dimensions = calculateDimensionScores(items, resumeParseability);
  const knownEvidenceMatch = calculateOverallScore(dimensions);
  const evidenceQuality = calculateEvidenceQuality(items);
  const informationQuality = jobInformationQuality(job);
  // Coverage describes known requirements, not completeness of the vacancy.
  if (!informationQuality.sufficient) {
    evidenceQuality.matchConfidence = Math.round(evidenceQuality.matchConfidence * 0.35);
    evidenceQuality.confidenceBand = "LOW";
  }
  const calibration = calibrateMatchScore(knownEvidenceMatch,evidenceQuality);
  if (!informationQuality.sufficient) calibration.calibratedMatchScore = Math.min(59, calibration.calibratedMatchScore);
  const overallScore = calibration.calibratedMatchScore;
  dimensions.jobInformation = informationQuality;
  dimensions.evidenceQuality = {...evidenceQuality,...calibration,knownEvidenceMatch,scoringModelVersion:CURRENT_SCORING_MODEL_VERSION};
  const eligibilityResult = evaluateEligibility(items);
  if (!informationQuality.sufficient) {
    eligibilityResult.warnings.push(informationQuality.message);
    if (eligibilityResult.eligibility !== "NOT_ELIGIBLE") eligibilityResult.eligibility = "REVIEW_REQUIRED";
  }
  const legacy = legacyLists(items);
  const suggestions = [
    ...eligibilityResult.warnings,
    ...eligibilityResult.unknownRequirements.map(
      (item) => `Confirmar: ${item.requirement}`,
    ),
    ...resumeParseability.issues.slice(0, 3),
  ].slice(0, 12);

  return {
    id: `ats-${randomUUID()}`,
    jobId: job.id,
    resumeId: resume.id,
    score: overallScore,
    overallScore,
    knownEvidenceMatch,
    calibratedMatchScore: overallScore,
    technicalMatch: overallScore,
    evidenceCoverage: evidenceQuality.evidenceCoverage,
    matchConfidence: evidenceQuality.matchConfidence,
    confidenceBand: evidenceQuality.confidenceBand,
    hardRequirementsScore: dimensions.hardRequirements.score,
    skillsScore: dimensions.skills.score,
    experienceScore: dimensions.experience.score,
    seniorityScore: dimensions.seniority.score,
    educationScore: dimensions.education.score,
    certificationsScore: dimensions.certifications.score,
    languagesScore: dimensions.languages.score,
    locationScore: dimensions.location.score,
    resumeAtsScore: dimensions.resumeAts.score,
    documentAtsCompatibility: {
      score: dimensions.resumeAts.score,
      status: dimensions.resumeAts.status,
      evaluated: dimensions.resumeAts.status !== "NOT_EVALUATED",
    },
    dimensions,
    eligibility: eligibilityResult.eligibility,
    blockingIssues: eligibilityResult.blockingIssues,
    warnings: eligibilityResult.warnings,
    unknownRequirements: eligibilityResult.unknownRequirements,
    requirements,
    items,
    candidateEvidence,
    evidenceProviders: resolvedEvidence.diagnostics,
    resumeParseability,
    matched: legacy.matched,
    missing: legacy.missing,
    suggestions,
    algorithmVersion: ATS_ALGORITHM_VERSION,
    matcherVersion: CURRENT_MATCHER_VERSION,
    scoringModelVersion: CURRENT_SCORING_MODEL_VERSION,
    requirementExtractorVersion: CURRENT_REQUIREMENT_EXTRACTOR_VERSION,
    analysisStatus: "CURRENT",
    createdAt: now,
    updatedAt: now,
  };
}
