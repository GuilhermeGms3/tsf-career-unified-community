import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";
import { normalizeJobHuntProfile } from "../src/automation/job-hunt-policy.mjs";
import {
  classifyThresholdScore,
  funnelFromFixture,
} from "../src/discovery/v4/mass-hunt-funnel.mjs";
import { DiscoveryV4Service } from "../src/discovery/v4/discovery-v4-service.mjs";
import { RuntimeCapabilityService } from "../src/discovery/v4/runtime-capability-service.mjs";
import { LeadPromotionService } from "../src/discovery/v4/lead-promotion-service.mjs";
import { CommunityDiscoveryService } from "../src/discovery/community/community-discovery-service.mjs";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";

const profile = {
  career: {
    targetRoles: ["DevOps"],
    skills: ["Linux"],
    workModels: ["REMOTE"],
  },
  personal: { country: "Brasil" },
};
const job = (description = "Terraform obrigatório") => ({
  id: "job-v411",
  title: "DevOps Junior",
  company: "Acme",
  description,
  location: "Brasil",
  workModel: "REMOTE",
  url: "https://jobs.example/v411",
});
const fact = (name) => ({
  key: `skill.${name.toLowerCase()}`,
  unitType: "TOOL",
  value: name,
  rawText: name,
  lifecycleStatus: "ACTIVE",
  verificationStatus: "USER_CONFIRMED",
  sourceType: "CANDIDATE_KNOWLEDGE",
  confidence: 1,
});

test("UNKNOWN obrigatório reduz Evidence Coverage e Confidence sem virar zero", () => {
  const analysis = runAtsMatcherV2({
    job: job("Linux obrigatório\nTerraform obrigatório"),
    profile,
    knowledgeFacts: [fact("Linux")],
  });
  const terraform = analysis.items.find(
    (item) => item.requirement.normalizedName === "terraform",
  );
  assert.equal(terraform.status, "UNKNOWN");
  assert.equal(terraform.score, null);
  assert.ok(analysis.overallScore > 0);
  assert.ok(analysis.evidenceCoverage < 100);
  assert.ok(analysis.matchConfidence < analysis.evidenceCoverage);
  assert.equal(analysis.eligibility, "REVIEW_REQUIRED");
});

test("evidência completa supera o mesmo job com Terraform UNKNOWN", () => {
  const partial = runAtsMatcherV2({
      job: job("Linux obrigatório\nTerraform obrigatório"),
      profile,
      knowledgeFacts: [fact("Linux")],
    }),
    complete = runAtsMatcherV2({
      job: job("Linux obrigatório\nTerraform obrigatório"),
      profile,
      knowledgeFacts: [fact("Linux"), fact("Terraform")],
    });
  assert.ok(complete.evidenceCoverage > partial.evidenceCoverage);
  assert.ok(complete.matchConfidence > partial.matchConfidence);
});

test("prioridade compara Opportunity Priority, não Technical Match", () => {
  assert.deepEqual(
    classifyThresholdScore(
      {
        technicalMatch: 92,
        opportunityPriority: 70,
        evidenceCoverage: 100,
        confidence: 90,
      },
      { consider: 60, priority: 85 },
    ),
    { filtered: false, relevant: true, priority: false },
  );
  assert.equal(
    classifyThresholdScore(
      {
        technicalMatch: 70,
        opportunityPriority: 92,
        evidenceCoverage: 100,
        confidence: 90,
      },
      { consider: 60, priority: 85 },
    ).priority,
    true,
  );
});

test("funil separa hiring signals, leads, canônicas, relevantes e prioritárias", () => {
  const funnel = funnelFromFixture({
    raw: 10,
    leads: 5,
    canonical: 4,
    relevant: 2,
    priority: 1,
    duplicates: 1,
  });
  assert.deepEqual(
    {
      signals: funnel.hiringRelevantSignals,
      leads: funnel.opportunityLeads,
      canonical: funnel.canonicalOpportunities,
      relevant: funnel.relevantOpportunities,
      priority: funnel.priorityOpportunities,
    },
    { signals: 10, leads: 5, canonical: 4, relevant: 2, priority: 1 },
  );
});

function v4Fixture(overrides = {}) {
  const publicWeb = overrides.publicWeb || {
      capability: () => ({ configured: false }),
      search: async () => [],
    },
    repository = overrides.repository || {
      listLeads: () => [],
      listSignals: () => [],
      createLead: (item) => ({ ...item, id: "lead", duplicate: false }),
      createSignal: () => ({}),
    },
    store = overrides.store || {
      providerConfigurations: { all: () => [] },
      watchlists: { all: () => [], boards: () => [] },
      discoveryV4: { listCommunitySources: () => [] },
    };
  return new DiscoveryV4Service({
    searchIntentService: {
      preview: () => ({
        queries: [{ query: "DevOps" }],
        budget: { maxQueries: 3 },
        truncated: false,
      }),
    },
    publicWeb,
    repository,
    jobHuntService: overrides.jobHuntService || {
      testSearch: async () => ({
        summary: {
          queries: 1,
          rawJobs: 0,
          normalized: 0,
          duplicates: 0,
          newJobs: 0,
          errors: 0,
        },
        reports: [],
      }),
      runManual: async () => ({
        status: "COMPLETED",
        queryCount: 1,
        providerCount: 1,
        rawCount: 0,
        canonicalCount: 0,
        duplicateCount: 0,
        report: { funnel: {}, sourceReports: [] },
      }),
    },
    evolutionService: overrides.evolutionService || {
      publicConfiguration: () => ({ configured: false }),
    },
    communityService: overrides.communityService || { configured: () => false },
    store,
    careerPageDiscovery: overrides.careerPageDiscovery,
  });
}

test("backlog comunitário histórico não vira descoberta do run atual", async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString(),
    service = v4Fixture({
      repository: {
        listLeads: () => [
          {
            sourceClass: "COMMUNITY_WHATSAPP_GROUP",
            createdAt: yesterday,
            reviewStatus: "NEEDS_REVIEW",
            riskState: "UNVERIFIED",
          },
        ],
        listSignals: () => [],
      },
    }),
    result = await service.run(
      { families: ["DEVOPS_SRE"], sourceClasses: ["COMMUNITY_WHATSAPP_GROUP"] },
      "MASS",
    );
  assert.equal(result.funnel.opportunityLeads, 0);
  assert.equal(
    result.reports.find(
      (item) => item.sourceClass === "COMMUNITY_WHATSAPP_GROUP",
    ).backlogAvailable,
    1,
  );
  assert.equal(result.summary.consulted, 0);
});

test("Mass reporta JOB_BOARD consultado quando JobSpy foi chamado", async () => {
  const service = v4Fixture({
      jobHuntService: {
        runManual: async () => ({
          status: "COMPLETED",
          queryCount: 1,
          providerCount: 1,
          rawCount: 2,
          canonicalCount: 2,
          duplicateCount: 0,
          report: {
            funnel: { rawDiscoveries: 2 },
            sourceReports: [
              {
                executionMode: "MASS",
                sourceClass: "JOB_BOARD",
                provider: "jobspy",
                status: "CONSULTED",
              },
            ],
          },
        }),
      },
    }),
    result = await service.run(
      { families: ["DEVOPS_SRE"], sourceClasses: ["JOB_BOARD"] },
      "MASS",
    );
  assert.equal(result.summary.consulted, 1);
  assert.equal(result.reports[0].sourceClass, "JOB_BOARD");
  assert.equal(result.reports[0].executionMode, "MASS");
});

test("Mass preserva métricas por provider e não transforma budget skipped em erro", async () => {
  const service = v4Fixture({
      jobHuntService: {
        runManual: async () => ({
          id: "run-provider-truth",
          status: "PARTIAL",
          queryCount: 1,
          providerCount: 2,
          report: {
            funnel: { rawDiscoveries: 5 },
            errors: [],
            sourceReports: [
              { sourceClass: "STRUCTURED_ATS", provider: "ashby", status: "CONSULTED", called: true, requestCount: 1, rawResults: 5, candidateResults: 4, newResults: 3, duplicates: 1, errors: [] },
              { sourceClass: "STRUCTURED_ATS", provider: "smartrecruiters", status: "BUDGET_SKIPPED", called: false, requestCount: 0, rawResults: 0, candidateResults: 0, newResults: 0, duplicates: 0, errors: [] },
            ],
          },
        }),
      },
    }),
    result = await service.run(
      {
        families: ["DEVOPS_SRE"],
        sourceClasses: ["STRUCTURED_ATS"],
        providerTargets: [
          { provider: "ashby", organizationKey: "acme" },
          { provider: "smartrecruiters", organizationKey: "example" },
        ],
      },
      "MASS",
    ),
    ashby = result.reports.find((item) => item.provider === "ashby"),
    skipped = result.reports.find(
      (item) => item.provider === "smartrecruiters",
    );
  assert.equal(ashby.rawResults, 5);
  assert.equal(ashby.newResults, 3);
  assert.equal(ashby.duplicates, 1);
  assert.equal(skipped.status, "BUDGET_SKIPPED");
  assert.equal(skipped.called, false);
  assert.equal(result.summary.error, 0);
});

test("Mass torna falha parcial do JobSpy visível no resumo e nos reports", async () => {
  const service = v4Fixture({
      jobHuntService: {
        runManual: async () => ({
          id: "run-partial",
          status: "PARTIAL",
          queryCount: 1,
          providerCount: 1,
          rawCount: 0,
          canonicalCount: 0,
          duplicateCount: 0,
          report: {
            funnel: { errors: 1 },
            sourceReports: [],
            errors: [
              {
                stage: "DISCOVERY",
                providers: ["jobspy"],
                errorCode: "PARTIAL_PROVIDER_FAILURE",
              },
            ],
          },
        }),
      },
    }),
    result = await service.run(
      { families: ["DEVOPS_SRE"], sourceClasses: ["JOB_BOARD"] },
      "MASS",
    );
  assert.equal(result.summary.consulted, 0);
  assert.equal(result.summary.error, 1);
  assert.equal(result.reports[0].sourceClass, "JOB_BOARD");
  assert.equal(result.reports[0].provider, "jobspy");
  assert.equal(result.reports[0].status, "ERROR");
  assert.equal(result.reports[0].errors[0].errorCode, "PARTIAL_PROVIDER_FAILURE");
});

test("providerTargets preserva organizationKey Ashby no round-trip", () => {
  const normalized = normalizeJobHuntProfile({
    queries: ["DevOps"],
    sourcePreferences: ["ashby"],
    providerTargets: [
      { provider: "ashby", organizationKey: "acme-tech", company: "Acme" },
    ],
  });
  assert.deepEqual(normalized.providerTargets, [
    {
      provider: "ashby",
      organizationKey: "acme-tech",
      company: "Acme",
      careerUrl: "",
    },
  ]);
});

test("Mass Hunt encaminha o target Ashby real ao Job Hunt", async () => {
  let received;
  const service = v4Fixture({
      jobHuntService: {
        runManual: async (input) => {
          received = input;
          return {
            status: "COMPLETED",
            queryCount: 1,
            providerCount: 1,
            rawCount: 0,
            canonicalCount: 0,
            duplicateCount: 0,
            report: {
              funnel: {},
              sourceReports: [
                {
                  sourceClass: "STRUCTURED_ATS",
                  provider: "ashby",
                  status: "CONSULTED",
                },
              ],
            },
          };
        },
      },
    }),
    result = await service.run(
      {
        name: "HOMOLOGATION_R1",
        families: ["DEVOPS_SRE"],
        sourceClasses: ["STRUCTURED_ATS"],
        providerTargets: [{ provider: "ashby", organizationKey: "acme-tech" }],
      },
      "MASS",
    );
  assert.equal(received.providerTargets[0].organizationKey, "acme-tech");
  assert.equal(received.name, "HOMOLOGATION_R1");
  assert.equal(result.summary.consulted, 1);
});

test("Career Page JSON-LD entra no pipeline canônico e é avaliada no Mass", async () => {
  let ingested = 0,
    evaluated = 0;
  const store = {
      providerConfigurations: { all: () => [] },
      watchlists: {
        all: () => [
          {
            name: "Acme",
            careerUrl: "https://acme.test/careers",
            active: true,
          },
        ],
        boards: () => [],
      },
      discoveryV4: { listCommunitySources: () => [] },
    },
    service = v4Fixture({
      store,
      careerPageDiscovery: {
        inspect: async () => ({
          jobs: [job()],
          strategy: "JSON_LD_JOB_POSTING",
        }),
      },
      jobHuntService: {
        discoveryService: {
          ingestResolvedJobs: (jobs) => {
            ingested += jobs.length;
            return {
              jobs: [{ ...jobs[0], id: "persisted" }],
              newCount: 1,
              duplicateCount: 0,
            };
          },
        },
        evaluateDiscoveredJobs: async (jobs) => {
          evaluated += jobs.length;
          return {
            matchEvaluated: 1,
            relevantOpportunities: 1,
            priorityOpportunities: 0,
          };
        },
      },
    });
  const result = await service.run(
    { families: ["DEVOPS_SRE"], sourceClasses: ["OFFICIAL_CAREER_PAGE"] },
    "MASS",
  );
  assert.equal(ingested, 1);
  assert.equal(evaluated, 1);
  assert.equal(result.funnel.canonicalOpportunities, 1);
  assert.equal(result.funnel.matchEvaluated, 1);
});

test("NEWS_BLOG usa handler Brave ou declara CONFIG_REQUIRED explicitamente", async () => {
  let calls = 0;
  const service = v4Fixture({
      publicWeb: {
        capability: () => ({ configured: true }),
        search: async () => {
          calls++;
          return [
            {
              title: "Empresa está contratando DevOps",
              excerpt: "Envie CV por email",
              url: "https://news.example/hiring",
            },
          ];
        },
      },
    }),
    result = await service.run(
      { families: ["DEVOPS_SRE"], sourceClasses: ["NEWS_BLOG_HIRING_SIGNAL"] },
      "TEST",
    );
  assert.equal(calls, 1);
  assert.equal(result.reports[0].status, "CONSULTED");
  assert.equal(result.funnel.hiringSignals, 1);
});

async function withStore(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "career-v411-")),
    store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("promoção genérica preserva proveniência Public Web", () =>
  withStore(async (store) => {
    const promoter = new LeadPromotionService({
        repository: store.discoveryV4,
        jobRepository: store.jobs,
      }),
      lead = store.discoveryV4.createLead({
        sourceClass: "PUBLIC_WEB",
        title: "DevOps",
        sourceUrl: "https://web.example/job",
        excerpt: "Hiring",
        provenance: { provider: "brave-public-web" },
      });
    assert.equal(promoter.promote(lead.id).job.provider, "brave-public-web");
  }));

test("promoção genérica preserva proveniência Manual", () =>
  withStore(async (store) => {
    const promoter = new LeadPromotionService({
        repository: store.discoveryV4,
        jobRepository: store.jobs,
      }),
      lead = store.discoveryV4.createLead({
        sourceClass: "MANUAL_LEAD_CAPTURE",
        title: "NOC Jr",
        sourceUrl: "https://manual.example/job",
        excerpt: "Vaga",
      });
    assert.equal(promoter.promote(lead.id).job.provider, "manual");
  }));

async function reconcileCase(sourceClass, provider) {
  return withStore(async (store) => {
    const sourceUrl = "https://jobs.acme.test/1";
    store.discoveryV4.createLead({
      sourceClass,
      title: "DevOps Engineer",
      company: "Acme",
      location: "Brasil",
      sourceUrl,
      excerpt: "Linux Terraform",
    });
    const now = new Date().toISOString(),
      official = store.jobs.upsert({
        id: "official-1",
        provider,
        title: "DevOps Engineer",
        company: "Acme",
        location: "Brasil",
        applicationUrl: sourceUrl,
        url: sourceUrl,
        description: "Linux Terraform",
        lifecycleStatus: "OPEN",
        createdAt: now,
        updatedAt: now,
      }),
      matches = store.discoveryV4.reconcileOfficialJob(official);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sourceClass, sourceClass);
  });
}
test("reconciliação WhatsApp + Ashby preserva duas fontes", () =>
  reconcileCase("COMMUNITY_WHATSAPP_GROUP", "ashby"));
test("reconciliação Public Web + Ashby preserva duas fontes", () =>
  reconcileCase("PUBLIC_WEB", "ashby"));
test("reconciliação Manual + Greenhouse preserva duas fontes", () =>
  reconcileCase("MANUAL_LEAD_CAPTURE", "greenhouse"));

test("runtime não confunde Evolution online e webhook com WhatsApp conectado", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const service = new RuntimeCapabilityService({
        discoveryV4: { capabilities: () => ({ sourceClasses: [] }) },
        evolutionService: {
          client: { baseUrl: "http://evolution" },
          publicConfiguration: () => ({
            configured: true,
            targetConfigured: true,
          }),
          webhookStatus: async () => ({
            status: "CONFIGURED",
            secretConfigured: true,
          }),
          connectionState: async () => ({
            connectionState: "DISCONNECTED",
            instanceExists: true,
          }),
        },
        providerTestService: { list: () => [] },
        intelligenceStatus: async () => ({ status: "OFFLINE" }),
        careerEngineUrl: "http://engine",
        n8nUrl: "http://n8n",
        integrationSettings: {
          get: () => ({
            enabled: true,
            webhookUrl: "http://n8n/webhook",
            secretEnvName: "MISSING_SECRET",
          }),
        },
      }),
      result = await service.diagnose();
    assert.equal(result.components.evolution.status, "ONLINE");
    assert.equal(result.components.whatsapp.status, "DISCONNECTED");
    assert.equal(result.components.whatsapp.outboundReady, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("Composer seleciona somente capabilities realmente prontas por default", () => {
  const service = v4Fixture({
      publicWeb: {
        capability: () => ({ configured: false }),
        search: async () => [],
      },
    }),
    classes = new Map(
      service
        .capabilities()
        .sourceClasses.map((item) => [item.sourceClass, item]),
    );
  assert.equal(classes.get("JOB_BOARD").defaultSelected, true);
  assert.equal(classes.get("STRUCTURED_ATS").defaultSelected, false);
  assert.equal(classes.get("PUBLIC_WEB").defaultSelected, false);
  assert.equal(classes.get("COMMUNITY_WHATSAPP_GROUP").defaultSelected, false);
});

test("filtro de CommunitySource descarta Senior Sales e aceita NOC Jr", () =>
  withStore(async (store) => {
    const secret = "secret",
      service = new CommunityDiscoveryService({
        repository: store.discoveryV4,
        jobRepository: store.jobs,
        instanceName: "career-unified",
        webhookSecret: secret,
      });
    store.discoveryV4.saveCommunitySource({
      groupJid: "123456@g.us",
      displayName: "NOC",
      enabled: true,
      filters: { jobFamilies: ["NOC"], seniorities: ["JUNIOR"] },
    });
    const payload = (id, text) => ({
      event: "MESSAGES_UPSERT",
      instance: "career-unified",
      data: {
        key: { id, remoteJid: "123456@g.us", fromMe: false },
        message: { conversation: text },
      },
    });
    assert.equal(
      service.ingest(
        payload(
          "one",
          "Estamos contratando Senior Sales Manager. Envie CV para rh@example.com",
        ),
        secret,
      ).reason,
      "SOURCE_SENIORITY_MISMATCH",
    );
    assert.equal(
      service.ingest(
        payload(
          "two",
          "Vaga para NOC Jr com Linux. Envie CV para rh@example.com",
        ),
        secret,
      ).outcome,
      "LEAD_CREATED",
    );
  }));

test("audit export inclui entrypoint, DB source, testes e migrations", async () => {
  const exporter = await readFile("scripts/export-audit.ps1", "utf8"),
    validator = await readFile("scripts/validate-audit-export.ps1", "utf8");
  assert.match(exporter, /"db"/);
  assert.match(exporter, /"server\.mjs"/);
  assert.match(validator, /db\/database\.mjs/);
  assert.match(validator, /analysis-without-resume-v4-1/);
  assert.match(validator, /cross-source-reconciliation-v4-1/);
});
test("audit limpo exclui dados e executa imports/testes mínimos", async () => {
  const validator = await readFile("scripts/validate-audit-export.ps1", "utf8");
  assert.match(validator, /node_modules/);
  assert.match(validator, /sqlite/);
  assert.match(validator, /ExtractToDirectory/);
  assert.match(validator, /node --test/);
});
