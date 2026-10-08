import {
  PROVIDER_CAPABILITIES as CAPABILITY,
  PROVIDER_CATEGORIES,
  normalizeDiscoveryJob,
  providerDiagnostic,
} from "../types.mjs";
import { extractApplicationLinks, resolveApplicationDestination } from "../application-destination-resolver.mjs";

const ENTITY = Object.freeze({
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
});
const STOP_WORDS = new Set([
  "a",
  "as",
  "de",
  "do",
  "da",
  "das",
  "dos",
  "e",
  "em",
  "job",
  "jobs",
  "para",
  "the",
  "vaga",
  "vagas",
]);
const SYNONYMS = Object.freeze({
  apprenticeship: ["aprendiz", "aprendizagem"],
  backend: ["back-end", "back end"],
  developer: ["desenvolvedor", "desenvolvedora", "desenvolvimento"],
  frontend: ["front-end", "front end"],
  intern: ["estagio", "estagiario", "estagiaria"],
  internship: ["estagio", "estagiario", "estagiaria"],
  junior: ["junior", "jr"],
  software: ["software", "sistemas", "tecnologia"],
});

const clean = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();
const fold = (value) =>
  clean(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
const decodeEntities = (value) =>
  String(value || "").replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (match, entity) => {
      const normalized = entity.toLowerCase();
      if (normalized.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
      if (normalized.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
      return ENTITY[normalized] ?? match;
    },
  );
const htmlToText = (value) =>
  clean(
    decodeEntities(
      String(value || "")
        .replace(/<\s*br\s*\/?\s*>/gi, "\n")
        .replace(/<\/(?:p|li|div|h\d)>/gi, "\n")
        .replace(/<[^>]*>/g, " "),
    ),
  );
const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const first = (value) => asArray(value)[0] || null;
const valueOf = (value) =>
  typeof value === "object" && value !== null
    ? value.name || value.value || ""
    : value || "";
const safeExternalUrl = (value, fallback) => {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
};
const extractId = (value) =>
  String(value || "").match(/\/(\d+)(?:[-/?#]|$)/)?.[1] ||
  String(value || "").match(/-(\d{4,})(?:\.php)?(?:[/?#]|$)/)?.[1] ||
  "";
const extractSitemapUrls = (xml) =>
  [...String(xml || "").matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) =>
    decodeEntities(match[1]),
  );
const extractSitemapEntries = (xml) => {
  const source = String(xml || ""), entries = [];
  for (const match of source.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)) {
    const url = match[1].match(/<loc>\s*([^<]+?)\s*<\/loc>/i)?.[1];
    if (!url) continue;
    entries.push({
      url: decodeEntities(url),
      lastModified: clean(match[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/i)?.[1]),
    });
  }
  return entries.length ? entries : extractSitemapUrls(source).map((url) => ({ url, lastModified: "" }));
};
const boundedInteger = (value, fallback, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback));
const wait = (milliseconds) => milliseconds > 0
  ? new Promise((resolve) => setTimeout(resolve, milliseconds))
  : Promise.resolve();

function escapeJsonControls(value) {
  let output = "",
    quoted = false,
    escaped = false;
  for (const character of String(value || "")) {
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      output += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      output += character;
      continue;
    }
    if (quoted && character === "\r") continue;
    if (quoted && character === "\n") {
      output += "\\n";
      continue;
    }
    if (quoted && character === "\t") {
      output += "\\t";
      continue;
    }
    output += character;
  }
  return output;
}

function structuredJobs(html) {
  const jobs = [];
  for (const match of String(html || "").matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const raw = match[1].trim();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = JSON.parse(escapeJsonControls(raw));
      }
      const queue = [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (Array.isArray(item)) queue.push(...item);
        else if (item && typeof item === "object") {
          if (asArray(item["@type"]).includes("JobPosting")) jobs.push(item);
          if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
        }
      }
    } catch {
      // Dados estruturados inválidos são ignorados; a resposta não é registrada.
    }
  }
  return jobs;
}

function queryTerms(query) {
  const terms = fold(query)
    .split(/[^a-z0-9+#.-]+/)
    .map((item) => item.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((item) => item.length >= 2 && !STOP_WORDS.has(item));
  return [...new Set(terms.flatMap((term) => [term, ...(SYNONYMS[term] || [])]).map(fold))];
}

function urlScore(url, query, location) {
  const text = fold(decodeURIComponent(url));
  const terms = queryTerms(query);
  let score = terms.reduce((total, term) => total + (text.includes(term) ? 5 : 0), 0);
  const locationText = fold(location);
  if (locationText && locationText !== "brasil") {
    const state = locationText.match(/\b([a-z]{2})\b/)?.[1];
    if (state && new RegExp(`/${state}(?:/|$)`, "i").test(url)) score += 4;
    for (const token of locationText.split(/[^a-z0-9]+/).filter((item) => item.length > 2))
      if (text.includes(token)) score += 2;
  }
  return score;
}

function locationFromJobPosting(job) {
  const location = first(job.jobLocation),
    address = location?.address || {},
    meaningful = (value) => (/^[-—–]$/.test(clean(value)) ? "" : clean(value)),
    city = meaningful(address.addressLocality),
    state = meaningful(address.addressRegion),
    country = meaningful(valueOf(address.addressCountry) || "BR"),
    label = [city, state, country].filter(Boolean).join(", ");
  return { city, state, country, label };
}

function opportunityType(value) {
  const text = fold(value);
  if (/\b(estagio|estagiari|internship|intern)\b/.test(text)) return "INTERNSHIP";
  if (/\b(aprendiz|aprendizagem|jovem aprendiz|apprentice)\b/.test(text)) return "APPRENTICESHIP";
  if (/\btrainee\b/.test(text)) return "TRAINEE";
  if (/\bbanco de talentos|talent pool\b/.test(text)) return "TALENT_POOL";
  return "JOB";
}

function normalizeJobPosting({ provider, sourceClass, url, job, html = "" }) {
  const location = locationFromJobPosting(job),
    remote = fold(job.jobLocationType).includes("telecommute"),
    remoteScope = clean(
      asArray(job.applicantLocationRequirements)
        .map(valueOf)
        .filter(Boolean)
        .join(", "),
    ),
    employmentType = asArray(job.employmentType).map(valueOf).filter(Boolean).join(", "),
    seniority = asArray(job.occupationalCategory).map(valueOf).filter(Boolean).join(", "),
    company = clean(job.hiringOrganization?.name),
    description = htmlToText(job.description),
    id = extractId(url) || clean(job.identifier?.value),
    expiresAt = clean(job.validThrough),
    expired = expiresAt && !Number.isNaN(Date.parse(expiresAt)) && Date.parse(expiresAt) < Date.now(),
    destination = resolveApplicationDestination({
      sourceUrl: url,
      canonicalUrl: url,
      applicationUrl: typeof job.url === "string" ? job.url : "",
      candidateUrls: extractApplicationLinks(html, url),
    });
  return normalizeDiscoveryJob({
    provider,
    providerCategory: PROVIDER_CATEGORIES.BRAZIL,
    providerJobId: id,
    companyIdentity: fold(company),
    title: htmlToText(job.title),
    company,
    description,
    location: remote && !location.label ? remoteScope || "Remoto" : location.label,
    city: location.city,
    state: location.state,
    country: location.country,
    remote,
    workModel: remote ? "REMOTE" : "",
    employmentType,
    seniority,
    salary: job.baseSalary || null,
    postedAt: clean(job.datePosted),
    expiresAt,
    sourceUrl: url,
    canonicalUrl: url,
    applicationUrl: destination.applicationUrl || url,
    atsType: destination.kind === "KNOWN_ATS" ? destination.applicationProvider : "",
    lifecycleStatus: expired ? "CLOSED" : "OPEN",
    metadata: {
      sourceClass,
      opportunityType: opportunityType(`${job.title} ${employmentType} ${description.slice(0, 500)} ${url}`),
      remoteScope: remoteScope || "UNKNOWN",
      discoveryMode: "PUBLIC_FEED",
      structuredData: "JobPosting",
      applicationDestination: destination,
    },
    provenance: {
      title: provider,
      company: provider,
      description: provider,
      location: provider,
      applicationUrl: destination.evidence || provider,
    },
  });
}

class SitemapJobProvider {
  constructor({ id, client, sitemapUrl, jobUrlPattern, sourceClass, maxSitemapBytes = 5_000_000, checkpointRepository = null, incremental = false, urlBudget = 30 }) {
    Object.assign(this, {
      id,
      client,
      sitemapUrl,
      jobUrlPattern,
      sourceClass,
      maxSitemapBytes,
      checkpointRepository,
      incremental,
      urlBudget: boundedInteger(urlBudget, 30, 1, 60),
      category: PROVIDER_CATEGORIES.BRAZIL,
      capabilities: [
        CAPABILITY.SEARCH,
        CAPABILITY.JOB_DETAILS,
        CAPABILITY.CANONICAL_ID,
        CAPABILITY.INCREMENTAL_SYNC,
      ],
    });
  }
  async health() {
    await this.client.getText(new URL("/robots.txt", this.sitemapUrl), {
      maxBytes: 200_000,
    });
    return providerDiagnostic("HEALTHY", {
      scope: "PUBLIC_FEED",
      message: "Página pública e política de acesso responderam.",
    });
  }
  async search({ query = "", location = "Brasil", limit = 10 } = {}) {
    const { data } = await this.client.getText(this.sitemapUrl, {
        maxBytes: this.maxSitemapBytes,
      }),
      allCandidates = extractSitemapEntries(data)
        .filter((entry) => this.jobUrlPattern.test(entry.url))
        .map((entry) => ({ ...entry, score: urlScore(entry.url, query, location), id: Number(extractId(entry.url)) || 0 })),
      target = Math.max(1, Math.min(50, Number(limit) || 10)),
      scopeKey = "catalog",
      checkpoint = this.incremental ? this.checkpointRepository?.get(this.id, scopeKey) : null,
      processed = this.incremental ? this.checkpointRepository?.processed(this.id, scopeKey) || new Map() : new Map(),
      startCursor = allCandidates.length ? Number(checkpoint?.cursor || 0) % allCandidates.length : 0,
      runBudget = this.incremental ? Math.min(this.urlBudget, target) : Math.max(1, Math.min(30, target * 3 || 15)),
      candidates = [];
    let cursorAdvance = 0;
    if (this.incremental) {
      const relevant = allCandidates
        .filter((item) => item.score > 0 && processed.get(item.url) !== `${item.url}|${item.lastModified}`)
        .sort((left, right) => right.score - left.score || right.id - left.id);
      for (const item of relevant) {
        if (candidates.length >= runBudget) break;
        candidates.push(item);
      }
      for (let offset = 0; offset < allCandidates.length && candidates.length < runBudget; offset++) {
        cursorAdvance = offset + 1;
        const item = allCandidates[(startCursor + offset) % allCandidates.length];
        const fingerprint = `${item.url}|${item.lastModified}`;
        if (processed.get(item.url) === fingerprint || candidates.some((candidate) => candidate.url === item.url)) continue;
        candidates.push(item);
      }
    } else {
      candidates.push(...allCandidates.filter((item) => item.score > 0).slice(0, runBudget));
    }
    const
      jobs = [];
    let failures = 0, scannedJobPages = 0;
    const processedItems = [];
    for (let offset = 0; offset < candidates.length && jobs.length < limit; offset += 3) {
      const batch = await Promise.allSettled(
        candidates.slice(offset, offset + 3).map(async ({ url, lastModified }) => {
          const page = await this.client.getText(url, { maxBytes: 1_000_000 });
          const job = structuredJobs(page.data)[0];
          return {
            job: job ? normalizeJobPosting({ provider: this.id, sourceClass: this.sourceClass, url, job, html: page.data }) : null,
            processed: { itemKey: url, fingerprint: `${url}|${lastModified}` },
          };
        }),
      );
      scannedJobPages += batch.length;
      for (const item of batch) {
        if (item.status === "rejected") failures++;
        else {
          processedItems.push(item.value.processed);
          if (item.value.job?.lifecycleStatus === "OPEN") jobs.push(item.value.job);
        }
      }
    }
    const processedAfter = new Map(processed);
    for (const item of processedItems) processedAfter.set(item.itemKey, item.fingerprint);
    const remainingUrls = this.incremental
      ? allCandidates.filter((item) => processedAfter.get(item.url) !== `${item.url}|${item.lastModified}`).length
      : Math.max(0, allCandidates.length - candidates.length);
    const nextCursor = allCandidates.length ? (startCursor + cursorAdvance) % allCandidates.length : 0;
    const nextCycle = Number(checkpoint?.cycle || 0) + (allCandidates.length > 0 && cursorAdvance > 0 && startCursor + cursorAdvance >= allCandidates.length ? 1 : 0);
    return {
      jobs: jobs.slice(0, target),
      diagnostic: providerDiagnostic(jobs.length ? "HEALTHY" : failures ? "DEGRADED" : "EMPTY", {
        scope: "PUBLIC_FEED",
        candidates: allCandidates.length,
        candidateUrls: allCandidates.length,
        processedUrls: processedItems.length,
        remainingUrls,
        pagesScanned: 1 + scannedJobPages,
        resultsLimit: target,
        checkpoint: this.incremental ? { cursor: nextCursor, cycle: nextCycle, scopeKey } : null,
        continuation: this.incremental ? {
          providerId: this.id,
          scopeKey,
          cursor: nextCursor,
          cycle: nextCycle,
          state: { candidateUrls: allCandidates.length, remainingUrls },
          processedItems,
        } : null,
        errorCount: failures,
        message: jobs.length
          ? `${jobs.length} vaga(s) pública(s) estruturada(s) encontrada(s).`
          : "Fonte respondeu, sem vagas estruturadas compatíveis neste budget.",
      }),
    };
  }
  async resolveJob(job) {
    return normalizeDiscoveryJob(job);
  }
  async resolveCanonicalIdentity(job) {
    return { provider: this.id, providerJobId: job.providerJobId };
  }
  commitContinuation(continuation) {
    return this.checkpointRepository?.commit(continuation) || null;
  }
}

export class IelProvider extends SitemapJobProvider {
  constructor({ client }) {
    super({
      id: "iel",
      client,
      sitemapUrl: "https://carreiras.iel.org.br/sitemap.xml",
      jobUrlPattern: /^https:\/\/carreiras\.iel\.org\.br\/[A-Z]{2}\/vaga\//i,
      sourceClass: "INTERNSHIP_PORTAL",
    });
  }
}

export class ProgramaThorProvider extends SitemapJobProvider {
  constructor({ client }) {
    super({
      id: "programathor",
      client,
      sitemapUrl: "https://programathor.com.br/sitemap.xml",
      jobUrlPattern: /^https:\/\/programathor\.com\.br\/jobs\/\d+-/i,
      sourceClass: "JOB_BOARD",
    });
  }
}

export class RecruteiProvider extends SitemapJobProvider {
  constructor({ client }) {
    super({
      id: "recrutei",
      client,
      sitemapUrl: "https://empregos.recrutei.com.br/sitemap-vagas-1.xml",
      jobUrlPattern: /^https:\/\/empregos\.recrutei\.com\.br\/vaga\//i,
      sourceClass: "JOB_BOARD",
      maxSitemapBytes: 1_000_000,
    });
  }
}

export class NerdinProvider extends SitemapJobProvider {
  constructor({ client, checkpointRepository = null, urlBudget = process.env.CAREER_NERDIN_URLS_PER_RUN }) {
    super({
      id: "nerdin",
      client,
      sitemapUrl: "https://www.nerdin.com.br/sitemap.xml",
      jobUrlPattern: /^https:\/\/(?:www\.)?nerdin\.com\.br\/vaga_emprego\/.+-\d+\.php$/i,
      sourceClass: "JOB_BOARD",
      checkpointRepository,
      incremental: true,
      urlBudget,
    });
  }
}

export class RemotarProvider {
  constructor({ client, checkpointRepository = null, pageBudget = process.env.CAREER_REMOTAR_PAGES_PER_RUN, pageDelayMs = process.env.CAREER_REMOTAR_PAGE_DELAY_MS }) {
    Object.assign(this, {
      id: "remotar",
      client,
      checkpointRepository,
      pageBudget: boundedInteger(pageBudget, 2, 1, 5),
      pageDelayMs: boundedInteger(pageDelayMs, 250, 0, 5_000),
      category: PROVIDER_CATEGORIES.BRAZIL,
      capabilities: [
        CAPABILITY.SEARCH,
        CAPABILITY.JOB_DETAILS,
        CAPABILITY.CANONICAL_ID,
        CAPABILITY.SALARY,
        CAPABILITY.REMOTE_FILTER,
        CAPABILITY.INCREMENTAL_SYNC,
      ],
    });
  }
  async health() {
    await this.client.getJson("https://api.remotar.com.br/jobs?page=1&active=true", {
      maxBytes: 1_500_000,
    });
    return providerDiagnostic("HEALTHY", {
      scope: "PUBLIC_API",
      message: "Catálogo público da Remotar respondeu sem credencial.",
    });
  }
  async search({ query = "", limit = 10 } = {}) {
    const target = Math.max(1, Math.min(50, Number(limit) || 10));
    const normalizedQuery = clean(query).slice(0, 120), scopeKey = `active:${fold(normalizedQuery) || "all"}`;
    const checkpoint = this.checkpointRepository?.get(this.id, scopeKey);
    const startPage = Math.max(1, Number(checkpoint?.cursor || 1));
    const seen = new Set(), jobs = [], processedItems = [];
    let page = startPage, pagesScanned = 0, recordsExamined = 0, totalAvailable = 0, lastPage = startPage;
    let errorCount = 0, errorCode = "", rateLimited = false;
    for (let offset = 0; offset < this.pageBudget; offset++) {
      if (offset > 0) await wait(this.pageDelayMs);
      const url = new URL("https://api.remotar.com.br/jobs");
      url.searchParams.set("page", String(page));
      url.searchParams.set("active", "true");
      if (normalizedQuery) url.searchParams.set("search", normalizedQuery);
      let payload;
      try {
        ({ data: payload } = await this.client.getJson(url, { maxBytes: 1_500_000 }));
      } catch (error) {
        if (pagesScanned === 0) throw error;
        errorCount++;
        errorCode = error.code || "PROVIDER_ERROR";
        rateLimited = errorCode === "RATE_LIMITED";
        break;
      }
      const raw = Array.isArray(payload?.data) ? payload.data : [];
      pagesScanned++;
      recordsExamined += raw.length;
      totalAvailable = Math.max(totalAvailable, Number(payload?.meta?.total || 0));
      lastPage = Math.max(1, Number(payload?.meta?.last_page || page));
      let newRecords = 0;
      for (const rawJob of raw) {
        const id = clean(rawJob?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        newRecords++;
        processedItems.push({ itemKey: id, fingerprint: `${id}|${clean(rawJob.updatedAt || rawJob.createdAt)}` });
        const job = this.normalize(rawJob);
        if (job.lifecycleStatus === "OPEN") jobs.push(job);
      }
      if (!raw.length || !newRecords || page >= lastPage) {
        page = 1;
        break;
      }
      page++;
    }
    const nextCycle = Number(checkpoint?.cycle || 0) + (page === 1 && pagesScanned > 0 ? 1 : 0);
    const status = errorCount ? "DEGRADED" : jobs.length ? "HEALTHY" : "EMPTY";
    return {
      jobs,
      diagnostic: providerDiagnostic(status, {
        scope: "PUBLIC_API",
        candidates: recordsExamined,
        recordsExamined,
        totalAvailable,
        pagesScanned,
        resultsLimit: target * this.pageBudget,
        hasContinuation: page !== 1,
        checkpoint: { page, cycle: nextCycle, startPage, lastPage, scopeKey },
        continuation: {
          providerId: this.id,
          scopeKey,
          cursor: page,
          cycle: nextCycle,
          state: { lastPage, totalAvailable, recordsExamined },
          processedItems,
        },
        errorCount,
        errorCode,
        rateLimited,
        rateLimits: rateLimited ? [{ code: errorCode }] : [],
        message: jobs.length
          ? `${jobs.length} vaga(s) remota(s) pública(s) encontrada(s) em ${pagesScanned} página(s).`
          : "Fonte respondeu, sem vagas compatíveis neste budget.",
      }),
    };
  }
  normalize(job = {}) {
    const id = clean(job.id),
      publicUrl = `https://remotar.com.br/job/${encodeURIComponent(id)}`,
      type = fold(job.type),
      remote = type === "remote" || /\bremot[oa]\b/.test(fold(`${job.title} ${job.subtitle}`)),
      tags = asArray(job.jobTags)
        .map((item) => clean(item?.tag?.name).replace(/^[^\p{L}\p{N}]+/u, ""))
        .filter(Boolean),
      requirements = asArray(job.jobRequirements).map((item) => ({
        description: htmlToText(item.description),
        mandatory: item.mandatory === true,
      })),
      description = [
        htmlToText(job.description),
        requirements.length
          ? `Requisitos: ${requirements.map((item) => item.description).join("; ")}`
          : "",
      ].filter(Boolean).join("\n"),
      seniority = tags.find((item) => /\b(est[aá]gio|j[uú]nior|pleno|s[eê]nior|especialista|lead)\b/i.test(item)) || "",
      employmentType = tags.find((item) => /\b(CLT|PJ|est[aá]gio|freelance|tempor[aá]rio)\b/i.test(item)) || "",
      expiresAt = clean(job.expiresAt),
      expired = job.active === false || job.expired === true || (expiresAt && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) < Date.now()),
      location = [clean(job.city), clean(job.state)].filter(Boolean).join(", ") || (remote ? "Remoto - Brasil" : "Brasil");
    return normalizeDiscoveryJob({
      provider: this.id,
      providerCategory: this.category,
      providerJobId: id,
      companyIdentity: clean(job.companyId || job.company?.id || fold(job.company?.name)),
      title: clean(job.title),
      company: clean(job.companyDisplayName || job.company?.name),
      description,
      location,
      city: clean(job.city),
      state: clean(job.state),
      country: clean(job.country?.code || job.country?.name || "BR"),
      remote,
      workModel: remote ? "REMOTE" : type === "hybrid" ? "HYBRID" : "ONSITE",
      employmentType,
      seniority,
      salary: job.jobSalary || null,
      postedAt: clean(job.createdAt),
      expiresAt,
      sourceUrl: publicUrl,
      canonicalUrl: publicUrl,
      applicationUrl: safeExternalUrl(job.externalLink, publicUrl),
      atsType: clean(job.integrationSource),
      lifecycleStatus: expired ? "CLOSED" : "OPEN",
      metadata: {
        sourceClass: "JOB_BOARD",
        opportunityType: opportunityType(`${job.title} ${employmentType}`),
        remoteScope: remote ? "BRASIL" : "UNKNOWN",
        discoveryMode: "PUBLIC_API",
        integrationSource: clean(job.integrationSource),
        subtitle: clean(job.subtitle),
        tags,
        requirements,
        categories: asArray(job.jobCategories).map((item) => clean(item?.category?.name)).filter(Boolean),
      },
      provenance: {
        title: this.id,
        company: this.id,
        description: this.id,
        location: this.id,
        applicationUrl: this.id,
      },
    });
  }
  async resolveJob(job) { return normalizeDiscoveryJob(job); }
  async resolveCanonicalIdentity(job) { return { provider: this.id, providerJobId: job.providerJobId }; }
  commitContinuation(continuation) {
    return this.checkpointRepository?.commit(continuation) || null;
  }
}

export class SolidesProvider {
  constructor({ client }) {
    Object.assign(this, {
      id: "solides",
      client,
      category: PROVIDER_CATEGORIES.BRAZIL,
      capabilities: [
        CAPABILITY.SEARCH,
        CAPABILITY.JOB_DETAILS,
        CAPABILITY.CANONICAL_ID,
        CAPABILITY.SALARY,
        CAPABILITY.REMOTE_FILTER,
      ],
    });
  }
  async health() {
    await this.client.getText("https://vagas.solides.com.br/robots.txt", {
      maxBytes: 200_000,
    });
    return providerDiagnostic("HEALTHY", {
      scope: "PUBLIC_API",
      message: "Portal público respondeu; nenhuma credencial foi usada.",
    });
  }
  async search({ query = "", location = "Brasil", limit = 10 } = {}) {
    const url = new URL("https://apigw.solides.com.br/jobs/v3/portal-vacancies-new");
    if (clean(query)) url.searchParams.set("title", clean(query).slice(0, 120));
    const { data: payload } = await this.client.getJson(url, {
        headers: { origin: "https://vagas.solides.com.br" },
      }),
      raw = Array.isArray(payload?.data?.data) ? payload.data.data : [],
      locationTerms = fold(location) === "brasil" ? [] : queryTerms(location),
      normalized = raw
        .filter((job) => {
          const terms = queryTerms(query);
          if (!terms.length) return true;
          const searchable = fold(
            `${job.title} ${asArray(job.occupationAreas).map(valueOf).join(" ")}`,
          );
          return terms.some((term) => searchable.includes(term));
        })
        .map((job) => this.normalize(job))
        .filter((job) => !locationTerms.length || locationTerms.some((term) => fold(job.location).includes(term)))
        .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)));
    return {
      jobs: normalized,
      diagnostic: providerDiagnostic(normalized.length ? "HEALTHY" : "EMPTY", {
        scope: "PUBLIC_API",
        candidates: raw.length,
        pagesScanned: 1,
        resultsLimit: Math.max(1, Math.min(50, Number(limit) || 10)),
        message: normalized.length
          ? `${normalized.length} vaga(s) pública(s) encontrada(s).`
          : "Fonte respondeu, sem vagas compatíveis neste budget.",
      }),
    };
  }
  normalize(job = {}) {
    const url = `https://vagas.solides.com.br/vaga/${encodeURIComponent(job.id)}/${encodeURIComponent(clean(job.slug || job.title).replace(/\s+/g, "-"))}`,
      remote = job.homeOffice === true || /\bremot[oa]\b/i.test(`${job.title} ${job.description}`),
      description = htmlToText(job.description),
      employmentType = clean(valueOf(job.recruitmentContractType) || valueOf(job.jobType)),
      applicationUrl = safeExternalUrl(job.redirectLink, url);
    return normalizeDiscoveryJob({
      provider: this.id,
      providerCategory: this.category,
      providerJobId: clean(job.id),
      companyIdentity: fold(job.companyName),
      title: clean(job.title),
      company: clean(job.companyName),
      description,
      location: [valueOf(job.city), valueOf(job.state)].filter(Boolean).join(", ") || (remote ? "Remoto" : ""),
      city: clean(valueOf(job.city)),
      state: clean(valueOf(job.state)),
      country: "BR",
      remote,
      workModel: remote ? "REMOTE" : "",
      employmentType,
      seniority: asArray(job.seniority).map(valueOf).filter(Boolean).join(", "),
      salary: job.salary || null,
      postedAt: clean(job.createdAt || job.date),
      sourceUrl: url,
      canonicalUrl: url,
      applicationUrl,
      lifecycleStatus: job.isDisabled ? "CLOSED" : "OPEN",
      metadata: {
        sourceClass: "JOB_BOARD",
        opportunityType: opportunityType(`${job.title} ${employmentType} ${description.slice(0, 500)}`),
        remoteScope: remote ? "UNKNOWN" : "",
        discoveryMode: "PUBLIC_API",
        occupationAreas: asArray(job.occupationAreas).map(valueOf).filter(Boolean),
        education: asArray(job.education).map(valueOf).filter(Boolean),
        skills: asArray(job.hardSkills).map(valueOf).filter(Boolean),
      },
      provenance: {
        title: this.id,
        company: this.id,
        description: this.id,
        location: this.id,
        applicationUrl: this.id,
      },
    });
  }
  async resolveJob(job) {
    return normalizeDiscoveryJob(job);
  }
  async resolveCanonicalIdentity(job) {
    return { provider: this.id, providerJobId: job.providerJobId };
  }
}

export const brazilianPublicProviderIds = Object.freeze([
  "iel",
  "programathor",
  "solides",
  "recrutei",
  "nerdin",
  "remotar",
]);

export const brazilianProviderDefinitions = Object.freeze([
  { providerId: "iel", displayName: "IEL", sourceClass: "INTERNSHIP_PORTAL", discoveryMode: "PUBLIC_FEED" },
  { providerId: "programathor", displayName: "ProgramaThor", sourceClass: "JOB_BOARD", discoveryMode: "PUBLIC_FEED" },
  { providerId: "solides", displayName: "Sólides", sourceClass: "JOB_BOARD", discoveryMode: "PUBLIC_API" },
  { providerId: "recrutei", displayName: "Recrutei", sourceClass: "JOB_BOARD", discoveryMode: "PUBLIC_FEED" },
  { providerId: "nerdin", displayName: "Nerdin", sourceClass: "JOB_BOARD", discoveryMode: "PUBLIC_FEED" },
  { providerId: "remotar", displayName: "Remotar", sourceClass: "JOB_BOARD", discoveryMode: "PUBLIC_API" },
]);

export const brazilianProviderInternals = Object.freeze({
  decodeEntities,
  escapeJsonControls,
  extractSitemapUrls,
  htmlToText,
  normalizeJobPosting,
  opportunityType,
  queryTerms,
  structuredJobs,
  urlScore,
});
