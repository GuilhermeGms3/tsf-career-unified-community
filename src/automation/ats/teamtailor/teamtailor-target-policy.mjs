const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const OFFICIAL_DOMAINS = ["teamtailor.com", "careers-page.com"];

const isOfficialHost = (host) =>
  OFFICIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));

export function parseTeamtailorIdentity(value) {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase(), parts = url.pathname.split("/").filter(Boolean);
    if (!isOfficialHost(host) || parts[0] !== "jobs" || !parts[1] || parts.length > 3) return {};
    const postingSegment = parts[1], postingId = postingSegment.match(/^\d+/)?.[0] || "";
    if (!postingId || (parts[2] && !["apply", "application"].includes(parts[2]))) return {};
    return {
      host,
      postingId,
      postingSegment,
      canonicalUrl: `https://${host}/jobs/${postingSegment}`,
      applyUrl: url.href,
    };
  } catch {
    return {};
  }
}

export function validateTeamtailorSubmissionTarget(value, { expectedIdentity = {}, allowLocalFixture = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error("Target Teamtailor inválido."), { code: "TEAMTAILOR_TARGET_INVALID" });
  }
  if (url.username || url.password)
    throw Object.assign(new Error("Target não pode conter credenciais."), { code: "TEAMTAILOR_TARGET_CREDENTIALS_NOT_ALLOWED" });
  if (LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    if (!allowLocalFixture || url.protocol !== "http:")
      throw Object.assign(new Error("Target local não permitido neste runtime."), { code: "TEAMTAILOR_TARGET_LOCAL_NOT_ALLOWED" });
    return { url: url.href, identity: expectedIdentity, localFixture: true };
  }
  const identity = parseTeamtailorIdentity(url.href);
  if (url.protocol !== "https:" || !isOfficialHost(url.hostname.toLowerCase()))
    throw Object.assign(new Error("Controlled Submit aceita somente host Teamtailor oficial em HTTPS."), { code: "TEAMTAILOR_TARGET_HOST_NOT_ALLOWED" });
  if (!identity.host || !identity.postingId)
    throw Object.assign(new Error("Identidade Teamtailor incompleta no target."), { code: "TEAMTAILOR_TARGET_IDENTITY_MISSING" });
  if (
    (expectedIdentity.host && expectedIdentity.host.toLowerCase() !== identity.host) ||
    (expectedIdentity.postingId && String(expectedIdentity.postingId) !== identity.postingId)
  )
    throw Object.assign(new Error("Identidade Teamtailor diverge do target persistido."), { code: "TEAMTAILOR_TARGET_IDENTITY_MISMATCH" });
  return { url: url.href, identity, localFixture: false };
}

export const teamtailorTargetPolicyInternals = Object.freeze({ isOfficialHost });
