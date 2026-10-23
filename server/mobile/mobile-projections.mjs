const text = (value, max = 240) => String(value || "").slice(0, max);
const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function huntSources(reports=[]) {
  return reports.flatMap(source=>{
    if(source.provider!=='jobspy'||!source.sites?.length)return [{id:text(source.provider,80),status:text(source.status,60),found:number(source.rawResults),accepted:number(source.candidateResults),errorCode:text(source.errors?.[0]?.errorCode||source.errors?.[0]?.code||source.errorCode,100),consulted:source.called!==false&&number(source.requestCount)>0,requests:number(source.requestCount),duplicates:number(source.duplicates),newJobs:number(source.newResults)}];
    const groups=Map.groupBy(source.sites,site=>site.site||site.source);
    return [...groups].map(([id,sites])=>{const failures=sites.filter(s=>!['SUCCESS','NO_RESULTS','OK'].includes(s.status)),called=sites.filter(s=>!['BUDGET_SKIPPED','SKIPPED','CIRCUIT_OPEN'].includes(s.status));return {id:text(id,80),status:failures.length?(failures.length<sites.length?'PARTIAL':text(failures[0].status,60)):'SUCCESS',found:sites.reduce((n,s)=>n+number(s.rawResults??s.acceptedResults),0),accepted:sites.reduce((n,s)=>n+number(s.acceptedResults),0),errorCode:text(failures[0]?.errorCode,100),consulted:called.length>0,requests:called.length,duplicates:0,newJobs:0};});
  });
}

export function projectNextAction(value) {
  return typeof value === "string" ? text(value, 500) : text(value?.reason || value?.label, 500) || null;
}

export function mobileApplicationActions(status) {
  if(['SUBMITTED','SUBMISSION_UNCERTAIN','CANCELLED','QUEUED','OPENING_PAGE','FILLING','VALIDATING','SUBMITTING'].includes(status))return ['ANALYZE'];
  if(['WAITING_USER','RETRYABLE','FAILED','BLOCKED','READY_TO_SUBMIT'].includes(status))return ['RESUME','ANALYZE','REJECT'];
  return ['APPROVE','ANALYZE','REQUEST_CHANGE','REJECT'];
}

export function projectHunt(run, profiles = []) {
  if (!run) return null;
  const profile = profiles.find((item) => item.id === run.profileId);
  const progress = run.report?.progress || {};
  return {
    id: run.id,
    profileId: run.profileId,
    profileName: text(profile?.name || "Busca em massa", 120),
    querySummary:text((run.report?.expandedQueries||[]).slice(0,3).join(', '),240),
    triggerType: run.triggerType,
    status: run.status,
    stage: text(progress.stage || run.status, 80),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    errorCode: text(run.errorCode, 100),
    progress: {
      completedRequests: number(progress.completedRequests),
      totalRequests: number(progress.totalRequests || run.requestCount),
      found: number(progress.partialDiscoveredCount || run.rawCount),
      unique: number(progress.partialCanonicalCount || run.canonicalCount),
      relevant: number(run.report?.relevantCount || run.potentialMatchCount),
    },
    sources: huntSources(run.report?.sourceReports||[]).slice(0,80),
    recentJobs: (run.report?.recentDiscoveries || progress.recentDiscoveries || []).slice(0, 8).map((job) => ({
      id: text(job.id, 200),
      title: text(job.title, 180),
      company: text(job.company, 140),
      location: text(job.location, 140),
      source: text(job.source, 80),
    })),
  };
}

export function projectOpportunity(item = {}) {
  return {
    id: text(item.job?.id, 200),
    title: text(item.job?.title, 180),
    company: text(item.job?.company, 140),
    location: text(item.job?.location, 140),
    workModel: text(item.job?.workModel, 40),
    seniority: text(item.job?.seniority, 60),
    source: text(
      item.job?.discoveredVia || item.job?.provider || item.job?.source,
      80,
    ),
    url: text(item.job?.url, 2_000),
    score:
      item.analysis?.overallScore ??
      item.priority?.technicalMatch ??
      item.priority?.score ??
      null,
    confidence: item.analysis?.matchConfidence ?? null,
    disposition: text(item.decision?.disposition, 60),
    reason: text(
      item.decision?.decisionExplanation?.summary || item.priority?.reasons?.[0],
      400,
    ),
    strengths: (item.analysis?.matched || []).slice(0, 3).map((value) =>
      text(typeof value === "string" ? value : value?.name || value?.requirement, 140),
    ),
    decision: text(item.feedback?.userDecision, 40),
    applicationStatus: text(item.application?.status, 60),
    freshness: {
      current: item.freshness?.current !== false,
      status: text(item.freshness?.status, 40),
      lastCheckedAt: item.job?.lastCheckedAt || "",
    },
  };
}

export function projectToday(inbox = {}, activeHunt = null) {
  return {
    generatedAt: inbox.generatedAt || new Date().toISOString(),
    status: text(inbox.daily?.status, 60),
    headline: text(inbox.daily?.headline, 220),
    counts: {
      total: number(inbox.daily?.totalActions),
      urgent: number(inbox.daily?.urgentActions),
      highImpact: number(inbox.daily?.highImpactActions),
      opportunities: number(inbox.categories?.OPPORTUNITIES),
      resumes: number(inbox.categories?.RESUMES),
      applications: number(inbox.categories?.APPLICATIONS),
    },
    actions: (inbox.items || []).slice(0, 12).map((item) => ({
      id: text(item.key, 200),
      category: text(item.category, 60),
      priority: number(item.inboxPriority),
      title: text(item.title, 180),
      description: text(item.description, 320),
      reason: text(item.why?.[0], 320),
      cta: {
        label: text(item.cta?.label, 100),
        destination: text(item.cta?.view, 80),
        jobId: text(item.cta?.jobId, 200),
        applicationId: text(item.cta?.applicationId, 200),
      },
    })),
    activeHunt,
  };
}
