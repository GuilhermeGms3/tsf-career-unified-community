import { preferenceLearning } from "../../opportunities/preference-learning.mjs";
import { classifyJobFamily } from "../../discovery/relevance/pre-match-plausibility.mjs";

export function whatsappProcessDetail(store, jobId) {
  const requests = store.whatsappProcesses.requests(jobId), job = store.jobs.findById(jobId);
  if (!job || !requests.length) return null;
  const timeline = requests.flatMap(request => store.applications.events(request.applicationId).slice(-100).map(event => ({
    id: event.id, at: event.createdAt, type: event.eventType, status: event.toStatus,
    action: event.metadata?.action || event.metadata?.approvalMode || "", decision: event.metadata?.decision || "", reason: event.metadata?.reason || "",
    errorCode: event.metadata?.errorCode || event.metadata?.code || "", version: event.metadata?.resumeVersionId || request.resumeVersionId,
    token: request.token,
  }))).filter((event, index, all) => all.findIndex(other => other.id === event.id) === index).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
  const latest = requests[0], application = store.applications.findById(latest.applicationId), version = store.resumeVersions.findById(latest.resumeVersionId);
  const family = classifyJobFamily({ title: job.title }).primaryJobFamily;
  const learning = preferenceLearning(store.jobs.all(), store.jobFeedback.all()).get(family) || { family, accepted: 0, rejected: 0, adjustment: 0 };
  return { job: { id: job.id, title: job.title, company: job.company, url: job.applicationUrl || job.url }, request: latest, application,
    resume: { baseName: version && store.resumes.findById(version.resumeId)?.title, versionId: latest.resumeVersionId, score: version?.atsAfter?.overallScore ?? null },
    feedback: store.jobFeedback.forJob(jobId), learning, manualSent: timeline.some(event => event.type === "WHATSAPP_MANUAL_SUBMISSION_REPORTED"), timeline };
}
