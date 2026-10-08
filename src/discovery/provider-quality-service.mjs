import { extractJobRequirements } from "../matching/job-requirement-extractor.mjs";
import { normalizeJobDescription } from "../matching/job-description-normalizer.mjs";
import { foldText } from "../matching/normalization.mjs";
import { duplicateOpportunityKey, opportunityFreshness } from "../opportunities/opportunity-freshness.mjs";

const clamp = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const rate = (count, total) => total ? clamp((count / total) * 100) : 0;
const average = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
export const technicalProviderId = (job) => String(job.provider || job.source || job.discoveredVia || "unknown").trim().toLowerCase() || "unknown";
export const sourcePortalId = (job) => String(job.discoveredVia || job.portal || job.provider || job.source || "unknown").trim().toLowerCase() || "unknown";
const canonicalKey = (job) => duplicateOpportunityKey(job) || String(job.canonicalUrl || job.applicationUrl || job.url || job.sourceUrl || job.id || "").trim().toLowerCase();
const meaningfulRequirement = (item) => item?.metadata?.provenance !== "CLASSIFICATION_CONTEXT";

function lightweightRequirementCount(description) {
  const normalized = foldText(description);
  const qualificationSignals = normalized.match(/\b(requirements?|qualifications?|requisitos?|experiencia|experience|conhecimento|knowledge|skills?|habilidades?)\b/g)?.length || 0;
  const knownTechnicalSignal = /\b(java|javascript|typescript|node|react|python|sql|linux|docker|kubernetes|aws|azure|gcp|terraform|network|redes|cloud|nuvem)\b/.test(normalized);
  return Number(qualificationSignals > 0 || knownTechnicalSignal);
}

export function assessJobAnalyzability(job = {}, persistedRequirements = null, { extractMissingRequirements = true } = {}) {
  const description = extractMissingRequirements ? normalizeJobDescription(job.description) : String(job.description || "").trim();
  const requirements = description.length >= 120
    ? (Array.isArray(persistedRequirements)
        ? persistedRequirements.filter(meaningfulRequirement)
        : extractMissingRequirements
          ? extractJobRequirements({ ...job, description }).filter(meaningfulRequirement)
          : Array.from({ length: lightweightRequirementCount(description) }))
    : [];
  const reasons = [];
  if (String(job.title || "").trim().length < 3) reasons.push("TITLE_MISSING");
  if (technicalProviderId(job) === "unknown") reasons.push("SOURCE_MISSING");
  if (!description.length) reasons.push("DESCRIPTION_MISSING");
  else if (description.length < 120) reasons.push("DESCRIPTION_INSUFFICIENT");
  if (/cloudflare|captcha|access denied|just a moment|enable javascript/i.test(description.slice(0, 500))) reasons.push("CHALLENGE_OR_ERROR_PAGE");
  if (/^(?:careers?|jobs?|opportunities|vagas?)\s*(?:at|na|no|em)?\s*[^\n]{0,80}$/i.test(description)) reasons.push("GENERIC_CAREER_PAGE");
  if (!requirements.length) reasons.push("REQUIREMENTS_NOT_EXTRACTABLE");
  return {
    analyzable: reasons.length === 0,
    isAnalyzable: reasons.length === 0,
    reasons,
    descriptionLength: description.length,
    requirementsFound: requirements.length,
  };
}

function sourceQualityReport(id, records, analysesByJob, diagnostics = [], dimension = "technicalProvider") {
  const uniqueKeys = new Set(records.map(({ job }) => canonicalKey(job)).filter(Boolean));
  const analyzed = records.map(({ job }) => analysesByJob.get(job.id)).filter(Boolean);
  const descriptions = records.map(({ assessment }) => assessment.descriptionLength).filter((length) => length > 0);
  const current = records.filter(({ job }) => opportunityFreshness(job).current).length;
  const verifiedAvailable = records.filter(({ job }) => job.availability?.status === "AVAILABLE" && Boolean(job.availability?.checkedAt)).length;
  const stale = records.filter(({ job }) => opportunityFreshness(job).needsUpdate).length;
  const analyzable = records.filter(({ assessment }) => assessment.isAnalyzable).length;
  const descriptionAvailable = records.filter(({ assessment }) => assessment.descriptionLength >= 120).length;
  const canonicalAvailable = records.filter(({ job }) => Boolean(job.canonicalUrl || job.applicationUrl || job.url || job.sourceUrl)).length;
  const locationAvailable = records.filter(({ job }) => Boolean(String(job.location || "").trim())).length;
  const publishedAvailable = records.filter(({ job }) => Boolean(job.postedAt || job.datePosted || job.createdAt)).length;
  const lowCoverage = analyzed.filter((analysis) => Number(analysis.evidenceCoverage) < 50).length;
  const attempts = diagnostics.filter((item) => item.attempted !== false);
  const successful = attempts.filter((item) => ["SUCCESS", "COMPLETED", "READY"].includes(String(item.status || "").toUpperCase())).length;
  const timedOut = attempts.filter((item) => ["TIMED_OUT", "TIMEOUT"].includes(String(item.status || "").toUpperCase())).length;
  const errors = attempts.filter((item) => ["FAILED", "ERROR"].includes(String(item.status || "").toUpperCase())).length;
  const semanticQualityScore = clamp(
    rate(analyzable, records.length) * 0.5 +
    rate(descriptionAvailable, records.length) * 0.2 +
    rate(canonicalAvailable, records.length) * 0.1 +
    rate(locationAvailable, records.length) * 0.1 +
    rate(current, records.length) * 0.1,
  );
  return {
    id,
    dimension,
    technicalProviders: [...new Set(records.map(({ job }) => technicalProviderId(job)))],
    ...(dimension === "technicalProvider" ? { providerId: id, technicalProvider: id } : { sourcePortal: id }),
    foundCount: records.length,
    uniqueJobs: uniqueKeys.size,
    duplicateRate: rate(records.length - uniqueKeys.size, records.length),
    descriptionAvailableRate: rate(descriptionAvailable, records.length),
    averageDescriptionLength: average(descriptions),
    locationAvailableRate: rate(locationAvailable, records.length),
    publishedDateAvailableRate: rate(publishedAvailable, records.length),
    canonicalUrlAvailableRate: rate(canonicalAvailable, records.length),
    recentlySeenOpenRate: rate(current, records.length),
    verifiedAvailableRate: rate(verifiedAvailable, records.length),
    analyzableRate: rate(analyzable, records.length),
    analyzedJobs: analyzed.length,
    averageEvidenceCoverage: average(analyzed.map((analysis) => Number(analysis.evidenceCoverage)).filter(Number.isFinite)),
    lowCoverageRate: rate(lowCoverage, analyzed.length),
    staleRate: rate(stale, records.length),
    fetchSuccessRate: attempts.length ? rate(successful, attempts.length) : null,
    timeoutRate: attempts.length ? rate(timedOut, attempts.length) : null,
    errorRate: attempts.length ? rate(errors, attempts.length) : null,
    semanticQualityScore,
  };
}

export function buildProviderQualityReport({ jobs = [], analyses = [], projected = [], requirementsByJob = null, providerDiagnostics = [], extractMissingRequirements = true } = {}) {
  const latest = new Map();
  for (const analysis of analyses) {
    const previous = latest.get(analysis.jobId);
    if (!previous || Date.parse(analysis.updatedAt || analysis.createdAt || 0) > Date.parse(previous.updatedAt || previous.createdAt || 0)) latest.set(analysis.jobId, analysis);
  }
  const records = jobs.map((job) => ({ job, assessment: assessJobAnalyzability(job, requirementsByJob?.get?.(job.id), { extractMissingRequirements }) }));
  const groupedBy = (selector) => {
    const grouped = new Map();
    for (const record of records) {
      const id = selector(record.job);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(record);
    }
    return grouped;
  };
  const providerGroups = groupedBy(technicalProviderId);
  const portalGroups = groupedBy(sourcePortalId);
  const diagnosticsByProvider = new Map();
  for (const diagnostic of providerDiagnostics) {
    const id = String(diagnostic.provider || diagnostic.providerId || diagnostic.source || diagnostic.site || "").toLowerCase();
    if (!id) continue;
    if (!diagnosticsByProvider.has(id)) diagnosticsByProvider.set(id, []);
    diagnosticsByProvider.get(id).push(diagnostic);
  }
  const providers = [...providerGroups.entries()].map(([id, providerRecords]) => sourceQualityReport(id, providerRecords, latest, diagnosticsByProvider.get(id) || [], "technicalProvider")).sort((left, right) => right.foundCount - left.foundCount);
  const sourcePortals = [...portalGroups.entries()].map(([id, portalRecords]) => sourceQualityReport(id, portalRecords, latest, diagnosticsByProvider.get(id) || [], "sourcePortal")).sort((left, right) => right.foundCount - left.foundCount);
  const unique = new Set(records.map(({ job }) => canonicalKey(job)).filter(Boolean)).size;
  const openValid = records.filter(({ job }) => opportunityFreshness(job).current).length;
  const analyzable = records.filter(({ assessment }) => assessment.isAnalyzable).length;
  const analyzed = records.filter(({ job }) => latest.has(job.id)).length;
  const highConfidence = records.filter(({ job }) => Number(latest.get(job.id)?.matchConfidence) >= 75).length;
  const relevant = projected.filter((item) => !["BLOCKED", "SKIP"].includes(item.decision?.disposition)).length;
  const recommended = projected.filter((item) => item.decision?.visibility?.recommended).length;
  const applied = projected.filter((item) => Boolean(item.application)).length;
  return {
    generatedAt: new Date().toISOString(),
    providers,
    sourcePortals,
    funnel: {
      found: records.length,
      unique,
      openValid,
      analyzable,
      analyzed,
      relevant,
      highConfidenceMatch: highConfidence,
      recommended,
      applied,
    },
  };
}
