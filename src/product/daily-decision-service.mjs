import { isCurrentAtsAnalysis } from "../matching/analysis-version.mjs";
import { classifyGeography } from "../discovery/relevance/pre-match-plausibility.mjs";

const timestamp = (value) => Date.parse(value || "") || 0;
const isClosed = (item) => String(item.job?.lifecycleStatus || "").toUpperCase() === "CLOSED";
const isHumanRejected = (item) => item.feedback?.userDecision === "REJECT" || item.feedback?.verdict === "NOT_FOR_ME";
export const isDailyDecisionExcluded = (item, locationPolicy = {}) => isClosed(item) || isHumanRejected(item) || ["BLOCKED", "SKIP"].includes(item.decision?.disposition) || !classifyGeography(item.job, locationPolicy).accepted;
export const isRefreshableOpportunity = (item, locationPolicy = {}) => {
  const nonFreshnessBlockers = (item.decision?.hardBlockers || []).filter((blocker) => !["STALE", "JOB_STALE"].includes(blocker));
  return item.freshness?.needsUpdate && !isClosed(item) && !isHumanRejected(item) && item.decision?.disposition !== "SKIP" && classifyGeography(item.job, locationPolicy).accepted && nonFreshnessBlockers.length === 0;
};
const confidenceBand = (value) => Number(value) >= 75 ? "HIGH" : Number(value) >= 45 ? "MEDIUM" : "LOW";

export function classifyOpportunityTier(item = {}) {
  if (isDailyDecisionExcluded(item)) return "REJECTED";
  if (!isCurrentAtsAnalysis(item.analysis)) return "REVIEW";
  const score = Number(item.analysis?.calibratedMatchScore || 0);
  const coverage = Number(item.analysis?.evidenceCoverage || 0);
  const confidence = Number(item.analysis?.matchConfidence || 0);
  if (item.decision?.disposition === "STRETCH") return "STRETCH";
  if (coverage < 40 || confidence < 40 || item.decision?.disposition === "REVIEW") return "REVIEW";
  if (score >= 80 && coverage >= 70 && confidence >= 70 && !item.decision?.hardBlockers?.length) return "EXCELLENT";
  if (score >= 65 && coverage >= 50 && confidence >= 45) return "GOOD";
  return "STRETCH";
}

const localDateKey = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-") : "";
};

export function buildOpportunityTrend(opportunities = [], now = new Date()) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index));
    return { date: localDateKey(date), discovered: 0 };
  });
  const byDay = new Map(days.map((day) => [day.date, day]));
  for (const item of opportunities) {
    const key = localDateKey(item.job?.firstSeenAt || item.job?.createdAt);
    if (byDay.has(key)) byDay.get(key).discovered += 1;
  }
  const recent = days.slice(-3).reduce((sum, day) => sum + day.discovered, 0);
  const previous = days.slice(1, 4).reduce((sum, day) => sum + day.discovered, 0);
  const delta = recent - previous;
  return { days, recent, previous, delta, direction: delta > 0 ? "UP" : delta < 0 ? "DOWN" : "STABLE" };
}

export function buildSearchQueue({ profile = null, runs = [], expandedQueries = [], plannerState = null, now = new Date() } = {}) {
  if (!profile) return { status: "NOT_CONFIGURED", profileId: "", profileName: "", lastRunAt: null, nextRunAt: null, recommendedQueries: [], latestRun: null };
  const profileRuns = runs.filter((run) => run.profileId === profile.id);
  const latestRun = profileRuns[0] || null;
  const running = profileRuns.find((run) => run.status === "RUNNING");
  const lastRunAt = profile.lastRunAt || latestRun?.completedAt || latestRun?.startedAt || "";
  const ageHours = lastRunAt ? Math.max(0, (now.getTime() - timestamp(lastRunAt)) / 3_600_000) : Infinity;
  const status = running ? "RUNNING" : !profile.enabled ? "PAUSED" : profile.nextRunAt && timestamp(profile.nextRunAt) <= now.getTime() ? "DUE" : ageHours >= 24 ? "UPDATE_RECOMMENDED" : "SCHEDULED";
  const familyCounts = plannerState?.familySelectionCounts || {};
  const tierWeight = { TIER_1: 0, TIER_2: 1, TIER_3: 2 };
  const recommendedQueries = [...expandedQueries]
    .sort((left, right) => Number(familyCounts[left.familyId] || 0) - Number(familyCounts[right.familyId] || 0) || Number(tierWeight[left.tier] ?? 2) - Number(tierWeight[right.tier] ?? 2))
    .slice(0, 5)
    .map((item) => ({ query: item.query, familyId: item.familyId || "", reason: item.reason || "Termo configurado", tier: item.tier || "TIER_2" }));
  return {
    status, profileId: profile.id, profileName: profile.name, enabled: profile.enabled,
    lastRunAt: lastRunAt || null, nextRunAt: profile.nextRunAt || null,
    recommendedQueries,
    latestRun: latestRun ? { id: latestRun.id, status: latestRun.status, discoveredCount: latestRun.discoveredCount, matchedCount: latestRun.matchedCount, duplicateCount: latestRun.duplicateCount, startedAt: latestRun.startedAt, completedAt: latestRun.completedAt } : null,
  };
}

export function buildDailyPlan({ summary, searchQueue, awaitingRefresh = 0 } = {}) {
  const items = [];
  if (["NOT_CONFIGURED", "PAUSED", "DUE", "UPDATE_RECOMMENDED"].includes(searchQueue?.status) || awaitingRefresh > 0)
    items.push({ kind: "SEARCH", title: searchQueue?.status === "NOT_CONFIGURED" ? "Configurar sua busca" : "Atualizar a busca de vagas", description: awaitingRefresh ? `${awaitingRefresh} vaga(s) aguardam uma confirmação recente.` : "A última busca já não representa bem o mercado de hoje.", href: "/opportunities?section=discover" });
  const pendingTriage = summary.triageQueue?.length || 0;
  const strongPending = summary.triageQueue?.filter((item) => ["EXCELLENT", "GOOD"].includes(item.tier)).length || 0;
  if (pendingTriage > 0)
    items.push({ kind: "TRIAGE", title: strongPending > 0 ? `Decidir ${strongPending} oportunidade(s) forte(s)` : `Revisar ${pendingTriage} vaga(s) incerta(s)`, description: "Comece pela primeira vaga do ranking e registre sua decisão.", href: summary.bestOpportunity ? `/opportunities/${encodeURIComponent(summary.bestOpportunity.job.id)}` : "/opportunities?section=review" });
  if (summary.dailyProgress.prepared > summary.dailyProgress.applied)
    items.push({ kind: "APPLICATION", title: "Concluir candidaturas preparadas", description: `${summary.dailyProgress.prepared - summary.dailyProgress.applied} preparação(ões) ainda não enviada(s).`, href: "/applications" });
  if (!items.length) items.push({ kind: "SEARCH", title: "Buscar novas oportunidades", description: "Sua fila de decisão está limpa; rode uma busca para renovar as opções.", href: "/opportunities?section=discover" });
  return items.slice(0, 4).map((item, index) => ({ ...item, priority: index + 1 }));
}

function opportunitySummary(item) {
  const analysis = item.analysis || {};
  const strengths = (analysis.matched || []).map((entry) => entry.normalizedName || entry.name || entry.requirement).filter(Boolean).slice(0, 5);
  const gaps = (item.decision?.gapSummary?.items || []).filter((entry) => ["MATERIAL_GAP", "LEARNABLE_GAP", "NON_MATERIAL_GAP"].includes(entry.status)).map((entry) => entry.requirement).filter(Boolean).slice(0, 5);
  return {
    job: {
      id: item.job.id, title: item.job.title, company: item.job.company, location: item.job.location,
      workModel: item.job.workModel, salary: item.job.salary || null, postedAt: item.job.postedAt || item.job.datePosted || null,
      firstSeenAt: item.job.firstSeenAt || item.job.createdAt || null, technicalProvider: item.job.technicalProvider,
      sourcePortal: item.job.sourcePortal, lifecycleStatus: item.job.lifecycleStatus,
    },
    tier: classifyOpportunityTier(item),
    disposition: item.decision?.disposition || "REVIEW",
    calibratedMatchScore: isCurrentAtsAnalysis(analysis) ? analysis.calibratedMatchScore : null,
    evidenceCoverage: analysis.evidenceCoverage ?? null,
    matchConfidence: analysis.matchConfidence ?? null,
    confidenceBand: confidenceBand(analysis.matchConfidence),
    analysisStatus: analysis.analysisStatus || (analysis ? "LEGACY" : "MISSING"),
    strengths,
    gaps,
    hardBlockers: item.decision?.hardBlockers || [],
    rankingReasons: item.priority?.rankingReasons || [],
    rankingWarnings: item.priority?.rankingWarnings || [],
    decisionSummary: item.decision?.decisionExplanation?.summary || "",
    userDecision: item.feedback?.userDecision || "",
  };
}

export function buildDailyDecisionSummary({ opportunities = [], applications = [], lastReviewAt = "", now = new Date(), locationPolicy = {}, searchQueue = null, awaitingRefresh = 0, weeklyTechRadar = null } = {}) {
  const reviewTimestamp = timestamp(lastReviewAt);
  const actionable = opportunities.filter((item) => !isDailyDecisionExcluded(item, locationPolicy) && item.freshness?.current !== false);
  const worthAttentionItems = actionable.filter((item) => ["EXCELLENT", "GOOD"].includes(classifyOpportunityTier(item)));
  const reviewItems = actionable.filter((item) => ["REVIEW", "STRETCH"].includes(classifyOpportunityTier(item)));
  const rank = (left, right) => Number(right.priority?.score || 0) - Number(left.priority?.score || 0);
  const rankedAttention = [...worthAttentionItems].sort(rank);
  const rankedReview = [...reviewItems].sort(rank);
  const ranked = [...rankedAttention, ...rankedReview];
  const pending = ranked.filter((item) => !item.feedback?.userDecision);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const reviewedToday = opportunities.filter((item) => item.feedback?.userDecision && timestamp(item.feedback.updatedAt) >= startOfDay).length;
  const applicationsToday = applications.filter((item) => timestamp(item.updatedAt || item.createdAt) >= startOfDay);
  const summary = {
    generatedAt: now.toISOString(),
    lastDailyReviewAt: lastReviewAt || null,
    discoveredSinceLastReview: opportunities.filter((item) => timestamp(item.job?.firstSeenAt || item.job?.createdAt) > reviewTimestamp).length,
    worthAttention: worthAttentionItems.length,
    reviewRequired: reviewItems.length,
    automaticallyExcluded: opportunities.filter((item) => isDailyDecisionExcluded(item, locationPolicy)).length,
    bestOpportunity: pending[0] ? opportunitySummary(pending[0]) : null,
    triageQueue: pending.slice(0, 10).map(opportunitySummary),
    applyToday: rankedAttention.filter((item) => !item.feedback?.userDecision).slice(0, 5).map(opportunitySummary),
    worthReviewing: rankedReview.filter((item) => !item.feedback?.userDecision).slice(0, 5).map(opportunitySummary),
    awaitingConfirmation: awaitingRefresh,
    dailyProgress: {
      reviewed: reviewedToday,
      prepared: applicationsToday.filter((item) => ["READY_TO_SUBMIT", "READY_FOR_REVIEW"].includes(item.status)).length,
      applied: applicationsToday.filter((item) => ["SUBMITTED", "APPLIED"].includes(item.status)).length,
    },
    needsAttention: {
      lowCoverage: actionable.filter((item) => isCurrentAtsAnalysis(item.analysis) && Number(item.analysis.evidenceCoverage) < 40).length,
      analysesToRecalculate: actionable.filter((item) => item.analysis && !isCurrentAtsAnalysis(item.analysis)).length,
    },
    opportunityTrend: buildOpportunityTrend(opportunities, now),
    searchQueue,
    weeklyTechRadar,
  };
  summary.dailyPlan = buildDailyPlan({ summary, searchQueue, awaitingRefresh });
  return summary;
}
