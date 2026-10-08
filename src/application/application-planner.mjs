import { PolicyEngine } from "./policy-engine.mjs";
import { applicationProvider } from "../discovery/source-attribution.mjs";

function atsFromUrl(url) {
  return applicationProvider(url).toLowerCase();
}

export class ApplicationPlanner {
  constructor(policy = {}) { this.policies = policy instanceof PolicyEngine ? policy : new PolicyEngine(policy); }

  plan({ application, job, analysis, resumes = [], resumeVersions = null, existingApplications = [], essentialFactsKnown = true }) {
    if (!application || !job || !analysis) throw new Error("Candidatura, vaga e analise ATS V2 sao obrigatorias.");
    const policy = this.policies.policy;
    const blockers = [...(analysis.blockingIssues || [])];
    const warnings = [...(analysis.warnings || [])];
    const unknown = [...(analysis.unknownRequirements || [])];
    const selected = resumes.find((item) => item.id === application.resumeId)
      || resumes.find((item) => item.id === analysis.resumeId) || null;
    const selectedVersion=Array.isArray(resumeVersions)?resumeVersions.find(item=>item.id===application.resumeVersionId&&item.resumeId===selected?.id)||null:null;
    const duplicate = existingApplications.some((item) => item.id !== application.id && item.jobId === job.id && item.status !== "CANCELLED");
    const companyCount = existingApplications.filter((item) => item.id !== application.id && item.status !== "CANCELLED" && item.company === job.company).length;
    const closed = job.lifecycleStatus==="CLOSED"||/^(closed|encerrada|expirada)$/i.test(String(job.status || ""));
    const reasons = [];
    let decision = "APPLY";
    if (blockers.length || analysis.eligibility === "NOT_ELIGIBLE" || this.policies.companyBlocked(job.company) || this.policies.keywordBlocked(job) || closed) {
      decision = "BLOCKED"; reasons.push("Existe um impedimento confirmado ou uma politica de bloqueio.");
    } else if (!selected || (Array.isArray(resumeVersions)&&!selectedVersion) || (policy.preventDuplicateApplication && duplicate) || companyCount >= policy.maxApplicationsPerCompany || Number(analysis.overallScore ?? analysis.score ?? 0) < policy.minimumMatchScore) {
      decision = "SKIP"; reasons.push(!selected ? "Nenhum curriculo elegivel foi selecionado." : duplicate ? "Ja existe candidatura para esta vaga." : "Politica de selecao nao atendida.");
    } else if (unknown.length || !essentialFactsKnown || analysis.eligibility === "REVIEW_REQUIRED") {
      decision = "REVIEW"; reasons.push("Ha informacao critica que exige confirmacao do usuario.");
    }
    return {
      applicationId: application.id, jobId: job.id, analysisId: analysis.id,
      selectedResumeId: selected?.id || "", selectedResumeVersionId:selectedVersion?.id||application.resumeVersionId||"", atsType: atsFromUrl(job.applicationUrl||job.canonicalUrl||job.url), decision,
      matchScore: Number(analysis.overallScore ?? analysis.score ?? 0), eligibility: analysis.eligibility || "REVIEW_REQUIRED",
      requiresReview: true, blockingIssues: blockers, warnings, unknownRequirements: unknown, reasons,
      policySnapshot: this.policies.snapshot()
    };
  }
}
