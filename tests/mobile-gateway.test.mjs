import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test, { after, before } from "node:test";
import { createMobileGateway, mobileApplicationPortalUrl } from "../server/mobile/mobile-gateway.mjs";
import {
  authenticateMobileRequest,
  mobileGatewayConfig,
} from "../server/mobile/mobile-auth.mjs";
import {
  projectHunt,
  projectOpportunity,
  projectToday,
  projectNextAction,
} from "../server/mobile/mobile-projections.mjs";
import { MobileIdempotencyStore } from "../server/mobile/mobile-idempotency.mjs";

const identityHeaders = {
  "tailscale-user-login": "candidate@example.com",
  "tailscale-user-name": "Candidate",
};

test("proxy mobile exige o endereco exato mesmo com identidade permitida", () => {
  const config=mobileGatewayConfig({MOBILE_GATEWAY_TRUST_PROXY:'true',MOBILE_GATEWAY_ALLOWED_TAILSCALE_USERS:'candidate@example.com',CAREER_WEB_PROXY_ADDRESSES:'172.21.0.1'});
  assert.equal(authenticateMobileRequest({headers:identityHeaders,socket:{remoteAddress:'::ffff:172.21.0.1'}},config).login,'candidate@example.com');
  for(const remoteAddress of ['172.21.0.7','127.0.0.1'])assert.throws(()=>authenticateMobileRequest({headers:identityHeaders,socket:{remoteAddress}},config),error=>error.code==='MOBILE_GATEWAY_PROXY_REQUIRED');
  assert.throws(()=>authenticateMobileRequest({headers:identityHeaders,socket:{remoteAddress:'172.21.0.1'}},{...config,proxyAddresses:[]}),error=>error.code==='MOBILE_GATEWAY_PROXY_REQUIRED');
});

test("proxima acao de dominio vira texto compativel com Android", () => {
  assert.equal(projectNextAction({ code: "ANSWER", label: "Responder", reason: "Confirme seu nivel de ingles." }), "Confirme seu nivel de ingles.");
  assert.equal(projectNextAction("Resolver CAPTCHA"), "Resolver CAPTCHA");
  assert.equal(projectNextAction({}), null);
});

test("link manual mobile rejeita credenciais e protocolos inseguros", () => {
  assert.equal(mobileApplicationPortalUrl("https://jobs.lever.co/acme/42"), "https://jobs.lever.co/acme/42");
  for (const value of ["javascript:alert(1)", "http://example.test/job", "https://user:secret@example.test/job"])
    assert.equal(mobileApplicationPortalUrl(value), "");
});

let server;
let baseUrl;
let connection;
let run;
let queueCalls = 0;
let feedbackCalls = 0;
let applicationActionCalls = 0;

const profile = {
  id: "profile-main",
  name: "Infraestrutura e suporte",
  enabled: true,
  nextRunAt: "",
};

const store = {
  database: {},
  jobHuntRuns: {
    active: () => (run?.status === "RUNNING" ? [run] : []),
    list: () => (run ? [run] : []),
    findById: (id) => (run?.id === id ? run : null),
  },
  jobs: {
    findById: (id) =>
      id === "job-1" ? { id, title: "Analista de Infraestrutura" } : null,
  },
  jobFeedback: {
    save: (jobId, input) => {
      feedbackCalls++;
      return { jobId, ...input, updatedAt: "2026-10-08T12:00:00.000Z" };
    },
  },
  resumeArtifacts: { forVersion: () => [{ artifactType: "PDF", status: "READY" }] },
  resumeVersions: { findById: () => ({ id: "version-1", resumeId: "resume-1" }) },
  resumeArtifactService: { readAllowed: async () => Buffer.from("%PDF-test") },
  applicationQuestions: { forApplication: () => [] },
  applications: {
    events: () => [],
    findById: (id) => id === "application-1"
      ? { id, resumeVersionId: "version-1" }
      : null,
  },
};

const jobHuntService = {
  queueManual: (criteria,options) => { queueCalls++; return {id:'manual-mobile',profileId:options.profileId,status:'RUNNING',report:{},criteria}; },
  listProfiles: () => [profile],
  queue: (profileId) => {
    queueCalls++;
    run = {
      id: "hunt-1",
      profileId,
      triggerType: "MOBILE",
      status: "RUNNING",
      startedAt: "2026-10-08T12:00:00.000Z",
      report: {
        progress: { stage: "SEARCHING", completedRequests: 2, totalRequests: 8 },
      },
    };
    return run;
  },
  pause: (id) => {
    assert.equal(id, "hunt-1");
    run = { ...run, status: "SKIPPED", errorCode: "USER_PAUSED" };
    return run;
  },
};

const inbox = {
  generatedAt: "2026-10-08T12:00:00.000Z",
  daily: {
    status: "ACTION_REQUIRED",
    headline: "Há ações prontas para avançar",
    totalActions: 1,
    urgentActions: 0,
    highImpactActions: 1,
  },
  categories: { OPPORTUNITIES: 1, RESUMES: 0, APPLICATIONS: 0 },
  items: [
    {
      key: "opportunity:job-1",
      category: "OPPORTUNITIES",
      inboxPriority: 90,
      title: "Analista de Infraestrutura",
      description: "Empresa · Brasília",
      why: ["Boa aderência ao perfil."],
      cta: { label: "Revisar", view: "pipeline", jobId: "job-1" },
    },
  ],
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...identityHeaders, ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

before(async () => {
  connection = new DatabaseSync(":memory:");
  connection.exec(
    await readFile("db/migrations/052_mobile_gateway.sql", "utf8"),
  );
  store.database.connection = connection;
  server = createMobileGateway({
    config: mobileGatewayConfig({
      MOBILE_GATEWAY_ALLOWED_TAILSCALE_USERS: "candidate@example.com",
    }),
    store,
    jobHuntService,
    decisionInbox: {
      read: async () => inbox,
      scheduleRebuild: () => {},
    },
    opportunityService: {
      page: async () => ({
        opportunities: [
          {
            job: {
              id: "job-1",
              title: "Analista de Infraestrutura",
              company: "Empresa",
              location: "Brasília",
            },
            analysis: { overallScore: 88, matched: ["Linux"] },
            decision: {
              disposition: "RECOMMENDED",
              decisionExplanation: { summary: "Boa aderência." },
            },
            priority: { score: 90 },
            freshness: { current: true },
          },
        ],
        pagination: { offset: 0, limit: 20, total: 1, hasMore: false },
      }),
      invalidate: () => {},
    },
    experienceService: {
      opportunityWorkspace: async () => null,
      applications: () => [{ application: { id: "application-1", jobId: "job-1", resumeVersionId: "version-1", status: "WAITING_USER", updatedAt: "2026-10-08T12:00:00.000Z" }, job: { id: "job-1", title: "Analista de Infraestrutura", company: "Empresa", applicationUrl: "https://www.nerdin.com.br/vaga_emprego/infra-12345.php" }, analysis: { overallScore: 88 }, pendingQuestions: 0, nextAction: "Resolver CAPTCHA" }],
    },
    applicationActions: { resume: async ({ applicationId }) => {
      if(applicationId==='stale')throw Object.assign(new Error('Revise e aprove a versao atual antes de retomar.'),{status:409,code:'DECISION_CONTEXT_STALE'});
      applicationActionCalls++; return { status: "STARTED", applicationId };
    } },
    logger: { warn: () => {} },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test('mobile advanced hunt validates criteria, is idempotent and rejects unknown saved profiles',async()=>{
  const before=queueCalls,headers={'content-type':'application/json','idempotency-key':'mobile-advanced-0001'},body=JSON.stringify({search:{queries:['Cloud'],locations:['Brasilia'],workModels:['REMOTE'],seniorities:['JUNIOR'],sourcePreferences:['gupy'],prepareResume:false}});
  const first=await request('/api/mobile/v1/hunts',{method:'POST',headers,body});
  assert.equal(first.response.status,202);assert.equal(first.body.hunt.profileId,'job-hunt-mobile-manual');
  assert.equal((await request('/api/mobile/v1/hunts',{method:'POST',headers,body})).response.headers.get('idempotent-replayed'),'true');assert.equal(queueCalls,before+1);
  const missing=await request('/api/mobile/v1/hunts',{method:'POST',headers:{...headers,'idempotency-key':'mobile-missing-0001'},body:JSON.stringify({profileId:'does-not-exist'})});assert.equal(missing.response.status,404);assert.equal(queueCalls,before+1);
  const previousRun=run;run={id:'running-mobile',profileId:'job-hunt-mobile-manual',status:'RUNNING'};
  try{const blocked=await request('/api/mobile/v1/hunts',{method:'POST',headers:{...headers,'idempotency-key':'mobile-active-0001'},body});assert.equal(blocked.response.status,409);assert.equal(queueCalls,before+1);}finally{run=previousRun;}
});

after(() => {
  server.close();
  connection.close();
});

test("configuração e autenticação exigem identidade permitida", () => {
  const config = mobileGatewayConfig({
    MOBILE_GATEWAY_ENABLED: "true",
    MOBILE_GATEWAY_ALLOWED_TAILSCALE_USERS:
      "CANDIDATE@example.com, amigo@example.com",
  });
  assert.equal(config.enabled, true);
  assert.deepEqual(config.allowedUsers, [
    "candidate@example.com",
    "amigo@example.com",
  ]);
  assert.throws(
    () =>
      authenticateMobileRequest(
        { headers: {}, socket: { remoteAddress: "127.0.0.1" } },
        config,
      ),
    (error) => error.code === "TAILSCALE_IDENTITY_REQUIRED",
  );
});

test("projeções móveis removem excesso e preservam estado visível", () => {
  const projectedRun = projectHunt(
    {
      id: "hunt-1",
      profileId: profile.id,
      triggerType: "MOBILE",
      status: "RUNNING",
      startedAt: "2026-10-08T12:00:00.000Z",
      rawCount: 12,
      canonicalCount: 9,
      report: {
        progress: { stage: "SEARCHING", completedRequests: 3, totalRequests: 8 },
        recentDiscoveries: [{ id: "job-1", title: "Infra", company: "Empresa" }],
      },
    },
    [profile],
  );
  assert.equal(projectedRun.profileName, profile.name);
  assert.equal(projectedRun.progress.completedRequests, 3);
  assert.equal(projectOpportunity({ job: { id: "job-1" }, priority: { score: 88 } }).score, 88);
  assert.equal(projectToday(inbox, projectedRun).activeHunt.id, "hunt-1");
});

test("health rejeita ausência de identidade e aceita usuário da allowlist", async () => {
  const denied = await fetch(`${baseUrl}/api/mobile/v1/health`);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).code, "TAILSCALE_IDENTITY_REQUIRED");

  const { response, body } = await request("/api/mobile/v1/health");
  assert.equal(response.status, 200);
  assert.equal(body.identity.login, "candidate@example.com");
});

test("today e oportunidades retornam DTOs compactos", async () => {
  const today = await request("/api/mobile/v1/today");
  assert.equal(today.response.status, 200);
  assert.equal(today.body.today.actions[0].cta.jobId, "job-1");

  const opportunities = await request("/api/mobile/v1/opportunities");
  assert.equal(opportunities.body.opportunities[0].score, 88);
  assert.equal(opportunities.body.opportunities[0].strengths[0], "Linux");
});

test("início do Mass Hunt é idempotente e pausa permanece explícita", async () => {
  const previousCalls=queueCalls;
  const headers = {
    "content-type": "application/json",
    "idempotency-key": "mobile-hunt-0001",
  };
  const first = await request("/api/mobile/v1/hunts", {
    method: "POST",
    headers,
    body: JSON.stringify({ profileId: profile.id }),
  });
  const replay = await request("/api/mobile/v1/hunts", {
    method: "POST",
    headers,
    body: JSON.stringify({ profileId: profile.id }),
  });
  assert.equal(first.response.status, 202);
  assert.equal(replay.response.headers.get("idempotent-replayed"), "true");
  assert.equal(queueCalls, previousCalls+1);

  const paused = await request("/api/mobile/v1/hunts/hunt-1/pause", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "mobile-pause-0001",
    },
    body: "{}",
  });
  assert.equal(paused.body.hunt.status, "SKIPPED");
  assert.equal(paused.body.hunt.errorCode, "USER_PAUSED");
});

test("feedback valida decisão e não duplica efeito em retry", async () => {
  const headers = {
    "content-type": "application/json",
    "idempotency-key": "mobile-feedback-0001",
  };
  const first = await request("/api/mobile/v1/opportunities/job-1/feedback", {
    method: "PUT",
    headers,
    body: JSON.stringify({ userDecision: "APPLY" }),
  });
  const replay = await request("/api/mobile/v1/opportunities/job-1/feedback", {
    method: "PUT",
    headers,
    body: JSON.stringify({ userDecision: "APPLY" }),
  });
  assert.equal(first.body.feedback.userDecision, "APPLY");
  assert.equal(replay.response.headers.get("idempotent-replayed"), "true");
  assert.equal(feedbackCalls, 1);
});

test("caixa de decisões expõe pendência e retoma por ação idempotente", async () => {
  const detail = await request("/api/mobile/v1/applications/application-1");
  assert.equal(detail.body.application.jobId, "job-1");
  assert.equal(detail.body.application.portalUrl, "https://www.nerdin.com.br/vaga_candidatura.php?id=12345");
  const decisions = await request("/api/mobile/v1/decisions");
  assert.equal(decisions.body.decisions[0].kind, "HANDOFF");
  assert.deepEqual(decisions.body.decisions[0].actions, ["RESUME", "ANALYZE", "REJECT"]);
  const headers = { "content-type": "application/json", "idempotency-key": "mobile-resume-0001" };
  const first = await request("/api/mobile/v1/applications/application-1/actions", { method: "POST", headers, body: JSON.stringify({ action: "RESUME" }) });
  const replay = await request("/api/mobile/v1/applications/application-1/actions", { method: "POST", headers, body: JSON.stringify({ action: "RESUME" }) });
  assert.equal(first.response.status, 202);
  assert.equal(first.body.result.status, "STARTED");
  assert.equal(replay.response.headers.get("idempotent-replayed"), "true");
  assert.equal(applicationActionCalls, 1);
});

test("mobile recebe versao e fingerprint da pergunta para rejeitar uma resposta de tela antiga",async()=>{
  const previous=store.applicationQuestions.forApplication;
  store.applicationQuestions.forApplication=()=>[{id:"question-versioned",fingerprint:"question-fingerprint-v2",label:"Synthetic question",required:true,answerStatus:"USER_REQUIRED"}];
  try{
    const detail=await request("/api/mobile/v1/applications/application-1"),decisions=await request("/api/mobile/v1/decisions");
    assert.equal(detail.body.application.resumeVersionId,"version-1");
    assert.equal(detail.body.application.questions[0].fingerprint,"question-fingerprint-v2");
    assert.equal(decisions.body.decisions[0].questions[0].fingerprint,"question-fingerprint-v2");
  }finally{store.applicationQuestions.forApplication=previous;}
});

test('mobile preserva motivo e status do conflito de contexto sem executar a candidatura',async()=>{
  const calls=applicationActionCalls;
  const result=await request('/api/mobile/v1/applications/stale/actions',{method:'POST',headers:{'content-type':'application/json','idempotency-key':'mobile-stale-0001'},body:JSON.stringify({action:'RESUME'})});
  assert.equal(result.response.status,409);
  assert.equal(result.body.code,'DECISION_CONTEXT_STALE');
  assert.match(result.body.error,/Revise e aprove/);
  assert.equal(applicationActionCalls,calls);
});

test("PDF móvel usa a leitura íntegra do serviço de artefatos", async () => {
  const response = await fetch(`${baseUrl}/api/mobile/v1/applications/application-1/resume.pdf`, {
    headers: identityHeaders,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "%PDF-test");
});

test("reserva idempotente bloqueia uma segunda mutação concorrente", () => {
  const idempotency = new MobileIdempotencyStore(connection);
  const scope = { action: "concurrent-action", userLogin: "candidate@example.com" };
  assert.equal(idempotency.claim("mobile-concurrent-0001", scope).owned, true);
  assert.throws(
    () => idempotency.claim("mobile-concurrent-0001", scope),
    (error) => error.code === "IDEMPOTENCY_REQUEST_IN_PROGRESS",
  );
  idempotency.complete("mobile-concurrent-0001", {
    ...scope,
    status: 200,
    body: { ok: true },
  });
  const replay = idempotency.claim("mobile-concurrent-0001", scope);
  assert.equal(replay.owned, false);
  assert.deepEqual(replay.body, { ok: true });
});
