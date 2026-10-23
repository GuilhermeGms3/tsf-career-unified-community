import assert from "node:assert/strict";
import test from "node:test";
import {
  IelProvider,
  NerdinProvider,
  ProgramaThorProvider,
  RecruteiProvider,
  RemotarProvider,
  SolidesProvider,
  brazilianProviderInternals,
} from "../src/discovery/providers/brazilian-public-providers.mjs";
import { createProviderRegistry } from "../src/discovery/provider-catalog.mjs";
import { SourceResolver } from "../src/discovery/source-resolver.mjs";
import { ApplicationMethodDetector } from "../src/discovery/application-method/application-method-detector.mjs";
import { CanonicalJobResolver } from "../src/discovery/canonical-job-resolver.mjs";
import { DiscoveryV4Service } from "../src/discovery/v4/discovery-v4-service.mjs";
import { SearchIntentService } from "../src/discovery/search-intent/search-intent-service.mjs";
import { sourceOnboardingRegistry } from "../src/discovery/source-center/source-onboarding-registry.mjs";
import { normalizeJobHuntProfile } from "../src/automation/job-hunt-policy.mjs";

const jobPosting = ({
  title = "Estágio em Tecnologia da Informação",
  company = "Empresa Exemplo",
  city = "Brasília",
  state = "DF",
  remote = false,
} = {}) => ({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title,
  description: "<p>Desenvolvimento com &quot;Java&quot; &amp; SQL.</p>",
  identifier: { "@type": "PropertyValue", value: "30009" },
  datePosted: "2026-08-20",
  validThrough: "2026-12-20",
  employmentType: title.includes("Estágio") ? "INTERN" : "FULL_TIME",
  hiringOrganization: { "@type": "Organization", name: company },
  jobLocation: {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: city,
      addressRegion: state,
      addressCountry: "BR",
    },
  },
  ...(remote
    ? {
        jobLocationType: "TELECOMMUTE",
        applicantLocationRequirements: { "@type": "Country", name: "Brazil" },
      }
    : {}),
});

const jsonLdPage = (job, extra = "") =>
  `<html><script type="application/ld+json">${JSON.stringify(job)}</script>${extra}</html>`;

function sitemapFixture(Provider, { sitemapUrl, jobUrl, posting = jobPosting(), pageExtra = "" }) {
  const calls = [];
  const client = {
    async getText(url) {
      const value = String(url);
      calls.push(value);
      if (value.endsWith("robots.txt")) return { data: "User-agent: *\nAllow: /" };
      if (value === sitemapUrl) return { data: `<urlset><url><loc>${jobUrl}</loc></url></urlset>` };
      if (value === jobUrl) return { data: jsonLdPage(posting, pageExtra) };
      throw new Error(`Unexpected URL: ${value}`);
    },
  };
  return { provider: new Provider({ client }), calls };
}

test("parser público extrai JobPosting sem manter HTML", () => {
  const jobs = brazilianProviderInternals.structuredJobs(jsonLdPage(jobPosting()));
  assert.equal(jobs.length, 1);
  const normalized = brazilianProviderInternals.normalizeJobPosting({
    provider: "iel",
    sourceClass: "INTERNSHIP_PORTAL",
    url: "https://carreiras.iel.org.br/DF/vaga/estagio/30009/tecnologia-da-informacao",
    job: jobs[0],
  });
  assert.equal(normalized.providerJobId, "30009");
  assert.equal(normalized.city, "Brasília");
  assert.equal(normalized.state, "DF");
  assert.equal(normalized.metadata.opportunityType, "INTERNSHIP");
  assert.equal(normalized.description, 'Desenvolvimento com "Java" & SQL.');
});

test("parser tolera quebra de linha inválida dentro do JSON-LD público", () => {
  const page = '<script type="application/ld+json">{"@type":"JobPosting","title":"Dev","description":"linha 1\nlinha 2"}</script>';
  const [job] = brazilianProviderInternals.structuredJobs(page);
  assert.equal(job.description, "linha 1\nlinha 2");
});

test("IEL usa somente sitemap/página pública e preserva regionalização", async () => {
  const sitemapUrl = "https://carreiras.iel.org.br/sitemap.xml";
  const jobUrl = "https://carreiras.iel.org.br/DF/vaga/estagio/30009/tecnologia-da-informacao";
  const fixture = sitemapFixture(IelProvider, { sitemapUrl, jobUrl });
  const result = await fixture.provider.search({ query: "Estágio TI", location: "Brasília, DF", limit: 5 });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].metadata.sourceClass, "INTERNSHIP_PORTAL");
  assert.ok(fixture.calls.every((url) => !url.includes("/api/")));
});

test("IEL rejeita vagas de outra área que coincidem apenas com a região", async () => {
  const sitemapUrl = "https://carreiras.iel.org.br/sitemap.xml",
    relevantUrl = "https://carreiras.iel.org.br/DF/vaga/estagio/30009/tecnologia-da-informacao",
    unrelatedUrl = "https://carreiras.iel.org.br/DF/vaga/aprendiz/30010/administracao",
    pages = new Map([
      [relevantUrl, jsonLdPage(jobPosting({ title: "Estágio em Tecnologia da Informação" }))],
      [unrelatedUrl, jsonLdPage(jobPosting({ title: "Jovem Aprendiz Administrativo" }))],
    ]),
    provider = new IelProvider({
      client: {
        async getText(url) {
          const value = String(url);
          if (value === sitemapUrl) return { data: `<urlset><url><loc>${unrelatedUrl}</loc></url><url><loc>${relevantUrl}</loc></url></urlset>` };
          if (pages.has(value)) return { data: pages.get(value) };
          throw new Error(`Unexpected URL: ${value}`);
        },
      },
    }),
    result = await provider.search({ query: "Tecnologia da Informação", location: "Brasília, DF", limit: 5 });
  assert.deepEqual(result.jobs.map((job) => job.title), ["Estágio em Tecnologia da Informação"]);
});

test("ProgramaThor preserva ID estável, remoto e escopo Brasil declarado", async () => {
  const sitemapUrl = "https://programathor.com.br/sitemap.xml";
  const jobUrl = "https://programathor.com.br/jobs/33740-engenheiro-de-ia-generativa-junior";
  const fixture = sitemapFixture(ProgramaThorProvider, {
    sitemapUrl,
    jobUrl,
    posting: jobPosting({ title: "Desenvolvedor de Software Júnior", remote: true }),
  });
  const result = await fixture.provider.search({ query: "Software Developer Junior", limit: 3 });
  assert.equal(result.jobs[0].providerJobId, "33740");
  assert.equal(result.jobs[0].remote, true);
  assert.equal(result.jobs[0].metadata.remoteScope, "Brazil");
});

test("ProgramaThor prioriza vagas recentes no sitemap histórico", async () => {
  const older = "https://programathor.com.br/jobs/120-desenvolvedor-junior";
  const newer = "https://programathor.com.br/jobs/99120-desenvolvedor-junior";
  const calls = [];
  const provider = new ProgramaThorProvider({
    client: {
      async getText(url) {
        calls.push(String(url));
        if (String(url).endsWith("sitemap.xml"))
          return { data: `<urlset><url><loc>${older}</loc></url><url><loc>${newer}</loc></url></urlset>` };
        return { data: jsonLdPage(jobPosting({ title: "Desenvolvedor Junior" })) };
      },
    },
  });
  const result = await provider.search({ query: "desenvolvedor", limit: 1 });
  assert.equal(result.jobs.length, 1);
  assert.equal(calls[1], newer);
});

test("Recrutei respeita sitemap e não usa API nem query bloqueada", async () => {
  const sitemapUrl = "https://empregos.recrutei.com.br/sitemap-vagas-1.xml";
  const jobUrl = "https://empregos.recrutei.com.br/vaga/empresa/155283-engenheiro-de-ia-jr";
  const fixture = sitemapFixture(RecruteiProvider, {
    sitemapUrl,
    jobUrl,
    posting: jobPosting({ title: "Engenheiro de IA Jr", company: "BM Vagas", city: "São José dos Campos", state: "SP" }),
  });
  const result = await fixture.provider.search({ query: "Engenheiro IA Junior", limit: 3 });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].providerJobId, "155283");
  assert.equal(result.jobs[0].atsType, "recrutei");
  assert.ok(fixture.calls.every((url) => !url.includes("/api/") && !/[?&](q|keyword)=/.test(url)));
});

test("Nerdin usa sitemap público, preserva ID, modalidade, senioridade e contrato", async () => {
  const sitemapUrl = "https://www.nerdin.com.br/sitemap.xml";
  const jobUrl = "https://www.nerdin.com.br/vaga_emprego/vaga-analista-qa-ruby-pleno-remoto-98747.php";
  const posting = jobPosting({
    title: "Analista QA - Ruby (Pleno) - Remoto",
    company: "Foursys",
    city: "Home Office",
    state: "HO",
    remote: true,
  });
  posting.identifier.value = "98747";
  posting.employmentType = ["FULL_TIME"];
  posting.occupationalCategory = "Testes / QA / Sistemas / Pleno";
  const fixture = sitemapFixture(NerdinProvider, { sitemapUrl, jobUrl, posting });
  const health = await fixture.provider.health();
  const result = await fixture.provider.search({ query: "QA Ruby Pleno", location: "Brasil", limit: 3 });

  assert.equal(health.status, "HEALTHY");
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].providerJobId, "98747");
  assert.equal(result.jobs[0].company, "Foursys");
  assert.equal(result.jobs[0].remote, true);
  assert.equal(result.jobs[0].seniority, "Testes / QA / Sistemas / Pleno");
  assert.equal(result.jobs[0].employmentType, "FULL_TIME");
  assert.equal(result.jobs[0].postedAt, "2026-08-20");
  assert.equal(result.jobs[0].expiresAt, "2026-12-20");
  assert.equal(result.jobs[0].applicationUrl, jobUrl);
  assert.equal(result.jobs[0].metadata.sourceClass, "JOB_BOARD");
  assert.deepEqual(fixture.calls, ["https://www.nerdin.com.br/robots.txt", sitemapUrl, jobUrl]);
});

test("Nerdin preserva origem e encaminha candidatura ao ATS externo encontrado no CTA público", async () => {
  const sitemapUrl = "https://www.nerdin.com.br/sitemap.xml";
  const jobUrl = "https://www.nerdin.com.br/vaga_emprego/vaga-analista-suporte-98748.php";
  const fixture = sitemapFixture(NerdinProvider, {
    sitemapUrl,
    jobUrl,
    posting: jobPosting({ title: "Analista de Suporte Júnior" }),
    pageExtra: '<a href="https://empresa.gupy.io/jobs/98748">Quero essa vaga</a>',
  });
  const result = await fixture.provider.search({ query: "Analista Suporte", limit: 3 }), job = result.jobs[0];
  assert.equal(job.sourceUrl, jobUrl);
  assert.equal(job.applicationUrl, "https://empresa.gupy.io/jobs/98748");
  assert.equal(job.atsType, "gupy");
  assert.equal(job.provenance.sourceAttribution.discoveredVia, "NERDIN");
  assert.equal(job.provenance.sourceAttribution.applicationProvider, "GUPY");
});

test("todos os providers de sitemap reutilizam a mesma resolução de destino", async () => {
  const cases = [
    [IelProvider, "https://carreiras.iel.org.br/sitemap.xml", "https://carreiras.iel.org.br/DF/vaga/estagio/30009/desenvolvedor-junior", "Desenvolvedor Junior"],
    [ProgramaThorProvider, "https://programathor.com.br/sitemap.xml", "https://programathor.com.br/jobs/30009-desenvolvedor-junior", "Desenvolvedor Junior"],
    [RecruteiProvider, "https://empregos.recrutei.com.br/sitemap-vagas-1.xml", "https://empregos.recrutei.com.br/vaga/acme/30009-desenvolvedor-junior", "Desenvolvedor Junior"],
    [NerdinProvider, "https://www.nerdin.com.br/sitemap.xml", "https://www.nerdin.com.br/vaga_emprego/desenvolvedor-junior-30009.php", "Desenvolvedor Junior"],
  ];
  for (const [Provider, sitemapUrl, jobUrl, query] of cases) {
    const fixture = sitemapFixture(Provider, {
      sitemapUrl,
      jobUrl,
      posting: jobPosting({ title: "Desenvolvedor Júnior" }),
      pageExtra: '<a href="https://jobs.lever.co/acme/30009">Candidatar-se</a>',
    });
    const job = (await fixture.provider.search({ query, limit: 1 })).jobs[0];
    assert.equal(job.sourceUrl, jobUrl, Provider.name);
    assert.equal(job.applicationUrl, "https://jobs.lever.co/acme/30009", Provider.name);
    assert.equal(job.atsType, "lever", Provider.name);
  }
});

test("Remotar consulta catálogo público e preserva ATS externo, requisitos e telemetria", async () => {
  const calls = [], provider = new RemotarProvider({
    client: {
      async getJson(url) {
        calls.push(String(url));
        return { data: { meta: { total: 841 }, data: [{
          id: 162969,
          title: "Engenheiro(a) de Software Sênior",
          subtitle: "Squad de AI com Java e Python",
          description: "<p>Desenvolvimento de serviços escaláveis.</p>",
          type: "remote",
          active: true,
          expired: false,
          externalLink: "https://softexpert.gupy.io/job/abc?jobBoardSource=remotar",
          integrationSource: "gupy",
          createdAt: "2026-09-15T20:51:23.929-03:00",
          company: { id: 1795, name: "SoftExpert" },
          jobSalary: { from: 7000, to: 9000, currency: "BRL" },
          jobTags: [{ tag: { name: "🧓🏽 Sênior" } }, { tag: { name: "💼 CLT" } }],
          jobRequirements: [{ description: "Domínio de Java e Python.", mandatory: true }],
          jobCategories: [{ category: { name: "Programação" } }],
        }] } };
      },
    },
  });
  const health = await provider.health(), result = await provider.search({ query: "Java", limit: 5 }), job = result.jobs[0];
  assert.equal(health.status, "HEALTHY");
  assert.match(calls[1], /active=true/);
  assert.match(calls[1], /search=Java/);
  assert.equal(job.providerJobId, "162969");
  assert.equal(job.company, "SoftExpert");
  assert.equal(job.remote, true);
  assert.equal(job.location, "Remoto - Brasil");
  assert.equal(job.seniority, "Sênior");
  assert.equal(job.employmentType, "CLT");
  assert.equal(job.sourceUrl, "https://remotar.com.br/job/162969");
  assert.match(job.applicationUrl, /softexpert\.gupy\.io/);
  assert.equal(job.metadata.sourceClass, "JOB_BOARD");
  assert.equal(job.metadata.requirements[0].mandatory, true);
  assert.equal(result.diagnostic.totalAvailable, 841);
});

test("Sólides usa busca pública limitada e normaliza campos ricos", async () => {
  let requested;
  const provider = new SolidesProvider({
    client: {
      async getJson(url, options) {
        requested = { url: String(url), options };
        return {
          data: {
            currentPage: 1,
            totalPages: 1,
            count: 1,
            data: [
                {
                  id: 908357,
                  slug: "desenvolvedor-mobile-cianorte-pr",
                  title: "Desenvolvedor Mobile Júnior",
                  companyName: "Academia Force One",
                  description: "<p>Aplicativos e APIs.</p>",
                  city: "Cianorte",
                  state: { name: "Paraná", code: "PR" },
                  createdAt: "2026-08-21",
                  homeOffice: false,
                  seniority: [{ name: "Junior" }],
                  recruitmentContractType: [{ name: "CLT" }],
                  jobType: "hibrido",
                  occupationAreas: [{ name: "Tecnologia" }],
                  education: [{ name: "Graduação" }],
                  salary: { negotiable: true },
                },
            ],
          },
        };
      },
    },
  });
  const result = await provider.search({ query: "Desenvolvedor", location: "Brasil", limit: 2 });
  assert.equal(new URL(requested.url).origin, "https://vagas.solides.com.br");
  assert.equal(new URL(requested.url).pathname, "/api/vacancies");
  assert.equal(new URL(requested.url).searchParams.get("take"), "14");
  assert.equal(new URL(requested.url).searchParams.has("locations"), false);
  assert.match(requested.url, /title=Desenvolvedor/);
  assert.equal(requested.options.headers.origin, "https://vagas.solides.com.br");
  assert.equal(result.jobs[0].providerJobId, "908357");
  assert.equal(result.jobs[0].metadata.occupationAreas[0], "Tecnologia");
  assert.equal(result.jobs[0].applicationUrl, "https://vagas.solides.com.br/vaga/908357");
  assert.equal(result.jobs[0].state, "PR");
  assert.equal(result.jobs[0].workModel, "HYBRID");
  assert.equal(result.jobs[0].employmentType, "CLT");
});

test("Sólides verifica a busca real no healthcheck e rejeita schema inválido", async () => {
  const calls = [];
  const provider = new SolidesProvider({ client: { async getJson(url, options) {
    calls.push({ url: new URL(url), options });
    return { data: { data: [], count: 0, currentPage: 1, totalPages: 0 } };
  } } });
  assert.equal((await provider.health()).status, "HEALTHY");
  assert.equal(calls[0].url.pathname, "/api/vacancies");
  assert.equal(calls[0].url.searchParams.get("take"), "1");
  assert.equal(calls[0].options.headers.authorization, undefined);
  provider.client.getJson = async () => ({ data: { message: "Unexpected response" } });
  await assert.rejects(provider.health(), error => error.code === "SOLIDES_INVALID_RESPONSE");
  await assert.rejects(provider.search(), error => error.code === "SOLIDES_INVALID_RESPONSE");
});

test("Sólides pagina sem duplicar e envia geografia ao portal", async () => {
  const pages = [];
  const provider = new SolidesProvider({ client: { async getJson(url) {
    const request = new URL(url), page = Number(request.searchParams.get("page"));
    pages.push(page);
    assert.equal(request.searchParams.get("locations"), "Brasília, DF");
    const rows = Array.from({ length: 14 }, (_, index) => ({
      id: page === 1 ? index + 1 : index + 14,
      title: "Analista de Suporte", companyName: "Fixture", city: { name: "Brasília" },
      state: { name: "Distrito Federal", code: "DF" }, jobType: "presencial",
    }));
    return { data: { data: rows, count: 27, currentPage: page, totalPages: 2 } };
  } } });
  const result = await provider.search({ query: "Suporte", location: "Brasília, DF", limit: 20 });
  assert.deepEqual(pages, [1, 2]);
  assert.equal(result.jobs.length, 20);
  assert.equal(new Set(result.jobs.map(job => job.providerJobId)).size, 20);
  assert.equal(result.jobs[0].location, "Brasília, DF");
  assert.equal(result.jobs[0].workModel, "ONSITE");
});

test("Sólides limita paginação e não confunde menção a remoto com modalidade", async () => {
  let calls = 0;
  const provider = new SolidesProvider({ client: { async getJson() {
    calls++;
    return { data: { data: Array.from({ length: 14 }, (_, index) => ({ id: calls * 100 + index, title: "Contador", occupationAreas: [] })), totalPages: 100 } };
  } } });
  assert.equal((await provider.search({ query: "Desenvolvedor", limit: 50 })).jobs.length, 0);
  assert.equal(calls, 4);
  const onsite = provider.normalize({ id: 1, title: "Suporte", description: "Atendimento remoto", jobType: "presencial" });
  assert.equal(onsite.remote, false);
  const remote = provider.normalize({ id: 2, title: "Suporte", jobType: "remoto", homeOffice: false });
  assert.equal(remote.remote, true);
  assert.equal(remote.workModel, "REMOTE");
  assert.equal(provider.normalize({ id: 3, title: "Suporte", jobType: "constructor" }).workModel, "");
});

test("Sólides rejeita redirects quebrados e preserva destino externo válido", () => {
  const provider = new SolidesProvider({ client: {} });
  for (const redirectLink of ["https://empresa./vacancies/12345", "https:///vacancies/12345", "http://localhost/apply", "https://user:secret@example.test/apply", "javascript:alert(1)"])
    assert.equal(provider.normalize({ id: 12345, title: "Dev", redirectLink }).applicationUrl, "https://vagas.solides.com.br/vaga/12345");
  const redirectUrl = "https://empresa.rhgestor.com.br/vagas/detalhes/abc";
  assert.equal(provider.normalize({ id: 12345, title: "Dev", redirectLink: "https://empresa./vacancies/12345", publishers: { rhgestor: { redirectUrl } } }).applicationUrl, redirectUrl);
  assert.equal(provider.normalize({ id: 12345, title: "Dev", redirectLink: "https://jobs.lever.co/company/job" }).applicationUrl, "https://jobs.lever.co/company/job");
});

test("registry e Source Center expõem seis fontes READY e Eureca manual", async () => {
  const registry = createProviderRegistry({
    searchClient: async () => ({ jobs: [] }),
    fetchImpl: async () => {
      throw new Error("network must not run");
    },
  });
  for (const id of ["iel", "programathor", "solides", "recrutei", "nerdin", "remotar"])
    assert.ok(registry.get(id));
  for (const id of ["iel", "programathor", "solides", "recrutei", "nerdin", "remotar"])
    assert.equal(sourceOnboardingRegistry.publicItem(sourceOnboardingRegistry.get(id), {}).status, "READY");
  assert.equal(sourceOnboardingRegistry.publicItem(sourceOnboardingRegistry.get("eureca"), {}).status, "MANUAL_ONLY");
});

test("URLs brasileiras têm método CAREER_PAGE com evidência de plataforma e identidade canônica cross-source", () => {
  const url = "https://programathor.com.br/jobs/33740-engenheiro-de-ia-generativa-junior";
  const resolved = new SourceResolver().resolve(url);
  assert.deepEqual(
    { atsType: resolved.atsType, organizationKey: resolved.organizationKey, providerJobId: resolved.providerJobId },
    { atsType: "programathor", organizationKey: "portal", providerJobId: "33740" },
  );
  const application = new ApplicationMethodDetector().detect({ applicationUrl: url });
  assert.equal(application.method, "CAREER_PAGE");
  assert.equal(application.evidence.platform, true);
  const canonical = new CanonicalJobResolver();
  const official = canonical.resolve({ atsType: resolved.atsType, companyIdentity: resolved.organizationKey, providerJobId: resolved.providerJobId });
  const publicWeb = canonical.resolve({ atsType: resolved.atsType, companyIdentity: resolved.organizationKey, providerJobId: resolved.providerJobId, provider: "brave-public-web" });
  assert.equal(official.key, publicWeb.key);
});

test("Recrutei não confunde slug de empresa iniciado por número com ID da vaga", () => {
  const resolved = new SourceResolver().resolve(
    "https://empregos.recrutei.com.br/vaga/3am-it-services/154900-desenvolvedor-sql",
  );
  assert.equal(resolved.providerJobId, "154900");
});

test("Nerdin resolve identidade canônica e mantém candidatura em página externa", () => {
  const url = "https://www.nerdin.com.br/vaga_emprego/vaga-analista-qa-ruby-pleno-remoto-98747.php";
  const resolved = new SourceResolver().resolve(url);
  const application = new ApplicationMethodDetector().detect({ applicationUrl: url });

  assert.deepEqual(
    { atsType: resolved.atsType, organizationKey: resolved.organizationKey, providerJobId: resolved.providerJobId },
    { atsType: "nerdin", organizationKey: "portal", providerJobId: "98747" },
  );
  assert.equal(application.method, "CAREER_PAGE");
  assert.equal(application.evidence.provider, "nerdin");
});

test("Remotar resolve identidade canônica e mantém candidatura no ATS de origem", () => {
  const publicUrl = "https://remotar.com.br/job/162969/softexpert/engenheiro-de-software";
  const resolved = new SourceResolver().resolve(publicUrl);
  const publicApplication = new ApplicationMethodDetector().detect({ applicationUrl: publicUrl });
  const externalApplication = new ApplicationMethodDetector().detect({ applicationUrl: "https://softexpert.gupy.io/job/abc", sourceUrl: publicUrl });
  assert.deepEqual(
    { atsType: resolved.atsType, organizationKey: resolved.organizationKey, providerJobId: resolved.providerJobId },
    { atsType: "remotar", organizationKey: "portal", providerJobId: "162969" },
  );
  assert.equal(publicApplication.method, "CAREER_PAGE");
  assert.equal(externalApplication.method, "ATS");
  assert.equal(externalApplication.evidence.provider, "gupy");
});

test("Search Composer mantém JobSpy aditivo ao provider brasileiro de job board", async () => {
  const calls = [];
  const service = new DiscoveryV4Service({
    searchIntentService: new SearchIntentService(),
    publicWeb: { capability: () => ({ configured: false }) },
    repository: {},
    jobHuntService: {
      testSearch: async (input) => {
        calls.push(input.providers);
        return {
          summary: { queries: 1, rawJobs: 1, normalized: 1, duplicates: 0, newJobs: 1, errors: 0 },
          reports: [],
        };
      },
    },
    communityService: { configured: () => false },
    evolutionService: { publicConfiguration: () => ({ configured: false }) },
  });
  const preview = service.preview({
    customTerms: ["Estágio TI"],
    providers: ["programathor", "nerdin"],
    sourceClasses: [],
    locationPolicy: { priorities: [{ priority: 1, location: "Brasília, DF", workModel: "HYBRID", accepted: true }] },
  });
  assert.deepEqual(preview.intent.providers, ["programathor", "nerdin"]);
  assert.ok(preview.intent.sourceClasses.includes("JOB_BOARD"));
  await service.run(preview.intent, "TEST");
  assert.deepEqual(calls, [["jobspy"],["programathor"],["nerdin"]]);
});

test("Policy Builder preserva providers brasileiros e continua pausado por padrão", () => {
  const profile = normalizeJobHuntProfile({
    queries: ["Desenvolvedor"],
    sourcePreferences: ["iel", "programathor", "solides", "recrutei", "nerdin", "remotar"],
  });
  assert.deepEqual(profile.providers, ["iel", "programathor", "solides", "recrutei", "nerdin", "remotar"]);
  assert.equal(profile.enabled, false);
});
