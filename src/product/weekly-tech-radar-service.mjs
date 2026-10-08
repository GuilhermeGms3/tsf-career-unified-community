const DEFAULT_URL = "https://dev.to/api/articles?top=7&per_page=6";

export class WeeklyTechRadarService {
  constructor({ fetchImpl = fetch, endpoint = DEFAULT_URL, timeoutMs = 1800, cacheMs = 60 * 60 * 1000, now = () => new Date() } = {}) {
    Object.assign(this, { fetchImpl, endpoint, timeoutMs, cacheMs, now });
    this.cache = null;
  }

  async get() {
    const current = this.now();
    if (this.cache && current.getTime() - this.cache.cachedAt < this.cacheMs) return this.cache.value;
    try {
      const response = await this.fetchImpl(this.endpoint, { headers: { accept: "application/json", "user-agent": "tsf-career-unified" }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw Object.assign(new Error(`DEV Community respondeu HTTP ${response.status}`), { code: `HTTP_${response.status}` });
      const payload = await response.json();
      const items = (Array.isArray(payload) ? payload : []).slice(0, 6).map((item) => ({
        id: String(item.id || item.url || ""), title: String(item.title || "").trim(), url: String(item.url || ""),
        author: String(item.user?.name || item.user?.username || ""), publishedAt: item.published_at || item.published_timestamp || null,
        reactions: Number(item.public_reactions_count || item.positive_reactions_count || 0), comments: Number(item.comments_count || 0),
        tags: Array.isArray(item.tag_list) ? item.tag_list.slice(0, 4) : [],
      })).filter((item) => item.title && /^https:\/\/dev\.to\//i.test(item.url));
      const value = { status: items.length ? "AVAILABLE" : "EMPTY", source: "DEV Community", periodDays: 7, updatedAt: current.toISOString(), items };
      this.cache = { cachedAt: current.getTime(), value };
      return value;
    } catch (error) {
      return { status: "UNAVAILABLE", source: "DEV Community", periodDays: 7, updatedAt: current.toISOString(), items: [], errorCode: error.name === "TimeoutError" ? "TIMEOUT" : error.code || "FETCH_FAILED" };
    }
  }
}
