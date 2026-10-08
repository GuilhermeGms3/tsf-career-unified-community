export const CACHE_TTL = Object.freeze({
  short: { staleTime: 15_000, cacheTime: 5 * 60_000 },
  medium: { staleTime: 60_000, cacheTime: 15 * 60_000 },
  long: { staleTime: 5 * 60_000, cacheTime: 30 * 60_000 },
});

export function cachePolicyFor(path) {
  if (/capabilities|catalog|job-families/.test(path)) return CACHE_TTL.long;
  if (/profiles|resumes|applications|candidate-knowledge|source-center|opportunities/.test(path))
    return CACHE_TTL.medium;
  return CACHE_TTL.short;
}

export class QueryCache {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.entries = new Map();
    this.inFlight = new Map();
    this.listeners = new Map();
    this.allListeners = new Set();
  }

  getCached(key) {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      if (entry) this.entries.delete(key);
      return undefined;
    }
    return entry.data;
  }

  isFresh(key, staleTime) {
    const entry = this.entries.get(key);
    return Boolean(entry && entry.expiresAt > this.now() && this.now() - entry.updatedAt < staleTime);
  }

  async query({ key, loader, staleTime = 0, cacheTime = 300_000 }) {
    const cached = this.getCached(key);
    if (cached !== undefined) {
      if (!this.isFresh(key, staleTime)) this.refresh({ key, loader, cacheTime, background: true });
      return cached;
    }
    return this.refresh({ key, loader, cacheTime, background: false });
  }

  refresh({ key, loader, cacheTime, background }) {
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const previous = this.getCached(key),
      request = Promise.resolve()
        .then(loader)
        .then((data) => {
          this.entries.set(key, {
            data,
            updatedAt: this.now(),
            expiresAt: this.now() + cacheTime,
            error: null,
          });
          this.notify(key, { data, refreshing: false, error: null, background });
          return data;
        })
        .catch((error) => {
          if (previous !== undefined) {
            const entry = this.entries.get(key);
            if (entry) entry.error = error;
            this.notify(key, { data: previous, refreshing: false, error, background });
            return previous;
          }
          if (!background) throw error;
          return undefined;
        })
        .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    if (previous !== undefined)
      this.notify(key, { data: previous, refreshing: true, error: null, background });
    return request;
  }

  invalidate(match) {
    const predicate =
      typeof match === "function"
        ? match
        : (key) => key === match || key.startsWith(String(match));
    for (const key of this.entries.keys()) if (predicate(key)) this.entries.delete(key);
  }

  prefetch(options) {
    return this.query(options).catch(() => undefined);
  }

  subscribe(key, listener) {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(listener);
    return () => this.listeners.get(key)?.delete(listener);
  }

  subscribeAll(listener) {
    this.allListeners.add(listener);
    return () => this.allListeners.delete(listener);
  }

  notify(key, state) {
    for (const listener of this.listeners.get(key) || []) listener(state);
    for (const listener of this.allListeners) listener(key, state);
  }
}

export const queryCache = new QueryCache();

export function invalidateForMutation(path) {
  const groups = [], pathname=String(path).split("?")[0];
  if(/^\/api\/connections/.test(pathname))groups.push('/api/connections','/api/source-center','/api/observability','/api/application-batches','/api/candidate-knowledge');
  if(/^\/api\/observability/.test(pathname))groups.push('/api/observability');
  if(pathname==="/api/unified/backup/restore"){
    queryCache.invalidate(()=>true);
    return;
  }
  queryCache.invalidate((key) => key.startsWith(`GET:${path}`));
  if (/^\/api\/candidate-knowledge/.test(pathname)) groups.push("/api/candidate-knowledge");
  if (/^\/api\/(?:experience\/)?applications?/.test(pathname)) groups.push("/api/applications", "/api/experience/applications");
  if (pathname === "/api/opportunities/verify") groups.push("/api/opportunities", "/api/today", "/api/job-hunt/runs");
  if (pathname === "/api/experience/resumes/default") groups.push("/api/experience/resumes", "/api/opportunities");
  if (/^\/api\/(?:resume-documents|intelligence\/tailoring|unified\/resume)/.test(pathname)) groups.push("/api/resumes", "/api/experience/resumes", "/api/opportunities");
  if (/^\/api\/resume-batches/.test(pathname)) groups.push("/api/resume-batches", "/api/experience/resumes");
  if (/^\/api\/application-(batches|drafts)/.test(pathname)) groups.push("/api/application-batches", "/api/application-drafts");
  if (/^\/api\/source-center/.test(pathname)) groups.push("/api/source-center");
  if (/^\/api\/whatsapp/.test(pathname)) groups.push("/api/whatsapp", "/api/source-center");
  if (/^\/api\/discovery/.test(pathname)) groups.push("/api/discovery");
  if (/source-center|github/.test(path))
    groups.push("/api/source-center", "/api/today", "/api/candidate-knowledge", "/api/opportunities");
  if (/discovery|job-hunt|jobs\/search/.test(path))
    groups.push("/api/opportunities", "/api/today", "/api/discovery-v4/diagnostics", "/api/logs");
  if (/applications?/.test(path))
    groups.push("/api/applications", "/api/experience/applications", "/api/today", "/api/opportunities");
  if (/profile|search-intent|candidate-knowledge/.test(path))
    groups.push("/api/profile", "/api/candidate-knowledge", "/api/opportunities", "/api/today", "/api/discovery-v4/diagnostics");
  if (/opportunities\/.+\/feedback/.test(path))
    groups.push("/api/opportunities", "/api/today");
  if (/unified\/ats|analys|resume-documents|today\/dismiss/.test(path))
    groups.push("/api/opportunities", "/api/today", "/api/resumes");
  if(/product\/onboarding/.test(path))groups.push("/api/product/onboarding","/api/profile","/api/today");
  for (const group of new Set(groups))
    queryCache.invalidate((key) => key.startsWith(`GET:${group}`));
}
