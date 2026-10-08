import { SourceResolver } from "../discovery/source-resolver.mjs";
import {
  operationalStatusFromObservation,
  sourceSurface,
} from "../discovery/source-authority.mjs";

export const COVERAGE_STATUSES = Object.freeze([
  "FOUND_AUTOMATICALLY",
  "FOUND_BY_OTHER_SOURCE",
  "FOUND_BUT_FILTERED",
  "FOUND_BUT_RANKED_LOW",
  "MISSED_QUERY",
  "MISSED_PLANNER_BUDGET",
  "MISSED_PAGINATION",
  "MISSED_PROVIDER_LIMIT",
  "MISSED_PARSER",
  "MISSED_LOCATION",
  "MISSED_DEDUPLICATION",
  "MISSED_SOURCE",
  "SOURCE_BLOCKED",
  "SOURCE_NOT_CONFIGURED",
  "SOURCE_NOT_IMPLEMENTED",
  "UNKNOWN",
]);

const trackingParameter = /^(utm_|ref$|ref_|source$|src$|trk|tracking|gh_src)/i;
const sourceAliases = new Map([
  ["linkedin", "jobspy:linkedin"], ["linkedin jobs", "jobspy:linkedin"],
  ["linkedin post", "linkedin-posts"], ["linkedin posts", "linkedin-posts"],
  ["indeed", "jobspy:indeed"], ["glassdoor", "jobspy:glassdoor"],
  ["google jobs", "jobspy:google"], ["google", "jobspy:google"],
  ["vagas.com", "vagas"], ["vagas.com.br", "vagas"],
  ["pagina da empresa", "generic-career-page"], ["página da empresa", "generic-career-page"],
  ["career page", "generic-career-page"],
]);
const domainSurfaces = [
  [/linkedin\.com\/jobs\/view/i, "jobspy:linkedin"],
  [/linkedin\.com\/(?:posts|feed\/update)/i, "linkedin-posts"],
  [/indeed\./i, "jobspy:indeed"], [/glassdoor\./i, "jobspy:glassdoor"],
  [/nerdin\.com\.br/i, "nerdin"], [/remotar\.com\.br/i, "remotar"],
  [/carreiras\.iel\.org\.br/i, "iel"], [/programathor\.com\.br/i, "programathor"],
  [/solides/i, "solides"], [/recrutei\.com\.br/i, "recrutei"],
  [/gupy\.io/i, "gupy"], [/catho\.com\.br/i, "catho"],
  [/infojobs\.com\.br/i, "infojobs"], [/vagas\.com\.br/i, "vagas"],
  [/greenhouse\.io/i, "greenhouse"], [/lever\.co/i, "lever"],
  [/ashbyhq\.com/i, "ashby"], [/smartrecruiters\.com/i, "smartrecruiters"],
  [/workable\.com/i, "workable"], [/myworkday/i, "workday"],
  [/eureca\.me/i, "eureca"], [/geekhunter\.com\.br/i, "geekhunter"],
  [/ciee\./i, "ciee"], [/nube\.com\.br/i, "nube"], [/cide\./i, "cide"],
];
const stopWords = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "com", "a", "o", "jr", "junior", "pleno", "senior"]);
const text = (value, max = 2_000) => String(value || "").trim().slice(0, max);
const normalized = (value) => text(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (value) => normalized(value).split(/\s+/).filter((item) => item.length > 2 && !stopWords.has(item));
const intersects = (left, right) => {
  const wanted = new Set(tokens(left));
  return tokens(right).some((item) => wanted.has(item));
};

export function canonicalizeReferenceUrl(value) {
  if (!text(value)) return "";
  let url;
  try { url = new URL(text(value, 2_000)); }
  catch { throw Object.assign(new Error("Informe uma URL HTTP ou HTTPS válida."), { code: "COVERAGE_REFERENCE_URL_INVALID", status: 400 }); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw Object.assign(new Error("A URL de referência não é permitida."), { code: "COVERAGE_REFERENCE_URL_UNSAFE", status: 400 });
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (trackingParameter.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  const linkedInId = `${url.hostname}${url.pathname}`.match(/linkedin\.com\/jobs\/view\/(?:[^/?]*-)?(\d+)/i)?.[1];
  if (linkedInId) return `https://www.linkedin.com/jobs/view/${linkedInId}`;
  return url.toString().replace(/\/$/, "");
}

function identifySurface(url, perceivedSource = "") {
  const alias = sourceAliases.get(normalized(perceivedSource));
  if (alias) return alias;
  for (const [pattern, id] of domainSurfaces) if (pattern.test(url)) return id;
  return perceivedSource && sourceSurface(normalized(perceivedSource)) ? normalized(perceivedSource) : "generic-career-page";
}

function titleFromUrl(url) {
  if (!url) return "";
  const slug = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "")
    .replace(/\.(?:php|html?)$/i, "").replace(/[-_]?(?:\d{4,}|[a-f0-9]{8,})$/i, "")
    .replace(/[-_]+/g, " ").trim();
  return /[a-zA-ZÀ-ÿ]{3}/.test(slug) && !/^(job|jobs|vaga|view|apply|application)$/i.test(slug) ? slug.slice(0, 200) : "";
}

function parseCsv(body) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const finishField = () => { row.push(field); field = ""; };
  const finishRow = () => { finishField(); if (row.some((item) => item.trim())) rows.push(row); row = []; };
  for (let index = 0; index < String(body || "").length; index++) {
    const character = body[index];
    if (character === '"' && quoted && body[index + 1] === '"') { field += '"'; index++; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) finishField();
    else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && body[index + 1] === "\n") index++; finishRow(); }
    else field += character;
  }
  if (field || row.length) finishRow();
  if (quoted) throw Object.assign(new Error("CSV possui aspas não encerradas."), { code: "COVERAGE_CSV_INVALID", status: 400 });
  if (rows.length < 2) return [];
  const headers = rows[0].map((item) => normalized(item).replace(/ /g, ""));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function postFacts(sourceText) {
  const value = text(sourceText, 20_000), lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const field = (pattern) => lines.map((line) => line.match(pattern)?.[1]?.trim()).find(Boolean) || "";
  const urls = [...value.matchAll(/https?:\/\/[^\s)\]}>,]+/gi)].map((match) => match[0]);
  return {
    title: field(/^(?:vaga|cargo|posição|position)\s*[:\-]\s*(.+)$/i) || lines.find((line) => !/^https?:/i.test(line)) || "",
    company: field(/^(?:empresa|company)\s*[:\-]\s*(.+)$/i),
    location: field(/^(?:localização|local|location)\s*[:\-]\s*(.+)$/i),
    externalUrl: urls.find((url) => !/linkedin\.com/i.test(url)) || "",
    recruiterContact: value.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] || "",
  };
}

function familyFor(reference) {
  const value = normalized(`${reference.title} ${reference.notes}`);
  if (/noc|rede|network/.test(value)) return "NETWORK_NOC";
  if (/devops|sre|cloud|observabilidade/.test(value)) return "DEVOPS_SRE";
  if (/infraestrutura|sysadmin|servidor/.test(value)) return "INFRASTRUCTURE";
  if (/service desk|help desk|suporte/.test(value)) return "SUPPORT";
  if (/seguranca|security|soc/.test(value)) return "SECURITY";
  return "";
}

function geographyFor(reference) {
  const value = normalized(`${reference.location} ${reference.workModel}`);
  if (/remot|home office|\bbrasil\b/.test(value)) return "REMOTE_BRAZIL";
  if (/brasilia|distrito federal|\bdf\b/.test(value)) return "LOCAL_DF";
  return "";
}

const evidence = (code, detail, data = {}) => ({ code, detail, ...data });
const timeline = (stage, status, detail) => ({ stage, status, detail });

export class CoverageBenchmarkService {
  constructor({ repository, store, discoveryService, jobHuntService, opportunityService } = {}) {
    Object.assign(this, { repository, store, discoveryService, jobHuntService, opportunityService });
    this.sources = new SourceResolver();
  }

  normalizeReference(input = {}) {
    const originalUrl = text(input.url || input.originalUrl, 2_000);
    const canonicalUrl = originalUrl ? canonicalizeReferenceUrl(originalUrl) : "";
    const sourceText = text(input.sourceText || input.text, 20_000);
    if (!canonicalUrl && !sourceText)
      throw Object.assign(new Error("Informe uma URL ou o texto público da vaga."), { code: "COVERAGE_REFERENCE_REQUIRED", status: 400 });
    const surface = identifySurface(canonicalUrl, input.perceivedSource || input.source);
    const post = surface === "linkedin-posts" ? postFacts(sourceText) : {};
    return {
      originalUrl, canonicalUrl, title: text(input.title || post.title || titleFromUrl(canonicalUrl), 200),
      company: text(input.company || post.company, 200), perceivedSource: surface,
      location: text(input.location || post.location, 200), workModel: text(input.workModel || input.modality, 80),
      sourcePage: Math.max(0, Number(input.sourcePage || input.page || 0)) || null,
      providerPosition: Math.max(0, Number(input.providerPosition || input.position || 0)) || null,
      foundAt: text(input.foundAt || input.found_at, 40) || new Date().toISOString(),
      interest: text(input.interest, 120), notes: text(input.notes, 2_000), sourceText,
      extracted: post,
    };
  }

  add(input) { return this.repository.saveReference(this.normalizeReference(input)); }

  addMany(inputs = []) {
    if (!Array.isArray(inputs) || inputs.length > 300)
      throw Object.assign(new Error("Envie uma lista de até 300 referências."), { code: "COVERAGE_REFERENCE_BATCH_INVALID", status: 400 });
    return inputs.map((item) => this.add(typeof item === "string" ? { url: item } : item));
  }

  importData({ format = "URLS", content = "" } = {}) {
    const kind = String(format).toUpperCase();
    let records;
    if (kind === "JSON") {
      try { const parsed = JSON.parse(String(content || "[]")); records = Array.isArray(parsed) ? parsed : [parsed]; }
      catch { throw Object.assign(new Error("JSON de referências inválido."), { code: "COVERAGE_JSON_INVALID", status: 400 }); }
    } else if (kind === "CSV") records = parseCsv(content).map((item) => ({
      url: item.url, title: item.cargo || item.title, company: item.empresa || item.company,
      perceivedSource: item.fonte || item.perceivedsource || item.source, location: item.localizacao || item.location,
      workModel: item.modalidade || item.workmodel, foundAt: item.data || item.foundat,
      interest: item.interesse || item.interest, notes: item.observacoes || item.notes,
      sourcePage: item.pagina || item.sourcepage, providerPosition: item.posicao || item.providerposition,
    }));
    else records = String(content || "").split(/\r?\n/).map((url) => url.trim()).filter(Boolean).map((url) => ({ url }));
    return this.addMany(records);
  }

  context() {
    return Promise.all([this.opportunityService.list()]).then(([opportunities]) => {
      const actionable = opportunities.filter((item) => !["BLOCKED", "SKIP"].includes(item.decision?.disposition));
      const index = (items) => new Map(items.flatMap((item, position) => {
        const ranked = { item, position: position + 1 };
        return [item.job.id, ...(item.job.duplicateGroup?.jobIds || [])]
          .map((jobId) => [jobId, ranked]);
      }));
      return {
        opportunities,
        ranking: index(actionable),
        allRanking: index(opportunities),
        jobs: this.store.jobs.all(),
        discoveryRuns: this.store.discovery.runs(),
        huntRuns: this.store.jobHuntRuns.list(),
      };
    });
  }

  jobUrls(job) {
    return [job.url, job.canonicalUrl, job.applicationUrl, ...(this.store.discovery.sourcesForJob(job.id) || []).flatMap((item) => [item.sourceUrl, item.canonicalUrl])]
      .filter(Boolean).map((url) => { try { return canonicalizeReferenceUrl(url); } catch { return ""; } }).filter(Boolean);
  }

  sourceStatus(surfaceId) {
    const definition = sourceSurface(surfaceId);
    if (!definition) return { definition: null, status: "UNKNOWN", observation: null };
    const observation = this.store.discoverySourceHealth.latest(surfaceId);
    if (observation) return { definition, status: operationalStatusFromObservation(observation), observation };
    if (definition.discovery_mode === "MANUAL_ONLY") return { definition, status: "MANUAL_ONLY", observation: null };
    if (definition.status === "NOT_IMPLEMENTED") return { definition, status: "NOT_IMPLEMENTED", observation: null };
    if (!definition.enabled) return { definition, status: "DISABLED", observation: null };
    const configuredBoards = definition.requires_known_board ? this.store.watchlists.boards().filter((item) => item.provider === definition.provider_id && item.enabled).length : 1;
    if (!configuredBoards || ["CREDENTIAL_REQUIRED", "PAIRING_REQUIRED", "OPTIONAL_NOT_CONFIGURED"].includes(definition.configuration_state))
      return { definition, status: "NOT_CONFIGURED", observation: null };
    return { definition, status: definition.status || "UNKNOWN", observation: null };
  }

  runEvidence(surfaceId, context) {
    const definition = sourceSurface(surfaceId), provider = definition?.provider_id || surfaceId;
    const direct = context.discoveryRuns.filter((run) => run.providers.includes(provider));
    const hunts = context.huntRuns.filter((run) => (run.report?.providers || []).includes(provider) || (run.report?.sourceReports || []).some((item) => item.provider === provider));
    const queries = [...new Set([...direct.map((run) => run.query?.query), ...hunts.flatMap((run) => run.report?.expandedQueries || [])].filter(Boolean))];
    return { provider, direct, hunts, queries };
  }

  scoreTrace(item) {
    const requirementOf = (entry) => entry?.requirement || entry || {};
    const labelOf = (entry) => requirementOf(entry).label || requirementOf(entry).name || requirementOf(entry).normalizedName || "";
    const analysisItems = item.items || [];
    return {
      rawRequirements: (item.requirements || []).map((requirement) => requirement.rawText || requirement.text || requirement.label || requirement.name || "").filter(Boolean),
      normalizedRequirements: (item.requirements || []).map((requirement) => ({
        label: requirement.label || requirement.name || requirement.normalizedName || "",
        type: requirement.type || requirement.category || "UNKNOWN",
        required: Boolean(requirement.required),
      })),
      matchedSkills: analysisItems.filter((entry) => ["MATCH", "PARTIAL_MATCH"].includes(entry.status)).map(labelOf).filter(Boolean),
      missingSkills: analysisItems.filter((entry) => ["NO_MATCH", "UNKNOWN"].includes(entry.status)).map(labelOf).filter(Boolean),
      hardRequirements: analysisItems.filter((entry) => requirementOf(entry).required).map((entry) => ({ label: labelOf(entry), status: entry.status })),
      softRequirements: analysisItems.filter((entry) => !requirementOf(entry).required).map((entry) => ({ label: labelOf(entry), status: entry.status })),
      dimensions: item.analysis ? {
        experience: item.analysis.experienceScore,
        education: item.analysis.educationScore,
        location: item.analysis.locationScore,
        employmentType: item.analysis.employmentTypeScore ?? null,
        language: item.analysis.languagesScore,
        seniority: item.analysis.seniorityScore,
        coverage: item.analysis.evidenceCoverage,
        confidence: item.analysis.matchConfidence,
      } : null,
      priority: item.priority,
      filter: {
        result: item.decision?.disposition || "UNKNOWN",
        reasons: item.decision?.reasons || [],
        hardBlockers: item.decision?.hardBlockers || [],
      },
    };
  }

  async diagnose(referenceInput, suppliedContext = null) {
    const reference = referenceInput.id ? referenceInput : this.normalizeReference(referenceInput);
    const context = suppliedContext || await this.context();
    const surfaceId = reference.perceivedSource || identifySurface(reference.canonicalUrl, "");
    const statusEvidence = this.sourceStatus(surfaceId);
    const canonical = reference.canonicalUrl;
    const exact = canonical ? context.jobs.filter((job) => this.jobUrls(job).includes(canonical)) : [];
    const semantic = context.jobs.filter((job) => reference.title && reference.company && normalized(job.title) === normalized(reference.title) && normalized(job.company) === normalized(reference.company));
    const matchedJob = exact[0] || semantic[0] || null;
    const sources = matchedJob ? this.store.discovery.sourcesForJob(matchedJob.id) : [];
    const automaticSources = sources.filter((item) => item.provenance?.originType !== "MANUAL_IMPORT" && item.provider !== "manual");
    const ranking = matchedJob ? context.ranking.get(matchedJob.id) : null;
    const allRanking = matchedJob ? context.allRanking.get(matchedJob.id) : null;
    const runs = this.runEvidence(surfaceId, context);
    const result = {
      reference, surface: statusEvidence.definition ? { id: surfaceId, displayName: statusEvidence.definition.display_name, status: statusEvidence.status } : { id: surfaceId, displayName: surfaceId, status: "UNKNOWN" },
      status: "UNKNOWN", matchedJob: matchedJob ? { id: matchedJob.id, title: matchedJob.title, company: matchedJob.company, url: matchedJob.canonicalUrl || matchedJob.url } : null,
      rankingPosition: ranking?.position ?? null,
      allRankingPosition: allRanking?.position ?? null,
      evidence: [], timeline: [], diagnosedAt: new Date().toISOString(),
    };
    if (allRanking?.item) result.scoreTrace = this.scoreTrace(allRanking.item);
    result.timeline.push(timeline("SOURCE", "IDENTIFIED", `${result.surface.displayName || surfaceId} identificada pela URL ou fonte informada.`));
    result.evidence.push(evidence("SOURCE_IDENTIFIED", `Superfície canônica: ${surfaceId}.`, { surfaceId }));

    if (matchedJob && automaticSources.length) {
      const discoveredSurfaces = new Set(automaticSources.flatMap((item) => [item.provider, item.discoveredVia, item.provider === "jobspy" ? `jobspy:${item.discoveredVia}` : ""]).filter(Boolean));
      const sameSurface = discoveredSurfaces.has(surfaceId);
      const sameProvider = !surfaceId.startsWith("jobspy:")
        && discoveredSurfaces.has(statusEvidence.definition?.provider_id);
      const foundByOther = !sameSurface && !sameProvider;
      result.timeline.push(timeline("DATABASE", "FOUND", `A identidade foi associada à vaga ${matchedJob.id}.`));
      result.timeline.push(timeline("PROVENANCE", "FOUND", `${automaticSources.length} proveniência(s) automática(s) registrada(s).`));
      result.evidence.push(evidence("AUTOMATIC_PROVENANCE", "A vaga possui proveniência automática persistida.", { sources: automaticSources }));
      if (foundByOther) {
        result.status = "FOUND_BY_OTHER_SOURCE";
      } else if (allRanking?.item?.decision?.disposition === "BLOCKED" || allRanking?.item?.decision?.disposition === "SKIP") {
        result.status = "FOUND_BUT_FILTERED";
        result.evidence.push(evidence("FILTER_DECISION", allRanking.item.decision.decisionExplanation?.summary || "A política retirou a vaga da fila principal.", { disposition: allRanking.item.decision.disposition, reasons: allRanking.item.decision.reasons || [] }));
      } else if (ranking && ranking.position > 25) {
        result.status = "FOUND_BUT_RANKED_LOW";
        result.evidence.push(evidence("LOW_RANK", `A vaga está na posição ${ranking.position} do ranking atual.`, { rankingPosition: ranking.position, score: ranking.item.priority?.score }));
      } else result.status = "FOUND_AUTOMATICALLY";
      result.timeline.push(timeline("RESULT", result.status, `Classificação final: ${result.status}.`));
      return result;
    }

    if (semantic.length && !exact.length) {
      result.status = "MISSED_DEDUPLICATION";
      result.matchedJob = { id: semantic[0].id, title: semantic[0].title, company: semantic[0].company, url: semantic[0].canonicalUrl || semantic[0].url };
      result.evidence.push(evidence("SEMANTIC_DUPLICATE_WITHOUT_URL_LINK", "Existe vaga com mesmo cargo e empresa, mas a URL de referência não foi ligada à identidade canônica.", { jobId: semantic[0].id }));
      result.timeline.push(timeline("DEDUPLICATION", "MISSED", "A equivalência semântica existe, mas a URL não consta na proveniência."));
      return result;
    }

    result.timeline.push(timeline("DATABASE", "NOT_FOUND", "A URL canônica não aparece em jobs nem em job_sources."));
    if (statusEvidence.status === "BLOCKED") result.status = "SOURCE_BLOCKED";
    else if (statusEvidence.status === "NOT_CONFIGURED" || statusEvidence.status === "DISABLED") result.status = "SOURCE_NOT_CONFIGURED";
    else if (statusEvidence.status === "NOT_IMPLEMENTED") result.status = "SOURCE_NOT_IMPLEMENTED";
    else if (statusEvidence.status === "MANUAL_ONLY") result.status = "MISSED_SOURCE";
    if (result.status !== "UNKNOWN") {
      result.evidence.push(evidence("SOURCE_STATE", `A autoridade de fontes registra ${statusEvidence.status}.`, { sourceStatus: statusEvidence.status }));
      result.timeline.push(timeline("SOURCE_HEALTH", statusEvidence.status, `Estado operacional: ${statusEvidence.status}.`));
      return result;
    }

    const family = familyFor(reference), geography = geographyFor(reference);
    const budgetRun = runs.hunts.find((run) => family && geography && (run.report?.queryPlanner?.coverage?.remainingCombinations || []).includes(`${family}:${geography}`));
    if (budgetRun) {
      result.status = "MISSED_PLANNER_BUDGET";
      result.evidence.push(evidence("COMBINATION_NOT_EXECUTED", `${family}:${geography} estava planejada, mas permaneceu fora da rodada por budget.`, { runId: budgetRun.id, effectiveBudget: budgetRun.report.queryPlanner.effectiveQueryBudget, requiredCombinations: budgetRun.report.queryPlanner.requiredCombinationCount }));
      result.timeline.push(timeline("PLANNER", "NOT_EXECUTED", `A combinação ${family}:${geography} ficou em remainingCombinations.`));
      return result;
    }

    const observation = statusEvidence.observation;
    if (reference.sourcePage > Number(observation?.pagesScanned || 0) && statusEvidence.definition?.supports_pagination) {
      result.status = "MISSED_PAGINATION";
      result.evidence.push(evidence("PAGE_NOT_SCANNED", `A referência está na página ${reference.sourcePage}; a execução percorreu ${observation?.pagesScanned || 0}.`, { sourcePage: reference.sourcePage, pagesScanned: observation?.pagesScanned || 0, runId: observation?.runId || "" }));
      result.timeline.push(timeline("PAGINATION", "NOT_REACHED", `Página ${reference.sourcePage} não foi percorrida.`));
      return result;
    }
    if (reference.providerPosition > Number(statusEvidence.definition?.current_limit || 0) && statusEvidence.definition?.current_limit) {
      result.status = "MISSED_PROVIDER_LIMIT";
      result.evidence.push(evidence("POSITION_AFTER_LIMIT", `A posição ${reference.providerPosition} excede o limite ${statusEvidence.definition.current_limit}.`, { providerPosition: reference.providerPosition, limit: statusEvidence.definition.current_limit }));
      result.timeline.push(timeline("PROVIDER_LIMIT", "NOT_REACHED", "A vaga ficou depois do limite configurado."));
      return result;
    }
    if (runs.queries.length && reference.title && !runs.queries.some((query) => intersects(reference.title, query))) {
      result.status = "MISSED_QUERY";
      result.evidence.push(evidence("QUERY_MISMATCH", "As consultas executadas não compartilham termos relevantes com o cargo de referência.", { executedQueries: runs.queries }));
      result.timeline.push(timeline("QUERY", "NO_MATCH", `${runs.queries.length} consulta(s) foram executadas, sem termo compatível.`));
      return result;
    }
    if (observation?.lastDiscardedCount > 0 && /fora|outside|local/i.test(reference.notes || "")) {
      result.status = "MISSED_LOCATION";
      result.evidence.push(evidence("LOCATION_DISCARDS", "A execução registrou descartes geográficos e a referência foi marcada com evidência de localização.", { discarded: observation.lastDiscardedCount, location: reference.location }));
      return result;
    }
    if (observation?.lastRawCount > 0 && observation.lastParsedCount === 0) {
      result.status = "MISSED_PARSER";
      result.evidence.push(evidence("RAW_WITHOUT_PARSED", "A fonte retornou itens brutos, mas nenhum foi parseado.", { raw: observation.lastRawCount, parsed: observation.lastParsedCount, runId: observation.runId }));
      return result;
    }
    result.evidence.push(evidence("INSUFFICIENT_EVIDENCE", "Não há evidência persistida suficiente para atribuir uma causa específica.", { executedQueries: runs.queries, sourceStatus: statusEvidence.status }));
    result.timeline.push(timeline("RESULT", "UNKNOWN", "A causa permanece desconhecida em vez de ser inferida sem prova."));
    return result;
  }

  async diagnoseUrl(input = {}) { return this.diagnose(this.normalizeReference(input)); }

  async runBenchmark() {
    const run = this.repository.startRun();
    try {
      const references = this.repository.references(), context = await this.context(), diagnostics = [];
      for (const reference of references) {
        const diagnostic = await this.diagnose(reference, context);
        diagnostics.push(diagnostic);
        this.repository.recordItem(run.id, reference.id, diagnostic);
      }
      const summary = this.summarize(diagnostics);
      return this.repository.finishRun(run.id, summary);
    } catch (error) {
      this.repository.failRun(run.id, error.code || "COVERAGE_BENCHMARK_FAILED");
      throw error;
    }
  }

  summarize(diagnostics) {
    const total = diagnostics.length, foundStatuses = new Set(["FOUND_AUTOMATICALLY", "FOUND_BY_OTHER_SOURCE", "FOUND_BUT_FILTERED", "FOUND_BUT_RANKED_LOW"]);
    const automaticFoundStatuses = new Set(["FOUND_AUTOMATICALLY", "FOUND_BUT_FILTERED", "FOUND_BUT_RANKED_LOW"]);
    const byStatus = Object.fromEntries(COVERAGE_STATUSES.map((status) => [status, diagnostics.filter((item) => item.status === status).length]));
    const bySource = {};
    for (const item of diagnostics) {
      const source = item.reference.perceivedSource || "unknown";
      bySource[source] ||= { total: 0, found: 0, missed: 0 };
      bySource[source].total++;
      if (foundStatuses.has(item.status)) bySource[source].found++; else bySource[source].missed++;
    }
    const found = diagnostics.filter((item) => foundStatuses.has(item.status));
    const ranked = diagnostics.filter((item) => Number.isInteger(item.rankingPosition));
    const ranks = ranked.map((item) => item.rankingPosition).sort((left, right) => left - right);
    const medianRank = ranks.length
      ? ranks.length % 2
        ? ranks[Math.floor(ranks.length / 2)]
        : Number(((ranks[ranks.length / 2 - 1] + ranks[ranks.length / 2]) / 2).toFixed(2))
      : null;
    const filtered = diagnostics.filter((item) => item.status === "FOUND_BUT_FILTERED");
    const invalid = diagnostics.filter((item) => item.matchedJob && contextLifecycle(this.store.jobs.findById(item.matchedJob.id)) === "CLOSED").length;
    return {
      totalReferenceJobs: total,
      foundAutomatically: diagnostics.filter((item) => automaticFoundStatuses.has(item.status)).length,
      foundByOtherSource: byStatus.FOUND_BY_OTHER_SOURCE,
      found: found.length,
      missed: total - found.length,
      coverageRate: total ? Number((found.length / total).toFixed(4)) : 0,
      coverageBySource: bySource,
      missedByReason: byStatus,
      duplicateRate: total ? Number((byStatus.MISSED_DEDUPLICATION / total).toFixed(4)) : 0,
      invalidJobRate: total ? Number((invalid / total).toFixed(4)) : 0,
      top10Recall: total ? Number((ranked.filter((item) => item.rankingPosition <= 10).length / total).toFixed(4)) : null,
      top25Recall: total ? Number((ranked.filter((item) => item.rankingPosition <= 25).length / total).toFixed(4)) : null,
      meanRank: ranks.length ? Number((ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length).toFixed(2)) : null,
      medianRank,
      rankedPositiveCount: ranks.length,
      filteredPositiveRate: total ? Number((filtered.length / total).toFixed(4)) : null,
      hardBlockFalsePositiveRate: total ? Number((filtered.filter((item) => item.scoreTrace?.filter?.hardBlockers?.length).length / total).toFixed(4)) : null,
      meanReciprocalRank: total ? Number((ranks.reduce((sum, rank) => sum + (1 / rank), 0) / total).toFixed(4)) : null,
      precisionAt10: null,
      precisionAt25: null,
      metricDefinitions: {
        positiveSet: "Todas as referências do ground truth existente; referências não encontradas ou filtradas não recebem rank operacional.",
        rankPosition: "Posição após excluir BLOCKED e SKIP; allRankingPosition preserva a posição na projeção completa para diagnóstico.",
        precision: "Indisponível: o universo completo do Top K não possui rótulos humanos de relevância.",
      },
    };
  }

  async importReference(id) {
    const reference = this.repository.findReference(id);
    if (!reference) throw Object.assign(new Error("Vaga de referência não encontrada."), { code: "COVERAGE_REFERENCE_NOT_FOUND", status: 404 });
    if (reference.importedJobId) return { reference, job: this.store.jobs.findById(reference.importedJobId), alreadyImported: true };
    const surfaceId = reference.perceivedSource || identifySurface(reference.canonicalUrl, ""), definition = sourceSurface(surfaceId), resolved = this.sources.resolve(reference.canonicalUrl), post = surfaceId === "linkedin-posts" ? postFacts(reference.sourceText) : {};
    const provider = definition?.provider_id === "jobspy" ? "jobspy" : definition?.provider_id || resolved.atsType || "manual";
    const raw = {
      provider, providerCategory: definition?.type || "MANUAL_IMPORT",
      providerJobId: resolved.providerJobId || `manual:${reference.id}`,
      discoveredVia: definition?.provider_id === "jobspy" ? surfaceId.split(":")[1] : surfaceId,
      sourceUrl: reference.originalUrl || reference.canonicalUrl,
      canonicalUrl: post.externalUrl || reference.canonicalUrl,
      applicationUrl: post.externalUrl || reference.canonicalUrl,
      atsType: resolved.atsType, companyIdentity: resolved.organizationKey,
      title: reference.title || post.title, company: reference.company || post.company,
      description: reference.sourceText || reference.notes,
      location: reference.location || post.location, workModel: reference.workModel,
      lifecycleStatus: "UNKNOWN",
      provenance: { originType: "MANUAL_IMPORT", referenceJobId: reference.id, originalUrl: reference.originalUrl, recruiterContact: post.recruiterContact || "" },
    };
    const ingested = this.discoveryService.ingestResolvedJobs([raw], {
      source: provider, query: { query: reference.title || "manual import", location: reference.location || "Brasil" },
      recordSourceHealth: false,
    });
    const job = ingested.jobs[0];
    if (!job) throw Object.assign(new Error("A referência não pôde entrar no pipeline canônico."), { code: "COVERAGE_IMPORT_FAILED", status: 422 });
    const profile = this.jobHuntService.listProfiles().find((item) => item.enabled) || this.jobHuntService.listProfiles()[0] || {};
    await this.jobHuntService.evaluateDiscoveredJobs([job], { consider: profile.considerThreshold ?? 70, priority: profile.notifyThreshold ?? 85 });
    this.opportunityService.invalidate();
    return { reference: this.repository.markImported(reference.id, job.id), job: this.store.jobs.findById(job.id), alreadyImported: false };
  }

  async dashboard() {
    const references = this.repository.references(), context = await this.context();
    const diagnostics = [];
    for (const reference of references) diagnostics.push(await this.diagnose(reference, context));
    return { references, diagnostics, summary: this.summarize(diagnostics), latestRun: this.repository.latestRun() };
  }
}

const contextLifecycle = (job) => String(job?.lifecycleStatus || "UNKNOWN").toUpperCase();
