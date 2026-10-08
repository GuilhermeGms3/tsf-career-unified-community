const SAFE_DEFAULTS = Object.freeze({
  minimumMatchScore: 65,
  autoFillEnabled: true,
  requireReviewBeforeSubmit: true,
  maxApplicationsPerCompany: 3,
  preventDuplicateApplication: true,
  blockedCompanies: [],
  blockedKeywords: [],
  allowedWorkModels: [],
  unknownCriticalAnswerBehavior: "REVIEW",
  submissionEnabled: false,
  submissionRateLimitPerHour: 5
});

const list = (value) => Array.isArray(value) ? value : String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);

export class PolicyEngine {
  constructor(input = {}) {
    this.policy = Object.freeze({
      ...SAFE_DEFAULTS,
      ...input,
      requireReviewBeforeSubmit: true,
      blockedCompanies: Object.freeze(list(input.blockedCompanies)),
      blockedKeywords: Object.freeze(list(input.blockedKeywords)),
      allowedWorkModels: Object.freeze(list(input.allowedWorkModels))
    });
  }

  snapshot() { return JSON.parse(JSON.stringify(this.policy)); }
  companyBlocked(company) { return this.policy.blockedCompanies.some((x) => String(company).toLowerCase().includes(x.toLowerCase())); }
  keywordBlocked(job) {
    const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
    return this.policy.blockedKeywords.some((x) => text.includes(x.toLowerCase()));
  }
}

export { SAFE_DEFAULTS as SAFE_POLICY_DEFAULTS };
