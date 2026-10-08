import assert from "node:assert/strict";
import test from "node:test";
import {
  extractApplicationLinks,
  resolveApplicationDestination,
  safeApplicationUrl,
} from "../src/discovery/application-destination-resolver.mjs";
import { applicationProvider } from "../src/discovery/source-attribution.mjs";
import { normalizeDiscoveryJob } from "../src/discovery/types.mjs";
import { SourceResolver } from "../src/discovery/source-resolver.mjs";
import { CareerPageDiscoveryService } from "../src/discovery/company-radar/career-page-discovery-service.mjs";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";

const platformCases = [
  ["https://boards.greenhouse.io/acme/jobs/1", "GREENHOUSE"],
  ["https://jobs.lever.co/acme/1", "LEVER"],
  ["https://jobs.ashbyhq.com/acme/1", "ASHBY"],
  ["https://jobs.smartrecruiters.com/acme/1", "SMARTRECRUITERS"],
  ["https://apply.workable.com/acme/j/ONE/", "WORKABLE"],
  ["https://acme.gupy.io/jobs/1", "GUPY"],
  ["https://acme.wd1.myworkdayjobs.com/jobs/job/1", "WORKDAY"],
  ["https://br.indeed.com/viewjob?jk=one", "INDEED"],
  ["https://jobs.icims.com/jobs/1/job", "ICIMS"],
  ["https://acme.taleo.net/careersection/jobdetail.ftl?job=1", "TALEO"],
  ["https://acme.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/jobs/job/1", "ORACLE"],
  ["https://career5.successfactors.com/career?career_job_req_id=1", "SUCCESSFACTORS"],
  ["https://acme.jobs.personio.de/job/1", "PERSONIO"],
  ["https://acme.teamtailor.com/jobs/1", "TEAMTAILOR"],
  ["https://carreiras.iel.org.br/DF/vaga/1", "IEL"],
  ["https://vagas.solides.com.br/vaga/1/dev", "SOLIDES"],
  ["https://empregos.recrutei.com.br/vaga/acme/1-dev", "RECRUTEI"],
  ["https://www.nerdin.com.br/vaga_emprego/dev-12345.php", "NERDIN"],
  ["https://programathor.com.br/jobs/12345-dev", "PROGRAMATHOR"],
  ["https://remotar.com.br/job/12345/acme/dev", "REMOTAR"],
  ["https://www.infojobs.com.br/vaga-de-dev_1.aspx", "INFOJOBS"],
  ["https://www.vagas.com.br/vagas/v1/dev", "VAGAS"],
  ["https://www.catho.com.br/vagas/dev/1", "CATHO"],
  ["https://www.geekhunter.com.br/vaga/1", "GEEKHUNTER"],
  ["https://candidatos.abler.com.br/vagas/abc123", "ABLER"],
  ["https://jobs.quickin.io/acme/jobs/abc123", "QUICKIN"],
  ["https://acme.pandape.infojobs.com.br/Detail/12345", "PANDAPE"],
];

test("classifica destinos de todas as famílias de fonte conhecidas por hostname exato", () => {
  for (const [url, expected] of platformCases) assert.equal(applicationProvider(url), expected, url);
  for (const url of [
    "https://gupy.io.evil.example/jobs/1",
    "https://evil.example/redirect/nerdin.com.br",
    "https://user:secret@jobs.lever.co/acme/1",
  ]) assert.equal(applicationProvider(url), "UNKNOWN", url);
  for (const url of ["https://jobs.lever.co.evil.example/acme/1", "https://evil.example/jobs/greenhouse.io/1"])
    assert.equal(new SourceResolver().resolve(url).canonicalTarget, false, url);
});

test("extrai somente links públicos com contexto explícito de candidatura", () => {
  const html = `<nav><a href="/login">Entrar</a></nav>
    <a href="https://acme.gupy.io/jobs/42">Quero essa vaga</a>
    <a href="https://social.example/share">Compartilhar</a>`;
  assert.deepEqual(extractApplicationLinks(html, "https://www.nerdin.com.br/vaga_emprego/dev-12345.php"), [{
    url: "https://acme.gupy.io/jobs/42",
    label: "Quero essa vaga",
    evidence: "PUBLIC_APPLICATION_LINK",
  }]);
});

test("prioriza ATS final e preserva a página que descobriu a vaga", () => {
  const sourceUrl = "https://www.nerdin.com.br/vaga_emprego/dev-12345.php";
  const destination = resolveApplicationDestination({
    sourceUrl,
    canonicalUrl: sourceUrl,
    applicationUrl: sourceUrl,
    candidateUrls: [{ url: "https://jobs.lever.co/acme/12345678-abcd-1234-abcd-123456789012/apply", label: "Candidatar-se" }],
  });
  assert.equal(destination.sourceUrl, sourceUrl);
  assert.equal(destination.applicationProvider, "lever");
  assert.equal(destination.kind, "KNOWN_ATS");
  assert.match(destination.applicationUrl, /jobs\.lever\.co/);

  const normalized = normalizeDiscoveryJob({ provider: "nerdin", sourceUrl, canonicalUrl: sourceUrl, applicationUrl: destination.applicationUrl });
  assert.equal(normalized.sourceUrl, sourceUrl);
  assert.equal(normalized.atsType, "lever");
  assert.equal(normalized.provenance.sourceAttribution.discoveredVia, "NERDIN");
  assert.equal(normalized.provenance.sourceAttribution.applicationProvider, "LEVER");
});

test("todas as superfícies de descoberta roteiam pelo ATS final do CTA",()=>{
  const sources=[
    "https://br.indeed.com/viewjob?jk=1",
    "https://www.linkedin.com/jobs/view/1",
    "https://www.glassdoor.com.br/job-listing/1",
    "https://www.google.com/search?q=vaga+dev",
    "https://www.nerdin.com.br/vaga_emprego/dev-12345.php",
    "https://remotar.com.br/job/12345/acme/dev",
    "https://programathor.com.br/jobs/12345-dev",
    "https://carreiras.iel.org.br/DF/vaga/12345",
    "https://vagas.solides.com.br/vaga/12345/dev",
    "https://empregos.recrutei.com.br/vaga/acme/12345-dev",
    "https://www.infojobs.com.br/vaga-de-dev_1.aspx",
    "https://www.vagas.com.br/vagas/v1/dev",
    "https://www.catho.com.br/vagas/dev/1",
    "https://www.geekhunter.com.br/vaga/1",
    "https://careers.example.com/jobs/1",
  ];
  const destinations=[
    ["https://jobs.lever.co/acme/12345678-abcd-1234-abcd-123456789012/apply","lever"],
    ["https://jobs.ashbyhq.com/acme/12345678-abcd-1234-abcd-123456789012/application","ashby"],
    ["https://acme.gupy.io/jobs/12345","gupy"],
    ["https://job-boards.greenhouse.io/acme/jobs/12345","greenhouse"],
  ];
  for(const [index,sourceUrl] of sources.entries()){
    const [applicationUrl,provider]=destinations[index%destinations.length],resolved=resolveApplicationDestination({sourceUrl,canonicalUrl:sourceUrl,applicationUrl:sourceUrl,candidateUrls:[{url:applicationUrl,label:"Candidatar-se"}]});
    assert.equal(resolved.sourceUrl,sourceUrl,sourceUrl);
    assert.equal(resolved.applicationProvider,provider,sourceUrl);
    assert.equal(resolved.kind,"KNOWN_ATS",sourceUrl);
    assert.equal(resolved.applicationUrl,applicationUrl,sourceUrl);
  }
});

test("mantém plataforma nativa explícita quando não existe ATS externo", () => {
  const sourceUrl = "https://empregos.recrutei.com.br/vaga/acme/12345-dev";
  const destination = resolveApplicationDestination({
    sourceUrl,
    applicationUrl: sourceUrl,
    candidateUrls: [{ url: "/candidatar/12345", label: "Quero essa vaga" }],
  });
  assert.equal(destination.applicationProvider, "recrutei");
  assert.equal(destination.kind, "NATIVE_PLATFORM");
  assert.equal(destination.applicationUrl, "https://empregos.recrutei.com.br/candidatar/12345");
});

test("rejeita credenciais e destinos locais ou privados", () => {
  for (const url of [
    "http://localhost/apply",
    "http://127.0.0.1/apply",
    "http://169.254.169.254/latest/meta-data",
    "http://192.168.0.2/apply",
    "https://user:secret@example.com/apply",
  ]) assert.equal(safeApplicationUrl(url), "", url);
});

test("página oficial resolve CTA por vaga sem cruzar links entre JobPostings", async () => {
  const nodes = ["one", "two"].map((id) => ({
    "@type": "JobPosting",
    identifier: { value: id },
    title: `Developer ${id}`,
    url: `https://careers.example/jobs/${id}`,
    hiringOrganization: { name: "Example" },
  }));
  const html = `<script type="application/ld+json">${JSON.stringify({ "@graph": nodes })}</script>
    <a href="https://jobs.lever.co/example/one">Apply one</a>
    <a href="https://example.gupy.io/jobs/two">Apply two</a>`;
  const service = new CareerPageDiscoveryService({ client: { getText: async () => ({ data: html, url: "https://careers.example/jobs" }) } });
  const result = await service.inspect("https://careers.example/jobs");
  assert.equal(result.jobs[0].applicationUrl, "https://jobs.lever.co/example/one");
  assert.equal(result.jobs[0].atsType, "lever");
  assert.equal(result.jobs[1].applicationUrl, "https://example.gupy.io/jobs/two");
  assert.equal(result.jobs[1].atsType, "gupy");
});

test("registry separa preenchimento assistido de destinos com envio controlado", () => {
  const registry = new AdapterRegistry();
  const assisted = ["generic", "iel", "solides", "recrutei", "programathor", "remotar", "infojobs", "vagas", "catho", "geekhunter", "indeed", "icims", "taleo", "oracle", "successfactors", "personio", "teamtailor", "abler", "quickin", "pandape"];
  for (const provider of assisted) {
    const capability = registry.describe(provider);
    assert.equal(capability.level, "ASSISTED_FILL", provider);
    assert.equal(capability.canFill, true, provider);
    assert.equal(capability.canSubmit, false, provider);
    assert.equal(typeof registry.get(provider).submit, "undefined", provider);
  }
  for (const provider of ["smartrecruiters", "workable", "nerdin"]) {
    const capability = registry.describe(provider);
    assert.equal(capability.level, "CONTROLLED_SUBMIT", provider);
    assert.equal(capability.canSubmit, true, provider);
    assert.equal(capability.canReceipt, true, provider);
  }
  assert.equal(registry.describe("workday").level, "ASSISTED_FILL");
  assert.equal(registry.describe("workday").canFill, true);
  assert.equal(registry.describe("workday").canSubmit, false);
  assert.equal(registry.describe("unknown").canFill, false);
});

test("resolve identidades de candidatura Nerdin, Abler, Quickin e Pandapé",()=>{
  assert.deepEqual(new SourceResolver().resolve("https://www.nerdin.com.br/vaga_candidatura.php?id=98743"),{atsType:"nerdin",canonicalTarget:true,url:"https://www.nerdin.com.br/vaga_candidatura.php?id=98743",organizationKey:"portal",providerJobId:"98743"});
  const abler=new SourceResolver().resolve("https://candidatos.abler.com.br/vagas/abc123");assert.equal(abler.organizationKey,"portal");assert.equal(abler.providerJobId,"abc123");
  const quickin=new SourceResolver().resolve("https://jobs.quickin.io/globalti/jobs/abc123");assert.equal(quickin.organizationKey,"globalti");assert.equal(quickin.providerJobId,"abc123");
  const pandape=new SourceResolver().resolve("https://minsaitbrasil.pandape.infojobs.com.br/ApplyCT/3784346");assert.equal(pandape.organizationKey,"minsaitbrasil");assert.equal(pandape.providerJobId,"3784346");
});
