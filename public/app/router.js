const listeners = new Set();
export function currentRoute() {
  const path = location.pathname.replace(/\/+$/, "") || "/",
    query = new URLSearchParams(location.search);
  for (const [name, pattern] of [
    ["opportunity", /^\/opportunities\/([^/]+)$/],
    ["application", /^\/applications\/([^/]+)$/],
    ["process", /^\/processes\/([^/]+)$/],
    ["resume", /^\/resumes\/([^/]+)$/],
    ["resume-batch", /^\/resume-batches\/([^/]+)$/],
    ["application-batch", /^\/application-batches\/([^/]+)$/],
    ["autopilot-profile", /^\/autopilot\/profiles\/([^/]+)$/],
  ]) {
    const match = path.match(pattern);
    if (match)
      return {
        name,
        path,
        id: decodeURIComponent(match[1]),
        tab: query.get("tab") || "summary",
        section: query.get("section") || "",
      };
  }
  const names = {
    "/": "today",
    "/opportunities": "opportunities",
    "/analyze": "analyze-job",
    "/autopilot": "autopilot",
    "/resumes": "resumes",
    "/applications": "applications",
    "/processes": "processes",
    "/application-batches": "application-batches",
    "/knowledge": "knowledge",
    "/settings": "settings",
    "/connections": "connections",
    "/vaults": "vaults",
    "/observability": "observability",
    "/quality-lab": "quality-lab",
  };
  return {
    name: names[path] || "not-found",
    path,
    tab: query.get("tab") || "",
    section: query.get("section") || "",
  };
}
export function navigate(path, { replace = false } = {}) {
  if (`${location.pathname}${location.search}` === path) return;
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  notify();
}
export function onRouteChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function notify() {
  const route = currentRoute();
  for (const listener of listeners) listener(route);
}
export function initRouter() {
  addEventListener("popstate", notify);
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a[data-link]");
    if (
      !link ||
      link.target === "_blank" ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    event.preventDefault();
    navigate(`${url.pathname}${url.search}`);
  });
}
