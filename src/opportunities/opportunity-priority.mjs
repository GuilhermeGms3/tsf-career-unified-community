import { isCurrentAtsAnalysis } from "../matching/analysis-version.mjs";
import {
  classifyGeography,
  classifySeniority,
} from "../discovery/relevance/pre-match-plausibility.mjs";
import { classifyFamilyFit } from "./opportunity-decision-policy-v2.mjs";

const clamp = (value) =>
  Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const values = (value) =>
  Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,;\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
const ageInDays = (value) => {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed)
    ? Math.max(0, (Date.now() - parsed) / 86400000)
    : null;
};
const includesAny = (text, terms) => {
  const normalizedText = normalize(text);
  return terms.some((term) => normalizedText.includes(normalize(term)));
};

function confidenceScore(job, analysis, requirements, items) {
  if (!analysis)
    return clamp(20 + Math.min(25, String(job.description || "").length / 40));
  if (Number.isFinite(Number(analysis.matchConfidence)))
    return clamp(analysis.matchConfidence);
  const identified = requirements.length;
  const evaluated = items.filter((item) =>
    ["MATCH", "PARTIAL_MATCH", "NO_MATCH", "UNKNOWN"].includes(item.status),
  ).length;
  const unknown =
    items.filter((item) => item.status === "UNKNOWN").length +
    (analysis.unknownRequirements?.length || 0);
  const descriptionQuality =
    String(job.description || "").length >= 500
      ? 20
      : String(job.description || "").length >= 200
        ? 12
        : 5;
  const identification = Math.min(35, identified * 4);
  const coverage = identified
    ? Math.round(Math.min(1, evaluated / identified) * 35)
    : 0;
  return clamp(
    15 +
      descriptionQuality +
      identification +
      coverage -
      Math.min(30, unknown * 4),
  );
}

function preferenceScore(job, profile, policies, feedback) {
  if (feedback?.verdict === "INTERESTED")
    return {
      score: 100,
      reasons: ["Você marcou esta vaga como interessante."],
    };
  if (feedback?.verdict === "NOT_FOR_ME")
    return {
      score: 0,
      reasons: [
        `Você marcou que esta vaga não é para você${feedback.reasons?.length ? ` (${feedback.reasons.join(", ").toLowerCase()})` : ""}.`,
      ],
    };
  const title = job.title || "",
    company = job.company || "",
    where = `${job.location || ""} ${job.workModel || ""}`,
    text = `${title} ${company} ${where} ${job.description || ""}`;
  const blockedCompanies = values(profile?.preferences?.blacklistCompanies),
    blockedTitles = values(profile?.preferences?.blacklistTitleTerms);
  if (
    includesAny(company, blockedCompanies) ||
    includesAny(title, blockedTitles)
  )
    return {
      score: 0,
      reasons: ["A vaga conflita com um bloqueio explícito do seu perfil."],
    };
  const roles = [
    ...values(profile?.career?.targetRoles),
    ...policies.flatMap((item) => item.queries || []),
  ];
  const keywords = values(profile?.preferences?.searchKeywords);
  const workModels = [
    ...values(profile?.career?.workModels),
    ...policies.flatMap((item) => item.workModels || []),
  ];
  const locations = [
    profile?.career?.locationRule,
    ...policies.flatMap((item) => item.locations || []),
  ]
    .flat()
    .filter(Boolean);
  const signals = [];
  if (roles.length)
    signals.push({
      match: includesAny(title, roles),
      positive: "O cargo coincide com um alvo explícito.",
      negative: "O cargo não coincide com os alvos configurados.",
    });
  if (keywords.length)
    signals.push({
      match: includesAny(text, keywords),
      positive: "A descrição contém termos de busca preferidos.",
      negative: "Os termos preferidos não aparecem na vaga.",
    });
  if (workModels.length && job.workModel)
    signals.push({
      match: includesAny(where, workModels),
      positive: "O modelo de trabalho coincide com sua preferência.",
      negative: "O modelo de trabalho difere da preferência declarada.",
    });
  if (locations.length && job.location)
    signals.push({
      match: includesAny(where, locations),
      positive: "A localização coincide com a política configurada.",
      negative:
        "A localização não coincide claramente com a política configurada.",
    });
  if (!signals.length)
    return {
      score: 50,
      reasons: ["Preferências insuficientes; componente mantido neutro."],
    };
  const matched = signals.filter((item) => item.match).length,
    score = clamp(30 + (matched / signals.length) * 55);
  return {
    score,
    reasons: signals
      .map((item) => (item.match ? item.positive : item.negative))
      .slice(0, 2),
  };
}

function listingQuality(job, requirements) {
  return clamp(
    15 +
      (job.company ? 12 : 0) +
      (job.title ? 10 : 0) +
      (String(job.description || "").length >= 500
        ? 25
        : String(job.description || "").length >= 200
          ? 15
          : 0) +
      (requirements.length ? 18 : 0) +
      (job.applicationUrl || job.canonicalUrl || job.url ? 12 : 0) +
      (job.salaryMin || job.salaryMax ? 8 : 0),
  );
}

export function calculateOpportunityPriority({
  job = {},
  analysis = null,
  requirements = [],
  items = [],
  profile = {},
  jobHuntPolicies = [],
  feedback = null,
  application = null,
  notified = false,
  sourceQuality = null,
  preMatch = null,
  intent = {},
} = {}) {
  const currentAnalysis = isCurrentAtsAnalysis(analysis);
  const technicalMatch = currentAnalysis ? clamp(analysis.calibratedMatchScore) : 0;
  const confidence = confidenceScore(job, analysis, requirements, items);
  const days = ageInDays(
    job.datePosted || job.postedAt || job.firstSeenAt || job.createdAt,
  );
  const freshness =
    days === null
      ? 45
      : days <= 3
        ? 100
        : days <= 7
          ? 88
          : days <= 14
            ? 72
            : days <= 30
              ? 45
              : 15;
  const preference = preferenceScore(job, profile, jobHuntPolicies, feedback);
  const familyFit = classifyFamilyFit({ job, preMatch: preMatch || {}, intent, policies: jobHuntPolicies });
  const seniority = preMatch?.seniority || classifySeniority(job).seniority;
  const requestedSeniorities = new Set([
    ...(intent.seniorities || []),
    ...jobHuntPolicies.flatMap((item) => item.seniorities || []),
  ]);
  const geography = preMatch?.geography || classifyGeography(job, intent.locationPolicy || jobHuntPolicies[0]?.locationPolicy || {});
  const familyRelevance = ({ EXACT_PRIMARY: 100, EXACT_SECONDARY: 85, ADJACENT: 60, UNKNOWN: 10, UNRELATED: 0 })[familyFit.level] ?? 10;
  const seniorityCompatibility = seniority === "UNKNOWN"
    ? 55
    : requestedSeniorities.size === 0 || requestedSeniorities.has(seniority)
      ? 100
      : seniority === "MID" ? 45 : 0;
  const locationCompatibility = geography.accepted ? 100 : geography.unknown ? 55 : 0;
  const hardRequirementCoverage = Number.isFinite(Number(analysis?.hardRequirementsScore))
    ? clamp(analysis.hardRequirementsScore)
    : 50;
  const listingQualityScore = listingQuality(job, requirements);
  const sourceQualityScore = clamp(sourceQuality?.semanticQualityScore ?? listingQualityScore);
  const qualityScore = clamp(listingQualityScore * 0.75 + sourceQualityScore * 0.25);
  const supported = ["greenhouse", "lever", "ashby"].includes(
    String(job.atsType || "").toLowerCase(),
  );
  const applicationEffort = application
    ? 20
    : supported
      ? 88
      : job.applicationUrl || job.url
        ? 62
        : 30;
  const sourceQualityAdjustment = sourceQuality
    ? sourceQualityScore >= 75
      ? 1
      : sourceQualityScore < 40
        ? -1
        : 0
    : 0;
  const penalties =
    (application ? 45 : 0) +
    (notified ? 5 : 0) +
    (feedback?.verdict === "NOT_FOR_ME" ? 30 : 0) +
    (job.lifecycleStatus === "CLOSED" ? 50 : 0) +
    Math.abs(Math.min(sourceQualityAdjustment, 0));
  const bonuses = (feedback?.verdict === "INTERESTED" ? 8 : 0) + Math.max(sourceQualityAdjustment, 0);
  const weights = Object.freeze({
    compatibility: 0.30,
    hardRequirementCoverage: 0.15,
    confidence: 0.07,
    careerFamilyRelevance: 0.20,
    seniorityCompatibility: 0.10,
    locationCompatibility: 0.10,
    freshness: 0.08,
  });
  const contributions = {
    compatibility: Number((technicalMatch * weights.compatibility).toFixed(2)),
    hardRequirementCoverage: Number((hardRequirementCoverage * weights.hardRequirementCoverage).toFixed(2)),
    confidence: Number((confidence * weights.confidence).toFixed(2)),
    careerFamilyRelevance: Number((familyRelevance * weights.careerFamilyRelevance).toFixed(2)),
    seniorityCompatibility: Number((seniorityCompatibility * weights.seniorityCompatibility).toFixed(2)),
    locationCompatibility: Number((locationCompatibility * weights.locationCompatibility).toFixed(2)),
    freshness: Number((freshness * weights.freshness).toFixed(2)),
  };
  const baseScore = Object.values(contributions).reduce((sum, value) => sum + value, 0);
  const score = clamp(baseScore + bonuses - penalties);
  const rankingReasons = [
    technicalMatch >= 80 ? "HIGH_CALIBRATED_MATCH" : technicalMatch >= 65 ? "GOOD_CALIBRATED_MATCH" : "",
    Number(analysis?.evidenceCoverage) >= 75 ? "HIGH_EVIDENCE_COVERAGE" : "",
    freshness >= 88 ? "FRESH_JOB" : "",
    sourceQualityScore >= 75 ? "RELIABLE_SOURCE" : "",
  ].filter(Boolean);
  const rankingWarnings = [
    !currentAnalysis && analysis ? "ANALYSIS_RECALCULATION_REQUIRED" : "",
    Number(analysis?.evidenceCoverage) < 40 ? "LOW_EVIDENCE_COVERAGE" : "",
    listingQualityScore < 50 ? "LOW_DESCRIPTION_QUALITY" : "",
  ].filter(Boolean);
  const reasons = [
    `Aderência técnica ${technicalMatch}% com confiança ${confidence}%.`,
    days === null
      ? "Data de publicação não confirmada."
      : days < 1
        ? "Publicada hoje."
        : `Publicada há ${Math.floor(days)} dia(s).`,
    ...preference.reasons,
    application
      ? "Candidatura já iniciada; prioridade reduzida."
      : supported
        ? `Formulário ${String(job.atsType).toUpperCase()} com preenchimento assistido disponível.`
        : "Candidatura ainda não iniciada.",
  ];
  return {
    score,
    level: score >= 80 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW",
    components: {
      technicalMatch,
      compatibility: technicalMatch,
      hardRequirementCoverage,
      confidence,
      careerFamilyRelevance: familyRelevance,
      seniorityCompatibility,
      locationCompatibility,
      freshness,
      preferenceFit: preference.score,
      listingQuality: listingQualityScore,
      sourceQuality: sourceQualityScore,
      quality: qualityScore,
      applicationEffort,
      effort: applicationEffort,
      penalties,
    },
    trace: {
      baseScore: Number(baseScore.toFixed(2)),
      weights,
      contributions,
      penalties: [
        application ? { code: "APPLICATION_STARTED", points: 45 } : null,
        notified ? { code: "ALREADY_NOTIFIED", points: 5 } : null,
        feedback?.verdict === "NOT_FOR_ME" ? { code: "NOT_FOR_ME", points: 30 } : null,
        job.lifecycleStatus === "CLOSED" ? { code: "JOB_CLOSED", points: 50 } : null,
        sourceQualityAdjustment < 0 ? { code: "LOW_SOURCE_QUALITY", points: 1 } : null,
      ].filter(Boolean),
      bonuses: [
        feedback?.verdict === "INTERESTED" ? { code: "HUMAN_INTEREST", points: 8 } : null,
        sourceQualityAdjustment > 0 ? { code: "RELIABLE_SOURCE_QUALITY", points: 1 } : null,
      ].filter(Boolean),
      context: {
        familyFit,
        seniority: { value: seniority, requested: [...requestedSeniorities] },
        location: geography,
      },
      finalScore: score,
    },
    reasons: reasons.slice(0, 6),
    rankingReasons,
    rankingWarnings,
    technicalMatch,
    analysisCurrent: currentAnalysis,
    algorithmVersion: "opportunity-priority-v2.2",
  };
}

export function opportunityAgeDays(job = {}) {
  return ageInDays(
    job.datePosted || job.postedAt || job.firstSeenAt || job.createdAt,
  );
}
