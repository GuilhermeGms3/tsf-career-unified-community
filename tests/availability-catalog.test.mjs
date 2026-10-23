import assert from "node:assert/strict";
import test from "node:test";
import { OpportunityAvailabilityService } from "../src/opportunities/opportunity-availability-service.mjs";
import { AvailabilityScheduler } from "../src/opportunities/availability-scheduler.mjs";
import { opportunityFreshness } from "../src/opportunities/opportunity-freshness.mjs";
import { inspectJobPage, publicJobEndpoint, checkPublicJobApi } from "../src/opportunities/availability-detector.mjs";
import { createOpportunityRoutes } from "../server/routes/opportunity-routes.mjs";
import { ResumeBatchService } from "../src/resume/batch/resume-batch-service.mjs";

const job = { id: "job", title: "Analista de Infraestrutura", url: "https://www.nerdin.com.br/vaga_emprego/analista-123.php", lifecycleStatus: "OPEN" };
const page = (data, url = job.url) => ({ data, url, response: { status: 200 } });
const posting = changes => `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: job.title, description: "Linux", url: job.url, ...changes })}</script>`;

test("HTTP 200 vazio, login, CAPTCHA e redirect não comprovam vaga ativa", () => {
  for (const result of [page("<div id='app'></div>"), page("<h1>Entrar</h1>"), page("Verify you are human"), page(posting({}), "https://www.nerdin.com.br/")])
    assert.equal(inspectJobPage(job, result).status, "INCONCLUSIVE");
});

test("JobPosting exige identidade; prazo do portal encerra, idade sozinha não", () => {
  assert.equal(inspectJobPage(job, page(posting({}))).status, "AVAILABLE");
  assert.equal(inspectJobPage(job, page(posting({ url: "https://www.nerdin.com.br/outra" }))).status, "INCONCLUSIVE");
  assert.equal(inspectJobPage(job, page(posting({ validThrough: "2020-01-01" }))).status, "CLOSED");
  assert.equal(inspectJobPage(job, page(posting({ validThrough: "2020-01-01" }) + '<button class="disabled:text-gray">Efetuar candidatura</button>')).status, "INCONCLUSIVE");
  assert.equal(inspectJobPage({ ...job, datePosted: "2020-01-01" }, page(posting({}))).status, "AVAILABLE");
  assert.equal(inspectJobPage(job, page(`<h1>${job.title}</h1><button>Quero essa vaga</button>`)).status, "AVAILABLE");
});

test("aviso de encerramento em script ou rodapé não encerra vaga identificada", () => {
  assert.equal(inspectJobPage(job, page(`${posting({})}<script>const copy='vaga encerrada';</script><footer>Vaga encerrada</footer>`)).status, "AVAILABLE");
});

test("Gupy exige id e tenant corretos e reconhece publicação retirada", () => {
  const gupy = { ...job, url: "https://acme.gupy.io/jobs/123" };
  const html = value => page(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { subdomain: "acme", job: { id: 123, ...value } } } })}</script>`, gupy.url);
  assert.equal(inspectJobPage(gupy, html({})).status, "AVAILABLE");
  assert.equal(inspectJobPage(gupy, html({ isPublished: false })).status, "CLOSED");
  assert.equal(inspectJobPage(gupy, html({ id: 456 })).status, "INCONCLUSIVE");
});

test("cinco ATS usam endpoints próprios com identidade validada", async () => {
  for (const url of ["https://jobs.lever.co/acme/abc", "https://job-boards.greenhouse.io/acme/jobs/123", "https://jobs.smartrecruiters.com/Acme/123-analista", "https://jobs.ashbyhq.com/acme/abc", "https://apply.workable.com/acme/j/ABC/"]) {
    const endpoint = publicJobEndpoint(url);
    const data = endpoint.collection ? { jobs: [{ id: endpoint.id, shortcode: endpoint.id, isListed: false, state: "California" }] } : { id: endpoint.id };
    assert.equal((await checkPublicJobApi(endpoint, { getJson: async () => ({ data }) })).status, "AVAILABLE");
  }
});

test("ausência oficial exige lista completa; bloqueios e schemas desconhecidos são inconclusivos", async () => {
  const endpoint = publicJobEndpoint("https://jobs.ashbyhq.com/acme/abc");
  assert.equal((await checkPublicJobApi(endpoint, { getJson: async () => ({ data: { jobs: [] } }) })).status, "CLOSED");
  for (const data of [{}, { jobs: [], hasMore: true }, { jobs: [], total: 10 }])
    assert.equal((await checkPublicJobApi(endpoint, { getJson: async () => ({ data }) })).status, "INCONCLUSIVE");
  for (const status of [403, 429, 502, 404])
    assert.equal((await checkPublicJobApi(endpoint, { getJson: async () => { throw Object.assign(new Error(), { status }); } })).status, "INCONCLUSIVE");
  const single = publicJobEndpoint("https://jobs.lever.co/acme/abc");
  assert.equal((await checkPublicJobApi(single, { getJson: async () => { throw Object.assign(new Error(), { status: 404 }); } })).status, "CLOSED");
  assert.equal((await checkPublicJobApi(single, { getJson: async () => ({ data: { id: "another" } }) })).status, "INCONCLUSIVE");
});

test("verificação preserva URL canônica, histórico limitado e permite reabrir com prova", async () => {
  let current = { ...job, canonicalUrl: job.url, closedAt: "2026-01-01", lifecycleStatus: "CLOSED", availabilityHistory: Array.from({ length: 10 }, () => ({ status: "CLOSED" })) };
  const service = new OpportunityAvailabilityService({ store: { jobs: { findById: () => current, upsert: value => (current = value) } }, client: { getText: async () => page(posting({})) } });
  await Promise.all([service.verify(job.id), service.verify(job.id)]);
  assert.equal(current.lifecycleStatus, "OPEN");
  assert.equal(current.closedAt, "");
  assert.equal(current.canonicalUrl, job.url);
  assert.equal(current.availabilityHistory.length, 10);
});

test("Nerdin verifica anúncio público, não a tela de login da candidatura", async () => {
  let current = { ...job, canonicalUrl: job.url, applicationUrl: "https://www.nerdin.com.br/vaga_candidatura.php?id=123" }, requested;
  const service = new OpportunityAvailabilityService({ store: { jobs: { findById: () => current, upsert: value => (current = value) } }, client: { getText: async url => { requested = url; return page(posting({})); } } });
  assert.equal((await service.verify(job.id)).availability.status, "AVAILABLE");
  assert.equal(requested, job.url);
  assert.match(current.applicationUrl, /vaga_candidatura/);
});

test("falha HTTP não encerra e resposta inconclusiva tira a confirmação recente", async () => {
  for (const status of [403, 429, 502]) {
    let current = { ...job, lastSeenAt: new Date().toISOString() };
    const service = new OpportunityAvailabilityService({ store: { jobs: { findById: () => current, upsert: value => (current = value) } }, client: { getText: async () => { throw Object.assign(new Error(), { status, code: `HTTP_${status}` }); } } });
    await service.verify(job.id);
    assert.equal(current.lifecycleStatus, "OPEN");
    assert.equal(current.availability.status, "INCONCLUSIVE");
    assert.equal(opportunityFreshness(current).current, false);
  }
});

test("404 após redirecionamento para login não encerra a publicação", async () => {
  let current = { ...job };
  const service = new OpportunityAvailabilityService({ store: { jobs: { findById: () => current, upsert: value => (current = value) } }, client: { getText: async () => { throw Object.assign(new Error(), { status: 404, finalUrl: "https://www.nerdin.com.br/login" }); } } });
  assert.equal((await service.verify(job.id)).availability.status, "INCONCLUSIVE");
  assert.equal(current.lifecycleStatus, "OPEN");
});

function scheduleFixture() {
  const metadata = new Map(), active = { value: null }, calls = [];
  const previous = { value: null };
  const store = { database: { getMetadata: (key, fallback) => metadata.get(key) || fallback, setMetadata: (key, value) => metadata.set(key, value) }, dailyRefreshRuns: { active: () => active.value, list: () => [], findById: () => previous.value } };
  let now = new Date("2026-10-14T12:00:00Z");
  const scheduler = new AvailabilityScheduler({ store, clock: () => now, refreshService: { status: () => active.value, start: options => { calls.push(options); return { id: "run" }; } } });
  return { scheduler, active, previous, calls, advance: () => { now = new Date(now.getTime() + 3_600_000); } };
}

test("agenda desligada não roda; intervalo persistido não repete e não disputa execução ativa", () => {
  const f = scheduleFixture();
  assert.equal(f.scheduler.tick(), null);
  f.scheduler.save({ enabled: true, everyHours: 1, batchSize: 100 });
  assert.equal(f.scheduler.tick(), null);
  f.advance();
  f.active.value = { id: "active" };
  assert.equal(f.scheduler.tick(), null);
  f.active.value = null;
  assert.equal(f.scheduler.tick().id, "run");
  assert.equal(f.calls[0].catalog, true);
  assert.equal(f.calls[0].skipSearch, true);
  assert.equal(f.scheduler.tick(), null);
  f.scheduler.save({ enabled: false, everyHours: 1, batchSize: 100 });
  f.advance();
  assert.equal(f.scheduler.tick(), null);
});

test("agenda rejeita tipos e limites inválidos", () => {
  const { scheduler } = scheduleFixture();
  for (const change of [{ enabled: "true" }, { everyHours: 0 }, { batchSize: 301 }, { everyHours: 1.1 }])
    assert.throws(() => scheduler.save({ enabled: true, everyHours: 24, batchSize: 100, ...change }), error => error.status === 400);
});

test("agenda continua lotes pendentes sem aguardar outro dia e para quando acaba", () => {
  const f = scheduleFixture();
  f.scheduler.save({ enabled: true, everyHours: 1, batchSize: 100 });
  f.advance();
  f.scheduler.tick();
  f.previous.value = { id: "run", status: "PARTIAL", remainingCount: 200 };
  assert.equal(f.scheduler.status().continuingSweep, true);
  assert.equal(f.scheduler.tick().id, "run");
  assert.ok(f.calls.at(-1).dueBefore);
  f.previous.value = { id: "run", status: "COMPLETED", remainingCount: 0 };
  assert.equal(f.scheduler.tick(), null);
});

test("contrato HTTP da política e rodada manual reutilizam os serviços canônicos", async () => {
  const f = scheduleFixture(), responses = [], starts = [];
  const route = createOpportunityRoutes({ availabilityScheduler: f.scheduler, dailyRefreshService: { start: options => { starts.push(options); return { id: "run" }; } }, readJson: async () => ({ enabled: true, everyHours: 24, batchSize: 100 }), json: (_, body, status = 200) => responses.push({ body, status }), sendError: (_, error) => { throw error; } });
  await route({ method: "PUT" }, {}, new URL("http://localhost/api/opportunities/verification-policy"));
  assert.equal(responses.at(-1).body.policy.enabled, true);
  await route({ method: "POST" }, {}, new URL("http://localhost/api/opportunities/verify"));
  assert.equal(responses.at(-1).status, 202);
  assert.equal(starts[0].catalog, true);
});

test("item encerrado sai da preparação em lote antes de chamar LLM", async () => {
  const changes = [];
  await ResumeBatchService.prototype.tailorItem.call({
    store: { resumeBatches: { findById: () => ({}), transitionItem: (...args) => changes.push(args) }, jobs: { findById: () => ({ lifecycleStatus: "CLOSED" }) }, resumes: { findById: () => ({}) }, analyses: { findById: () => ({}) } },
    profileProvider: async () => ({}), tailorEngine: { tailor: () => { throw new Error("Não deve chamar LLM"); } },
  }, { id: "item", batchRunId: "batch", jobId: "closed" });
  assert.equal(changes[0][1], "CANCELLED");
  assert.equal(changes[0][2].failureCode, "JOB_CLOSED");
});
