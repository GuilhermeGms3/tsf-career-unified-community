import assert from "node:assert/strict";
import test from "node:test";
import { OpportunityAvailabilityService } from "../src/opportunities/opportunity-availability-service.mjs";
import { duplicateOpportunityKey, opportunityFreshness } from "../src/opportunities/opportunity-freshness.mjs";
import { OpportunityService } from "../src/opportunities/opportunity-service.mjs";
import { DecisionInboxService } from "../src/product/decision-inbox-service.mjs";

const date = (days = 0) => new Date(Date.now() - days * 86_400_000).toISOString();
const job = (id, overrides = {}) => ({
  id,
  title: "Analista DevOps Júnior",
  company: "Acme Tecnologia",
  location: "Brasília, DF",
  description: "Linux, Docker e integração contínua em ambiente de produção.",
  url: `https://example.test/jobs/${id}`,
  lifecycleStatus: "OPEN",
  lastSeenAt: date(),
  lastCheckedAt: date(),
  createdAt: date(),
  updatedAt: date(),
  ...overrides,
});

test("frescor exige confirmação recente para entrar em Hoje", () => {
  assert.equal(opportunityFreshness(job("fresh")).current, true);
  const old = opportunityFreshness(job("old", { lastSeenAt: date(8), lastCheckedAt: date(8) }));
  assert.equal(old.current, false);
  assert.equal(old.status, "UPDATE_RECOMMENDED");
  assert.equal(opportunityFreshness(job("closed", { lifecycleStatus: "CLOSED" })).status, "CLOSED");
});

test("assinatura de duplicata normaliza empresa, cargo e localização", () => {
  assert.equal(
    duplicateOpportunityKey(job("a")),
    duplicateOpportunityKey(job("b", { title: "Analista DevOps Junior", company: "ACME TECNOLOGIA", location: "Brasilia - DF" })),
  );
});

test("assinatura de duplicata usa URL final quando faltam dados semânticos", () => {
  assert.equal(
    duplicateOpportunityKey(job("url-a", { company: "", canonicalUrl: "https://jobs.example.test/vagas/123?utm_source=board" })),
    duplicateOpportunityKey(job("url-b", { company: "", canonicalUrl: "https://jobs.example.test/vagas/123#apply" })),
  );
});

test("projeção agrupa anúncios exatos e preserva as origens", async () => {
  const jobs = [job("indeed", { provider: "jobspy", source: "indeed" }), job("linkedin", { provider: "jobspy", source: "linkedin" })];
  const store = {
    jobs: { all: () => jobs }, analyses: { all: () => [] }, applications: { all: () => [] },
    jobFeedback: { all: () => [] }, jobAlerts: { list: () => [] }, jobHuntProfiles: { all: () => [] },
    jobHuntRuns: { list: () => [] }, jobRequirements: { forJob: () => [] }, analysisItems: { forAnalysis: () => [] },
    candidateFacts: { active: () => [] },
  };
  const result = await new OpportunityService({ store, profileProvider: async () => ({}) }).list();
  assert.equal(result.length, 1);
  assert.equal(result[0].job.duplicateGroup.count, 2);
  assert.deepEqual(result[0].job.duplicateGroup.providers, ["jobspy"]);
  // The freshest representative may change source order by one millisecond.
  assert.deepEqual([...result[0].job.duplicateGroup.sources].sort(), ["indeed", "jobspy", "linkedin"]);
});

test("verificação pública persiste disponível, encerrada e inconclusiva", async () => {
  let current = job("verify");
  const store = { jobs: { findById: () => current, upsert: (value) => (current = value) } };
  const available = new OpportunityAvailabilityService({ store, client: { getText: async () => ({ data: `<h1>${current.title}</h1><button>Candidatar</button>`, url: current.url, response: { status: 200 } }) } });
  assert.equal((await available.verify(current.id)).availability.status, "AVAILABLE");

  const closed = new OpportunityAvailabilityService({ store, client: { getText: async () => ({ data: "Esta vaga foi encerrada", url: current.url, response: { status: 200 } }) } });
  assert.equal((await closed.verify(current.id)).job.lifecycleStatus, "CLOSED");

  current = job("blocked");
  const inconclusive = new OpportunityAvailabilityService({ store, client: { getText: async () => { throw Object.assign(new Error("bloqueado"), { status: 403, code: "HTTP_403" }); } } });
  const result = await inconclusive.verify(current.id);
  assert.equal(result.availability.status, "INCONCLUSIVE");
  assert.equal(result.job.lifecycleStatus, "OPEN");
});

test("Hoje retira vaga vencida, pede atualização e mantém análise da vaga atual", async () => {
  const opportunities = [
    {
      job: job("stale"),
      analysis: null,
      priority: { score: 82 },
      decision: { disposition: "BLOCKED", visibility: { today: false }, hardBlockers: ["STALE"] },
      freshness: { current: false, needsUpdate: true },
    },
    {
      job: job("current"),
      analysis: null,
      priority: { score: 80 },
      decision: { disposition: "RECOMMENDED", visibility: { today: true }, hardBlockers: [] },
      freshness: { current: true },
    },
  ];
  const store = {
    decisionDismissals: { keys: () => new Set() }, applications: { all: () => [] },
    applicationQuestions: { forApplication: () => [] }, resumeVersions: { list: () => [] },
    jobs: { findById: () => null },
  };
  const inbox = await new DecisionInboxService({ store, opportunityService: { list: async () => opportunities } }).build();
  assert.equal(inbox.awaitingRefresh, 1);
  assert.ok(inbox.items.some((item) => item.key === "opportunities:refresh"));
  assert.ok(!inbox.items.some((item) => item.key === "opportunity:stale"));
  assert.equal(inbox.items.find((item) => item.key === "opportunity:current").cta.label, "Analisar vaga");
});

test("Hoje mantém somente a revisão de currículo mais recente por vaga", async () => {
  const store = {
    decisionDismissals: { keys: () => new Set() }, applications: { all: () => [] },
    applicationQuestions: { forApplication: () => [] }, resumeVersions: { list: () => [] },
    jobs: { findById: () => job("target") },
    resumeTailoring: { list: () => [
      { id: "new", jobId: "target", resumeId: "resume" },
      { id: "old", jobId: "target", resumeId: "alternate-resume" },
    ] },
  };
  const opportunity = {
    job: job("target"), freshness: { current: true }, priority: { score: 80 },
    decision: { disposition: "RECOMMENDED", visibility: { today: true }, hardBlockers: [] },
  };
  const inbox = await new DecisionInboxService({ store, opportunityService: { list: async () => [opportunity] } }).build();
  assert.deepEqual(inbox.items.filter((item) => item.category === "RESUMES").map((item) => item.key), ["tailoring:new"]);
});

test("triagem diária consolida perguntas da mesma candidatura e expõe uma ordem decisiva", async () => {
  const application = { id: "application", jobId: "job", status: "WAITING_USER", createdAt: date(2), updatedAt: date() };
  const store = {
    decisionDismissals: { keys: () => new Set() },
    applications: { all: () => [application], events: () => [] },
    applicationQuestions: { forApplication: () => [
      { id: "first", answerStatus: "USER_REQUIRED", label: "Disponibilidade" },
      { id: "second", answerStatus: "USER_REQUIRED", label: "Pretensão" },
    ] },
    resumeVersions: { list: () => [] }, jobs: { findById: () => null },
  };
  const inbox = await new DecisionInboxService({ store, opportunityService: { list: async () => [] } }).build();
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].key, "question:first");
  assert.equal(inbox.items[0].cta.questionId, "first");
  assert.equal(inbox.daily.primaryKey, "question:first");
  assert.equal(inbox.daily.status, "URGENT");
  assert.equal(inbox.daily.totalActions, 1);
});
