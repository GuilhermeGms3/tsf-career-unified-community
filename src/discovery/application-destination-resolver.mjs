import { publicUrl } from "../security/public-url-policy.mjs";
import { SourceResolver } from "./source-resolver.mjs";

const APPLY_TEXT = /\b(apply|application|aplicar|candidate-se|candidatar|candidatura|inscreva-se|quero essa vaga|enviar curr[ií]culo)\b/i;
const APPLY_PATH = /\/(apply|application|applications|aplicar|candidatar|candidatura|inscricao|inscrever)(?:[/?#-]|$)/i;
const REJECT_TEXT = /\b(compartilhar|share|login|entrar|cadastro|cadastrar|salvar|favorit|curso|treinamento)\b/i;
const ATS_PROVIDERS = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "gupy",
  "workday",
  "indeed",
  "icims",
  "taleo",
  "oracle",
  "successfactors",
  "personio",
  "teamtailor",
  "nerdin",
  "quickin",
  "pandape",
  "abler",
]);

const decodeEntities = (value) =>
  String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

const visibleText = (value) =>
  decodeEntities(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

export function safeApplicationUrl(value, baseUrl = "") {
  try {
    const url=publicUrl(baseUrl?new URL(String(value||""),baseUrl):value);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

export function extractApplicationLinks(html, baseUrl) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = match[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    const url = safeApplicationUrl(decodeEntities(href), baseUrl);
    if (!url) continue;
    const label = visibleText(match[2]);
    if (APPLY_TEXT.test(label) || APPLY_PATH.test(new URL(url).pathname))
      links.push({ url, label, evidence: "PUBLIC_APPLICATION_LINK" });
  }
  for (const match of String(html || "").matchAll(/<(?:button|input)\b([^>]*)>/gi)) {
    const action = match[1].match(/\bformaction\s*=\s*(["'])(.*?)\1/i)?.[2];
    const url = safeApplicationUrl(decodeEntities(action), baseUrl);
    if (!url) continue;
    const label = visibleText(match[1].match(/\b(?:value|aria-label)\s*=\s*(["'])(.*?)\1/i)?.[2]);
    if (APPLY_TEXT.test(label) || APPLY_PATH.test(new URL(url).pathname))
      links.push({ url, label, evidence: "PUBLIC_APPLICATION_ACTION" });
  }
  return links.filter((item, index) => links.findIndex((candidate) => candidate.url === item.url) === index);
}

const sameUrl = (left, right) => {
  const a = safeApplicationUrl(left), b = safeApplicationUrl(right);
  return Boolean(a && b && a === b);
};

const scoreCandidate = (candidate, { sourceUrl, canonicalUrl, explicitUrl, resolver }) => {
  const target = resolver.resolve(candidate.url), url = new URL(candidate.url), source = safeApplicationUrl(sourceUrl || canonicalUrl), sourceHost = source ? new URL(source).hostname : "";
  let score = 0;
  if (ATS_PROVIDERS.has(target.atsType)) score += 120;
  else if (target.canonicalTarget) score += 45;
  if (candidate.label && APPLY_TEXT.test(candidate.label)) score += 35;
  if (APPLY_PATH.test(url.pathname)) score += 20;
  if (sourceHost && url.hostname !== sourceHost) score += 18;
  if (sameUrl(candidate.url, explicitUrl)) score += 15;
  if (candidate.label && REJECT_TEXT.test(candidate.label) && !APPLY_TEXT.test(candidate.label)) score -= 100;
  if (sameUrl(candidate.url, sourceUrl) || sameUrl(candidate.url, canonicalUrl)) score -= 5;
  return { ...candidate, target, score };
};

export function resolveApplicationDestination(input = {}) {
  const resolver = new SourceResolver(), sourceUrl = safeApplicationUrl(input.sourceUrl || input.url), canonicalUrl = safeApplicationUrl(input.canonicalUrl || sourceUrl), explicitUrl = safeApplicationUrl(input.applicationUrl, sourceUrl || canonicalUrl), candidates = [];
  if (explicitUrl) candidates.push({ url: explicitUrl, label: "", evidence: "PROVIDER_APPLICATION_URL" });
  for (const item of input.candidateUrls || []) {
    const candidate = typeof item === "string" ? { url: item } : item || {}, url = safeApplicationUrl(candidate.url, sourceUrl || canonicalUrl);
    if (url) candidates.push({ url, label: visibleText(candidate.label), evidence: candidate.evidence || "DISCOVERED_APPLICATION_LINK" });
  }
  if (!candidates.length && (canonicalUrl || sourceUrl)) candidates.push({ url: canonicalUrl || sourceUrl, label: "", evidence: "SOURCE_PAGE_FALLBACK" });
  const ranked = candidates
    .filter((item, index) => candidates.findIndex((candidate) => candidate.url === item.url) === index)
    .map((item) => scoreCandidate(item, { sourceUrl, canonicalUrl, explicitUrl, resolver }))
    .sort((left, right) => right.score - left.score);
  const selected = ranked[0] || { url: "", target: resolver.resolve(""), score: 0, evidence: "NO_APPLICATION_DESTINATION", label: "" };
  const applicationProvider = selected.target.canonicalTarget ? selected.target.atsType : "unknown";
  return {
    sourceUrl,
    applicationUrl: selected.url,
    applicationProvider,
    kind: ATS_PROVIDERS.has(applicationProvider)
      ? "KNOWN_ATS"
      : applicationProvider !== "unknown"
        ? "NATIVE_PLATFORM"
        : selected.url && !sameUrl(selected.url, sourceUrl || canonicalUrl)
          ? "EXTERNAL_FORM"
          : selected.url
            ? "SOURCE_PAGE"
            : "UNKNOWN",
    confidence: Math.max(0, Math.min(1, selected.score / 150)),
    evidence: selected.evidence,
    candidateCount: ranked.length,
  };
}

export const applicationDestinationInternals = Object.freeze({ ATS_PROVIDERS, APPLY_TEXT, APPLY_PATH });
