export const SOURCE_OPERATIONAL_STATES = Object.freeze([
  "OPERATIONAL_REAL",
  "DEGRADED",
  "SUCCESS_EMPTY",
  "BLOCKED",
  "NOT_CONFIGURED",
  "NOT_IMPLEMENTED",
  "MANUAL_ONLY",
  "DISABLED",
  "UNKNOWN",
]);

export const TECHNICAL_DISCOVERY_PROVIDERS = Object.freeze([
  "jobspy",
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "iel",
  "programathor",
  "solides",
  "recrutei",
  "nerdin",
  "remotar",
  "gupy",
  "infojobs",
  "vagas",
  "catho",
  "eureca",
  "geekhunter",
]);

const surface = (id, providerId, displayName, options = {}) => Object.freeze({
  id,
  provider_id: providerId,
  display_name: displayName,
  type: options.type || "JOB_BOARD",
  discovery_mode: options.discoveryMode || "NOT_IMPLEMENTED",
  status: options.status || "UNKNOWN",
  enabled: options.enabled !== false,
  supports_global_search: Boolean(options.globalSearch),
  requires_known_board: Boolean(options.knownBoard),
  requires_authentication: Boolean(options.authentication),
  supports_pagination: Boolean(options.pagination),
  configuration_state: options.configurationState || "NOT_REQUIRED",
  current_limit: Number(options.limit || 0),
  limit_origin: options.limitOrigin || "",
  continuation: options.continuation || "NONE",
});

const jobSpy = [
  ["linkedin", "LinkedIn Jobs"],
  ["indeed", "Indeed"],
  ["glassdoor", "Glassdoor"],
  ["google", "Google Jobs"],
].map(([id, name]) => surface(`jobspy:${id}`, "jobspy", name, {
  type: "AGGREGATOR_PORTAL",
  discoveryMode: "JOBSPY",
  globalSearch: true,
  pagination: true,
  limit: 50,
  limitOrigin: "DiscoveryPolicy and JobSpy request budget",
  continuation: "LIBRARY_MANAGED",
}));

const board = (id, name) => surface(id, id, name, {
  type: "ATS_BOARD",
  discoveryMode: "COMPANY_BOARD",
  knownBoard: true,
  pagination: id === "lever",
  configurationState: "TARGET_REQUIRED",
  limit: 50,
  limitOrigin: "Known board request",
  continuation: id === "lever" ? "LIMIT_PARAMETER" : "NONE",
});

export const SOURCE_SURFACES = Object.freeze([
  ...jobSpy,
  board("greenhouse", "Greenhouse"),
  board("lever", "Lever"),
  board("ashby", "Ashby"),
  board("smartrecruiters", "SmartRecruiters"),
  board("workable", "Workable"),
  surface("iel", "iel", "IEL", { type: "INTERNSHIP_PORTAL", discoveryMode: "PUBLIC_FEED", globalSearch: true, limit: 30, limitOrigin: "Sitemap candidate cap", continuation: "SITEMAP_SELECTION" }),
  surface("programathor", "programathor", "ProgramaThor", { discoveryMode: "PUBLIC_FEED", globalSearch: true, limit: 30, limitOrigin: "Sitemap candidate cap", continuation: "SITEMAP_SELECTION" }),
  surface("solides", "solides", "Sólides", { discoveryMode: "PUBLIC_API", globalSearch: true, limit: 50, limitOrigin: "Provider result cap", continuation: "NONE" }),
  surface("recrutei", "recrutei", "Recrutei", { discoveryMode: "PUBLIC_FEED", globalSearch: true, limit: 30, limitOrigin: "Sitemap candidate cap", continuation: "SITEMAP_SELECTION" }),
  surface("nerdin", "nerdin", "Nerdin", { discoveryMode: "PUBLIC_FEED", globalSearch: true, limit: 30, limitOrigin: "Sitemap candidate cap", continuation: "SITEMAP_SELECTION" }),
  surface("remotar", "remotar", "Remotar", { discoveryMode: "PUBLIC_API", globalSearch: true, pagination: true, limit: 50, limitOrigin: "Provider result cap", continuation: "PAGE_AVAILABLE_NOT_FOLLOWED" }),
  surface("gupy", "gupy", "Gupy", { type: "ATS_BOARD", discoveryMode: "COMPANY_BOARD", knownBoard: true, limit: 50, limitOrigin: "Public company career page", continuation: "NONE" }),
  surface("catho", "catho", "Catho", { type: "PARTNER_ONLY", status: "NOT_IMPLEMENTED", authentication: true, configurationState: "PARTNER_REQUIRED" }),
  surface("infojobs", "infojobs", "InfoJobs", { type: "PARTNER_ONLY", status: "NOT_IMPLEMENTED", authentication: true, configurationState: "PARTNER_REQUIRED" }),
  surface("vagas", "vagas", "Vagas.com.br", { type: "PARTNER_ONLY", status: "NOT_IMPLEMENTED", authentication: true, configurationState: "PARTNER_REQUIRED" }),
  surface("eureca", "eureca", "Eureca", { type: "MANUAL_PORTAL", discoveryMode: "MANUAL_ONLY", status: "MANUAL_ONLY" }),
  surface("geekhunter", "geekhunter", "GeekHunter", { type: "MANUAL_PORTAL", discoveryMode: "MANUAL_ONLY", status: "MANUAL_ONLY" }),
  surface("linkedin-posts", "linkedin-posts", "LinkedIn Posts", { type: "PUBLIC_SOCIAL_SIGNAL", discoveryMode: "MANUAL_ONLY", status: "MANUAL_ONLY", authentication: true }),
  surface("ciee", "ciee", "CIEE", { type: "INTERNSHIP_PORTAL", status: "NOT_IMPLEMENTED" }),
  surface("nube", "nube", "Nube", { type: "INTERNSHIP_PORTAL", status: "NOT_IMPLEMENTED" }),
  surface("cide", "cide", "CIDE", { type: "INTERNSHIP_PORTAL", status: "NOT_IMPLEMENTED" }),
  surface("brave-public-web", "brave-public-web", "Public Web / Brave", { type: "PUBLIC_WEB", discoveryMode: "OPTIONAL_API", enabled: false, globalSearch: true, authentication: true, pagination: true, configurationState: "OPTIONAL_NOT_CONFIGURED", limit: 20, limitOrigin: "Public web policy", continuation: "API_PAGINATION_NOT_USED" }),
  surface("workday", "workday", "Workday", { type: "ATS_DETECTION", discoveryMode: "INDIRECT_DISCOVERY", status: "NOT_IMPLEMENTED", knownBoard: true }),
  surface("generic-career-page", "generic", "Páginas de carreira", { type: "MANUAL_PORTAL", discoveryMode: "MANUAL_ONLY", status: "MANUAL_ONLY" }),
  surface("github", "github", "GitHub Evidence", { type: "EVIDENCE", discoveryMode: "EVIDENCE_SYNC", status: "NOT_CONFIGURED", authentication: true, configurationState: "CREDENTIAL_REQUIRED" }),
  surface("whatsapp", "whatsapp", "WhatsApp Groups", { type: "COMMUNITY", discoveryMode: "EVENT_DRIVEN", status: "NOT_CONFIGURED", authentication: true, configurationState: "PAIRING_REQUIRED" }),
]);

const byId = new Map(SOURCE_SURFACES.map((item) => [item.id, item]));
const blockedPattern = /AUTH|CAPTCHA|CHALLENGE|FORBIDDEN|ROBOTS|RATE_LIMIT|HTTP_?403|BLOCK/i;
const failureStates = new Set(["FAILED", "ERROR", "OFFLINE", "TIMED_OUT", "RATE_LIMITED", "BLOCKED"]);

export function sourceSurface(id) {
  return byId.get(String(id || "")) || null;
}

export function sourceSurfacesForProvider(providerId) {
  return SOURCE_SURFACES.filter((item) => item.provider_id === providerId);
}

export function operationalStatusFromObservation(observation = {}, { now = Date.now(), recentDays = 7 } = {}) {
  if (observation.attempted === false || observation.realQuery === false) return "UNKNOWN";
  const rawStatus = String(observation.status || observation.healthStatus || "").toUpperCase();
  const errorCode = String(observation.lastErrorCode || observation.errorCode || "");
  if (["BLOCKED", "DEGRADED", "SUCCESS_EMPTY"].includes(rawStatus)) return rawStatus;
  if (rawStatus === "OPERATIONAL_REAL") {
    const realAt = observation.lastRealQueryAt || observation.finishedAt || observation.checkedAt || "";
    return realAt && now - Date.parse(realAt) > recentDays * 86400000 ? "DEGRADED" : "OPERATIONAL_REAL";
  }
  if (blockedPattern.test(`${rawStatus} ${errorCode}`) || rawStatus === "RATE_LIMITED") return "BLOCKED";
  if (failureStates.has(rawStatus) || errorCode) return "DEGRADED";
  const realAt = observation.lastRealQueryAt || observation.finishedAt || observation.checkedAt || "";
  const stale = realAt && now - Date.parse(realAt) > recentDays * 86400000;
  if (stale) return "DEGRADED";
  if (Number(observation.lastValidCount ?? observation.validCount ?? observation.acceptedResults ?? 0) > 0) return "OPERATIONAL_REAL";
  return "SUCCESS_EMPTY";
}

export function projectSourceSurface(definition, context = {}) {
  const enabled = context.enabled ?? definition.enabled;
  const configured = context.configured ?? !["TARGET_REQUIRED", "CREDENTIAL_REQUIRED", "PAIRING_REQUIRED", "OPTIONAL_NOT_CONFIGURED"].includes(definition.configuration_state);
  let configurationState = definition.configuration_state;
  if (definition.requires_known_board) configurationState = Number(context.targetCount || 0) > 0 ? "CONFIGURED" : "TARGET_REQUIRED";
  else if (definition.requires_authentication && context.configured === true) configurationState = "CONFIGURED";
  if (!enabled) return { ...definition, enabled: false, configuration_state: configurationState, status: "DISABLED", observation: context.observation || null };
  if (definition.discovery_mode === "MANUAL_ONLY") return { ...definition, enabled, configuration_state: configurationState, status: "MANUAL_ONLY", observation: context.observation || null };
  if (definition.status === "NOT_IMPLEMENTED") return { ...definition, enabled, configuration_state: configurationState, status: "NOT_IMPLEMENTED", observation: context.observation || null };
  if ((!configured && definition.requires_authentication) || (definition.requires_known_board && Number(context.targetCount || 0) === 0)) {
    return { ...definition, enabled, configuration_state: configurationState, status: "NOT_CONFIGURED", observation: context.observation || null };
  }
  const observation = context.observation || null;
  return { ...definition, enabled, configuration_state: configurationState, status: observation ? operationalStatusFromObservation(observation) : definition.status, observation };
}
