import { navigation, navigationGroups } from "./navigation.js";
import { currentRoute, initRouter, onRouteChange } from "./router.js";
import { icon, errorState, loading } from "./ui.js";
import { renderToday } from "../features/today/page.js";
import {
  renderOpportunities,
  renderOpportunityWorkspace,
} from "../features/opportunities/page.js";
import { renderAutopilot } from "../features/autopilot/page.js";
import { renderProcesses } from "../features/processes/page.js";
import {
  renderResumes,
  renderResumeWorkspace,
} from "../features/resumes/page.js";
import {
  renderApplications,
  renderApplicationWorkspace,
} from "../features/applications/page.js";
import { renderKnowledge } from "../features/knowledge/page.js";
import { renderSettings } from "../features/settings/page.js";
import { renderAnalyzeJob } from "../features/analyze-job/page.js";
import { renderResumeBatchWorkspace } from "../features/resume-batches/page.js";
import { renderApplicationBatches } from "../features/application-batches/page.js";
import { renderConnections } from "../features/connections/page.js";
import { renderVaults } from "../features/vaults/page.js";
import { renderObservability } from "../features/observability/page.js";
import { renderQualityLab } from "../features/quality-lab/page.js";
import { api, queryCache } from "../api/client.js";
import { initBackgroundJobs } from "./background-jobs.js";
import { initTheme } from "./theme.js";
import {initResumeQueuePanel} from "./resume-queue-panel.js";

const renderers = {
  today: renderToday,
  opportunities: renderOpportunities,
  opportunity: renderOpportunityWorkspace,
  "analyze-job": renderAnalyzeJob,
  autopilot: renderAutopilot,
  "autopilot-profile": renderAutopilot,
  resumes: renderResumes,
  resume: renderResumeWorkspace,
  "resume-batch": renderResumeBatchWorkspace,
  "application-batch": renderApplicationBatches,
  "application-batches": renderApplicationBatches,
  applications: renderApplications,
  processes: renderProcesses,
  process: renderProcesses,
  application: renderApplicationWorkspace,
  knowledge: renderKnowledge,
  settings: renderSettings,
  connections: renderConnections,
  vaults: renderVaults,
  observability: renderObservability,
  "quality-lab": renderQualityLab,
};
let navigationGeneration = 0;
let renderingGeneration = 0;
let idlePrefetchScheduled = false;
const routeMetrics = [];
globalThis.__careerPerformance = routeMetrics;
export function bootstrap() {
  renderNavigation();
  initTheme();
  api("/api/runtime",{cache:false}).then(runtime=>{
    if(!runtime.mode)return;
    const label=document.querySelector(".sidebar-foot small");
    if(label&&runtime.mode==="maintenance")label.textContent="Manutenção · automações pausadas";
    if(label&&runtime.mode==="manual")label.textContent="Modo manual · agendas pausadas";
    if(["maintenance","manual"].includes(runtime.mode)){
      const banner=document.createElement("div");
      banner.className="safety-banner";banner.setAttribute("role","status");
      banner.textContent=runtime.mode==="manual"?"Modo manual: comandos liberados no mobile. Agendas e WhatsApp pausados; envio exige sua aprovação e validação do portal.":"Manutenção: buscas, filas e envios pausados. Você pode consultar os dados e renovar sessões em Cofres.";
      document.body.prepend(banner);
    }
  }).catch(()=>{});
  initBackgroundJobs();
  initResumeQueuePanel();
  initRouter();
  onRouteChange(renderRoute);
  renderRoute(currentRoute());
  document
    .querySelector("#mobile-nav-toggle")
    ?.addEventListener("click", toggleMobileNav);
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-retry]")) renderRoute(currentRoute());
  });
  document.addEventListener("career:background-job-complete", (event) => {
    const target = new URL(event.detail.targetUrl, location.origin);
    if (target.pathname === location.pathname) renderRoute(currentRoute());
  });
  queryCache.subscribeAll((key, state) => {
    if (
      !state.background ||
      state.refreshing ||
      renderingGeneration ||
      !routeUsesKey(currentRoute(), key)
    )
      return;
    queueMicrotask(() => renderRoute(currentRoute(), { revalidation: true }));
  });
  document.addEventListener("pointerover", prefetchNavigationIntent, {
    passive: true,
  });
  document.addEventListener("focusin", prefetchNavigationIntent);
}
async function renderRoute(route, { revalidation = false } = {}) {
  const root = document.querySelector("#app-content");
  const generation = ++navigationGeneration,
    startedAt = performance.now(),
    staging = root.cloneNode(false),
    progress = document.querySelector("[data-route-progress]");
  staging.removeAttribute("aria-busy");
  renderingGeneration = generation;
  if (!revalidation && progress) progress.hidden = false;
  if (!root.firstElementChild)
    root.innerHTML = loading("Preparando o aplicativo…");
  else root.setAttribute("aria-busy", "true");
  closeMobileNav();
  updateActiveNavigation(route);
  const renderer = renderers[route.name];
  if (!renderer) {
    staging.innerHTML = errorState(new Error("Esta rota não existe."), false);
    root.replaceWith(staging);
    renderingGeneration = 0;
    return;
  }
  try {
    await renderer({ root: staging, route });
    if (generation !== navigationGeneration) return;
    root.replaceWith(staging);
    staging.focus({ preventScroll: true });
    document.title = `${navigation.find((item) => item.matches(route))?.label || "Career Unified"} · Career Unified`;
    routeMetrics.push({
      routeNavigationStart: startedAt,
      shellRendered: startedAt,
      cachedDataRendered: performance.now(),
      networkDataResolved: performance.now(),
      routeInteractive: performance.now(),
      route: route.name,
      revalidation,
    });
    if (routeMetrics.length > 100) routeMetrics.shift();
    if (route.name === "today") scheduleIdlePrefetch();
  } catch (error) {
    if (generation !== navigationGeneration) return;
    console.error(error);
    staging.innerHTML = errorState(error);
    root.replaceWith(staging);
  } finally {
    if (generation === navigationGeneration && progress) progress.hidden = true;
    if (renderingGeneration === generation) renderingGeneration = 0;
  }
}

function routeUsesKey(route, key) {
  if(route.name==='connections')return key.startsWith('GET:/api/connections');
  if(route.name==='vaults')return key.startsWith('GET:/api/vaults');
  if(route.name==='observability')return key.startsWith('GET:/api/observability');
  if (["application-batch","application-batches"].includes(route.name))return key.startsWith("GET:/api/application-batches");
  if (route.name === "today")
    return (
      key.startsWith("GET:/api/today") ||
      key.startsWith("GET:/api/source-center")
    );
  if (route.name === "opportunities")
    return (
      key.startsWith("GET:/api/opportunities") ||
      (route.section === "diagnostics" &&
        key.startsWith("GET:/api/discovery-v4/diagnostics")) ||
      ((!route.section || route.section === "discover") &&
        key.startsWith("GET:/api/discovery-v4/capabilities"))
    );
  if (route.name === "applications")
    return key.startsWith("GET:/api/experience/applications");
  if (route.name === "knowledge")
    return key.startsWith("GET:/api/candidate-knowledge");
  return false;
}
function prefetch(path) {
  return api(path).catch(() => undefined);
}
function scheduleIdlePrefetch() {
  if (idlePrefetchScheduled) return;
  idlePrefetchScheduled = true;
  const run = () =>
    Promise.all([
      prefetch("/api/opportunities?view=cards&section=discover&offset=0&limit=12"),
      prefetch("/api/experience/applications"),
      prefetch("/api/candidate-knowledge/inventory"),
    ]);
  if ("requestIdleCallback" in globalThis)
    requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 250);
}
function prefetchNavigationIntent(event) {
  const link = event.target.closest?.("a[data-nav-path]");
  if (!link) return;
  const path = link.dataset.navPath;
  if (path === "/opportunities")
    prefetch("/api/opportunities?view=cards&section=discover&offset=0&limit=12");
  else if (path === "/applications") prefetch("/api/experience/applications");
  else if (path === "/knowledge")
    prefetch("/api/candidate-knowledge/inventory");
}
function renderNavigation() {
  const markup = navigationGroups
    .map((group) => `<section class="nav-group"><p class="nav-group-label">${group.label}</p><div class="nav-group-items">${group.items.map((item) => `<a href="${item.path}" data-link data-nav-path="${item.path}">${icon(item.icon)}<span>${item.label}</span></a>`).join("")}</div></section>`)
    .join("");
  document.querySelector(".primary-nav").innerHTML = markup;
  document.querySelector(".mobile-nav").innerHTML = markup;
}
function updateActiveNavigation(route) {
  for (const item of navigation)
    for (const link of document.querySelectorAll(
      `[data-nav-path="${item.path}"]`,
    )) {
      const active = item.matches(route);
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
}
function toggleMobileNav() {
  const nav = document.querySelector("#mobile-nav"),
    button = document.querySelector("#mobile-nav-toggle"),
    open = nav.hidden;
  nav.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}
function closeMobileNav() {
  const nav = document.querySelector("#mobile-nav"),
    button = document.querySelector("#mobile-nav-toggle");
  if (nav) nav.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}
