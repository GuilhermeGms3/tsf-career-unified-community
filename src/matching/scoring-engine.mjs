import {
  DIMENSION_DEFINITIONS,
  MATCH_STATUS,
  SCORING_WEIGHTS,
} from "./constants.mjs";
import { CURRENT_SCORING_MODEL_VERSION } from "./analysis-version.mjs";

export const SCORING_MODEL_CONFIG = Object.freeze({
  version: CURRENT_SCORING_MODEL_VERSION,
  neutralScore: 50,
  reliabilityModel: "geometric-mean",
});

const skillTypes = new Set([
  "skill",
  "tool",
  "framework",
  "platform",
  "cloud",
  "operating_system",
  "methodology",
]);

function weightedResult(items) {
  const applicable = items.filter(
    (item) => item.score !== null && Number.isFinite(Number(item.score)),
  );
  if (!applicable.length)
    return {
      score: null,
      status: "NOT_APPLICABLE",
      relevantCount: items.length,
      evaluatedCount: 0,
    };
  const denominator = applicable.reduce(
    (sum, item) => sum + Number(item.requirement.weight || 1),
    0,
  );
  if (!denominator)
    return {
      score: null,
      status: "NOT_APPLICABLE",
      relevantCount: items.length,
      evaluatedCount: 0,
    };
  const value =
    applicable.reduce(
      (sum, item) =>
        sum + Number(item.score) * Number(item.requirement.weight || 1),
      0,
    ) / denominator;
  const score = Math.max(0, Math.min(100, Math.round(value * 100)));
  return {
    score,
    status: score >= 80 ? "STRONG" : score >= 55 ? "PARTIAL" : "WEAK",
    relevantCount: items.length,
    evaluatedCount: applicable.length,
  };
}

function select(items, predicate) {
  return items.filter((item) => predicate(item.requirement));
}

export function calculateDimensionScores(items, resumeParseability) {
  const dimensions = {
    hardRequirements: weightedResult(
      select(
        items,
        (requirement) => requirement.required && requirement.type !== "role",
      ),
    ),
    skills: weightedResult(
      select(items, (requirement) => skillTypes.has(requirement.type)),
    ),
    experience: weightedResult(
      select(items, (requirement) =>
        [
          "experience_years",
          "specific_experience",
          "domain",
          "role",
          "availability",
        ].includes(requirement.type),
      ),
    ),
    seniority: weightedResult(
      select(items, (requirement) => requirement.type === "seniority"),
    ),
    education: weightedResult(
      select(items, (requirement) => requirement.type === "education"),
    ),
    certifications: weightedResult(
      select(items, (requirement) => requirement.type === "certification"),
    ),
    languages: weightedResult(
      select(items, (requirement) => requirement.type === "language"),
    ),
    location: weightedResult(
      select(items, (requirement) =>
        ["location", "work_model", "relocation", "travel"].includes(
          requirement.type,
        ),
      ),
    ),
    resumeAts: {
      score: resumeParseability.score,
      status: resumeParseability.status,
      relevantCount: 1,
      evaluatedCount: 1,
    },
  };
  return Object.fromEntries(
    Object.entries(dimensions).map(([key, value]) => [
      key,
      { ...DIMENSION_DEFINITIONS[key], ...value },
    ]),
  );
}

function combinedEducationScore(dimensions) {
  const values = [
    dimensions.education.score,
    dimensions.certifications.score,
  ].filter((value) => value !== null);
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
}

export function calculateOverallScore(dimensions, weights = SCORING_WEIGHTS) {
  const weightedDimensions = [
    ["skills", dimensions.skills.score],
    ["experience", dimensions.experience.score],
    ["seniority", dimensions.seniority.score],
    ["educationAndCertifications", combinedEducationScore(dimensions)],
    ["languages", dimensions.languages.score],
    ["location", dimensions.location.score],
  ].filter(([, score]) => score !== null && Number.isFinite(Number(score)));
  const totalWeight = weightedDimensions.reduce(
    (sum, [key]) => sum + Number(weights[key] || 0),
    0,
  );
  if (!totalWeight) return 0;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        weightedDimensions.reduce(
          (sum, [key, score]) =>
            sum + Number(score) * Number(weights[key] || 0),
          0,
        ) / totalWeight,
      ),
    ),
  );
}

export function calibrateMatchScore(knownEvidenceMatch, evidenceQuality = {}, config = SCORING_MODEL_CONFIG) {
  const neutralScore = Number(config?.neutralScore ?? SCORING_MODEL_CONFIG.neutralScore);
  const known = Math.max(0, Math.min(100, Number(knownEvidenceMatch || 0)));
  const coverage = Math.max(0, Math.min(1, Number(evidenceQuality.evidenceCoverage || 0) / 100));
  const confidence = Math.max(0, Math.min(1, Number(evidenceQuality.matchConfidence || 0) / 100));
  const reliability = Math.sqrt(coverage * confidence);
  const calibratedMatchScore = Math.max(0, Math.min(100, Math.round(neutralScore + (known - neutralScore) * reliability)));
  return {
    calibratedMatchScore,
    reliability: Number(reliability.toFixed(4)),
    neutralScore,
    scoringModelVersion: config?.version || SCORING_MODEL_CONFIG.version,
  };
}

export function calculateEvidenceQuality(items = []) {
  const relevant = items.filter((item) => !(item.requirement?.metadata?.provenance === "CLASSIFICATION_CONTEXT" && ["role","domain"].includes(item.requirement?.type)));
  const weighted = relevant.map((item) => ({
    ...item,
    evidenceWeight: Math.max(0.1, Number(item.requirement?.weight || 1)),
  }));
  const totalWeight = weighted.reduce(
    (sum, item) => sum + item.evidenceWeight,
    0,
  );
  const knownWeight = weighted
    .filter(
      (item) => item.score !== null && Number.isFinite(Number(item.score)),
    )
    .reduce((sum, item) => sum + item.evidenceWeight, 0);
  const requiredUnknownWeight = weighted
    .filter(
      (item) =>
        item.status === MATCH_STATUS.UNKNOWN && item.requirement?.required,
    )
    .reduce((sum, item) => sum + item.evidenceWeight, 0);
  const evidenceCoverage = totalWeight
    ? Math.round((knownWeight / totalWeight) * 100)
    : 0;
  const requiredUnknownShare = totalWeight
    ? requiredUnknownWeight / totalWeight
    : 0;
  const evaluated = weighted.filter((item) => item.score !== null && Number.isFinite(Number(item.score)));
  const evaluatedWeight = evaluated.reduce((sum,item)=>sum+item.evidenceWeight,0);
  const knownEvidenceQuality = evaluatedWeight ? evaluated.reduce((sum,item)=>{
    const requirementConfidence=Math.max(0,Math.min(1,Number(item.requirement?.confidence??0.7)));
    const evidenceStrength=item.evidence?.length?Math.max(...item.evidence.map(evidence=>Number(evidence.strengthScore??0.7))):requirementConfidence;
    return sum+item.evidenceWeight*Math.min(requirementConfidence,Math.max(0.35,evidenceStrength));
  },0)/evaluatedWeight:0;
  const matchConfidence = Math.max(
    0,
    Math.min(
      100,
      Math.round(evidenceCoverage * (0.65 + knownEvidenceQuality * 0.35) * (1 - requiredUnknownShare * 0.35)),
    ),
  );

  return {
    evidenceCoverage,
    matchConfidence,
    totalWeight: Number(totalWeight.toFixed(3)),
    knownWeight: Number(knownWeight.toFixed(3)),
    unknownCount: weighted.filter(
      (item) => item.status === MATCH_STATUS.UNKNOWN,
    ).length,
    requiredUnknownCount: weighted.filter(
      (item) =>
        item.status === MATCH_STATUS.UNKNOWN && item.requirement?.required,
    ).length,
    knownEvidenceQuality: Number(knownEvidenceQuality.toFixed(4)),
    confidenceBand: matchConfidence >= 75 ? "HIGH" : matchConfidence >= 45 ? "MEDIUM" : "LOW",
  };
}

export function legacyLists(items) {
  return {
    matched: items
      .filter((item) => item.status === MATCH_STATUS.MATCH)
      .map((item) => item.requirement.normalizedName)
      .slice(0, 30),
    missing: items
      .filter((item) => item.status === MATCH_STATUS.NO_MATCH)
      .map((item) => item.requirement.normalizedName)
      .slice(0, 30),
  };
}
