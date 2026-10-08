import test from "node:test";
import assert from "node:assert/strict";
import { seniorityLevel } from "../src/matching/normalization.mjs";
import { calculateOpportunityPriority } from "../src/opportunities/opportunity-priority.mjs";
import { CoverageBenchmarkService } from "../src/benchmark/coverage-benchmark-service.mjs";

const job = (overrides = {}) => ({
  id: "job-c2",
  title: "Analista de Suporte N2",
  company: "Acme",
  description: "Atendimento técnico, troubleshooting e Active Directory.",
  location: "Remoto - Brasil",
  workModel: "REMOTE",
  firstSeenAt: new Date().toISOString(),
  lifecycleStatus: "OPEN",
  url: "https://example.com/jobs/c2",
  ...overrides,
});

const analysis = (overrides = {}) => ({
  analysisStatus: "CURRENT",
  algorithmVersion: "ats-matcher-v2",
  matcherVersion: "ats-matcher-v2",
  scoringModelVersion: "confidence-calibrated-v1",
  requirementExtractorVersion: "requirements-v3",
  calibratedMatchScore: 76,
  hardRequirementsScore: 90,
  evidenceCoverage: 70,
  matchConfidence: 62,
  ...overrides,
});

const policy = {
  jobFamilies: ["SUPPORT", "NETWORK_NOC"],
  seniorities: ["JUNIOR"],
  locationPolicy: {
    priorities: [{ priority: 1, location: "Brasil", workModel: "REMOTE", remoteScope: "Brasil", accepted: true }],
    allowOnsiteOutsideArea: false,
  },
};

test("C2: N1, N2 e N3 de suporte não são níveis de senioridade profissional", () => {
  assert.equal(seniorityLevel("Analista de Suporte N1"), null);
  assert.equal(seniorityLevel("Service Desk N2"), null);
  assert.equal(seniorityLevel("Suporte N3"), null);
  assert.equal(seniorityLevel("Analista de Suporte Júnior"), 1);
  assert.equal(seniorityLevel("Analista de Suporte Pleno"), 2);
});

test("C2: ranking persiste dimensões e contribuições sem misturar confiança com compatibilidade", () => {
  const priority = calculateOpportunityPriority({
    job: job(), analysis: analysis(), jobHuntPolicies: [policy],
    intent: { families: policy.jobFamilies, seniorities: policy.seniorities, locationPolicy: policy.locationPolicy },
  });
  assert.equal(priority.components.compatibility, 76);
  assert.equal(priority.components.confidence, 62);
  assert.equal(priority.components.hardRequirementCoverage, 90);
  assert.equal(priority.components.careerFamilyRelevance, 100);
  assert.equal(priority.components.locationCompatibility, 100);
  assert.equal(priority.trace.finalScore, priority.score);
  assert.ok(priority.trace.contributions.compatibility > priority.trace.contributions.confidence);
});

test("C2: requisito repetido não altera score quando a análise canônica é a mesma", () => {
  const input = { job: job(), analysis: analysis(), jobHuntPolicies: [policy], intent: { families: policy.jobFamilies, seniorities: policy.seniorities, locationPolicy: policy.locationPolicy } };
  const single = calculateOpportunityPriority({ ...input, requirements: [{ label: "Active Directory", required: true }] });
  const repeated = calculateOpportunityPriority({ ...input, requirements: Array(3).fill({ label: "Active Directory", required: true }) });
  assert.equal(single.score, repeated.score);
});

test("C2: família desconhecida não recebe crédito neutro suficiente para dominar o topo", () => {
  const known = calculateOpportunityPriority({
    job: job(), analysis: analysis(), jobHuntPolicies: [policy],
    intent: { families: policy.jobFamilies, seniorities: policy.seniorities, locationPolicy: policy.locationPolicy },
  });
  const unknown = calculateOpportunityPriority({
    job: job({ title: "Analista de Cobrança Júnior", description: "Cobrança e negociação com clientes." }),
    analysis: analysis(), jobHuntPolicies: [policy],
    intent: { families: policy.jobFamilies, seniorities: policy.seniorities, locationPolicy: policy.locationPolicy },
  });
  assert.equal(known.components.careerFamilyRelevance, 100);
  assert.equal(unknown.components.careerFamilyRelevance, 10);
  assert.ok(known.score > unknown.score);
});

test("C2: recall usa todo o ground truth e vagas filtradas não recebem rank operacional", () => {
  const diagnostics = [
    { reference: { perceivedSource: "fixture" }, status: "FOUND_AUTOMATICALLY", rankingPosition: 3 },
    { reference: { perceivedSource: "fixture" }, status: "FOUND_BUT_RANKED_LOW", rankingPosition: 30 },
    { reference: { perceivedSource: "fixture" }, status: "FOUND_BUT_FILTERED", rankingPosition: null, scoreTrace: { filter: { hardBlockers: ["SENIORITY_MISMATCH"] } } },
    { reference: { perceivedSource: "fixture" }, status: "SOURCE_NOT_IMPLEMENTED", rankingPosition: null },
  ];
  const summary = CoverageBenchmarkService.prototype.summarize.call({ store: { jobs: { findById: () => null } } }, diagnostics);
  assert.equal(summary.top10Recall, 0.25);
  assert.equal(summary.top25Recall, 0.25);
  assert.equal(summary.rankedPositiveCount, 2);
  assert.equal(summary.filteredPositiveRate, 0.25);
  assert.equal(summary.hardBlockFalsePositiveRate, 0.25);
  assert.equal(summary.precisionAt10, null);
});
