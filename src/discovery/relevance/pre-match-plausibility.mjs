import { jobFamilyCatalog } from "../search-intent/job-family-catalog.mjs";

const officialProviders = new Set([
    "ashby",
    "greenhouse",
    "lever",
    "smartrecruiters",
    "workable",
    "career-page",
  ]),
  negativeOccupationalDomains = Object.freeze({
    HEALTHCARE: [
      "veterinaria",
      "veterinario",
      "enfermagem",
      "odontologia",
      "farmacia",
      "fisioterapia",
      "hospital veterinario",
    ],
    LABORATORY: [
      "tecnico de laboratorio",
      "laboratory technician",
      "coleta de amostras",
      "analises clinicas",
    ],
    BUSINESS: [
      "economia",
      "economics",
      "contabilidade",
      "accounting",
      "recursos humanos",
      "human resources",
      "direito",
      "juridico",
      "analista comercial",
      "sales development",
      "sdr",
      "vendas",
      "marketing",
      "commercial",
      "business development",
      "client success",
      "account director",
    ],
  }),
  sourceClass = (job) =>
    String(
      job.sourceClass ||
        (officialProviders.has(String(job.provider || "").toLowerCase())
          ? "STRUCTURED_ATS"
          : "JOB_BOARD"),
    ).toUpperCase();

export const PRE_MATCH_DECISIONS = Object.freeze([
  "PASS",
  "PASS_WITH_WARNINGS",
  "REVIEW",
  "REJECT",
]);

export const PRE_MATCH_REASONS = Object.freeze([
  "JOB_CLOSED",
  "ROLE_FAMILY_MISMATCH",
  "LOCATION_MISMATCH",
  "LOCAL_DF_MATCH",
  "LOCAL_REGION_MATCH",
  "REMOTE_BRAZIL_MATCH",
  "REMOTE_COUNTRY_MATCH",
  "FOREIGN_LOCATION",
  "OUTSIDE_ACCEPTED_REGION",
  "WORK_MODEL_UNKNOWN",
  "WORK_MODEL_MISMATCH",
  "LOCATION_UNKNOWN",
  "LOCATION_CONFLICT",
  "SENIORITY_MISMATCH",
  "STALE",
  "NON_JOB_CONTENT",
  "INSUFFICIENT_INFORMATION",
  "UNKNOWN_REMOTE_SCOPE",
  "UNKNOWN_SENIORITY",
  "UNKNOWN_FRESHNESS",
  "LATAM_REMOTE_SCOPE",
  "TALENT_POOL",
  "COOP",
  "AMBIGUOUS_JOB_FAMILY",
]);

export function foldRelevanceText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const foldedPhraseCache = new Map();

function contains(text, phrase) {
  const cacheKey = String(phrase || "");
  let normalized = foldedPhraseCache.get(cacheKey);
  if (normalized === undefined) {
    normalized = foldRelevanceText(cacheKey);
    if (foldedPhraseCache.size >= 2_048) foldedPhraseCache.clear();
    foldedPhraseCache.set(cacheKey, normalized);
  }
  if (!normalized) return false;
  return ` ${text} `.includes(` ${normalized} `) || text.includes(normalized);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function classifyJobFamily(job = {}, intent = {}) {
  const title = foldRelevanceText(job.title),
    description = foldRelevanceText(job.description).slice(0, 12_000),
    combined = `${title} ${description}`,
    scores = [];
  for (const family of jobFamilyCatalog.list()) {
    let score = 0,
      titleScore = 0;
    const evidence = [];
    for (const alias of family.aliases || []) {
      if (contains(title, alias)) {
        score += 6;
        titleScore += 6;
        evidence.push(`TITLE:${alias}`);
      }
    }
    for (const alias of family.ambiguousAliases || []) {
      if (contains(title, alias)) {
        score += 3;
        titleScore += 3;
        evidence.push(`AMBIGUOUS_TITLE:${alias}`);
      }
    }
    for (const signal of family.roleSignals || []) {
      if (contains(title, signal)) {
        score += 4;
        titleScore += 4;
        evidence.push(`TITLE:${signal}`);
      } else if (contains(description, signal)) {
        score += 1.5;
        evidence.push(`DESCRIPTION:${signal}`);
      }
    }
    for (const signal of family.contextSignals || []) {
      if (contains(title, signal)) {
        score += 2;
        titleScore += 2;
        evidence.push(`TITLE_CONTEXT:${signal}`);
      } else if (contains(description, signal)) {
        score += 1.5;
        evidence.push(`DESCRIPTION_CONTEXT:${signal}`);
      }
    }
    scores.push({
      familyId: family.id,
      score,
      titleScore,
      evidence: unique(evidence).slice(0, 8),
    });
  }

  const automationTitle = /\b(automacao|automation)\b/.test(title),
    softwareAutomationEvidence = [
      "python",
      "api",
      "git",
      "integracoes de sistemas",
      "software",
      "javascript",
    ].filter((term) => contains(description, term));
  if (automationTitle && softwareAutomationEvidence.length >= 2) {
    const backend = scores.find((item) => item.familyId === "BACKEND");
    backend.score += 5;
    backend.titleScore += 2;
    backend.evidence.push(
      ...softwareAutomationEvidence.slice(0, 4).map((item) => `CONTEXT:${item}`),
    );
  }

  scores.sort((a, b) => b.score - a.score || a.familyId.localeCompare(b.familyId));
  const primary = scores[0]?.score >= 4 ? scores[0] : null,
    secondary = scores.filter(
      (item, index) => index > 0 && item.score >= 3 && item.score >= scores[0].score * 0.45,
    ),
    negativeEvidence = Object.entries(negativeOccupationalDomains).flatMap(
      ([domain, terms]) =>
        terms
          .filter((term) => contains(combined, term))
          .map((term) => ({ domain, term, inTitle: contains(title, term) })),
    ),
    titleNegative = negativeEvidence.some((item) => item.inTitle),
    requested = new Set((intent.families || []).map(String));
  let mismatch = false,
    insufficient = false;
  if (!primary) {
    mismatch = titleNegative;
    insufficient = !mismatch;
  } else if (
    requested.size &&
    !requested.has(primary.familyId) &&
    !secondary.some((item) => requested.has(item.familyId))
  ) mismatch = true;
  else if (titleNegative && primary.titleScore < 4) mismatch = true;
  return {
    primaryJobFamily: primary?.familyId || "UNKNOWN",
    secondaryJobFamilies: secondary.map((item) => item.familyId),
    familyConfidence: primary ? Math.min(1, primary.score / 10) : 0,
    familyEvidence: primary?.evidence || [],
    negativeOccupationalEvidence: negativeEvidence.slice(0, 6),
    mismatch,
    insufficient,
    ambiguous:
      Boolean(primary) &&
      Boolean(scores[1]) &&
      scores[1].score >= primary.score * 0.75 &&
      scores[1].familyId !== primary.familyId,
  };
}

export function classifySeniority(job = {}) {
  const title = foldRelevanceText(job.title),
    explicit = foldRelevanceText(job.seniority),
    text = `${title} ${explicit}`,
    description = foldRelevanceText(job.description).slice(0, 2_000),
    advertisedSeniorRole = /\b(?:job title|seeking|looking for|hiring|position|role|vaga|busca|procuramos|contratando)\b[^.\n]{0,100}\b(?:senior|sr|staff|principal|lead|manager|head|director|gerente|coordenador)\s+(?:site reliability engineer|sre|devops engineer|platform engineer|cloud engineer|infrastructure engineer|backend engineer|backend developer|software engineer|analista|engenheiro|desenvolvedor)\b/.test(description);
  if (/\b(senior|sr|staff|principal|lead|manager|head|director|gerente|coordenador)\b/.test(text))
    return { seniority: "SENIOR", confidence: 0.95, evidence: "SENIOR_TERM" };
  if (advertisedSeniorRole)
    return { seniority: "SENIOR", confidence: 0.9, evidence: "DESCRIPTION_SENIOR_ROLE" };
  if (/\b(pleno|mid level|mid-level|midlevel)\b/.test(text))
    return { seniority: "MID", confidence: 0.92, evidence: "MID_TERM" };
  if (/\b(estagio|estagiario|intern|internship|trainee|co-op|coop)\b/.test(text))
    return { seniority: "INTERNSHIP", confidence: 0.95, evidence: "EARLY_CAREER_TERM" };
  if (/\b(junior|jr|entry level|entry-level)\b/.test(text))
    return { seniority: "JUNIOR", confidence: 0.95, evidence: "JUNIOR_TERM" };
  return { seniority: "UNKNOWN", confidence: 0, evidence: "" };
}

export function classifyOpportunityType(job = {}) {
  const title = foldRelevanceText(job.title),
    text = `${title} ${foldRelevanceText(job.description).slice(0, 4_000)} ${foldRelevanceText(job.jobType || job.employmentType)}`;
  if (/\b(workshop|curso|course|bootcamp|evento|event|webinar|hackathon)\b/.test(title))
    return { opportunityType: "EVENT", confidence: 0.98 };
  if (/\b(banco de talentos|talent pool|talent community)\b/.test(text))
    return { opportunityType: "TALENT_POOL", confidence: 0.98 };
  if (/\b(co-op|coop|cooperative education)\b/.test(text))
    return { opportunityType: "COOP", confidence: 0.96 };
  if (/\b(jovem aprendiz|apprentice|apprenticeship)\b/.test(text))
    return { opportunityType: "APPRENTICESHIP", confidence: 0.95 };
  if (/\b(trainee)\b/.test(text))
    return { opportunityType: "TRAINEE", confidence: 0.95 };
  if (/\b(edital|public notice)\b/.test(text)) {
    if (/\b(bolsa academica|scholarship|bolsista)\b/.test(text))
      return { opportunityType: "SCHOLARSHIP", confidence: 0.95 };
    return { opportunityType: "PUBLIC_NOTICE", confidence: 0.9 };
  }
  if (/\b(freelance|freelancer)\b/.test(text))
    return { opportunityType: "FREELANCE", confidence: 0.9 };
  if (/\b(contract|contrato temporario|pj)\b/.test(text))
    return { opportunityType: "CONTRACT", confidence: 0.8 };
  if (/\b(estagio|estagiario|intern|internship)\b/.test(text))
    return { opportunityType: "INTERNSHIP", confidence: 0.9 };
  if (job.lifecycleStatus === "OPEN" || /\b(vaga|job|role|position)\b/.test(text))
    return { opportunityType: "JOB", confidence: job.lifecycleStatus === "OPEN" ? 0.85 : 0.65 };
  return { opportunityType: "UNKNOWN", confidence: 0 };
}

function countryCode(value = "", job = {}) {
  const text = foldRelevanceText(value);
  if (/\b(brasil|brazil|br)\b/.test(text)) return "BR";
  if (/\b(acre|alagoas|amapa|amazonas|bahia|ceara|espirito santo|goias|maranhao|mato grosso|minas gerais|paraiba|parana|pernambuco|piaui|rio de janeiro|rio grande do norte|rio grande do sul|rondonia|roraima|santa catarina|sao paulo|sergipe|tocantins|brasilia|florianopolis|curitiba|porto alegre|recife|salvador|fortaleza|manaus|belem|goiania|cuiaba|campo grande|vitoria|maceio|aracaju|natal|joao pessoa|teresina|palmas|porto velho|boa vista|rio branco|macapa|belo horizonte|sao luis)\b/.test(text)) return "BR";
  if (/\b(portugal|portuguesa?)\b/.test(text)) return "PT";
  if (/\b(lisboa|lisbon|porto|braga|coimbra|aveiro|faro|setubal|leiria|viseu|guimaraes)\b/.test(text)) return "PT";
  if (/\b(spain|espanha|madrid|barcelona|valencia|seville|sevilla)\b/.test(text)) return "ES";
  if (/\b(france|franca|paris|lyon|marseille)\b/.test(text)) return "FR";
  if (/\b(germany|alemanha|berlin|munich|munique|hamburg)\b/.test(text)) return "DE";
  if (/\b(italy|italia|rome|roma|milan|milao)\b/.test(text)) return "IT";
  if (/\b(united kingdom|uk|england|scotland|wales|london|londres)\b/.test(text)) return "GB";
  if (/\b(ireland|irlanda|dublin)\b/.test(text)) return "IE";
  if (/\b(netherlands|holanda|amsterdam|rotterdam)\b/.test(text)) return "NL";
  if (/\b(belgium|belgica|brussels|bruxelas)\b/.test(text)) return "BE";
  if (/\b(colombia|colômbia)\b/.test(text)) return "CO";
  if (/\b(argentina)\b/.test(text)) return "AR";
  if (/\b(chile)\b/.test(text)) return "CL";
  if (/\b(mexico|méxico)\b/.test(text)) return "MX";
  if (/\b(peru)\b/.test(text)) return "PE";
  if (/\b(uruguay|uruguai)\b/.test(text)) return "UY";
  if (/\b(costa rica)\b/.test(text)) return "CR";
  if (/\b(united states|usa|u.s.|us only|estados unidos)\b/.test(text)||/(?:^|[,/ ])us(?:$|[,/ ])/i.test(String(value))) return "US";
  if (/\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|washington dc)\b/.test(text)) return "US";
  if (String(job.provider || job.discoveredVia || job.source || "").toLowerCase() === "jobspy" && /,\s*(al|ma|pa|sc)\s*$/i.test(String(value))) return "US";
  if (/\b(canada|ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick)\b/.test(text)||/(?:^|[,/ ])ca(?:$|[,/ ])/i.test(String(value))) return "CA";
  if (/(?:^|[,/ ])(ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|mi|mn|mo|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|ri|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)(?:$|[,/ ])/i.test(String(value))) return "US";
  return "UNKNOWN";
}

function workModel(job = {}) {
  const value = foldRelevanceText(
    `${job.workModel || ""} ${job.remote ? "remote" : ""}`,
  ),
    description = foldRelevanceText(job.description || "").slice(0, 8_000),
    requiresHubAccess =
      /\b(?:must|required to|need to)\b[^.]{0,80}\b(?:within commuting distance|commute (?:to|into)|based near)\b/.test(description) ||
      /\bwithin commuting distance\b[^.]{0,80}\b(?:office|hub)\b/.test(description) ||
      /\b(?:deve|precisa)\b[^.]{0,80}\b(?:residir|morar|estar)\b[^.]{0,80}\b(?:proximo|perto|regiao metropolitana)\b/.test(description) ||
      /\b(?:distancia|raio) de deslocamento\b[^.]{0,80}\b(?:escritorio|hub)\b/.test(description);
  if (/\b(remote|remoto|home office|telecommute)\b/.test(value))
    return requiresHubAccess ? "HYBRID" : "REMOTE";
  if (/\b(hybrid|hibrido)\b/.test(value)) return "HYBRID";
  if (/\b(onsite|on site|presencial)\b/.test(value)) return "ONSITE";
  return "UNKNOWN";
}

function remoteScope(job = {}) {
  const locationText=foldRelevanceText(`${job.location || ""} ${job.country || ""}`),
    description=foldRelevanceText(job.description||"").slice(0,8_000),
    text=`${locationText} ${description}`;
  if (/\b(worldwide|anywhere|global remote)\b/.test(locationText)||/\b(remote (?:worldwide|anywhere)|work from anywhere|open to candidates worldwide)\b/.test(description))
    return { kind: "WORLDWIDE", value: "WORLDWIDE" };
  if (/\b(latam|latin america|america latina)\b/.test(locationText)||/\b(remote[^.]{0,40}(?:latam|latin america)|candidates[^.]{0,60}(?:latam|latin america))\b/.test(description))
    return { kind: "LATAM", value: "LATAM" };
  if (/\b(americas)\b/.test(locationText)||/\bremote[^.]{0,40}americas\b/.test(description)) return { kind: "AMERICAS", value: "AMERICAS" };
  if (/\b(emea)\b/.test(locationText)||/\bremote[^.]{0,40}emea\b/.test(description)) return { kind: "EMEA", value: "EMEA" };
  if (/\b(europe|europa|european union|uniao europeia|eu only)\b/.test(locationText)||/\bremote[^.]{0,40}(?:europe|europa|european union|uniao europeia|eu only)\b/.test(description)) return { kind: "EUROPE", value: "EUROPE" };
  const country = countryCode(`${job.country || ""} ${job.location || ""}`, job);
  if (country !== "UNKNOWN") return { kind: "COUNTRY", value: country };
  return { kind: "UNKNOWN", value: "UNKNOWN" };
}

function samePlace(jobText, targetText) {
  const job = foldRelevanceText(jobText),
    target = foldRelevanceText(targetText);
  if (/\b(brasilia|distrito federal)\b/.test(target) || /\bdf\b/.test(target))
    return /\b(brasilia|distrito federal)\b/.test(job) || /(?:^|[,/ ])df(?:$|[,/ ])/i.test(job);
  const portugueseCities = ["lisboa", "lisbon", "porto", "braga", "coimbra", "aveiro", "faro", "setubal", "leiria", "viseu", "guimaraes"],
    targetCity = portugueseCities.find((city) => new RegExp(`\\b${city}\\b`).test(target));
  if (targetCity) return new RegExp(`\\b${targetCity}\\b`).test(job) || (targetCity === "lisboa" && /\blisbon\b/.test(job)) || (targetCity === "lisbon" && /\blisboa\b/.test(job));
  const targetCountry = countryCode(target);
  if (targetCountry !== "UNKNOWN") return countryCode(job) === targetCountry;
  return Boolean(target) && job.includes(target);
}

export function classifyGeography(job = {}, policy = {}) {
  const model = workModel(job),
    rawLocation = `${job.location || ""} ${job.city || ""} ${job.state || ""} ${job.country || ""}`.trim(),
    foldedLocation = foldRelevanceText(rawLocation),
    country = countryCode(rawLocation, job),
    localDf = /\b(brasilia|distrito federal)\b/.test(foldedLocation) || /(?:^|[,/ ])df(?:$|[,/ ])/i.test(rawLocation),
    normalizedCountry = country === "BR" || localDf ? "BR" : country,
    normalizedRegion = localDf ? "DF" : String(job.state || "").trim().toUpperCase(),
    normalizedCity = /\bbrasilia\b/.test(foldedLocation) ? "Brasília" : String(job.city || "").trim(),
    priorities = (policy.priorities || [])
      .filter((item) => item.accepted !== false)
      .sort((a, b) => Number(a.priority) - Number(b.priority));
  const targetCountries = unique(priorities.map((item) => countryCode(`${item.remoteScope || ""} ${item.location || ""}`)).filter((value) => value !== "UNKNOWN")),
    targetSurfaces = priorities.map((item) => item.workModel === "REMOTE" ? `REMOTE_${countryCode(item.remoteScope || item.location)}` : samePlace("Brasilia, DF", item.location) ? "LOCAL_DF" : `LOCAL_${countryCode(item.location)}`),
    targetSurface = unique(targetSurfaces).join("+") || "UNRESTRICTED",
    localTargets = priorities.filter((item) => item.workModel !== "REMOTE"),
    remoteTargets = priorities.filter((item) => item.workModel === "REMOTE"),
    explicitForeign = normalizedCountry !== "UNKNOWN" && targetCountries.length > 0 && !targetCountries.includes(normalizedCountry),
    localMatch = localTargets.some((item) => samePlace(rawLocation, item.location)),
    broadCountry = normalizedCountry !== "UNKNOWN" && !String(job.city || job.state || "").trim() && countryCode(rawLocation) === normalizedCountry,
    scope = model === "REMOTE" ? remoteScope(job) : { kind: "UNKNOWN", value: "UNKNOWN" },
    remoteMatch = remoteTargets.some((item) => {const targetCountry=countryCode(item.remoteScope || item.location),regional=targetCountry==="BR"?["LATAM","AMERICAS"]:targetCountry==="PT"?["EUROPE","EMEA"]:[];return (targetCountry!=="UNKNOWN"&&normalizedCountry===targetCountry&&(model==="REMOTE"||model==="UNKNOWN"&&broadCountry))||model==="REMOTE"&&["WORLDWIDE",...regional].includes(scope.kind);}),
    geographyStatus = !priorities.length ? "MATCH" : explicitForeign ? "MISMATCH" : localMatch || remoteMatch ? "MATCH" : !rawLocation || normalizedCountry === "UNKNOWN" ? "UNKNOWN" : "MISMATCH",
    geographyReason = explicitForeign ? "FOREIGN_LOCATION" : geographyStatus === "MATCH" ? localMatch ? localDf ? "LOCAL_DF_MATCH" : "LOCAL_REGION_MATCH" : normalizedCountry === "BR" ? "REMOTE_BRAZIL_MATCH" : "REMOTE_COUNTRY_MATCH" : geographyStatus === "UNKNOWN" ? "LOCATION_UNKNOWN" : "OUTSIDE_ACCEPTED_REGION",
    locationConflict = Boolean(job.country && countryCode(job.country) !== "UNKNOWN" && localMatch && targetCountries.length && !targetCountries.includes(countryCode(job.country)));
  const resolvedGeographyStatus = locationConflict ? "MISMATCH" : geographyStatus,
    resolvedGeographyReason = locationConflict ? "LOCATION_CONFLICT" : geographyReason;
  let workModelStatus = "UNKNOWN", workModelReason = "WORK_MODEL_UNKNOWN";
  if (model !== "UNKNOWN") {
    const matchingModels = priorities.filter((item) => item.workModel === model);
    workModelStatus = !priorities.length || matchingModels.length ? "MATCH" : "MISMATCH";
    workModelReason = workModelStatus === "MATCH" ? "" : "WORK_MODEL_MISMATCH";
    if (model === "REMOTE" && scope.kind === "COUNTRY" && remoteTargets.length && !remoteTargets.some((item) => countryCode(item.remoteScope || item.location) === scope.value)) {
      workModelStatus = "MISMATCH";
      workModelReason = "WORK_MODEL_MISMATCH";
    }
  }
  const geographicMatch = {status:resolvedGeographyStatus,normalizedCountry,normalizedRegion,normalizedCity,targetSurface,reasonCodes:[resolvedGeographyReason]},
    workModelMatch = {status:workModelStatus,inferredWorkModel:model,evidence:model === "UNKNOWN" ? [] : [String(job.workModel || (job.remote ? "remote=true" : ""))].filter(Boolean),reasonCodes:[workModelReason].filter(Boolean)},
    accepted = resolvedGeographyStatus !== "MISMATCH" && workModelStatus !== "MISMATCH",
    reviewRequired = resolvedGeographyStatus === "UNKNOWN" || workModelStatus === "UNKNOWN";
  return {
    geographicMatch,
    workModelMatch,
    accepted: accepted || (model === "ONSITE" && policy.allowOnsiteOutsideArea === true && !explicitForeign),
    reviewRequired,
    workModel: model,
    remoteScope: scope,
    warning: workModelStatus === "UNKNOWN" ? "WORK_MODEL_UNKNOWN" : resolvedGeographyStatus === "UNKNOWN" ? "LOCATION_UNKNOWN" : scope.kind === "UNKNOWN" && model === "REMOTE" ? "UNKNOWN_REMOTE_SCOPE" : "",
  };
}

export function classifyFreshness(job = {}, now = new Date()) {
  const lifecycle = String(job.lifecycleStatus || "UNKNOWN").toUpperCase(),
    source = sourceClass(job),
    officialOpen = source === "STRUCTURED_ATS" && lifecycle === "OPEN",
    text = foldRelevanceText(`${job.title || ""} ${job.description || ""}`).slice(0, 5_000),
    explicitYears = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1])),
    oldExplicitYear = explicitYears.find((year) => year <= now.getUTCFullYear() - 2),
    rawDate = job.datePosted || job.postedAt || job.publishedAt || "",
    parsed = rawDate ? new Date(rawDate) : null,
    validDate = parsed && !Number.isNaN(parsed.getTime()),
    ageDays = validDate ? Math.floor((now.getTime() - parsed.getTime()) / 86_400_000) : null;
  if (lifecycle === "CLOSED")
    return { lifecycle: "CLOSED", confidence: 1, ageDays, stale: false };
  if (oldExplicitYear || (ageDays !== null && ageDays > (officialOpen ? 730 : 365)))
    return { lifecycle: "STALE", confidence: 0.98, ageDays, stale: true };
  if (officialOpen)
    return { lifecycle: "OPEN", confidence: 0.98, ageDays, stale: false };
  if (lifecycle === "OPEN" && ageDays !== null && ageDays <= 180)
    return { lifecycle: "OPEN", confidence: 0.85, ageDays, stale: false };
  if (ageDays !== null && ageDays <= 90)
    return { lifecycle: "OPEN", confidence: 0.75, ageDays, stale: false };
  return { lifecycle: lifecycle === "OPEN" ? "OPEN" : "UNKNOWN", confidence: lifecycle === "OPEN" ? 0.55 : 0.2, ageDays, stale: false };
}

export class PreMatchPlausibility {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
  }

  evaluate(job = {}, intent = {}) {
    const family = classifyJobFamily(job, intent),
      geography = classifyGeography(job, intent.locationPolicy || {}),
      seniority = classifySeniority(job),
      opportunity = classifyOpportunityType(job),
      freshness = classifyFreshness(job, this.now()),
      requestedSeniorities = new Set(intent.seniorities || []),
      reasons = [];
    let decision = "PASS",
      score = 100;
    const reject = (reason, penalty = 100) => {
        if (decision !== "REJECT") decision = "REJECT";
        reasons.push(reason);
        score -= penalty;
      },
      warn = (reason, penalty = 10, review = false) => {
        if (decision !== "REJECT")
          decision = review ? "REVIEW" : decision === "PASS" ? "PASS_WITH_WARNINGS" : decision;
        reasons.push(reason);
        score -= penalty;
      };

    if (freshness.lifecycle === "CLOSED") reject("JOB_CLOSED");
    else if (freshness.stale) reject("STALE");
    if (["EVENT", "COURSE", "SCHOLARSHIP"].includes(opportunity.opportunityType))
      reject("NON_JOB_CONTENT");
    if (!geography.accepted) reject(geography.geographicMatch?.reasonCodes?.[0] || geography.workModelMatch?.reasonCodes?.[0] || "OUTSIDE_ACCEPTED_REGION");
    if (
      seniority.seniority === "SENIOR" &&
      requestedSeniorities.size &&
      !requestedSeniorities.has(seniority.seniority)
    ) reject("SENIORITY_MISMATCH");
    else if (
      seniority.seniority === "MID" &&
      requestedSeniorities.size &&
      !requestedSeniorities.has(seniority.seniority)
    ) warn("SENIORITY_MISMATCH", 25, true);
    if (family.mismatch) reject("ROLE_FAMILY_MISMATCH");

    if (decision !== "REJECT") {
      if (family.insufficient) warn("INSUFFICIENT_INFORMATION", 30, true);
      if (seniority.seniority === "UNKNOWN") warn("UNKNOWN_SENIORITY", 8);
      if (geography.warning) warn(geography.warning, geography.warning === "UNKNOWN_REMOTE_SCOPE" ? 12 : 5);
      if (freshness.confidence < 0.5) warn("UNKNOWN_FRESHNESS", 8);
      if (opportunity.opportunityType === "TALENT_POOL") warn("TALENT_POOL", 15, true);
      if (opportunity.opportunityType === "COOP") warn("COOP", 5);
    }

    return {
      decision,
      reasons: unique(reasons),
      score: Math.max(0, Math.min(100, score)),
      primaryJobFamily: family.primaryJobFamily,
      secondaryJobFamilies: family.secondaryJobFamilies,
      familyConfidence: family.familyConfidence,
      familyEvidence: family.familyEvidence,
      negativeOccupationalEvidence: family.negativeOccupationalEvidence,
      jobLocation: {
        raw: String(job.location || ""),
        country: countryCode(`${job.country || ""} ${job.location || ""}`),
      },
      geographicMatch: geography.geographicMatch,
      workModelMatch: geography.workModelMatch,
      geographyAccepted: geography.accepted,
      geographyReviewRequired: geography.reviewRequired,
      workModel: geography.workModel,
      remoteScope: geography.remoteScope,
      seniority: seniority.seniority,
      seniorityConfidence: seniority.confidence,
      opportunityType: opportunity.opportunityType,
      freshness,
      sourceClass: sourceClass(job),
      algorithmVersion: "pre-match-plausibility-r2-v2",
    };
  }
}
