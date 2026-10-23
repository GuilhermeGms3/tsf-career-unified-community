import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { OpportunityAvailabilityService } from "../src/opportunities/opportunity-availability-service.mjs";
import { SafeHttpClient } from "../src/discovery/safe-http-client.mjs";
import { GupyPublicProvider } from "../src/discovery/providers/gupy-public-provider.mjs";
import { VERIFIED_COMPANY_TARGETS } from "../src/discovery/company-targets/verified-company-targets.mjs";

// Isolated projection: public GET requests only; never changes the operational DB.
const database = new DatabaseSync(path.resolve(process.env.HUB_DATA_DIR || "data", "career-hub.sqlite"), { readOnly: true });
const samples = [];
for (const provider of ["nerdin", "gupy", "greenhouse", "lever", "ashby", "smartrecruiters", "workable", "solides", "recrutei", "programathor", "iel"]) {
  const rows = database.prepare("SELECT id,title,url,application_url,canonical_url,provider FROM jobs WHERE provider=? ORDER BY last_seen_at DESC LIMIT 2").all(provider);
  samples.push(...rows.map(row => ({ id: row.id, title: row.title, url: row.url, applicationUrl: row.application_url, canonicalUrl: row.canonical_url, provider: row.provider })));
}
database.close();
const client = new SafeHttpClient({ timeoutMs: 8000, retries: 0, cacheTtlMs: 0 }), feedErrors = [];
for (const provider of ["gupy", "greenhouse", "lever", "ashby", "smartrecruiters", "workable"]) {
  for (const target of VERIFIED_COMPANY_TARGETS.filter(item => item.provider === provider).slice(0, 3)) {
    try {
      const key = encodeURIComponent(target.organizationKey);
      let item, url;
      if (provider === "gupy") {
        item = (await new GupyPublicProvider({ client }).listCompanyJobs({ ...target, limit: 1 }))[0];
        url = item?.canonicalUrl;
      } else {
        const endpoint = { greenhouse: `https://boards-api.greenhouse.io/v1/boards/${key}/jobs`, lever: `https://api.lever.co/v0/postings/${key}?mode=json`, ashby: `https://api.ashbyhq.com/posting-api/job-board/${key}`, smartrecruiters: `https://api.smartrecruiters.com/v1/companies/${key}/postings?limit=1`, workable: `https://www.workable.com/api/accounts/${key}?details=true` }[provider];
        const { data } = await client.getJson(endpoint, { cache: false });
        item = (Array.isArray(data) ? data : data.jobs || data.content || [])[0];
        url = item && ({ greenhouse: item.absolute_url, lever: item.hostedUrl, ashby: item.jobUrl,
          smartrecruiters: `https://jobs.smartrecruiters.com/${key}/${item.id}`, workable: `https://apply.workable.com/${key}/j/${item.shortcode}/` })[provider];
      }
      if (!item || !url) continue;
      samples.push({ id: `fresh-${provider}`, title: item.title || item.text || item.name, provider, url, expected: "AVAILABLE", groundTruth: "Publicação presente no catálogo oficial consultado nesta execução; comparação com o anúncio/detalhe" });
      break;
    } catch (error) { feedErrors.push({ provider, board: target.organizationKey, errorCode: error.code || "FEED_FAILED" }); }
  }
}
const nerdinOpen = samples.find(job => job.canonicalUrl?.endsWith("99624.php"));
if (nerdinOpen) Object.assign(nerdinOpen, { expected: "AVAILABLE", groundTruth: "Página pública identificada com título e Enviar candidatura; conferência separada do login" });
samples.push({ id: "known-closed-nerdin", title: "Analista de Infraestrutura de TI Junior", provider: "nerdin", url: "https://www.nerdin.com.br/vaga_emprego/vaga-analista-de-infraestrutura-de-ti-junior-99159.php", expected: "CLOSED", groundTruth: "Aviso real de não aceitar novas candidaturas, conferido previamente" });
const jobs = new Map(samples.map(job => [job.id, job]));
const service = new OpportunityAvailabilityService({ store: { jobs: { findById: id => jobs.get(id), upsert: job => { jobs.set(job.id, job); return job; } } } });
const checks = [];
for (const sample of samples) {
  const started = Date.now();
  const { availability } = await service.verify(sample.id);
  const check = { provider: sample.provider, url: sample.applicationUrl || sample.url, ...availability, latencyMs: Date.now() - started, expected: sample.expected || null, groundTruth: sample.groundTruth || "Sem rótulo independente; diagnóstico, não mede acurácia" };
  checks.push(check);
  console.log(JSON.stringify({ provider: check.provider, status: check.status, reason: check.reason, latencyMs: check.latencyMs, expected: check.expected }));
}
const labelled = checks.filter(check => check.expected);
const report = { checkedAt: new Date().toISOString(), operationalDatabaseModified: false, submissionEnabled: false,
  total: checks.length, feedErrors, available: checks.filter(check => check.status === "AVAILABLE").length, closed: checks.filter(check => check.status === "CLOSED").length, inconclusive: checks.filter(check => check.status === "INCONCLUSIVE").length,
  labelledSamples: labelled.length, falseAvailable: labelled.filter(check => check.expected === "CLOSED" && check.status === "AVAILABLE").length, falseClosed: labelled.filter(check => check.expected === "AVAILABLE" && check.status === "CLOSED").length,
  unresolvedLabels: labelled.filter(check => check.status === "INCONCLUSIVE").length, checks };
if (process.argv[2]) await writeFile(path.resolve(process.argv[2]), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total: report.total, available: report.available, closed: report.closed, inconclusive: report.inconclusive, labelledSamples: report.labelledSamples, falseAvailable: report.falseAvailable, falseClosed: report.falseClosed, unresolvedLabels: report.unresolvedLabels }));
