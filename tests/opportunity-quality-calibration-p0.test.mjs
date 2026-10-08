import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRequirementCriticality,
  classifyRequirementGap,
  evaluateOpportunityDecision,
} from "../src/opportunities/opportunity-decision-policy-v2.mjs";
import { extractJobRequirements } from "../src/matching/job-requirement-extractor.mjs";
import { matchRequirement } from "../src/matching/matching-engine.mjs";
import {
  CURRENT_MATCHER_VERSION,
  CURRENT_REQUIREMENT_EXTRACTOR_VERSION,
  CURRENT_SCORING_MODEL_VERSION,
} from "../src/matching/analysis-version.mjs";

const now = new Date("2026-08-26T12:00:00Z");
const intent = { version: 7, families: ["BACKEND"], locationPolicy: { priorities: [{ location: "Brasil", workModel: "REMOTE", remoteScope: "Brasil", accepted: true }] } };
const job = { id: "job-calibration", title: "Backend Developer Jr", description: "APIs e serviços.", location: "Brasil", workModel: "REMOTE", lifecycleStatus: "OPEN", datePosted: "2026-08-25" };
const analysis = { overallScore: 78, calibratedMatchScore: 78, matchConfidence: 70, evidenceCoverage: 65, eligibility: "ELIGIBLE", blockingIssues: [], algorithmVersion: CURRENT_MATCHER_VERSION, matcherVersion: CURRENT_MATCHER_VERSION, scoringModelVersion: CURRENT_SCORING_MODEL_VERSION, requirementExtractorVersion: CURRENT_REQUIREMENT_EXTRACTOR_VERSION };
const policy = [{ jobFamilies: ["BACKEND"], considerThreshold: 70, prepareResumeThreshold: 82 }];
const baseRequirement = { type: "skill", normalizedName: "kubernetes", originalText: "Kubernetes", required: false, importance: "unspecified", confidence: 0.9, source: "job.description", metadata: { provenance: "INFERRED_FROM_DESCRIPTION" } };

test("P0 calibration: criticality follows explicit semantics instead of requirement type", () => {
  const cases = [
    [{ ...baseRequirement, required: true }, "MUST_HAVE"],
    [{ ...baseRequirement, originalText: "Kubernetes obrigatório" }, "UNKNOWN_CRITICALITY"],
    [{ ...baseRequirement, importance: "preferred", originalText: "Kubernetes desejável" }, "NICE_TO_HAVE"],
    [{ ...baseRequirement, originalText: "Strong Kubernetes knowledge", metadata: { provenance: "EXPLICIT_REQUIREMENT", criticality: "IMPORTANT" } }, "IMPORTANT"],
    [baseRequirement, "UNKNOWN_CRITICALITY"],
    [{ ...baseRequirement, type: "education", normalizedName: "3", originalText: "Graduação em TI" }, "UNKNOWN_CRITICALITY"],
    [{ ...baseRequirement, type: "language", normalizedName: "english", originalText: "English" }, "UNKNOWN_CRITICALITY"],
    [{ ...baseRequirement, type: "specific_experience", originalText: "Experiência em backend" }, "UNKNOWN_CRITICALITY"],
  ];
  for (const [requirement, expected] of cases) assert.equal(classifyRequirementCriticality(requirement), expected);
});

test("P0 calibration: evidence resolution and materiality are independent axes", () => {
  const unknown = classifyRequirementGap({ status: "UNKNOWN", requirement: baseRequirement, resolution: { reason: "NO_EVIDENCE" } });
  assert.equal(unknown.evidenceResolution, "NO_EVIDENCE");
  assert.notEqual(unknown.status, "MATERIAL_GAP");
  assert.equal(unknown.materiality, "NON_MATERIAL");
  const mandatory = classifyRequirementGap({ status: "UNKNOWN", requirement: { ...baseRequirement, required: true, importance: "required", metadata: { provenance: "EXPLICIT_REQUIREMENT" } }, resolution: { reason: "NO_EVIDENCE" } });
  assert.equal(mandatory.evidenceResolution, "NO_EVIDENCE");
  assert.equal(mandatory.status, "MATERIAL_GAP");
});

test("P0 calibration: inferred aligned domain is context, not candidate evidence", () => {
  const item = { status: "NO_MATCH", evidence: [], resolution: { reason: "NO_EVIDENCE" }, requirement: { type: "domain", normalizedName: "backend", originalText: "Backend Developer Jr", required: false, importance: "unspecified", confidence: 0.98, source: "job.title", metadata: { provenance: "CLASSIFICATION_CONTEXT" } } };
  const gap = classifyRequirementGap(item, { familyFit: { level: "EXACT_PRIMARY" }, intent });
  assert.equal(gap.status, "NON_MATERIAL_GAP");
  assert.equal(gap.reasonCode, "DOMAIN_CONTEXT_ALIGNED");
  assert.equal(gap.evidenceResolution, "NO_EVIDENCE");
  assert.notEqual(gap.status, "MATCHED");
});

test("P0 calibration: preferred and required education, language and specific experience remain distinct", () => {
  for (const [type, name] of [["education", "3"], ["language", "english"], ["specific_experience", "backend-production"]]) {
    const optional = classifyRequirementGap({ status: "UNKNOWN", requirement: { ...baseRequirement, type, normalizedName: name, originalText: `${name} desejável`, importance: "preferred" } });
    const required = classifyRequirementGap({ status: "UNKNOWN", requirement: { ...baseRequirement, type, normalizedName: name, originalText: `${name} obrigatório`, importance: "required", required: true, metadata: { provenance: "EXPLICIT_REQUIREMENT" } } });
    assert.notEqual(optional.status, "MATERIAL_GAP");
    assert.equal(required.status, "MATERIAL_GAP");
  }
});

test("P0 calibration: education can use explicitly accepted equivalent experience without claiming exact match", () => {
  const requirement = { type: "education", normalizedName: "4", originalText: "Ensino superior ou experiência equivalente", metadata: { minimumLevel: 4, equivalentExperienceAccepted: true } };
  const matched = matchRequirement(requirement, [{ type: "specific_experience", normalizedName: "support", text: "Suporte profissional", strengthScore: 0.9, source: "knowledge", sourceSection: "experience", metadata: {} }]);
  assert.equal(matched.status, "PARTIAL_MATCH");
  assert.match(matched.explanation, /equivalencia/i);
});

test("P0 calibration: preferred and mandatory experience years do not collapse", () => {
  const preferred = extractJobRequirements({ ...job, description: "5 years of experience preferred." }).find((item) => item.type === "experience_years");
  const required = extractJobRequirements({ ...job, description: "5+ years of experience required." }).find((item) => item.type === "experience_years");
  assert.equal(classifyRequirementGap({ status: "NO_MATCH", requirement: preferred }).status, "NON_MATERIAL_GAP");
  assert.equal(classifyRequirementGap({ status: "NO_MATCH", requirement: required }).status, "BLOCKING_GAP");
});

test("P0 calibration: transferability remains explicit non-equivalence", () => {
  const transferred = classifyRequirementGap({ status: "UNKNOWN", requirement: { ...baseRequirement, normalizedName: "ci-cd", importance: "preferred" }, evidence: [{ text: "GitHub Actions em produção" }] });
  assert.equal(transferred.status, "TRANSFERABLE");
  assert.equal(transferred.materiality, "NON_MATERIAL");
  assert.notEqual(transferred.status, "MATCHED");
});

test("P0 calibration: Stretch explanation names its actual material cause", () => {
  const decision = evaluateOpportunityDecision({
    job, analysis, priority: { technicalMatch: 78, components: { confidence: 70 } }, policies: policy, intent,
    preMatch: { primaryJobFamily: "BACKEND", secondaryJobFamilies: [], negativeOccupationalEvidence: [], seniority: "JUNIOR", freshness: { stale: false }, reasons: [], algorithmVersion: "fixture" },
    items: [{ status: "UNKNOWN", requirement: { ...baseRequirement, required: true, importance: "required", originalText: "Kubernetes em produção obrigatório", metadata: { provenance: "EXPLICIT_REQUIREMENT" } }, resolution: { reason: "NO_EVIDENCE" } }],
  }, { now });
  assert.equal(decision.disposition, "STRETCH");
  assert.equal(decision.primaryDecisionReason, "MATERIAL_GAP_PRESENT");
  assert.match(decision.decisionExplanation.summary, /requisito.*sem evidência/i);
  assert.ok(decision.supportingReasons.includes("EXACT_PRIMARY_FIT"));
});

test("P0 calibration: Search Intent avoids contradiction but never creates evidence", () => {
  const item = { status: "UNKNOWN", evidence: [], resolution: { reason: "NO_EVIDENCE" }, requirement: { type: "domain", normalizedName: "backend", originalText: "Backend Developer", required: false, importance: "unspecified", source: "job.title", metadata: { provenance: "CLASSIFICATION_CONTEXT" } } };
  const decision = evaluateOpportunityDecision({ job, analysis, priority: { technicalMatch: 78, components: { confidence: 70 } }, policies: policy, intent, preMatch: { primaryJobFamily: "BACKEND", secondaryJobFamilies: [], negativeOccupationalEvidence: [], seniority: "JUNIOR", freshness: { stale: false }, reasons: [] }, items: [item] }, { now });
  const domainGap = decision.gapSummary.items[0];
  assert.equal(domainGap.reasonCode, "DOMAIN_CONTEXT_ALIGNED");
  assert.equal(domainGap.evidenceResolution, "NO_EVIDENCE");
  assert.equal(domainGap.status, "NON_MATERIAL_GAP");
});

test("P0 calibration: positive controls still reach Recommended and Prepare Eligible", () => {
  const evaluate = (overallScore) => evaluateOpportunityDecision({
    job,
    analysis: { ...analysis, overallScore, matchConfidence: 85, evidenceCoverage: 85 },
    priority: { technicalMatch: overallScore, components: { confidence: 85 } },
    policies: policy,
    intent,
    preMatch: {
      primaryJobFamily: "BACKEND",
      secondaryJobFamilies: [],
      negativeOccupationalEvidence: [],
      seniority: "JUNIOR",
      freshness: { stale: false },
      reasons: [],
      algorithmVersion: "positive-control",
    },
    items: [],
  }, { now });

  const recommended = evaluate(78);
  const prepareEligible = evaluate(88);
  assert.equal(recommended.disposition, "RECOMMENDED");
  assert.equal(recommended.primaryDecisionReason, "CONSIDER_THRESHOLD_MET");
  assert.equal(prepareEligible.disposition, "PREPARE_ELIGIBLE");
  assert.equal(prepareEligible.visibility.prepareEligible, true);
});
