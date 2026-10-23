import test from "node:test";
import assert from "node:assert/strict";
import { SolidesProvider, RecruteiProvider } from "../src/discovery/providers/brazilian-public-providers.mjs";
import { publicAlternative, solidesPublicHtmlJobs } from "../src/discovery/providers/public-portal-recovery.mjs";
import { SafeHttpClient } from "../src/discovery/safe-http-client.mjs";
import { ResumeTailor } from "../src/intelligence/tasks/resume-tailor.mjs";
import { buildDeterministicTailoringVariants } from "../src/intelligence/tasks/deterministic-resume-tailor.mjs";
import { IntelligenceService } from "../src/intelligence/intelligence-service.mjs";
import { FakeProvider } from "../src/intelligence/providers/fake-provider.mjs";
import { TASK_TYPES } from "../src/intelligence/runtime/task-types.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { JobHuntService } from "../src/automation/job-hunt-service.mjs";

const failure = (code = "HTTP_502") => Object.assign(new Error(code), { code, status: Number(code.slice(5)) });
const text = "Monitoramento de redes com Zabbix e Grafana. Administração de DNS e DHCP. Automação com PowerShell e Python. Suporte técnico em Windows e Linux, configuração de Azure, Docker e Terraform, APIs REST e Git.";
const flight = jobs => `<script>self.__next_f.push(${JSON.stringify([1, `b:${JSON.stringify({ jobs })}\n`])})</script>`;

test("Sólides troca API indisponível por catálogo HTML sem repetir a API", async () => {
  let api = 0, html = 0;
  const provider = new SolidesProvider({ client: {
    getJson: async (url, options) => { api++; assert.equal(options.retries, 1); throw failure(); },
    getText: async (url, options) => { html++; assert.equal(options.retries, 0); assert.equal(String(url), "https://vagas.solides.com.br/vagas/todas"); return { data: flight([{ id: 42, title: "Analista de Suporte", description: text, companyName: "Acme", city: { name: "Brasília" }, state: { code: "DF" } }]) }; },
  } });
  const result = await provider.search({ query: "suporte", location: "Brasília", limit: 5 });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.diagnostic.strategy, "PUBLIC_HTML_CATALOG");
  assert.deepEqual(result.diagnostic.strategyAttempts.map(item => item.status), ["FAILED", "SUCCESS"]);
  assert.equal(api, 1); assert.equal(html, 1);
});

test("403 e 429 não disparam alternativa para contornar bloqueio", async () => {
  let calls = 0;
  for (const code of ["HTTP_403", "RATE_LIMITED", "PRIVATE_DISCOVERY_TARGET"])
    await assert.rejects(publicAlternative(failure(code), { primary: "API", alternate: "HTML", work: async () => { calls++; } }), error => error.code === code);
  assert.equal(calls, 0);
});

test("Sólides preserva páginas já coletadas quando as estratégias seguintes falham", async () => {
  let calls = 0;
  const provider = new SolidesProvider({ client: {
    getJson: async () => { if (++calls > 1) throw failure(); return { data: { totalPages: 2, count: 30, data: Array.from({ length: 14 }, (_, id) => ({ id: id + 1, title: "Suporte", description: text, companyName: "Acme" })) } }; },
    getText: async () => { throw failure(); },
  } });
  const result = await provider.search({ limit: 20 });
  assert.equal(result.jobs.length, 14);
  assert.equal(result.diagnostic.status, "DEGRADED");
  assert.equal(result.diagnostic.alternativesExhausted, true);
});

test("Mass Hunt não repete fonte cujas alternativas públicas já falharam", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "portal-strategy-")), store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  try {
    const calls = [];
    const service = new JobHuntService({ store, profileProvider: async () => ({}), discoveryService: { discover: async input => {
      const provider = input.providers[0]; calls.push(provider);
      return { run: { id: `run-${calls.length}` }, jobs: [], discoveredCount: 0, ok: provider !== "recrutei", sourceReports: [{ provider, status: provider === "recrutei" ? "ERROR" : "EMPTY", errorCode: provider === "recrutei" ? "HTTP_502" : "", alternativesExhausted: provider === "recrutei", strategyAttempts: provider === "recrutei" ? [{ strategy: "PUBLIC_SITEMAP", status: "FAILED" }, { strategy: "PUBLIC_HTML_LINKS", status: "FAILED" }] : [] }] };
    } } });
    const profile = service.saveProfile({ name: "Strategies", jobFamilies: ["SUPPORT"], seniorities: ["JUNIOR"], sourcePreferences: ["recrutei", "nerdin"], queries: ["suporte", "help desk", "service desk"], queryBudget: { maxQueries: 6, maxQueriesPerProvider: 6, maxRequests: 12 }, enabled: false });
    const run = await service.run(profile.id);
    assert.equal(calls.filter(provider => provider === "recrutei").length, 1);
    assert.ok(calls.filter(provider => provider === "nerdin").length > 1);
    const report = run.report.sourceReports.find(item => item.provider === "recrutei");
    assert.equal(report.alternativesExhausted, true);
    assert.match(report.recovery.message, /não será consultada novamente/);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Recrutei abandona fonte quando sitemap e HTML falham", async () => {
  const urls = [];
  const provider = new RecruteiProvider({ client: { getText: async url => { urls.push(String(url)); throw failure(); } } });
  await assert.rejects(provider.search(), error => error.code === "HTTP_502" && error.alternativesExhausted && error.strategyAttempts.length === 2);
  assert.equal(urls.length, 2);
  assert.ok(urls[0].endsWith("sitemap-vagas-1.xml"));
  assert.equal(urls[1], "https://empregos.recrutei.com.br/");
});

test("Recrutei extrai somente links públicos de vagas do próprio portal", async () => {
  const provider = new RecruteiProvider({ client: { getText: async url => {
    if (String(url).endsWith(".xml")) throw failure();
    return { data: '<a href="/vaga/suporte-42">Vaga</a><a href="http://127.0.0.1/vaga/43">Não</a><a href="/api/private">Não</a>' };
  } } });
  const result = await provider.loadCatalog();
  assert.match(result.data, /https:\/\/empregos\.recrutei\.com\.br\/vaga\/suporte-42/);
  assert.doesNotMatch(result.data, /127\.0\.0\.1|private/);
});

test("parser HTML resolve texto serializado sem executar JavaScript", () => {
  const description = "Descrição técnica com acentuação.", stream = `1e:T${Buffer.byteLength(description).toString(16)},${description}\nb:${JSON.stringify({ jobs: [{ id: 42, title: "Suporte", companyName: "Acme", description: "$1e" }] })}\n`;
  const html = `<script>throw new Error('never execute')</script><script>self.__next_f.push(${JSON.stringify([1, stream])})</script>`;
  assert.equal(solidesPublicHtmlJobs(html)[0].description, description);
  const splitHtml = [`1e:T${Buffer.byteLength(description).toString(16)},`, description, `b:${JSON.stringify({ jobs: [{ id: 42, title: "Suporte", companyName: "Acme", description: "$1e" }] })}\n`].map(part => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join("");
  assert.equal(solidesPublicHtmlJobs(splitHtml)[0].description, description);
  assert.throws(() => solidesPublicHtmlJobs("<html>Captcha</html>"), error => error.code === "SOLIDES_PUBLIC_HTML_INVALID");
});

test("budget por request permite desistir sem modificar retries globais", async () => {
  let calls = 0;
  const client = new SafeHttpClient({ retries: 2, fetchImpl: async () => { calls++; return new Response("down", { status: 502 }); } });
  await assert.rejects(client.getText("https://1.1.1.1/public", { retries: 0 }), error => error.code === "HTTP_502");
  assert.equal(calls, 1); assert.equal(client.retries, 2);
});

test("biblioteca salva diferencia famílias e reescreve experiência sem trocar cargo ou empresa", async () => {
  const resume = { id: "base", sections: { summary: "Profissional de TI.", experience: "Empresa Exemplo | Suporte N2 | 2024-2025\n• Automação de rotinas com Python.\n• Monitoramento de redes com Zabbix e Grafana.\n• Configuração de DNS e DHCP.", education: "Engenharia de Software em andamento", projects: text } };
  const offline = { execute: async () => ({ result: { changes: [] }, meta: { fallback: true } }) };
  const summaries = new Set();
  for (const [title, domain] of [["Desenvolvedor Backend", "DEVELOPMENT"], ["Analista de Redes", "NETWORK"], ["Analista NOC", "NOC"], ["Analista Cloud", "CLOUD"], ["Analista de Infraestrutura", "CLOUD_INFRA"], ["Analista de Suporte", "SUPPORT"]]) {
    const result = await new ResumeTailor(offline).tailor({ job: { title }, resume });
    assert.equal(result.meta.generationMode, "OFFLINE_LIBRARY");
    assert.equal(result.meta.selectedDomain, domain);
    assert.equal(result.meta.libraryVersion, "role-texts-v2");
    assert.equal(result.evidenceStatus, "VALID");
    summaries.add(result.tailoredResume.sections.summary);
    assert.match(result.tailoredResume.sections.experience, /Empresa Exemplo \| Suporte N2 \| 2024-2025/);
    assert.doesNotMatch(result.tailoredResume.sections.summary, /formação em Engenharia/);
  }
  assert.equal(summaries.size, 6);
  const development = await new ResumeTailor(offline).tailor({ job: { title: "Desenvolvedor Python" }, resume });
  assert.match(development.tailoredResume.sections.experience, /Desenvolvimento de automações de rotinas com Python/);
});

test("biblioteca não acrescenta stack da vaga sem evidência", () => {
  const variants = buildDeterministicTailoringVariants({ job: { title: "Desenvolvedor Kubernetes Rust" }, resume: { sections: { summary: "TI" } }, evidence: [{ id: "python", text: "Projeto Python", sourceSection: "projects" }] });
  assert.equal(variants.length, 3);
  for (const variant of variants) assert.doesNotMatch(variant.changes.map(change => change.proposed).join(" "), /Kubernetes|Rust/);
});

test("LLM volta a ser elegível após indisponibilidade sem reiniciar serviço", async () => {
  const provider = new FakeProvider({ mode: "offline", responses: { default: { changes: [{ targetId: "target-1", type: "REWRITE_SUMMARY", sourceEvidenceIds: ["e1"], proposed: "Suporte técnico.", reason: "Foco da vaga." }] } } });
  const service = new IntelligenceService({ provider, settings: { balancedModel: "fake-balanced" }, hardwareProfile: { memoryProfile: "NORMAL", recommendedConcurrency: 1 } });
  await service.refreshAvailability();
  const first = await service.execute(TASK_TYPES.RESUME_TAILORING, {}, { fallback: { changes: [] } });
  assert.equal(first.meta.fallback, true); assert.equal(provider.calls.length, 0);
  provider.mode = "valid"; service.availabilityCheckedAt = 0;
  await service.refreshAvailability();
  const second = await service.execute(TASK_TYPES.RESUME_TAILORING, {}, { fallback: { changes: [] } });
  assert.equal(second.meta.fallback, false); assert.equal(provider.calls.length, 1);
  provider.mode = "timeout";
  await service.execute(TASK_TYPES.RESUME_TAILORING, { different: true }, { cache: false, fallback: { changes: [] } });
  const calls = provider.calls.length;
  await service.execute(TASK_TYPES.RESUME_TAILORING, { different: 2 }, { cache: false, fallback: { changes: [] } });
  assert.equal(provider.calls.length, calls);
});
