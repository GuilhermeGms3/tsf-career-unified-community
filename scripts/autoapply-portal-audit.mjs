import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";
import { applicationProvider } from "../src/discovery/source-attribution.mjs";
import { resolveAutomationEntryUrl } from "../src/automation/automation-validation.mjs";
import { LiveInspector } from "../src/automation/live-inspector.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const output = path.resolve(option("output", "tmp/autoapply-portal-audit"));
const requestedProviders=option("providers","").split(",").filter(Boolean);
if(requestedProviders.some(provider=>!new AdapterRegistry().supports(provider)))throw new Error("Provider de auditoria desconhecido.");
const database = new DatabaseSync(path.resolve(option("db", "data/career-hub.sqlite")), { readOnly: true });
const capabilities = new AdapterRegistry().listCapabilities().filter(item => !["generic", "unknown"].includes(item.atsType)&&(!requestedProviders.length||requestedProviders.includes(item.atsType)));
const jobs = database.prepare("SELECT id,title,company,source,application_url,canonical_url,url,lifecycle_status,fit_score,last_seen_at FROM jobs ORDER BY fit_score DESC,last_seen_at DESC").all();
const receipts = database.prepare("SELECT provider,count(*) AS count FROM submission_receipts GROUP BY provider").all();
database.close();

const supplemental=option("targets","")?JSON.parse(await readFile(path.resolve(option("targets","")),"utf8")):[];
if(!Array.isArray(supplemental)||supplemental.length>100)throw new Error("Targets devem ser uma lista com ate 100 URLs publicas.");
for(const target of supplemental){if(applicationProvider(target.url).toLowerCase()!==target.provider)throw new Error("Provider do target diverge da URL.");jobs.unshift({url:target.url,title:target.title||"Alvo de homologacao",company:target.company||"",source:"MANUAL_HOMOLOGATION",lifecycle_status:"UNKNOWN"});}

const groups = new Map();
for (const job of jobs) {
  const provider = applicationProvider(job.application_url || job.canonical_url || job.url).toLowerCase();
  if (!groups.has(provider)) groups.set(provider, []);
  groups.get(provider).push(job);
}
await mkdir(output, { recursive: true });
const report = { generatedAt: new Date().toISOString(), mode: "PUBLIC_INSPECTION_ONLY", externalSubmission: false, portals: [] };
for (const capability of capabilities) {
  const catalog = groups.get(capability.atsType) || [];
  const job = catalog.find(item => item.lifecycle_status !== "CLOSED" && /suporte|infraestrutura|redes|desenvolv|software|cloud|seguran[cç]a|analista/i.test(item.title)) || catalog.find(item => item.lifecycle_status !== "CLOSED");
  const result = { provider: capability.atsType, capability: capability.level, canSubmit: capability.canSubmit, catalogCount: catalog.length, confirmedReceipts: receipts.find(item => item.provider === capability.atsType)?.count || 0, status: "NO_CATALOG_TARGET", submitAttempted: false };
  if (job) {
    result.job = { id: job.id, title: job.title, company: job.company, discoverySource: job.source };
    const evidenceDir = path.join(output, capability.atsType);
    try {
      const url = resolveAutomationEntryUrl(job.application_url || job.canonical_url || job.url);
      const inspected = await new LiveInspector({ publicOnly: true, timeoutMs: 12000, evidenceDir }).inspect(url);
      result.inspection = { url: inspected.url, detectedProvider: inspected.ats, fields: inspected.fieldsFound, requiredFields: inspected.requiredFields || 0, supported: inspected.supported, challenge: inspected.challenge || "", variant: inspected.variant || "",availability:inspected.availability||"UNCONFIRMED" };
      result.status = inspected.availability==="CLOSED"?"JOB_CLOSED":inspected.challenge ? "HUMAN_ACTION_REQUIRED" : inspected.supported && inspected.fieldsFound ? "PUBLIC_FORM_INSPECTED" : "FORM_NOT_SUPPORTED";
    } catch (error) {
      result.status = "INSPECTION_FAILED";
      result.errorCode = error.code || (/timeout/i.test(error.message) ? "PORTAL_TIMEOUT" : "FORM_INSPECTION_FAILED");
    }
    result.visualEvidence = await stat(path.join(evidenceDir, "inspection.png")).then(() => `${capability.atsType}/inspection.png`).catch(() => "");
  }
  report.portals.push(result);
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ provider: result.provider, status: result.status, fields: result.inspection?.fields || 0, canSubmit: result.canSubmit }));
}
console.log(JSON.stringify({ report: path.join(output, "report.json"), portals: report.portals.length, externalSubmission: false }));
