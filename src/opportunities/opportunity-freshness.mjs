const DAY_MS = 86_400_000;
export const TODAY_CONFIRMATION_MAX_AGE_MS = 3 * DAY_MS;

const fold = (value) => String(value || "")
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const parsedTime = (value) => Date.parse(value || "") || 0;

export function opportunityFreshness(job = {}, now = new Date()) {
  const lifecycle = String(job.lifecycleStatus || "UNKNOWN").toUpperCase();
  const availability = job.availability || {};
  const confirmedAt = availability.status === "AVAILABLE"
    ? availability.checkedAt
    : lifecycle === "OPEN"
      ? job.lastSeenAt || job.lastCheckedAt
      : "";
  const confirmedTime = parsedTime(confirmedAt);
  const ageMs = confirmedTime ? Math.max(0, now.getTime() - confirmedTime) : null;
  const ageDays = ageMs === null ? null : Math.floor(ageMs / DAY_MS);
  const current = lifecycle === "OPEN" && ageMs !== null && ageMs <= TODAY_CONFIRMATION_MAX_AGE_MS;
  let status = "NEVER_CONFIRMED";
  if (lifecycle === "CLOSED") status = "CLOSED";
  else if (availability.status === "INCONCLUSIVE") status = "INCONCLUSIVE";
  else if (current) status = "CURRENT";
  else if (confirmedTime) status = "UPDATE_RECOMMENDED";
  return {
    status,
    current,
    confirmedAt: confirmedAt || "",
    ageDays,
    needsUpdate: !current && lifecycle !== "CLOSED",
  };
}

export function duplicateOpportunityKey(job = {}) {
  const company = fold(job.company);
  const title = fold(job.title);
  const location = fold(job.location);
  if (company && title && location) return `${company}|${title}|${location}`;
  try {
    const url = new URL(job.canonicalUrl || job.applicationUrl || job.url || "");
    const pathname = url.pathname.replace(/\/+$/, "").toLowerCase();
    return pathname ? `url:${url.hostname.toLowerCase()}${pathname}` : "";
  } catch { return ""; }
}
