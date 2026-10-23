import { applicationRoutingThresholds } from "../application/application-routing-policy.mjs";

const list = (value, max = 20) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ].slice(0, max);
const time = (value) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""))
    ? String(value)
    : "09:00";
const threshold = (value) => Math.max(0, Math.min(100, Number(value)));
export const JOB_HUNT_SOURCE_IDS = Object.freeze([
  "indeed",
  "linkedin",
  "glassdoor",
  "google",
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "gupy",
  "iel",
  "programathor",
  "solides",
  "recrutei",
  "nerdin",
  "remotar",
  "monitored_companies",
]);
const sourceIds = new Set(JOB_HUNT_SOURCE_IDS);
const aggregatorIds = new Set(["indeed", "linkedin", "glassdoor", "google"]);
const workModelIds = new Set(["REMOTE", "HYBRID", "ONSITE"]);

function providerTargets(value = []) {
  const normalized = [];
  for (const item of Array.isArray(value) ? value : []) {
    const provider = String(item?.provider || item?.providerId || "")
      .trim()
      .toLowerCase();
    const organizationKey = String(item?.organizationKey || "").trim();
    if (!sourceIds.has(provider) || !organizationKey) continue;
    normalized.push({
      provider,
      organizationKey,
      company: String(item.company || "")
        .trim()
        .slice(0, 160),
      careerUrl: String(item.careerUrl || "")
        .trim()
        .slice(0, 1000),
    });
  }
  return [
    ...new Map(
      normalized.map((item) => [
        `${item.provider}:${item.organizationKey}`,
        item,
      ]),
    ).values(),
  ].slice(0, 500);
}

function sourcePolicy(input, current) {
  const explicit = Array.isArray(input.sourcePreferences);
  const sourcePreferences = list(
    explicit ? input.sourcePreferences : Array.isArray(input.providers) ? [] : current.sourcePreferences || [],
    sourceIds.size,
  ).filter((item) => sourceIds.has(item));
  if (!sourcePreferences.length && !explicit) {
    const legacyProviders = list(
      input.providers?.length ? input.providers : current.providers,
      8,
    );
    for (const provider of legacyProviders) {
      if (provider === "jobspy")
        sourcePreferences.push("indeed", "linkedin", "glassdoor", "google");
      else if (sourceIds.has(provider)) sourcePreferences.push(provider);
    }
    if (!legacyProviders.length) sourcePreferences.push("indeed");
  }
  const providers = [
    ...new Set([
      ...(sourcePreferences.some((item) => aggregatorIds.has(item))
        ? ["jobspy"]
        : []),
      ...sourcePreferences.filter(
        (item) => !aggregatorIds.has(item) && item !== "monitored_companies",
      ),
    ]),
  ];
  return {
    sourcePreferences: [...new Set(sourcePreferences)],
    providers: explicit
      ? providers
      : providers.length
        ? providers
        : list(
            input.providers?.length ? input.providers : current.providers,
            8,
          ),
  };
}

function workModelPolicy(input, current) {
  const explicit = Array.isArray(input.workModels);
  const workModels = list(
    explicit ? input.workModels : current.workModels || [],
    3,
  ).filter((item) => workModelIds.has(item));
  if (!workModels.length && !explicit) {
    const legacy = input.remotePolicy || current.remotePolicy;
    if (legacy === "REMOTE_ONLY") workModels.push("REMOTE");
    else if (legacy === "ONSITE_OR_HYBRID") workModels.push("HYBRID", "ONSITE");
    else workModels.push("REMOTE", "HYBRID", "ONSITE");
  }
  const remotePolicy =
    workModels.length === 1 && workModels[0] === "REMOTE"
      ? "REMOTE_ONLY"
      : !workModels.includes("REMOTE") && workModels.length
        ? "ONSITE_OR_HYBRID"
        : "ANY";
  return { workModels, remotePolicy };
}

export function nextJobHuntRun(schedule = {}, from = new Date()) {
  const everyHours = Math.max(
    1,
    Math.min(168, Number(schedule.everyHours) || 24),
  );
  if (schedule.mode === "INTERVAL")
    return new Date(from.getTime() + everyHours * 3600000).toISOString();
  const days = list(schedule.days, 7)
      .map(Number)
      .filter((day) => day >= 0 && day <= 6),
    [hour, minute] = time(schedule.time).split(":").map(Number);
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate <= from) continue;
    if (!days.length || days.includes(candidate.getDay()))
      return candidate.toISOString();
  }
  return new Date(from.getTime() + 24 * 3600000).toISOString();
}

export function normalizeJobHuntProfile(input = {}, current = {}) {
  input = {
    ...input,
    enabled: input.enabled ?? current.enabled,
    prepareResume: input.prepareResume ?? current.prepareResume,
    massHunt: input.massHunt ?? current.massHunt,
    schedule: { ...current.schedule, ...input.schedule },
    notificationPolicy: {
      ...current.notificationPolicy,
      ...input.notificationPolicy,
      quietHours: { ...current.notificationPolicy?.quietHours, ...input.notificationPolicy?.quietHours },
    },
  };
  const schedule = {
    mode: input.schedule?.mode === "INTERVAL" ? "INTERVAL" : "WEEKLY",
    days: list(input.schedule?.days, 7)
      .map(Number)
      .filter((day) => day >= 0 && day <= 6),
    time: time(input.schedule?.time),
    everyHours: Math.max(
      1,
      Math.min(168, Number(input.schedule?.everyHours) || 24),
    ),
  };
  const notificationPolicy = {
    maxInstantAlerts: Math.max(
      0,
      Math.min(20, Number(input.notificationPolicy?.maxInstantAlerts ?? 3)),
    ),
    digestEnabled: input.notificationPolicy?.digestEnabled !== false,
    quietHours: {
      enabled: input.notificationPolicy?.quietHours?.enabled === true,
      start: time(input.notificationPolicy?.quietHours?.start || "22:00"),
      end: time(input.notificationPolicy?.quietHours?.end || "08:00"),
    },
    decisionClasses: list(input.notificationPolicy?.decisionClasses ?? ["RECOMMENDED", "REVIEW", "STRETCH"], 3).filter(
      (value) => ["RECOMMENDED", "REVIEW", "STRETCH"].includes(value),
    ),
    delivery: list(input.notificationPolicy?.delivery ?? ["WHATSAPP"], 3).filter(
      (value) => value === "WHATSAPP",
    ),
    summaryFields: list(input.notificationPolicy?.summaryFields, 8).filter(
      (value) => ["ROLE", "COMPANY", "LOCATION", "RECOMMENDATION", "STRENGTHS_GAPS", "JOB_LINK"].includes(value),
    ),
  };
  const enabled = input.enabled === true;
  const legacyOnly =
    input.minimumMatchScore !== undefined &&
    input.considerThreshold === undefined &&
    input.prepareResumeThreshold === undefined &&
    input.notifyThreshold === undefined;
  const considerThreshold = threshold(
    input.considerThreshold ??
      input.minimumMatchScore ??
      current.considerThreshold ??
      current.minimumMatchScore ??
      70,
  );
  const prepareResumeThreshold = threshold(
    input.prepareResumeThreshold ??
      (legacyOnly ? considerThreshold : (current.prepareResumeThreshold ?? 82)),
  );
  const notifyThreshold = threshold(
    input.notifyThreshold ??
      (legacyOnly ? considerThreshold : (current.notifyThreshold ?? 90)),
  );
  if (
    !(
      considerThreshold <= prepareResumeThreshold &&
      prepareResumeThreshold <= notifyThreshold
    )
  )
    throw Object.assign(
      new Error(
        "Use limiares crescentes: considerar, preparar currículo e notificar.",
      ),
      { code: "JOB_HUNT_THRESHOLDS_INVALID" },
    );
  const sources = sourcePolicy(input, current),
    models = workModelPolicy(input, current);
  const jobFamilies = list(input.jobFamilies ?? current.jobFamilies, 12).map(
      (item) => item.toUpperCase(),
    ),
    seniorities = list(input.seniorities ?? current.seniorities, 4)
      .map((item) => item.toUpperCase())
      .filter((item) =>
        ["INTERNSHIP", "JUNIOR", "MID", "SENIOR"].includes(item),
      );
  const fallbackPriorities = list(
    input.locations ?? current.locations,
    12,
  ).flatMap((location, index) =>
    models.workModels.map((workModel) => ({
      priority: index + 1,
      location,
      workModel,
      remoteScope: workModel === "REMOTE" ? "BRASIL" : "",
      accepted: true,
    })),
  );
  const locationPolicy = normalizeLocationPolicy(
      input.locationPolicy ??
        current.locationPolicy ?? { priorities: fallbackPriorities },
    ),
    queryBudget = new QueryBudgetPolicy().normalize(
      input.queryBudget ?? current.queryBudget,
    ),
    massHunt = input.massHunt === true;
  return {
    ...current,
    name: String(input.name || current.name || "Busca de vagas")
      .trim()
      .slice(0, 120),
    enabled,
    queries: list(input.queries ?? current.queries, 20),
    locations: list(input.locations ?? current.locations, 12),
    ...models,
    ...sources,
    providerTargets: providerTargets(
      input.providerTargets ?? current.providerTargets,
    ),
    jobFamilies,
    seniorities,
    locationPolicy,
    queryBudget,
    massHunt,
    searchIntentVersion: Number(current.searchIntentVersion || 1),
    companyWatchlistIds: list(
      input.companyWatchlistIds ?? current.companyWatchlistIds,
      50,
    ),
    considerThreshold,
    prepareResumeThreshold,
    notifyThreshold,
    minimumMatchScore: considerThreshold,
    allowedEligibility: list(
      input.allowedEligibility ?? current.allowedEligibility,
      4,
    ).filter((item) =>
      [
        "ELIGIBLE",
        "ELIGIBLE_WITH_WARNINGS",
        "REVIEW_REQUIRED",
        "UNKNOWN",
      ].includes(item),
    ),
    prepareResume: input.prepareResume === true,
    notificationPolicy,
    schedule,
    nextRunAt: enabled ? nextJobHuntRun(schedule) : null,
  };
}

export function effectiveJobHuntThresholds(profile = {}, policy = {}) {
  const configured = {
    consider: Number(profile.considerThreshold ?? 70),
    prepareResume: Number(profile.prepareResumeThreshold ?? 82),
    notify: Number(profile.notifyThreshold ?? 90),
  };
  if (policy.enabled !== true) return { ...configured, authority: "SEARCH_PROFILE" };
  const thresholds=applicationRoutingThresholds(policy);
  if(!thresholds.valid)return {...configured,authority:"SEARCH_PROFILE",reason:"ROUTING_POLICY_INVALID"};
  const routingFloor = Math.min(thresholds.minimumAtsScore, thresholds.whatsappMinimumAtsScore);
  return {
    consider: Math.min(configured.consider, routingFloor),
    prepareResume: Math.min(configured.prepareResume, routingFloor),
    notify: Math.min(configured.notify, routingFloor),
    authority: "AUTO_APPLY_POLICY",
  };
}

export function jobMatchesWorkModels(job = {}, workModels = []) {
  if (!workModels.length || workModels.length === 3) return true;
  const value = `${job.workModel || ""} ${job.location || ""}`.toLowerCase();
  const model = /remote|remoto|home office/.test(value)
    ? "REMOTE"
    : /h[ií]brid/.test(value)
      ? "HYBRID"
      : "ONSITE";
  return workModels.includes(model);
}

export function jobMatchesSeniority(job = {}, seniorities = []) {
  if (!seniorities.length) return true;
  const text =
      `${job.seniority || ""} ${job.title || ""} ${job.employmentType || job.jobType || ""}`.toLowerCase(),
    detected = /est[aá]gio|intern(ship)?/.test(text)
      ? "INTERNSHIP"
      : /j[uú]nior|\bjr\b|entry.level/.test(text)
        ? "JUNIOR"
        : /pleno|mid.level/.test(text)
          ? "MID"
          : /s[eê]nior|\bsr\b|lead|principal/.test(text)
            ? "SENIOR"
            : "UNKNOWN";
  return detected === "UNKNOWN" || seniorities.includes(detected);
}

export function jobMatchesLocationPolicy(job = {}, policy = {}) {
  const priorities = Array.isArray(policy.priorities)
    ? policy.priorities.filter((item) => item.accepted !== false)
    : [];
  if (!priorities.length)
    return { accepted: true, priority: 1, reason: "NO_LOCATION_RESTRICTION" };
  const haystack =
      `${job.location || ""} ${job.city || ""} ${job.state || ""} ${job.country || ""}`
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase(),
    model = /remote|remoto|home office/i.test(
      `${job.workModel} ${job.location}`,
    )
      ? "REMOTE"
      : /h[ií]brid/i.test(`${job.workModel} ${job.location}`)
        ? "HYBRID"
        : "ONSITE";
  for (const item of [...priorities].sort((a, b) => a.priority - b.priority)) {
    if (item.workModel !== model) continue;
    const target = String(
      model === "REMOTE" ? item.remoteScope || item.location : item.location,
    )
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    if (
      !target ||
      target === "brasil" ||
      haystack.includes(target) ||
      target
        .split(/[\s/,-]+/)
        .some((part) => part.length > 2 && haystack.includes(part))
    )
      return {
        accepted: true,
        priority: item.priority,
        reason: `LOCATION_POLICY_${model}`,
      };
  }
  return {
    accepted:
      model !== "ONSITE" ? false : policy.allowOnsiteOutsideArea === true,
    priority: 99,
    reason: "LOCATION_POLICY_MISMATCH",
  };
}

export function aggregatorSites(profile = {}) {
  return (profile.sourcePreferences || []).filter((item) =>
    aggregatorIds.has(item),
  );
}

export function isQuietHours(policy = {}, date = new Date()) {
  if (!policy.quietHours?.enabled) return false;
  const minute = date.getHours() * 60 + date.getMinutes(),
    toMinute = (value) => {
      const [h, m] = time(value).split(":").map(Number);
      return h * 60 + m;
    },
    start = toMinute(policy.quietHours.start),
    end = toMinute(policy.quietHours.end);
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}
import { normalizeLocationPolicy } from "../discovery/search-intent/search-intent-service.mjs";
import { QueryBudgetPolicy } from "../discovery/search-intent/query-budget-policy.mjs";
