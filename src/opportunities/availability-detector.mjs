import { parseGreenhouseIdentity } from "../automation/ats/greenhouse/greenhouse-identity.mjs";
import { parseLeverIdentity } from "../automation/ats/lever/lever-target-policy.mjs";
import { parseAshbyIdentity } from "../automation/ats/ashby/ashby-target-policy.mjs";
import { parseSmartRecruitersIdentity } from "../automation/ats/smartrecruiters/smartrecruiters-target-policy.mjs";
import { parseWorkableIdentity } from "../automation/ats/workable/workable-target-policy.mjs";

const outcome = (status, reason, extra = {}) => ({ status, reason, ...extra });
const fold = value => String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const samePage = (left, right) => {
  try {
    const a = new URL(left), b = new URL(right);
    return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "") && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
  } catch { return false; }
};

export function publicJobEndpoint(value) {
  const url = new URL(value), host = url.hostname.toLowerCase(), encode = encodeURIComponent;
  if (["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(host)) {
    const id = parseGreenhouseIdentity(value);
    if (id.boardToken && id.jobPostId) return { provider: "greenhouse", id: id.jobPostId, url: `https://boards-api.greenhouse.io/v1/boards/${encode(id.boardToken)}/jobs/${encode(id.jobPostId)}` };
  }
  const lever = parseLeverIdentity(value);
  if (lever.postingId) return { provider: "lever", id: lever.postingId, url: `https://api.${lever.region === "eu" ? "eu." : ""}lever.co/v0/postings/${encode(lever.site)}/${encode(lever.postingId)}` };
  const smart = parseSmartRecruitersIdentity(value);
  if (smart.postingId) return { provider: "smartrecruiters", id: smart.postingId, url: `https://api.smartrecruiters.com/v1/companies/${encode(smart.company)}/postings/${encode(smart.postingId)}` };
  const ashby = parseAshbyIdentity(value);
  if (ashby.postingId) return { provider: "ashby", id: ashby.postingId, collection: true, url: `https://api.ashbyhq.com/posting-api/job-board/${encode(ashby.board)}` };
  const workable = parseWorkableIdentity(value);
  if (workable.shortcode) return { provider: "workable", id: workable.shortcode, collection: true, url: `https://apply.workable.com/api/v1/widget/accounts/${encode(workable.account)}?details=true` };
  return null;
}

export async function checkPublicJobApi(endpoint, client) {
  const extra = { authority: `${endpoint.provider}-public-api`, reference: endpoint.url };
  try {
    const result = await client.getJson(endpoint.url, { cache: false, retries: 0 });
    if (!samePage(endpoint.url, result.url || endpoint.url)) return outcome("INCONCLUSIVE", "API_REDIRECTED", extra);
    const data = result.data;
    if (endpoint.collection) {
      // Absence is evidence only in a complete, recognized public listing.
      if (!Array.isArray(data?.jobs) || data.hasMore === true || data.next || data.nextPage || Number(data.total) > data.jobs.length)
        return outcome("INCONCLUSIVE", "API_LIST_INCOMPLETE", extra);
      const posting = data.jobs.find(item => String(item.id || item.shortcode || "") === endpoint.id ||
        (endpoint.provider === "ashby" && [item.jobUrl, item.applyUrl].some(url => parseAshbyIdentity(url).postingId === endpoint.id)) ||
        (endpoint.provider === "workable" && String(item.shortcode || "") === endpoint.id));
      if (!posting) return outcome("CLOSED", "ABSENT_FROM_OFFICIAL_LIST", extra);
      if (endpoint.provider === "workable" && ["closed", "archived", "unpublished", "draft"].includes(String(posting.state || "").toLowerCase())) return outcome("CLOSED", "OFFICIAL_JOB_UNPUBLISHED", extra);
      return outcome("AVAILABLE", "OFFICIAL_JOB_PRESENT", extra);
    }
    if (![data?.id, data?.uuid].some(id => String(id || "") === endpoint.id)) return outcome("INCONCLUSIVE", "API_IDENTITY_MISMATCH", extra);
    return outcome("AVAILABLE", "OFFICIAL_JOB_PRESENT", extra);
  } catch (error) {
    if (error.finalUrl && !samePage(endpoint.url, error.finalUrl)) return outcome("INCONCLUSIVE", "API_REDIRECTED", extra);
    return outcome(!endpoint.collection && [404, 410].includes(Number(error.status)) ? "CLOSED" : "INCONCLUSIVE",
      error.code || `HTTP_${error.status || 0}`, { ...extra, httpStatus: Number(error.status || 0) });
  }
}

function jobPostings(html) {
  const found = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if ([value["@type"]].flat().includes("JobPosting")) found.push(value);
    if (value["@graph"]) visit(value["@graph"]);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Invalid structured data is not evidence. */ }
  }
  return found;
}

export function inspectJobPage(job, { data, url, response }, now = new Date()) {
  const html = String(data || ""), source = job.applicationUrl || job.canonicalUrl || job.url;
  const extra = { httpStatus: response?.status || 200, finalUrl: url || source, authority: "public-job-page" };
  if (url && !samePage(source, url)) return outcome("INCONCLUSIVE", "JOB_PAGE_REDIRECTED", extra);
  const text = html.replace(/<(script|style|nav|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  if (/captcha|verify (?:you are|you're) human|access denied|checking your browser|verifique que voc[eê]/i.test(text))
    return outcome("INCONCLUSIVE", "HUMAN_VERIFICATION_REQUIRED", extra);
  if (/n[aã]o\s+(?:estamos|est[aá])\s+aceitando\s+novas?\s+candidaturas\s+para\s+esta\s+vaga|(?:esta |a )?vaga (?:foi |est[aá] )?(?:encerrada|fechada|expirada)|(?:this )?(?:job|position|opportunity) (?:is |has been )?(?:closed|expired|no longer available)|applications? (?:are )?closed|vaga n[aã]o (?:foi )?encontrada|job (?:was )?not found/i.test(text))
    return outcome("CLOSED", "CLOSED_PAGE_CONTENT", extra);
  const applyAction = /<(?:a|button|input)\b(?![^>]*\sdisabled(?:\s|=|>))[^>]*(?:>[\s\S]{0,200}?(?:quero (?:essa|esta) vaga|candidatar|candidate|(?:enviar|efetuar) candidatura|apply(?: now| for)|enviar curr[ií]culo)|value=["'][^"']*(?:apply|candidatar))/i.test(html);
  for (const posting of jobPostings(html)) {
    if (posting.url ? !samePage(posting.url, source) : !job.title || fold(posting.title) !== fold(job.title)) continue;
    const expiry = Date.parse(posting.validThrough || "");
    if (Number.isFinite(expiry) && expiry <= now.getTime()) return outcome(applyAction ? "INCONCLUSIVE" : "CLOSED", applyAction ? "EXPIRY_CONFLICTS_WITH_APPLY_ACTION" : "OFFICIAL_VALID_THROUGH_PASSED", extra);
    if (posting.title && posting.description) return outcome("AVAILABLE", "MATCHING_JOB_POSTING", extra);
  }
  if (/^[a-z0-9-]+\.gupy\.io$/i.test(new URL(source).hostname)) {
    try {
      const props = JSON.parse(html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] || "{}").props?.pageProps;
      const id = new URL(source).pathname.match(/^\/jobs\/(\d+)/)?.[1];
      const tenant = new URL(source).hostname.split(".")[0];
      if (id && String(props?.job?.id) === id && props?.subdomain === tenant) {
        if (props.job.isPublished === false || ["closed", "unpublished", "finished"].includes(String(props.job.status || "").toLowerCase())) return outcome("CLOSED", "GUPY_JOB_UNPUBLISHED", extra);
        return outcome("AVAILABLE", "GUPY_MATCHING_PUBLIC_JOB", extra);
      }
    } catch { /* A changed layout remains inconclusive. */ }
  }
  const titleMatches = job.title && fold(text).includes(fold(job.title));
  return outcome(titleMatches && applyAction ? "AVAILABLE" : "INCONCLUSIVE", titleMatches && applyAction ? "MATCHING_JOB_WITH_APPLY_ACTION" : "JOB_OPEN_NOT_PROVEN", extra);
}
