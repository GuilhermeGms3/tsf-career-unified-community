import { developmentOpportunityExplanation } from "../../app/presentation.js";
import { api } from "../shared/data.js";
import {
  escapeHtml,
  formatDate,
  icon,
  pageHeader,
  pill,
  score,
  statusLabel, humanText, technicalDetails,
  toast,
} from "../../app/ui.js";
import {
  bindResumeReview,
  renderResumeReview,
} from "../shared/resume-review.js";
import { trackBackgroundJob } from "../../app/background-jobs.js";

let currentQueryBudget = {};
let massHuntPollGeneration = 0;
let availabilityPollGeneration = 0;
const BATCH_SELECTION_KEY = "career.resumeBatchSelection.v1";
const MASS_HUNT_RUN_KEY = "career.massHuntRunId";
const MASS_HUNT_MINIMIZED_KEY = "career.massHuntPanelMinimized";
const AVAILABILITY_RUN_KEY = "career.opportunityVerificationRunId";
const decisionLabel = (decision) =>
  ({
    APPLY: "Aplicaria",
    REVIEW: "Talvez aplicaria",
    REJECT: "Não aplicaria",
  })[decision] || statusLabel(decision);
const opportunityPageSize = (section) =>
  ["companies", "history"].includes(section) ? 2_000 : section === "all" ? 30 : 12;
const opportunityCardsPath = (section, { offset = 0, limit = opportunityPageSize(section), query = "" } = {}) => {
  const params = new URLSearchParams({
    view: "cards",
    section,
    offset: String(offset),
    limit: String(limit),
  });
  if (query) params.set("query", query);
  return `/api/opportunities?${params}`;
};
async function loadOpportunityPage(section) {
  try {
    return await api(opportunityCardsPath(section));
  } catch {
    const legacy = await api("/api/opportunities"),
      selected = orderedOpportunities(section, legacy.opportunities || []),
      limit = opportunityPageSize(section);
    return {
      opportunities: selected.slice(0, limit),
      pagination: {
        section,
        offset: 0,
        limit,
        returned: Math.min(limit, selected.length),
        total: selected.length,
        hasMore: selected.length > limit,
      },
    };
  }
}
export async function renderOpportunities({ root }) {
  root.__availabilityCleanup?.();
  const query = new URLSearchParams(location.search),
    section = query.get("section") || "discover",
    needsOpportunities = section !== "diagnostics",
    needsCapabilities = section === "discover",
    needsDiagnostics = section === "diagnostics",
    needsAutomation = ["discover", "history"].includes(section),
    [{ opportunities = [], pagination = {} }, capabilities, diagnostics, automation] = await Promise.all([
      needsOpportunities
        ? loadOpportunityPage(section)
        : { opportunities: [], pagination: { total: 0, hasMore: false } },
      needsCapabilities
        ? api("/api/discovery-v4/capabilities").catch(() => ({
            sourceClasses: [],
          }))
        : { sourceClasses: [] },
      needsDiagnostics
        ? api("/api/discovery-v4/diagnostics").catch(() => null)
        : null,
      needsAutomation
        ? Promise.all([
            api("/api/job-hunt/profiles", { cache: false }),
            api("/api/job-hunt/runs?limit=20&detail=summary", { cache: false }),
          ])
            .then(([profileData, runData]) => ({
              profiles: profileData.profiles || [],
              recentRuns: runData.runs || [],
              availabilityRuns: runData.availabilityRuns || [],
            }))
            .catch(() => null)
        : null,
    ]);
  currentQueryBudget = capabilities.activeSearchIntent?.queryBudget || {};
  const activeVerification = automation?.availabilityRuns?.find((item) => item.status === "RUNNING") || null;
  root.innerHTML = `<div class="page">${pageHeader({ eyebrow: "Descobrir → Avaliar", title: "Oportunidades", description: "Descubra vagas, entenda o contexto e escolha onde investir energia.", actions: `<button class="button" type="button" data-verify-active-jobs ${activeVerification ? "disabled" : ""}>${icon("refresh")} ${activeVerification ? "Verificando vagas" : "Verificar vagas ativas"}</button>` })}${opportunityNavigation(section)}${availabilityVerificationMarkup(activeVerification)}
    ${opportunitiesContent(section, opportunities, capabilities, diagnostics, pagination.total ?? opportunities.length, automation)}${batchStudioChrome()}${massHuntPanelMarkup()}</div>`;
  applyActiveSearchIntent(root, capabilities.activeSearchIntent);
  let visible = opportunities.length;
  root.querySelector("[data-load-more]")?.addEventListener("click", (event) => {
    loadMoreOpportunities({ root, section, opportunities, visible, button: event.currentTarget })
      .then((nextVisible) => (visible = nextVisible))
      .catch((error) => {
        event.currentTarget.disabled = false;
        toast(error.message, "error");
      });
  });
  const filter = root.querySelector("[data-filter-opportunities]");
  let filterTimer = 0;
  filter?.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(async () => {
      const term = filter.value.trim();
      filter.setAttribute("aria-busy", "true");
      try {
        const data = await api(
          opportunityCardsPath(section, {
            limit: term ? 100 : opportunityPageSize(section),
            query: term,
          }),
          { cache: false },
        );
        opportunities.splice(0, opportunities.length, ...(data.opportunities || []));
        visible = opportunities.length;
        replaceOpportunityList(root, section, opportunities);
        const total = data.pagination?.total ?? opportunities.length,
          counter = root.querySelector("[data-opportunity-total]"),
          more = root.querySelector("[data-load-more]");
        if (counter) counter.textContent = total;
        if (more) more.hidden = !data.pagination?.hasMore || Boolean(term);
        bindOpportunityListActions(root, () => renderOpportunities({ root }));
        bindBatchSelection(root, opportunities, section);
      } catch (error) {
        toast(error.message, "error");
      } finally {
        filter.removeAttribute("aria-busy");
      }
    }, 250);
  });
  root
    .querySelector("#manual-discovery")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = root.querySelector("#discovery-status"),
        button = event.submitter,
        progress = root.querySelector("[data-search-progress]"),
        progressLabel = progress?.querySelector("strong");
      button.disabled = true;
      status.textContent = "Buscando e consolidando resultados…";
      progress.hidden = false;
      progress.className = "search-progress is-running";
      progressLabel.textContent = "Consultando portais e removendo duplicatas…";
      let stage = 0;
      const stages = ["Consultando portais…", "Lendo vagas encontradas…", "Consolidando duplicatas…", "Atualizando sua fila…"];
      const stageTimer = setInterval(() => {
        stage = Math.min(stage + 1, stages.length - 1);
        progressLabel.textContent = stages[stage];
      }, 3500);
      try {
        const form = new FormData(event.currentTarget);
        const result = await api("/api/unified/jobs/search", {
          method: "POST",
          body: JSON.stringify({
            query: form.get("query"),
            location: form.get("location"),
            hoursOld: Number(form.get("hoursOld")),
            resultsWanted: Number(form.get("limit")),
            geographies: form.getAll("geographies"),
          }),
        });
        const accepted=result.jobs?.length||result.results?.length||0,rejected=Number(result.geographyRejectedCount||0),analyzed=Number(result.analyzedCount||0);
        status.innerHTML = `${accepted} vaga(s) atual(is) aceita(s)${rejected?` · ${rejected} fora da região descartada(s)`:""}${analyzed?` · ${analyzed} análise(s) ATS atualizada(s)`:""}. <a data-link href="/opportunities?section=recommended">Ver vagas para mim</a>`;
        progress.className = "search-progress is-complete";
        progressLabel.textContent = "Busca concluída e fila atualizada.";
        toast("Busca concluída. As oportunidades foram persistidas.");
      } catch (error) {
        status.textContent = error.message;
        progress.className = "search-progress is-error";
        progressLabel.textContent = "A busca não pôde ser concluída.";
      } finally {
        clearInterval(stageTimer);
        button.disabled = false;
      }
    });
  bindOpportunityListActions(root, () => renderOpportunities({ root }));
  bindSearchComposer(root);
  bindMassHuntPanel(root);
  root.querySelectorAll("[data-hunt-source]").forEach(button => button.addEventListener("click", async () => {
    const status = button.closest("[data-source-recovery]").querySelector('[role="status"]');
    button.disabled = true;
    try {
      const result = await api(`/api/job-hunt/runs/${encodeURIComponent(button.dataset.runId)}/source`, { method: "POST", body: JSON.stringify({ source: button.dataset.huntSource }) });
      localStorage.setItem(MASS_HUNT_RUN_KEY, result.runId);
      status.textContent = result.reused ? "Busca já em andamento; radar reaberto." : "Busca direcionada iniciada, sem gerar currículos ou candidaturas.";
      root.__openMassHunt?.(result.runId);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }));
  bindAvailabilityVerification(root, activeVerification);
  bindBatchSelection(root, opportunities, section);
}

function opportunityNavigation(section) {
  const primary = [
      ["discover", "Descobrir"],
      ["recommended", "Recomendadas"],
      ["decisions", "Minhas decisões"],
      ["all", "Todas"],
      ["companies", "Empresas"],
      ["history", "Histórico"],
    ],
    secondary = [
      ["priority", "Prioridade calculada"],
      ["review", "Vale revisar"],
      ["stretch", "Desenvolvimento"],
      ["excluded", "Excluídas"],
      ["diagnostics", "Diagnóstico"],
    ],
    secondaryActive = secondary.find(([id]) => id === section);
  const links = (items) => items.map(([id, label]) => `<a data-link href="/opportunities?section=${id}" class="${id === section ? "active" : ""}" ${id === section ? 'aria-current="page"' : ""}>${escapeHtml(label)}</a>`).join("");
  return `<nav class="opportunity-navigation" aria-label="Seções"><div class="opportunity-view-tabs"><div class="tabs">${links(primary)}</div></div><details class="page-secondary-navigation" ${secondaryActive ? "open" : ""}><summary>${secondaryActive ? escapeHtml(secondaryActive[1]) : "Mais visões"}</summary><div>${links(secondary)}</div></details></nav>`;
}

function opportunityListMarkup(section, opportunities) {
  const ordered = orderedOpportunities(section, opportunities);
  if (!ordered.length) return opportunityEmpty();
  return ordered
    .map((item) =>
      section === "all"
        ? compactOpportunityRecord(item)
        : opportunityCard({ ...item, excludedView: section === "excluded" }),
    )
    .join("");
}

function replaceOpportunityList(root, section, opportunities) {
  const list = root.querySelector(
    section === "all" ? ".compact-record-list" : ".opportunity-list",
  );
  if (list) list.innerHTML = opportunityListMarkup(section, opportunities);
}

async function loadMoreOpportunities({ root, section, opportunities, visible, button }) {
  button.disabled = true;
  button.textContent = "Carregando…";
  const data = await api(
      opportunityCardsPath(section, {
        offset: visible,
        limit: opportunityPageSize(section),
      }),
    ),
    next = data.opportunities || [],
    list = root.querySelector(
      section === "all" ? ".compact-record-list" : ".opportunity-list",
    );
  opportunities.push(...next);
  list?.insertAdjacentHTML("beforeend", opportunityListMarkup(section, next));
  const nextVisible = visible + next.length;
  button.disabled = false;
  button.textContent = "Mostrar mais oportunidades";
  button.hidden = !data.pagination?.hasMore;
  bindOpportunityListActions(root, () => renderOpportunities({ root }));
  bindBatchSelection(root, opportunities, section);
  return nextVisible;
}
function bindOpportunityListActions(root, refresh) {
  root.querySelectorAll("[data-verify-opportunity]:not([data-opportunity-action-bound])").forEach((button) => {
    button.dataset.opportunityActionBound = "true";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Verificando…";
      try {
        const result = await api(`/api/opportunities/${encodeURIComponent(button.dataset.verifyOpportunity)}/verify`, { method: "POST" });
        toast(result.availability?.status === "CLOSED" ? "A vaga foi marcada como encerrada." : result.availability?.status === "AVAILABLE" ? "Disponibilidade confirmada." : "O portal não permitiu confirmar a vaga.", result.availability?.status === "CLOSED" ? "error" : "default");
        await refresh();
      } catch (error) {
        button.disabled = false;
        button.textContent = "Verificar agora";
        toast(error.message, "error");
      }
    });
  });
  root.querySelectorAll("[data-analyze-opportunity]:not([data-opportunity-action-bound])").forEach((button) => {
    button.dataset.opportunityActionBound = "true";
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Analisando…";
      try {
        await api("/api/unified/ats", { method: "POST", body: JSON.stringify({ jobId: button.dataset.analyzeOpportunity, resumeId: null }) });
        toast("Análise concluída.");
        location.href = `/opportunities/${encodeURIComponent(button.dataset.analyzeOpportunity)}?tab=analysis`;
      } catch (error) {
        button.disabled = false;
        button.textContent = "Analisar";
        toast(error.message, "error");
      }
    });
  });
}
function discoverPanel(capabilities = {}) {
  const active = capabilities.activeSearchIntent || {},
    activeFamilies = new Set(active.families || []),
    activeSeniorities = new Set(active.seniorities || []),
    activeLocations = active.locationPolicy?.priorities || [],
    activeBudget = active.queryBudget || {};
  const labels = {
      STRUCTURED_ATS: "ATS estruturado",
      JOB_BOARD: "Portais de vagas",
      OFFICIAL_CAREER_PAGE: "Carreiras oficiais",
      PUBLIC_WEB: "Web pública",
      NEWS_BLOG_HIRING_SIGNAL: "Blogs e notícias",
      PUBLIC_SOCIAL_SIGNAL: "Sinal social público",
      RECRUITER_PUBLIC_SIGNAL: "Sinal de recrutador",
      COMMUNITY_WHATSAPP_GROUP: "Grupos WhatsApp",
      INTERNSHIP_PORTAL: "Portais de estágio",
      CONSULTANCY_STAFFING: "Consultorias e staffing",
      EXTERNAL_FORM: "Formulários externos",
      MANUAL_LEAD_CAPTURE: "Captura manual",
    },
    availability = new Map(
      (capabilities.sourceClasses || []).map((item) => [
        item.sourceClass,
        item,
      ]),
    ),
    sourceOptions = Object.keys(labels)
      .map((sourceClass) => {
        const item = availability.get(sourceClass) || {};
        return `<label class="check"><input type="checkbox" name="sourceClasses" value="${sourceClass}" ${item.defaultSelected ? "checked" : ""} /> <span><strong>${escapeHtml(labels[sourceClass])}</strong><small>${escapeHtml(statusLabel(item.status || "UNKNOWN"))}</small></span></label>`;
      })
      .join(""),
    providerOptions = (capabilities.providers || [])
      .map(
        (item) =>
          `<label class="check"><input type="checkbox" name="providers" value="${escapeHtml(item.providerId)}" /> <span><strong>${escapeHtml(item.displayName)}</strong><small>${escapeHtml(statusLabel(item.status || "UNKNOWN"))} · ${escapeHtml(item.discoveryMode || "")}</small></span></label>`,
      )
      .join("");
  const familyOptions = (capabilities.jobFamilies || [])
    .map(
      (item) =>
        `<label class="check"><input type="checkbox" name="families" value="${escapeHtml(item.id)}" ${["BACKEND", "DEVOPS_SRE", "SOFTWARE_INTERNSHIP"].includes(item.id) ? "checked" : ""}/> <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.aliases?.slice(0, 2).join(" · ") || "")}</small></span></label>`,
    )
    .join("");
  return `<section class="simple-search-panel"><div><p class="eyebrow">Buscar vagas</p><h2>O que você está procurando?</h2><p>Pesquise nas fontes gratuitas configuradas sem escolher provedores, budgets ou thresholds.</p><div class="button-row"><a class="button quiet" data-link href="/analyze">Adicionar vaga por link ou texto</a></div></div><form id="manual-discovery" class="task-form"><label><span>Cargo, tecnologia ou função</span><input name="query" required minlength="2" placeholder="Software Engineer" /></label><label><span>Onde?</span><input name="location" value="Portugal" /></label><fieldset><legend>Regiões aceitas</legend><div class="choice-grid"><label class="check"><input type="checkbox" name="geographies" value="LOCAL_LISBON" checked /> Lisboa</label><label class="check"><input type="checkbox" name="geographies" value="LOCAL_PORTO" checked /> Porto</label><label class="check"><input type="checkbox" name="geographies" value="LOCAL_BRAGA" /> Braga</label><label class="check"><input type="checkbox" name="geographies" value="REMOTE_PORTUGAL" checked /> Remoto Portugal</label><label class="check"><input type="checkbox" name="geographies" value="LOCAL_DF" /> Brasília e região</label><label class="check"><input type="checkbox" name="geographies" value="REMOTE_BRAZIL" /> Remoto Brasil</label></div></fieldset><input type="hidden" name="hoursOld" value="168" /><input type="hidden" name="limit" value="20" /><button class="button primary" type="submit">${icon("search")} Buscar vagas</button><div class="search-progress" data-search-progress role="status" aria-live="polite" hidden><div class="search-progress-track"><span></span></div><strong>Aguardando início da busca.</strong></div><p id="discovery-status" class="form-status" role="status"></p></form></section><section class="discovery-panel"><div><p class="eyebrow">Busca avançada</p><h2>Configurações avançadas da busca</h2><p>Search Intent, fontes, thresholds e Mass Hunt continuam disponíveis para quem precisa de controle técnico.</p><div class="button-row"><button class="button" type="button" data-open-composer>Configurar busca avançada</button><button class="button quiet" type="button" data-open-signal>Capturar sinal manual</button></div></div><div class="source-wizard-summary"><strong>Sem dependência paga</strong><p>Brave é externo, pago e opcional, desativado por padrão. Sessões de LinkedIn e outros portais não são inspecionadas.</p><a class="button quiet" data-link href="/connections">Gerenciar fontes e conexões</a></div></section>
  <dialog id="search-composer" class="wide-dialog"><form method="dialog" class="dialog-card composer-form"><header><div><p class="eyebrow">Search Composer V4.1</p><h2>Busca omni-source</h2><p>Famílias, senioridade, geografia e fontes compõem uma consulta versionada.</p></div><button class="icon-button" value="cancel" aria-label="Fechar">×</button></header><fieldset><legend>Famílias profissionais</legend><p class="field-help">Selecione uma ou mais famílias do catálogo canônico.</p><div class="choice-grid">${familyOptions}</div></fieldset><label><span>Termos adicionais (opcional)</span><input name="customTerms" placeholder="Kubernetes, Java, AWS" /></label><fieldset><legend>Senioridades</legend><div class="choice-grid">${["INTERNSHIP", "JUNIOR", "MID", "SENIOR"].map((value) => `<label class="check"><input type="checkbox" name="seniorities" value="${value}" ${["INTERNSHIP", "JUNIOR"].includes(value) ? "checked" : ""}/> ${statusLabel(value)}</label>`).join("")}</div></fieldset><fieldset><legend>Localizações priorizadas</legend><div class="location-policy-editor">${[{location:"Portugal",model:"REMOTE",scope:"Portugal"},{location:"Lisboa, Portugal",model:"HYBRID",scope:""},{location:"Porto, Portugal",model:"HYBRID",scope:""}].map((item,index) => `<div><strong>Prioridade ${index+1}</strong><input name="location${index+1}" value="${item.location}" placeholder="Cidade, estado ou país"/><select name="model${index+1}"><option value="REMOTE" ${item.model==="REMOTE"?"selected":""}>Remoto</option><option value="HYBRID" ${item.model==="HYBRID"?"selected":""}>Híbrido</option><option value="ONSITE">Presencial</option></select><input name="scope${index+1}" value="${item.scope}" placeholder="Escopo remoto"/></div>`).join("")}</div></fieldset><fieldset><legend>Classes de fonte</legend><div class="choice-grid source-class-grid">${sourceOptions}</div><a class="button quiet" data-link href="/connections">Gerenciar fontes e conexões</a></fieldset>${providerOptions ? `<fieldset><legend>Fontes regionais e ATS</legend><p class="field-help">Selecione explicitamente. Nenhuma fonte nova é ativada só por estar pronta.</p><div class="choice-grid source-class-grid">${providerOptions}</div></fieldset>` : ""}<div class="policy-thresholds"><label><span>Considerar</span><input name="consider" type="number" min="0" max="100" value="70"/></label><label><span>Preparar currículo</span><input name="prepareResume" type="number" min="0" max="100" value="82"/></label><label><span>Notificar</span><input name="notify" type="number" min="0" max="100" value="90"/></label><label><span>Prioridade</span><input name="priority" type="number" min="0" max="100" value="85"/></label><label><span>Máx. queries</span><input name="maxQueries" type="number" min="1" max="30" value="12"/></label></div><div class="button-row"><button class="button" type="button" data-composer-action="preview">Pré-visualizar queries</button><button class="button" type="button" data-composer-action="test">Testar busca</button><button class="button primary" type="button" data-composer-action="mass">Executar Mass Hunt</button></div><div class="query-preview" data-composer-output hidden></div><p class="form-status" role="status"></p></form></dialog>
  <dialog id="manual-signal-dialog" class="wide-dialog"><form method="dialog" class="dialog-card" id="manual-signal-form"><header><div><p class="eyebrow">Manual Signal Capture</p><h2>Registrar URL ou texto público</h2><p>Use para sinais públicos, recrutadores, formulários ou grupos. Fatos ausentes continuam desconhecidos.</p></div><button class="icon-button" value="cancel" aria-label="Fechar">×</button></header><div class="form-grid"><label><span>Classe</span><select name="sourceClass"><option>MANUAL_LEAD_CAPTURE</option><option>PUBLIC_SOCIAL_SIGNAL</option><option>RECRUITER_PUBLIC_SIGNAL</option><option>NEWS_BLOG_HIRING_SIGNAL</option><option>EXTERNAL_FORM</option></select></label><label><span>URL pública</span><input name="url" type="url"/></label><label><span>Empresa (se conhecida)</span><input name="company"/></label><label><span>Método</span><select name="applicationMethod"><option>UNKNOWN</option><option>EMAIL</option><option>WHATSAPP</option><option>DIRECT_MESSAGE</option><option>EXTERNAL_FORM</option><option>CAREER_PAGE</option></select></label></div><label><span>Texto ou trecho fornecido por você</span><textarea name="text" rows="7"></textarea></label><button class="button primary" type="submit">Salvar para revisão</button><p class="form-status" role="status"></p></form></dialog>`;
}
function applyActiveSearchIntent(root, intent) {
  if (!intent) return;
  const form = root.querySelector("#search-composer form");
  if (!form) return;
  for (const input of form.querySelectorAll('[name="families"]'))
    input.checked = (intent.families || []).includes(input.value);
  for (const input of form.querySelectorAll('[name="seniorities"]'))
    input.checked = (intent.seniorities || []).includes(input.value);
  (intent.locationPolicy?.priorities || [])
    .slice(0, 3)
    .forEach((item, index) => {
      const priority = index + 1;
      if (form.elements[`location${priority}`])
        form.elements[`location${priority}`].value = item.location || "";
      if (form.elements[`model${priority}`])
        form.elements[`model${priority}`].value = item.workModel || "REMOTE";
      if (form.elements[`scope${priority}`])
        form.elements[`scope${priority}`].value = item.remoteScope || "";
    });
  if (intent.queryBudget?.maxQueries)
    form.elements.maxQueries.value = intent.queryBudget.maxQueries;
  for (const [name, value] of Object.entries(intent.thresholds || {}))
    if (form.elements[name] && Number.isFinite(Number(value)))
      form.elements[name].value = value;
}
function discoveryDiagnostics(data) {
  const run = data?.latestRun,
    report = run?.report || {},
    f = report.funnel || {},
    planner = report.queryPlanner || {},
    sources = report.sourceReports || [];
  if (!run)
    return `<section class="settings-panel"><h2>Diagnóstico de descoberta</h2><div class="calm-state"><h3>Nenhuma execução persistida</h3><p>Execute uma busca controlada para produzir registros por consulta, geografia, fonte e portal.</p></div></section>`;
  return `<section class="settings-panel discovery-diagnostics"><div class="section-heading"><div><p class="eyebrow">Relatório de busca de vagas</p><h2>Última execução</h2><p>${escapeHtml(formatDate(run.startedAt))}${technicalDetails({runId:run.id})}</p></div>${pill(statusLabel(run.status), run.status === "COMPLETED" ? "success" : "attention")}</div><div class="diagnostic-grid"><article><small>Brutas</small><strong>${f.rawDiscoveries || 0}</strong></article><article><small>Canônicas</small><strong>${f.canonicalOpportunities || 0}</strong></article><article><small>Descoberta humana</small><strong>${f.humanDiscoveryOpportunities ?? f.relevantOpportunities ?? 0}</strong></article><article><small>Elegíveis à automação</small><strong>${f.automationEligibleOpportunities ?? 0}</strong></article><article><small>Limite efetivo</small><strong>${planner.effectiveQueryBudget || 0} / ${planner.configuredQueryBudget || 0}</strong></article><article><small>Cobertura</small><strong>${planner.coverage?.searchedCombinations?.length || 0} / ${planner.requiredCombinationCount || 0}</strong></article></div>${(planner.diagnostics || []).map((item) => `<div class="safety-banner"><strong>${escapeHtml(statusLabel(item.code))}</strong><span>${escapeHtml(item.message)}</span></div>`).join("")}<h3>Fontes e portais</h3><div class="compact-record-list">${sources.map((source) => `<article><strong>${escapeHtml(source.provider)}</strong><span>${escapeHtml(statusLabel(source.status))} · ${source.rawResults || 0} resultado(s)</span>${(source.sites || []).map((site) => `<small>${escapeHtml(site.site || site.source)}: ${escapeHtml(statusLabel(site.status))} · ${site.acceptedResults || 0} aceitas · ${site.durationMs || 0} ms</small>`).join("")}</article>`).join("")}</div><div class="button-row"><a class="button primary" href="/settings?section=logs&runId=${encodeURIComponent(run.id)}">Abrir logs desta execução</a></div><details><summary>Detalhes técnicos</summary><pre>${escapeHtml(JSON.stringify({ planner, funnel: f, companyRadar: data.companyRadar }, null, 2))}</pre></details></section>`;
}
function orderedOpportunities(section, opportunities) {
  if (section === "all") return opportunities;
  const active = opportunities.filter(
    (item) => !isExcludedOpportunity(item) && !item.feedback?.userDecision,
  );
  const selected = section === "decisions"
    ? opportunities.filter((item) => item.feedback?.userDecision)
    : section === "excluded"
    ? opportunities.filter(isExcludedOpportunity)
    : section === "recommended"
      ? active.filter((item) => ["RECOMMENDED", "PREPARE_ELIGIBLE"].includes(item.decision?.disposition))
      : section === "review"
        ? active.filter((item) => item.decision?.disposition === "REVIEW")
        : section === "stretch"
          ? active.filter((item) => item.decision?.disposition === "STRETCH")
          : active;
  if (section === "priority")
    return [...selected].sort((a, b) => (b.priority?.score || 0) - (a.priority?.score || 0));
  if (section === "excluded")
    return [...selected].sort(
      (a, b) =>
        new Date(b.job?.lastSeenAt || b.job?.updatedAt || 0) -
        new Date(a.job?.lastSeenAt || a.job?.updatedAt || 0),
    );
  return selected;
}
function opportunitiesContent(
  section,
  opportunities,
  capabilities,
  diagnostics,
  total = opportunities.length,
  automation = null,
) {
  if (section === "diagnostics") return discoveryDiagnostics(diagnostics);
  if (section === "companies") return companiesView(opportunities);
  if (section === "history") return opportunityHistory(opportunities, automation);
  if (section === "all") return allOpportunitiesView(opportunities, total);
  const ordered = orderedOpportunities(section, opportunities);
  const headings = {
      priority: [
        "Prioridade calculada",
        "Ordenação interna preservada por match, confiança, frescor, preferências e esforço.",
      ],
      recommended: [
        "Recomendadas",
        "Sem bloqueadores confirmados e com aderência suficiente para investir energia.",
      ],
      review: [
        "Vale revisar",
        "Oportunidades plausíveis que pedem contexto ou evidência humana.",
      ],
      stretch: [
        "Oportunidade de desenvolvimento",
        developmentOpportunityExplanation,
      ],
      decisions: [
        "Minhas decisões",
        "Vagas em que você registrou interesse, dúvida ou rejeição. Esses sinais calibram as próximas recomendações.",
      ],
      excluded: [
        "Excluídas",
        "Bloqueadas, incompatíveis ou encerradas ficam fora das filas principais, mas continuam disponíveis para consulta.",
      ],
    },
    heading = headings[section] || [
      "Fila útil para avaliar",
      "Resultados ranqueados para decisão. Oportunidades bloqueadas, incompatíveis ou encerradas ficam em Excluídas.",
    ];
  return `${section === "discover" ? `${automationStatusMarkup(automation)}${discoverPanel(capabilities)}<section class="section-intro opportunity-queue-intro"><div><p class="eyebrow">Fila de avaliação</p><h2>${heading[0]}</h2><p>${heading[1]}</p></div></section>` : `<section class="section-intro"><div><p class="eyebrow">${section === "excluded" ? "Consulta secundária" : section === "decisions" ? "Preferências registradas" : "Fila de avaliação"}</p><h2>${heading[0]}</h2><p>${heading[1]}</p></div></section>`}<div class="list-toolbar"><div><strong data-opportunity-total>${total}</strong> ${section === "excluded" ? "oportunidades excluídas da triagem" : section === "decisions" ? "decisões registradas" : "oportunidades para esta fila"}</div><label class="search-field">${icon("search")}<span class="sr-only">Filtrar oportunidades</span><input type="search" placeholder="Cargo, empresa ou tecnologia" data-filter-opportunities /></label></div><section class="opportunity-list" aria-label="${section === "excluded" ? "Oportunidades excluídas" : section === "decisions" ? "Minhas decisões" : "Oportunidades"}">${opportunityListMarkup(section, opportunities)}</section>${total > opportunities.length ? '<button class="button load-more" type="button" data-load-more>Mostrar mais oportunidades</button>' : ""}`;
}

function automationStatusMarkup(automation = {}) {
  const profiles = automation?.profiles || [],
    profile = profiles.find((item) => item.enabled) || profiles[0],
    runs = automation?.recentRuns || [],
    running = runs.find((item) => item.status === "RUNNING"),
    latest = profile ? runs.find((item) => item.profileId === profile.id) : runs[0],
    state = running ? "Executando agora" : profile?.enabled ? "Automação ativa" : profile ? "Automação pausada" : "Não configurada",
    tone = running ? "attention" : profile?.enabled ? "success" : "neutral";
  return `<section class="automation-truth-strip"><div><p class="eyebrow">Renovação automática</p><strong>${escapeHtml(state)}</strong><span>${profile?.enabled && profile.nextRunAt ? `Próxima rodada: ${escapeHtml(formatDate(profile.nextRunAt))}` : profile ? "Execução somente manual no momento" : "Crie um perfil para programar buscas"}</span></div>${pill(state, tone)}<div><small>Última execução</small><strong>${latest ? escapeHtml(formatDate(latest.completedAt || latest.startedAt)) : "Nunca executada"}</strong><span>${latest ? `${latest.discoveredCount || 0} encontrada(s) · ${latest.duplicateCount || 0} duplicada(s)` : "Sem histórico"}</span></div><a class="button quiet" data-link href="/autopilot?section=profiles">Configurar</a></section>`;
}

export function isExcludedOpportunity(item = {}) {
  const lifecycleStatus =
    item.job?.lifecycleStatus || item.freshness?.lifecycleStatus;
  return (
    ["BLOCKED", "SKIP"].includes(item.decision?.disposition) ||
    lifecycleStatus === "CLOSED" ||
    item.freshness?.status === "CLOSED"
  );
}

function composerPayload(form) {
  const checked = (name) =>
      [...form.querySelectorAll(`[name="${name}"]:checked`)].map(
        (item) => item.value,
      ),
    values = Object.fromEntries(new FormData(form)),
    priorities = [1, 2, 3]
      .map((priority) => ({
        priority,
        location: values[`location${priority}`],
        workModel: values[`model${priority}`],
        remoteScope: values[`scope${priority}`],
        accepted: true,
      }))
      .filter((item) => item.location || item.workModel === "REMOTE");
  return {
    families: checked("families"),
    customTerms: String(values.customTerms || "").split(","),
    seniorities: checked("seniorities"),
    sourceClasses: checked("sourceClasses"),
    providers: checked("providers"),
    languages: ["pt-BR", "en"],
    locationPolicy: { priorities, allowOnsiteOutsideArea: false },
    thresholds: {
      consider: Number(values.consider),
      prepareResume: Number(values.prepareResume),
      notify: Number(values.notify),
      priority: Number(values.priority),
    },
    queryBudget: {
      ...currentQueryBudget,
      maxQueries: Number(values.maxQueries),
    },
  };
}
function composerResult(result, action) {
  if (action === "preview")
    return `<div class="composer-summary"><strong>${result.structuredQueries?.length || 0}</strong><span>consultas estruturadas</span><strong>${result.publicWebQueries?.length || 0}</strong><span>consultas web</span><strong>${result.budget?.maxQueries || 0}</strong><span>budget de queries</span><strong>${result.budget?.maxRequests || 0}</strong><span>budget de requests</span></div><p>${result.summary?.operational || 0} de ${result.summary?.requested || 0} classes estão operacionais.${result.truncated ? " O budget efetivo truncou a expansão." : ""}</p><ul class="plain-list">${(
      result.structuredQueries || []
    )
      .slice(0, 5)
      .map((item) => `<li>${escapeHtml(item.query)}</li>`)
      .join(
        "",
      )}</ul><details><summary>Ver detalhes técnicos</summary><pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre></details>`;
  const f = result.funnel || result.metrics || {};
  const discarded =
    (f.roleMismatch || 0) +
    (f.locationMismatch || 0) +
    (f.seniorityMismatch || 0) +
    (f.stale || 0) +
    (f.nonJob || 0);
  const noisy = (result.relevance?.queryDiagnostics || []).filter(
    (item) => item.suggestion,
  );
  return `<div class="composer-summary"><strong>${f.rawDiscoveries || 0}</strong><span>encontradas</span><strong>${f.canonicalOpportunities || 0}</strong><span>únicas</span><strong>${discarded}</strong><span>descartadas por relevância</span><strong>${f.matchEvaluated || 0}</strong><span>analisadas</span><strong>${f.relevantOpportunities || 0}</strong><span>relevantes</span><strong>${f.priorityOpportunities || 0}</strong><span>prioritárias</span></div><p>${result.summary?.consulted || 0} classe(s) realmente consultada(s); ${result.summary?.noTargets || 0} sem alvos e ${result.summary?.configRequired || 0} aguardando configuração.</p><details><summary>Entender descartes e revisão</summary><ul class="plain-list"><li>Família incompatível: ${f.roleMismatch || 0}</li><li>Localização incompatível: ${f.locationMismatch || 0}</li><li>Senioridade incompatível: ${f.seniorityMismatch || 0}</li><li>Antigas: ${f.stale || 0}</li><li>Não são vagas: ${f.nonJob || 0}</li><li>Precisam de revisão: ${f.needsReview || 0}</li></ul>${noisy.length ? `<p><strong>Consultas a refinar</strong></p><ul class="plain-list">${noisy.map((item) => `<li>${escapeHtml(item.query)}: ${Math.round(item.rejectionRate * 100)}% descartadas</li>`).join("")}</ul>` : ""}</details><details><summary>Ver detalhes técnicos</summary><pre>${escapeHtml(JSON.stringify({ funnel: f, summary: result.summary, reports: result.reports }, null, 2))}</pre></details>`;
}

function preMatchReason(reason) {
  return (
    {
      ROLE_FAMILY_MISMATCH: "família profissional incompatível",
      LOCATION_MISMATCH: "localização fora da política",
      FOREIGN_LOCATION: "a vaga exige trabalho fora das regiões aceitas",
      OUTSIDE_ACCEPTED_REGION: "localização fora das regiões configuradas",
      WORK_MODEL_UNKNOWN: "modalidade de trabalho não identificada",
      WORK_MODEL_MISMATCH: "modalidade fora das preferências configuradas",
      LOCATION_UNKNOWN: "localização não confirmada",
      LOCATION_CONFLICT: "informações de localização conflitantes",
      SENIORITY_MISMATCH: "senioridade incompatível",
      STALE: "anúncio antigo",
      NON_JOB_CONTENT: "conteúdo não classificado como vaga",
      JOB_CLOSED: "vaga encerrada",
      INSUFFICIENT_INFORMATION: "informações insuficientes",
    }[reason] || statusLabel(reason || "revisão necessária")
  );
}
function decisionReason(reason) {
  return (
    {
      MATERIAL_GAP_PRESENT:
        "Há requisito obrigatório ou importante sem evidência suficiente.",
      BLOCKING_GAP_PRESENT:
        "Há incompatibilidade explícita em requisito obrigatório.",
      MID_SENIORITY_DISTANCE:
        "A vaga plena exige avaliar a distância de senioridade.",
      FAMILY_ADJACENT: "A família é adjacente, não uma correspondência direta.",
      LOW_CONFIDENCE: "A evidência ainda tem baixa confiança.",
      LOW_EVIDENCE_COVERAGE: "A cobertura de evidências ainda é baixa.",
      BELOW_CONSIDER_THRESHOLD:
        "A aderência está abaixo do threshold de considerar.",
      MISSING_ANALYSIS: "A oportunidade ainda precisa de análise técnica.",
      EXACT_PRIMARY_FIT: "Família principal alinhada ao perfil.",
      SECONDARY_FAMILY_FIT: "Família secundária alinhada ao perfil.",
      LEARNABLE_GAPS_ONLY: "As lacunas restantes são aprendíveis.",
      NON_MATERIAL_UNRESOLVED_REQUIREMENTS:
        "Há critérios sem criticidade comprovada para revisar.",
      UNKNOWN_FAMILY_FIT: "Família profissional precisa de revisão.",
      MID_SENIORITY_STRETCH: "Senioridade plena exige avaliação consciente.",
      UNKNOWN_REMOTE_SCOPE: "Escopo remoto precisa de confirmação.",
    }[reason] || preMatchReason(reason)
  );
}

function availabilityVerificationMarkup(run = null) {
  if (!run) return '<section class="availability-verification" data-availability-verification hidden></section>';
  const running = run.status === "RUNNING",
    total = Number(run.verificationTotal || 0),
    checked = Number(run.verificationChecked || 0),
    progress = running
      ? run.stage === "VERIFYING" && total
        ? Math.min(95, Math.round((checked / total) * 90) + 5)
        : 5
      : 100,
    title = run.stage === "REBUILDING"
      ? "Atualizando as filas"
      : running
        ? "Verificando anúncios por prioridade"
        : run.status === "FAILED"
          ? "A verificação foi interrompida"
          : "Verificação concluída";
  return `<section class="availability-verification is-${running ? "running" : run.status === "FAILED" ? "error" : "complete"}" data-availability-verification aria-live="polite"><div><span class="status-symbol ${running ? "pending" : "complete"}">${icon(running ? "clock" : "check")}</span><div><strong>${escapeHtml(title)}</strong><small>${running ? "Você pode continuar usando o sistema." : `${checked} anúncio(s) consultado(s) nesta rodada.`}</small></div><b>${progress}%</b></div><div class="daily-refresh-track" role="progressbar" aria-label="Progresso da verificação de vagas" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div>${run.stage === "VERIFYING" || !running ? `<div class="availability-verification-metrics"><span><strong>${checked}</strong> verificadas</span><span><strong>${run.availableCount || 0}</strong> ativas</span><span><strong>${run.closedCount || 0}</strong> encerradas</span><span><strong>${run.inconclusiveCount || 0}</strong> inconclusivas</span><span><strong>${run.remainingCount || 0}</strong> aguardando</span></div>` : ""}${!running && run.remainingCount ? '<small>Execute novamente para verificar o próximo lote, mantendo prioridade e limites seguros para os portais.</small>' : ""}</section>`;
}

function bindAvailabilityVerification(root, initialRun = null) {
  const generation = ++availabilityPollGeneration;
  let timer = 0,
    runId = initialRun?.id || localStorage.getItem(AVAILABILITY_RUN_KEY) || "";
  const button = root.querySelector("[data-verify-active-jobs]");
  const render = (run) => {
    const current = root.querySelector("[data-availability-verification]");
    if (current) current.outerHTML = availabilityVerificationMarkup(run);
  };
  const monitor = async (id) => {
    if (!id || !root.isConnected || generation !== availabilityPollGeneration) return;
    clearTimeout(timer);
    try {
      const { run } = await api(`/api/opportunities/verify/${encodeURIComponent(id)}`, { cache: false });
      render(run);
      if (run.status !== "RUNNING") {
        localStorage.removeItem(AVAILABILITY_RUN_KEY);
        if (button) {
          button.disabled = false;
          button.innerHTML = `${icon("refresh")} Verificar vagas ativas`;
        }
        const message = run.status === "FAILED" ? "A verificação terminou com erro; nenhuma vaga foi encerrada por suposição." : `Verificação concluída: ${run.availableCount || 0} ativas e ${run.closedCount || 0} encerradas.`;
        await renderOpportunities({ root });
        toast(message, run.status === "FAILED" ? "error" : "success");
        return;
      }
      timer = setTimeout(() => monitor(id), 1500);
    } catch (error) {
      toast(`Não foi possível acompanhar a verificação: ${error.message}`, "error");
      timer = setTimeout(() => monitor(id), 4000);
    }
  };
  button?.addEventListener("click", async () => {
    button.disabled = true;
    button.innerHTML = `${icon("refresh")} Iniciando verificação`;
    try {
      const { run } = await api("/api/opportunities/verify", { method: "POST", body: "{}" });
      runId = run.id;
      localStorage.setItem(AVAILABILITY_RUN_KEY, runId);
      render(run);
      monitor(runId);
    } catch (error) {
      button.disabled = false;
      button.innerHTML = `${icon("refresh")} Verificar vagas ativas`;
      toast(error.message, "error");
    }
  });
  if (runId) monitor(runId);
  root.__availabilityCleanup = () => {
    clearTimeout(timer);
    if (generation === availabilityPollGeneration) availabilityPollGeneration++;
  };
}

function massHuntPanelMarkup() {
  return `<aside class="hunt-live-panel" data-mass-hunt-panel hidden aria-hidden="true" aria-label="Acompanhamento da busca em massa"><header><div><p class="eyebrow">Radar de oportunidades</p><h2>Caça em massa</h2></div><div class="hunt-panel-actions"><button class="button quiet" type="button" data-pause-mass-hunt>Pausar</button><button class="icon-button hunt-minimize" type="button" data-minimize-mass-hunt aria-label="Minimizar radar" title="Minimizar radar">${icon("arrow")}</button></div></header><div data-mass-hunt-body><p class="muted">Localizando a execução no servidor…</p></div></aside><button class="hunt-minimized-launcher" type="button" data-restore-mass-hunt hidden aria-label="Reabrir radar de oportunidades">${icon("arrow")}<span><small>Radar</small><strong>Ver busca em andamento</strong></span></button>`;
}

function massHuntRunBody(run, logs = [], error = "") {
  const progress = run?.report?.progress || {},
    portals = (run?.report?.sourceReports || []).flatMap((item) => item.sites || []),
    discoveries = run?.report?.recentDiscoveries || progress.recentDiscoveries || [],
    finished = ["COMPLETED", "PARTIAL", "FAILED", "SKIPPED"].includes(run?.status),
    completed = Number(progress.completedRequests || 0),
    planned = Math.max(1, Number(progress.plannedQueries || run?.queryCount || 1)),
    stage = progress.stage || run?.status || "PLANNED",
    stageLabels = { PLANNED: "Preparando rotas de busca", DISCOVERY: "Caçando nas fontes", MATCHING: "Comparando com seu perfil", DECISION: "Montando o ranking", COMPLETED: "Rodada concluída", PARTIAL: "Concluída com limitações", FAILED: "Rodada interrompida", SKIPPED: "Rodada não iniciada" },
    percent = finished ? 100 : stage === "DISCOVERY" ? Math.min(62, 14 + Math.round((completed / planned) * 48)) : stage === "MATCHING" ? 75 : stage === "DECISION" ? 90 : 8;
  if (error)
    return `<div class="partial-banner" role="status"><strong>Reconectando ao acompanhamento</strong><span>${escapeHtml(error)}. A execução não foi cancelada.</span></div>`;
  if (!run) return '<p class="muted">Aguardando dados da execução…</p>';
  return `<div class="hunt-live-status"><span class="hunt-pulse" aria-hidden="true"></span><div><strong>${escapeHtml(stageLabels[stage] || "Busca em andamento")}</strong><small>${finished ? "O resultado permanece salvo no Histórico." : "A execução continua mesmo se você navegar."}</small></div><b>${percent}%</b></div><div class="hunt-live-track" role="progressbar" aria-label="Progresso da busca em massa" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div><div class="hunt-scoreboard"><div><strong>${progress.partialDiscoveredCount ?? run.rawCount ?? run.discoveredCount ?? 0}</strong><span>encontradas</span></div><div><strong>${progress.partialCanonicalCount ?? run.canonicalCount ?? 0}</strong><span>únicas</span></div><div><strong>${run.matchedCount || 0}</strong><span>relevantes</span></div></div>${discoveries.length ? `<section class="hunt-discoveries"><h3>Vagas chegando agora</h3><ol>${discoveries.slice(0, 6).map((item, index) => `<li><span class="hunt-job-rank">${index + 1}</span><div><strong>${escapeHtml(item.title || "Oportunidade")}</strong><small>${escapeHtml([item.company, item.location].filter(Boolean).join(" · "))}</small><em>${escapeHtml(item.source || "fonte")}</em></div></li>`).join("")}</ol></section>` : '<p class="muted">Ainda não chegou uma vaga válida nesta rodada.</p>'}${portals.length ? `<details><summary>Fontes consultadas</summary><ul class="plain-list">${portals.slice(-10).map((item) => `<li>${escapeHtml(item.site || item.source || "portal")}: ${escapeHtml(statusLabel(item.status))} · ${item.acceptedResults || 0} resultado(s)</li>`).join("")}</ul></details>` : ""}${logs.length ? `<details><summary>Atividade recente</summary><ul class="plain-list">${logs.slice(0, 12).map((item) => `<li>${escapeHtml(item.message || item.event)} · ${escapeHtml(statusLabel(item.status))}</li>`).join("")}</ul></details>` : ""}${finished ? '<div class="hunt-finish-actions"><a class="button primary" data-link href="/opportunities?section=recommended">Ver ranking atualizado</a><a class="button quiet" data-link href="/opportunities?section=history">Ver histórico</a></div>' : ""}`;
}

function setMassHuntButtons(root, runId = "") {
  root.querySelectorAll("[data-open-mass-hunt]").forEach((button) => {
    button.dataset.activeRunId = runId;
    button.innerHTML = runId ? `${icon("search")} Ver busca em andamento` : `${icon("search")} Busca em massa`;
  });
}

function bindMassHuntPanel(root) {
  root.__massHuntCleanup?.();
  const generation = ++massHuntPollGeneration,
    panel = root.querySelector("[data-mass-hunt-panel]"),
    launcher = root.querySelector("[data-restore-mass-hunt]"),
    body = panel?.querySelector("[data-mass-hunt-body]");
  let timer = 0;
  const minimized = () => localStorage.getItem(MASS_HUNT_MINIMIZED_KEY) === "true";
  const hide = () => {
    if (panel) { panel.hidden = true; panel.setAttribute("aria-hidden", "true"); }
    if (launcher) launcher.hidden = true;
  };
  const show = ({ forceOpen = false } = {}) => {
    if (!root.__massHuntRunId) { hide(); return; }
    if (forceOpen) localStorage.removeItem(MASS_HUNT_MINIMIZED_KEY);
    const collapsed = !forceOpen && minimized();
    if (panel) { panel.hidden = collapsed; panel.setAttribute("aria-hidden", String(collapsed)); }
    if (launcher) launcher.hidden = !collapsed;
  };
  const minimize = () => {
    localStorage.setItem(MASS_HUNT_MINIMIZED_KEY, "true");
    show();
  };
  const monitor = async (runId) => {
    if (!runId || !root.isConnected || generation !== massHuntPollGeneration) return;
    clearTimeout(timer);
    root.__massHuntRunId = runId;
    setMassHuntButtons(root, runId);
    try {
      const { run, logs = [] } = await api(`/api/job-hunt/runs/${encodeURIComponent(runId)}`, { cache: false });
      if (["COMPLETED", "PARTIAL", "FAILED", "SKIPPED"].includes(run.status)) {
        localStorage.removeItem(MASS_HUNT_RUN_KEY);
        root.__massHuntRunId = "";
        hide();
        setMassHuntButtons(root);
        return;
      }
      show();
      if (body) body.innerHTML = massHuntRunBody(run, logs);
      timer = setTimeout(() => monitor(runId), 2500);
    } catch (error) {
      hide();
      timer = setTimeout(() => monitor(runId), 4000);
    }
  };
  const attach = (runId, { forceOpen = false } = {}) => {
    if (!runId) return;
    localStorage.setItem(MASS_HUNT_RUN_KEY, runId);
    show({ forceOpen });
    monitor(runId);
  };
  root.__openMassHunt = (runId) => attach(runId, { forceOpen: true });
  panel?.querySelector("[data-minimize-mass-hunt]")?.addEventListener("click", minimize);
  panel?.querySelector("[data-pause-mass-hunt]")?.addEventListener("click", async (event) => {
    const runId = root.__massHuntRunId;
    if (!runId) return;
    event.currentTarget.disabled = true;
    try {
      await api(`/api/job-hunt/runs/${encodeURIComponent(runId)}/pause`, { method: "POST", body: "{}" });
      localStorage.removeItem(MASS_HUNT_RUN_KEY);
      root.__massHuntRunId = "";
      hide();
      setMassHuntButtons(root);
      toast("Busca pausada. O resultado parcial ficou salvo no Histórico.", "success");
    } catch (error) {
      event.currentTarget.disabled = false;
      toast(error.message, "error");
    }
  });
  launcher?.addEventListener("click", () => show({ forceOpen: true }));
  const restore = async () => {
    hide();
    try {
      const active = await api("/api/job-hunt/runs?status=RUNNING&limit=1&detail=summary", { cache: false });
      const runId = active.runs?.[0]?.id || "";
      if (runId) attach(runId);
      else localStorage.removeItem(MASS_HUNT_RUN_KEY);
    } catch { root.__massHuntRunId = ""; }
  };
  restore();
  root.__massHuntCleanup = () => { clearTimeout(timer); if (generation === massHuntPollGeneration) massHuntPollGeneration++; };
}
function bindSearchComposer(root) {
  const dialog = root.querySelector("#search-composer"),
    form = dialog?.querySelector("form"),
    output = dialog?.querySelector("[data-composer-output]");
  dialog?.querySelector('a[href="/connections"]')?.remove();
  const advancedButton = root.querySelector("[data-open-composer]");
  if (advancedButton && !root.querySelector("[data-open-mass-hunt]")) {
    advancedButton.insertAdjacentHTML(
      "beforebegin",
      `<button class="button primary" type="button" data-open-mass-hunt>${icon("search")} Busca em massa</button>`,
    );
  }
  root.querySelectorAll("dialog .icon-button[aria-label='Fechar']").forEach((button) => {
    button.type = "button";
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });
  root
    .querySelector("[data-open-mass-hunt]")
    ?.addEventListener("click", () => {
      const activeRunId = root.__massHuntRunId;
      if (activeRunId) {
        root.__openMassHunt?.(activeRunId);
        return;
      }
      dialog.showModal();
      dialog.querySelector('[data-composer-action="mass"]')?.focus();
    });
  root
    .querySelector("[data-open-composer]")
    ?.addEventListener("click", () => dialog.showModal());
  root
    .querySelector("[data-open-signal]")
    ?.addEventListener("click", () =>
      root.querySelector("#manual-signal-dialog")?.showModal(),
    );
  dialog?.querySelectorAll("[data-composer-action]").forEach((button) =>
    button.addEventListener("click", async () => {
      const action = button.dataset.composerAction,
        status = form.querySelector(".form-status");
      button.disabled = true;
      status.textContent =
        action === "mass"
          ? "Executando o pipeline completo do Mass Hunt…"
          : "Consultando capacidades com budget reduzido…";
      try {
        const data = await api(`/api/discovery-v4/search/${action}`, {
            method: "POST",
            body: JSON.stringify(composerPayload(form)),
          }),
          result = data.result || data.preview;
        if (action === "mass" && data.runId) {
          localStorage.setItem(MASS_HUNT_RUN_KEY, data.runId);
          status.textContent =
            data.reused
              ? "A busca em andamento foi reaberta."
              : "Mass Hunt iniciado. Você pode navegar; o estado foi persistido no servidor.";
          output.hidden = false;
          output.innerHTML = '<p>Acompanhe o progresso no painel lateral. Você pode minimizá-lo e continuar usando o sistema.</p>';
          dialog.close();
          root.__openMassHunt?.(data.runId);
          return;
        }
        output.hidden = false;
        output.innerHTML = composerResult(result, action);
        status.textContent = `Concluído: ${result.summary?.consulted || 0} classe(s) consultada(s), ${result.summary?.configRequired || 0} exigem configuração e ${result.summary?.error || 0} erro(s).`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    }),
  );
  root
    .querySelector("#manual-signal-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = event.currentTarget.querySelector(".form-status");
      try {
        const result=await api("/api/discovery-v4/manual-signals", {
          method: "POST",
          body: JSON.stringify(
            Object.fromEntries(new FormData(event.currentTarget)),
          ),
        });
        const type=result.lead?.classification?.opportunityType;
        status.textContent=result.lead?.rejected?"O texto não apresentou sinais suficientes de uma oportunidade de trabalho; não foi salvo.":type==="POSSIBLE_JOB_POST"?"Possível oportunidade de recrutador salva para revisão. Há informações incompletas.":"Sinal salvo como lead para revisão.";
        toast(result.lead?.rejected?"Conteúdo não classificado como vaga.":"Sinal registrado sem promover uma vaga automaticamente.");
      } catch (error) {
        status.textContent = error.message;
      }
    });
}
function compactOpportunityRecord(item) {
  return `<a class="compact-record" data-link data-opportunity-search="${escapeHtml(`${item.job.title} ${item.job.company} ${item.job.location}`.toLocaleLowerCase("pt-BR"))}" href="/opportunities/${encodeURIComponent(item.job.id)}"><span><strong>${escapeHtml(item.job.title || "Oportunidade")}</strong><small>${escapeHtml([item.job.company, item.job.location, item.job.workModel].filter(Boolean).join(" · "))}</small></span><span>${item.analysis ? score(item.priority.technicalMatch) : "Não analisada"}</span>${pill(statusLabel(item.priority.level), item.priority.level === "HIGH" ? "success" : "neutral")}${icon("arrow")}</a>`;
}
function allOpportunitiesView(opportunities, total = opportunities.length) {
  if (!opportunities.length) return opportunityEmpty();
  return `<div class="list-toolbar"><div><strong data-opportunity-total>${total}</strong> oportunidades</div><label class="search-field">${icon("search")}<span class="sr-only">Filtrar oportunidades</span><input type="search" placeholder="Cargo, empresa ou tecnologia" data-filter-opportunities /></label></div><section class="compact-record-list" aria-label="Todas as oportunidades">${opportunityListMarkup("all", opportunities)}</section>${total > opportunities.length ? '<button class="button load-more" type="button" data-load-more>Mostrar mais oportunidades</button>' : ""}`;
}
function companiesView(opportunities) {
  const grouped = new Map();
  for (const item of opportunities) {
    const name = item.job.company || "Empresa não informada";
    const current = grouped.get(name) || {
      name,
      items: [],
      providers: new Set(),
    };
    current.items.push(item);
    if (item.job.provider || item.job.source)
      current.providers.add(item.job.provider || item.job.source);
    grouped.set(name, current);
  }
  if (!grouped.size) return opportunityEmpty();
  return `<section class="company-grid">${[...grouped.values()]
    .sort((a, b) => b.items.length - a.items.length)
    .map((company) => {
      const relevant = company.items.filter(
        (item) => item.priority?.level === "HIGH",
      ).length;
      const latest = company.items
        .map((item) => item.job.firstSeenAt || item.job.createdAt)
        .filter(Boolean)
        .sort()
        .at(-1);
      return `<article class="content-card"><div class="section-heading"><div><p class="eyebrow">Empresa encontrada</p><h2>${escapeHtml(company.name)}</h2></div>${pill(`${company.items.length} vaga(s)`, "info")}</div><dl class="definition-grid"><div><dt>Fontes</dt><dd>${escapeHtml([...company.providers].join(", ") || "Não informadas")}</dd></div><div><dt>Melhor prioridade</dt><dd>${Math.max(...company.items.map((item) => item.priority?.score || 0))}%</dd></div><div><dt>Última descoberta</dt><dd>${formatDate(latest)}</dd></div></dl><p class="truth-note">Presente nas oportunidades descobertas; não está necessariamente no Company Radar.</p><a class="button" data-link href="/opportunities?section=all">Ver oportunidades</a></article>`;
    })
    .join("")}</section>`;
}
function opportunityHistory(opportunities, automation = {}) {
  automation ||= {};
  const items = [...opportunities].sort(
    (a, b) =>
      new Date(b.job.firstSeenAt || b.job.createdAt || 0) -
      new Date(a.job.firstSeenAt || a.job.createdAt || 0),
  );
  const recentCutoff = Date.now() - 7 * 86_400_000,
    newCount = items.filter((item) => new Date(item.job.firstSeenAt || item.job.createdAt || 0).getTime() >= recentCutoff).length,
    renewedCount = items.filter((item) => item.freshness?.current && new Date(item.job.lastSeenAt || 0).getTime() > new Date(item.job.firstSeenAt || item.job.createdAt || 0).getTime()).length,
    updateCount = items.filter((item) => item.freshness?.needsUpdate).length,
    closedCount = items.filter((item) => item.freshness?.status === "CLOSED").length;
  return `${automationStatusMarkup(automation)}${massHuntHistoryMarkup(automation.recentRuns || [])}${availabilityHistoryMarkup(automation.availabilityRuns || [])}<section class="opportunity-lifecycle-summary" aria-label="Mudanças recentes nas vagas"><article><small>Novas em 7 dias</small><strong>${newCount}</strong></article><article><small>Renovadas</small><strong>${renewedCount}</strong></article><article><small>Pedem atualização</small><strong>${updateCount}</strong></article><article><small>Encerradas</small><strong>${closedCount}</strong></article></section><p class="truth-note">Uma vaga antiga não é apagada apenas pela idade. Sem confirmação recente, ela sai das filas decisivas e permanece em Todas ou Histórico; vagas confirmadamente encerradas ficam em Excluídas.</p>${items.length ? `<section class="timeline content-card" aria-label="Histórico de descoberta">${items
     .slice(0, 50)
    .map(
      (item) => {
        const firstSeen = item.job.firstSeenAt || item.job.createdAt,
          lastSeen = item.freshness?.confirmedAt || item.job.lastSeenAt || item.job.lastCheckedAt,
          lifecycle = item.freshness?.status === "CLOSED" ? "Encerrada" : item.freshness?.current ? "Confirmada" : "Aguardando atualização";
        return `<article><span class="timeline-dot"></span><div><small>${formatDate(firstSeen, { dateStyle: "medium", timeStyle: "short" })} · ${escapeHtml(lifecycle)}</small><h3><a data-link href="/opportunities/${encodeURIComponent(item.job.id)}">${escapeHtml(item.job.title || "Oportunidade")}</a></h3><p>Descoberta via ${escapeHtml(item.job.provider || item.job.source || "fonte manual")} · ${escapeHtml(item.job.company || "Empresa não informada")}${lastSeen ? ` · última confirmação ${escapeHtml(formatDate(lastSeen))}` : ""}</p></div></article>`;
      },
    )
    .join("")}</section>` : opportunityEmpty()}`;
}

function massHuntHistoryMarkup(runs = []) {
  if (!runs.length) return `<section class="operation-history"><div class="section-heading"><div><p class="eyebrow">Histórico do Mass Hunt</p><h2>Rodadas de busca</h2><p>As próximas execuções aparecerão aqui com o funil completo.</p></div></div></section>`;
  return `<section class="operation-history" aria-labelledby="mass-hunt-history-title"><div class="section-heading"><div><p class="eyebrow">Histórico do Mass Hunt</p><h2 id="mass-hunt-history-title">Rodadas de busca</h2><p>Descobertas, duplicatas, descartes, fontes e resultado final de cada rodada.</p></div>${pill(`${runs.length} rodada(s)`, "info")}</div><div class="operation-run-list">${runs.slice(0, 12).map((run) => {
    const funnel = run.report?.funnel || {},
      sources = (run.sourceRecovery || run.report?.sourceReports || []).filter((item) => item.called || item.status === "CONSULTED"),
      stale = Number(funnel.stale || 0),
      closed = Number(run.closedCount || funnel.closed || 0),
      relevant = Number(funnel.relevantOpportunities ?? run.matchedCount ?? 0),
      tone = run.status === "COMPLETED" ? "success" : run.status === "RUNNING" ? "attention" : run.status === "FAILED" ? "critical" : "neutral";
    return `<article class="operation-run"><header><div><strong>${escapeHtml(formatDate(run.startedAt, { dateStyle: "medium", timeStyle: "short" }))}</strong><small>${run.completedAt ? `Terminou ${escapeHtml(formatDate(run.completedAt, { dateStyle: "short", timeStyle: "short" }))}` : "Em execução agora"}</small></div>${pill(statusLabel(run.status), tone)}</header><div class="operation-run-metrics"><span><strong>${run.rawCount || run.discoveredCount || 0}</strong> encontradas</span><span><strong>${run.canonicalCount || 0}</strong> únicas</span><span><strong>${run.duplicateCount || 0}</strong> duplicadas</span><span><strong>${relevant}</strong> relevantes</span><span><strong>${stale}</strong> antigas filtradas</span><span><strong>${closed}</strong> encerradas</span></div><footer><span>${sources.length ? `${sources.length} fonte(s): ${escapeHtml(sources.slice(0, 5).map((item) => item.provider).join(", "))}${sources.length > 5 ? "…" : ""}` : "Nenhuma fonte confirmou consulta"}</span>${run.errorCode ? `<b>${escapeHtml(statusLabel(run.errorCode))}</b>` : ""}</footer></article>`;
  }).join("")}</div>${runs.slice(0, 6).map(sourceRecoveryMarkup).join("")}</section>`;
}

function availabilityHistoryMarkup(runs = []) {
  if (!runs.length) return "";
  return `<section class="operation-history" aria-labelledby="availability-history-title"><div class="section-heading"><div><p class="eyebrow">Disponibilidade</p><h2 id="availability-history-title">Verificações dos anúncios</h2><p>Somente uma resposta explícita do portal marca uma vaga como encerrada.</p></div></div><div class="operation-run-list compact">${runs.slice(0, 8).map((run) => `<article class="operation-run"><header><div><strong>${escapeHtml(formatDate(run.startedAt, { dateStyle: "medium", timeStyle: "short" }))}</strong><small>${run.status === "RUNNING" ? "Verificação em andamento" : `${run.verificationChecked || 0} anúncio(s) consultado(s)`}</small></div>${pill(statusLabel(run.status), run.status === "COMPLETED" ? "success" : run.status === "RUNNING" ? "attention" : "neutral")}</header><div class="operation-run-metrics availability"><span><strong>${run.availableCount || 0}</strong> ativas</span><span><strong>${run.closedCount || 0}</strong> encerradas</span><span><strong>${run.inconclusiveCount || 0}</strong> inconclusivas</span><span><strong>${run.remainingCount || 0}</strong> aguardando</span></div></article>`).join("")}</div></section>`;
}

function sourceRecoveryMarkup(run) {
  if (run.status === "RUNNING") return "";
  const sources = (run.sourceRecovery || run.report?.sourceReports || []).flatMap(report => report.provider === "jobspy"
    ? (report.sites || []).map(site => ({ ...site, provider: site.site || site.source }))
    : [report]);
  const unique = [...new Map(sources.filter(source => source.provider).map(source => [source.provider, source])).values()];
  if (!unique.length) return "";
  return `<section data-source-recovery class="content-card"><h3>Buscar novamente por portal</h3><p class="muted">Rodada de ${escapeHtml(formatDate(run.startedAt))}</p><div class="compact-record-list">${unique.map(source => `<article><strong>${escapeHtml(source.provider)}</strong> <span class="muted">${escapeHtml(statusLabel(source.status))}</span>${source.recovery?.message ? `<p>${escapeHtml(source.recovery.message)}</p>` : ""}${source.skippedRequests ? `<small>${source.skippedRequests} consultas adiadas após falhas repetidas.</small>` : ""}<button class="button" type="button" data-hunt-source="${escapeHtml(source.provider)}" data-run-id="${escapeHtml(run.id)}">${icon("search")} Buscar só ${escapeHtml(source.provider)}</button></article>`).join("")}</div><p role="status" aria-live="polite"></p></section>`;
}
function opportunityEmpty() {
  return `<div class="empty-inline"><h2>Nenhuma oportunidade encontrada</h2><p>Faça uma busca manual ou configure o Autopilot. Os resultados descobertos serão persistidos automaticamente.</p></div>`;
}
function freshnessNotice(freshness = {}, job = {}) {
  const checked = freshness.confirmedAt || job.lastCheckedAt || job.lastSeenAt;
  if (freshness.status === "CURRENT")
    return `<div class="freshness-notice is-current">${icon("check")}<span><strong>Disponibilidade confirmada</strong><small>${freshness.ageDays ? `Há ${freshness.ageDays} dia(s)` : "Hoje"}</small></span></div>`;
  if (freshness.status === "CLOSED")
    return `<div class="freshness-notice is-closed">${icon("clock")}<span><strong>Vaga encerrada</strong><small>Retirada das prioridades</small></span></div>`;
  const label = freshness.status === "INCONCLUSIVE" ? "Não foi possível confirmar" : "Atualização recomendada";
  const detail = checked ? `Última confirmação: ${formatDate(checked)}` : "Esta vaga ainda não tem confirmação recente";
  return `<div class="freshness-notice is-warning">${icon("clock")}<span><strong>${label}</strong><small>${escapeHtml(detail)}</small></span></div>`;
}
function analysisConfidenceBand(analysis = {}, priority = {}) {
  analysis ||= {};
  priority ||= {};
  if (analysis.confidenceBand) return analysis.confidenceBand;
  const confidence = Number(analysis.matchConfidence ?? priority.components?.confidence ?? 0);
  return confidence >= 75 ? "HIGH" : confidence >= 45 ? "MEDIUM" : "LOW";
}
function evidenceCoverageWarning(analysis = {}) {
  analysis ||= {};
  if ((analysis.jobInformation || analysis.dimensions?.jobInformation)?.sufficient === false)
    return '<div class="partial-banner" role="status"><strong>Descrição incompleta</strong><span>A nota é provisória. Atualize os detalhes da vaga antes de autorizar envio automático.</span></div>';
  const coverage = Number(analysis.evidenceCoverage);
  if (!Number.isFinite(coverage) || coverage >= 50) return "";
  return `<div class="partial-banner" role="status"><strong>Cobertura limitada</strong><span>Só conseguimos avaliar ${Math.round(coverage)}% dos requisitos desta vaga. A compatibilidade estimada tem baixa confiança.</span></div>`;
}
function humanizeRequirement(value = "") {
  const text = String(value).trim();
  if (!text) return "";
  const known = {
    remote: "Remoto",
    hybrid: "Híbrido",
    onsite: "Presencial",
    support: "Suporte",
    backend: "Desenvolvimento de sistemas",
    frontend: "Desenvolvimento de interfaces",
    devops: "Desenvolvimento e operações",
    infrastructure: "Infraestrutura",
  }[text.toLowerCase()];
  if (known) return known;
  return text
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("pt-BR"));
}
function requirementDisplayName(item = {}) {
  const requirement = item.requirement || item;
  const direct = requirement.label || requirement.name || requirement.text;
  if (direct) return humanizeRequirement(direct);

  const original = String(requirement.originalText || "").trim();
  if (original && original.length <= 120)
    return humanizeRequirement(original.replace(/[;,.]+$/, ""));

  const normalized = String(requirement.normalizedName || "").trim();
  if (normalized && !/^\d+(?:\.\d+)?$/.test(normalized))
    return humanizeRequirement(normalized);

  return (
    {
      seniority: "Senioridade da vaga",
      work_model: "Modelo de trabalho",
      education: "Formação solicitada",
      location: "Localização da vaga",
      experience_years: "Tempo de experiência",
      employment_type: "Tipo de contratação",
      language: "Idioma solicitado",
      role: "Cargo da vaga",
      domain: "Área profissional",
      skill: "Competência técnica",
      certification: "Certificação solicitada",
      specific_experience: "Experiência específica",
    }[String(requirement.type || "").toLowerCase()] || "Critério da vaga"
  );
}
function opportunityCard({
  job,
  analysis,
  preMatch,
  priority,
  application,
  feedback,
  decision,
  freshness,
  excludedView = false,
}) {
  let searchable =
      `${job.title} ${job.company} ${job.location} ${job.description}`.toLocaleLowerCase(
        "pt-BR",
      ),
    analyzed = analysis?.analysisStatus === "CURRENT",
    tone =
      priority.level === "HIGH"
        ? "success"
        : priority.level === "MEDIUM"
          ? "attention"
          : "neutral",
    ignored = ["BLOCKED", "SKIP"].includes(decision?.disposition),
    reason = ignored
      ? `Decisão: ${statusLabel(decision?.disposition)} · ${decisionReason(decision?.hardBlockers?.[0] || preMatch?.reasons?.[0])}`
      : analyzed
        ? decision?.decisionExplanation?.summary ||
          decisionReason(decision?.reasons?.[0]) ||
          priority.reasons?.[0]
        : "Aguardando análise técnica; a prioridade considera frescor, preferências e qualidade da vaga.";
  const source =
      job.discoveredVia || job.provider || job.source || "fonte manual",
    sourceLabel =
      {
        indeed: "Indeed",
        linkedin: "LinkedIn",
        glassdoor: "Glassdoor",
        google: "Google Jobs",
        greenhouse: "Greenhouse",
        lever: "Lever",
        ashby: "Ashby",
        smartrecruiters: "SmartRecruiters",
        workable: "Workable",
      }[String(source).toLowerCase()] || source,
    gaps = decision?.gapSummary?.counts || {},
    strengths = (analysis?.matched || [])
      .slice(0, 3)
      .map(
        (item) =>
          item.requirement?.normalizedName || item.normalizedName || item.label,
      )
      .filter(Boolean),
    gapNames = (decision?.gapSummary?.items || [])
      .filter((item) => ["LEARNABLE_GAP", "MATERIAL_GAP"].includes(item.status))
      .slice(0, 3)
      .map((item) => item.requirement)
      .filter(Boolean);
  reason = `${reason} Encontrada via ${sourceLabel}.`;
  const coverage = Number(analysis?.evidenceCoverage || 0),
    confidenceBand = analysisConfidenceBand(analysis, priority),
    primaryAction = !excludedView && !analyzed
        ? `<button class="button primary" type="button" data-analyze-opportunity="${escapeHtml(job.id)}">Analisar</button>`
        : "";
  const workspaceHref = `/opportunities/${encodeURIComponent(job.id)}`;
  return `<article class="opportunity-card" data-opportunity-search="${escapeHtml(searchable)}" data-opportunity-disposition="${escapeHtml(decision?.disposition || "UNCLASSIFIED")}"><a class="opportunity-card-hit-area" data-link href="${workspaceHref}" aria-label="Abrir ${escapeHtml(job.title || "oportunidade")}"></a><div class="opportunity-main"><div class="opportunity-heading"><div><p>${escapeHtml(job.company || "Empresa não informada")}</p><h2>${escapeHtml(job.title || "Oportunidade sem título")}</h2><span>${escapeHtml([job.location, job.workModel, job.seniority].filter(Boolean).join(" · ") || "Localização não informada")}</span></div>${pill(statusLabel(decision?.disposition || priority.level), ignored ? "critical" : tone)}</div>${freshnessNotice(freshness, job)}${job.duplicateGroup?.count > 1 ? `<p class="duplicate-note">${job.duplicateGroup.count} anúncios da mesma vaga agrupados · ${escapeHtml((job.duplicateGroup.sources||job.duplicateGroup.providers).join(", "))}</p>` : ""}<div class="opportunity-compact-summary"><strong>${analyzed ? score(priority.technicalMatch) : "Não analisada"} compatibilidade estimada</strong><span>${analyzed ? `${score(coverage)} cobertura · confiança ${escapeHtml(statusLabel(confidenceBand))}` : `${gaps.LEARNABLE_GAP || 0} aprendível(is) · ${gaps.MATERIAL_GAP || 0} material(is)`}</span></div>${analyzed ? evidenceCoverageWarning(analysis) : ""}${strengths.length ? `<p><strong>Pontos fortes:</strong> ${escapeHtml(strengths.map(humanizeRequirement).join(" · "))}</p>` : ""}${gapNames.length ? `<p><strong>Lacunas:</strong> ${escapeHtml(gapNames.map(humanizeRequirement).join(" · "))}</p>` : ""}<p class="opportunity-reason">${escapeHtml(reason || decision?.reasons?.[0] || "Abra a oportunidade para avaliar o contexto.")}</p><details class="progressive-details"><summary>Ver métricas e critérios</summary><div class="opportunity-signals"><span><small>Compatibilidade técnica conhecida</small><strong>${analyzed ? score(analysis.knownEvidenceMatch ?? analysis.overallScore) : "—"}</strong></span><span><small>Cobertura</small><strong>${analyzed ? score(coverage) : "—"}</strong></span><span><small>Confiança</small><strong>${analyzed ? score(analysis.matchConfidence ?? priority.components?.confidence) : "—"}</strong></span><span><small>Transferíveis</small><strong>${gaps.TRANSFERABLE || 0}</strong></span><span><small>Aprendíveis</small><strong>${gaps.LEARNABLE_GAP || 0}</strong></span><span><small>Bloqueantes</small><strong>${gaps.BLOCKING_GAP || 0}</strong></span></div></details></div><div class="opportunity-actions">${application ? pill(statusLabel(application.status), "info") : feedback?.userDecision === "APPLY" ? pill("Aplicaria", "success") : feedback?.userDecision === "REVIEW" ? pill("Talvez aplicaria", "attention") : feedback?.userDecision === "REJECT" ? pill("Não aplicaria", "critical") : ""}${primaryAction}<button class="button" type="button" data-verify-opportunity="${escapeHtml(job.id)}">Verificar agora</button>${job.url ? `<a class="button quiet" target="_blank" rel="noreferrer" href="${escapeHtml(job.url)}">Fonte ${icon("external")}</a>` : ""}</div></article>`;
}

function batchStudioChrome() {
  return `<div class="batch-selection-bar" data-batch-selection-bar hidden><div><strong><span data-batch-count>0</span> oportunidades selecionadas</strong><small>Seleção temporária para a preparação de currículos em lote</small></div><div class="button-row"><button class="button" type="button" data-batch-open="compare">Comparar currículos</button><button class="button primary" type="button" data-batch-open="prepare">Preparar currículos</button><button class="button" type="button" data-application-prepare>Preparar candidaturas</button><button class="button quiet" type="button" data-batch-clear>Limpar</button></div></div><dialog id="resume-batch-dialog" class="wide-dialog"><form class="dialog-card" data-batch-create><header><div><p class="eyebrow">Preparação de currículos em lote</p><h2>Configurar preparação em lote</h2><p>A fila é persistente, limitada a 25 oportunidades e mantém revisão humana antes da geração.</p></div><button class="icon-button" type="button" data-batch-close aria-label="Fechar">×</button></header><label><span>Currículo-base</span><select name="baseResumeId" required><option value="">Carregando…</option></select></label><fieldset><legend>Currículos adicionais para comparar</legend><div class="choice-grid" data-comparison-resumes></div></fieldset><fieldset><legend>Saídas</legend><div class="choice-grid"><label class="check"><input type="checkbox" name="outputs" value="pdf" checked/> PDF</label><label class="check"><input type="checkbox" name="outputs" value="latex" checked/> LaTeX</label><label class="check"><input type="checkbox" name="outputs" value="overleaf"/> ZIP Overleaf</label></div></fieldset><fieldset><legend>Revisão</legend><label class="check"><input type="checkbox" name="autoApproveSafe"/> Aprovar automaticamente currículos sem alertas</label><p class="truth-note">Itens sem evidência válida ou com alerta editorial continuam aguardando sua revisão.</p></fieldset><fieldset><legend>Depois que cada currículo estiver aprovado e validado</legend><div class="choice-grid"><label class="check"><input type="radio" name="afterReady" value="PREPARE_ONLY" checked/> Apenas deixar pronto para eu decidir</label><label class="check"><input type="radio" name="afterReady" value="REVIEW_OR_AUTOAPPLY"/> Enviar para revisão ou AutoApply conforme a nota ATS configurada</label></div><p class="truth-note">Currículos com alerta editorial nunca seguem direto para AutoApply, mesmo que a nota ATS seja alta.</p></fieldset><label><span>Idioma</span><select name="language"><option value="pt-BR">Português (Brasil)</option><option value="en">English</option></select></label><label class="check" data-blocked-ack hidden><input type="checkbox" name="acknowledgeBlocked"/> Entendo que há oportunidade(s) bloqueada(s) e quero preparar mesmo assim.</label><button class="button primary" type="submit">Criar fila e comparar</button><p class="form-status" role="status"></p></form></dialog>`;
}

function bindBatchSelection(root, opportunities, section) {
  if (!["recommended", "review", "stretch", "all"].includes(section)) return;
  const known = new Map(opportunities.map((item) => [item.job.id, item])),
    selected = new Set(
      JSON.parse(sessionStorage.getItem(BATCH_SELECTION_KEY) || "[]"),
    );
  for (const card of root.querySelectorAll(
    ".opportunity-card:not(.batch-selectable),.compact-record:not(.batch-selectable)",
  )) {
    const link = card.querySelector('a[href^="/opportunities/"]'),
      id = link
        ? decodeURIComponent(
            new URL(link.href, location.href).pathname.split("/").at(-1),
          )
        : "";
    if (!id || !known.has(id)) continue;
    card.classList.add("batch-selectable");
    card.insertAdjacentHTML(
      "afterbegin",
      `<label class="batch-selector"><input type="checkbox" data-batch-job="${escapeHtml(id)}" data-batch-blocked="${["BLOCKED", "SKIP"].includes(known.get(id)?.decision?.disposition)}" ${selected.has(id) ? "checked" : ""}/><span class="sr-only">Selecionar ${escapeHtml(known.get(id)?.job?.title || "oportunidade")}</span></label>`,
    );
  }
  const bar = root.querySelector("[data-batch-selection-bar]"),
    count = root.querySelector("[data-batch-count]"),
    persist = () => {
      sessionStorage.setItem(
        BATCH_SELECTION_KEY,
        JSON.stringify([...selected]),
      );
      count.textContent = selected.size;
      bar.hidden = !selected.size;
      root.querySelectorAll("[data-batch-job]").forEach((input) => {
        input.checked = selected.has(input.dataset.batchJob);
        input
          .closest(".batch-selectable")
          ?.classList.toggle("batch-selected", input.checked);
      });
    };
  root.querySelectorAll("[data-batch-job]:not([data-batch-bound])").forEach((input) => {
    input.dataset.batchBound = "true";
    input.addEventListener("change", () => {
      input.checked
        ? selected.add(input.dataset.batchJob)
        : selected.delete(input.dataset.batchJob);
      persist();
    });
  });
  root.querySelector("[data-application-prepare]")?.addEventListener("click", async event => {
    event.currentTarget.disabled=true;
    try { const {prepareApplications}=await import("../application-batches/page.js");await prepareApplications([...selected]); }
    catch(error){toast(error.message,"error");event.target.disabled=false;}
  });
  root.querySelector("[data-batch-clear]")?.addEventListener("click", () => {
    selected.clear();
    persist();
  });
  root.querySelectorAll("[data-batch-open]").forEach((button) =>
    button.addEventListener("click", async () => {
      const dialog = root.querySelector("#resume-batch-dialog"),
        form = dialog.querySelector("form"),
        status = form.querySelector(".form-status");
      status.textContent = "Carregando currículos disponíveis…";
      try {
        const data = await api("/api/experience/resumes"),
          resumes = data.resumes || [],
          options = resumes
            .map(
              (item) =>
                `<option value="${escapeHtml(item.resume.id)}">${escapeHtml(item.resume.title || item.resume.id)}</option>`,
            )
            .join("");
        form.elements.baseResumeId.innerHTML =
          options || '<option value="">Nenhum currículo disponível</option>';
        form.querySelector("[data-comparison-resumes]").innerHTML = resumes
          .map(
            (item) =>
              `<label class="check"><input type="checkbox" name="comparisonResumeIds" value="${escapeHtml(item.resume.id)}"/> ${escapeHtml(item.resume.title || item.resume.id)}</label>`,
          )
          .join("");
        const blocked = [...selected].filter((id) =>
          ["BLOCKED", "SKIP"].includes(known.get(id)?.decision?.disposition),
        );
        form.dataset.blockedIds = JSON.stringify(blocked);
        form.querySelector("[data-blocked-ack]").hidden = !blocked.length;
        status.textContent = `${selected.size} oportunidade(s) prontas para configurar.`;
        dialog.showModal();
      } catch (error) {
        status.textContent = error.message;
        dialog.showModal();
      }
    }),
  );
  root
    .querySelector("[data-batch-close]")
    ?.addEventListener("click", () =>
      root.querySelector("#resume-batch-dialog")?.close(),
    );
  root
    .querySelector("[data-batch-create]")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        status = form.querySelector(".form-status"),
        button = event.submitter,
        blocked = JSON.parse(form.dataset.blockedIds || "[]");
      if (blocked.length && !form.elements.acknowledgeBlocked.checked) {
        status.textContent =
          "Confirme explicitamente a preparação das oportunidades bloqueadas.";
        return;
      }
      button.disabled = true;
      status.textContent = "Organizando a preparação…";
      try {
        const result = await api("/api/resume-batches", {
          method: "POST",
          body: JSON.stringify({
            jobIds: [...selected],
            baseResumeId: form.elements.baseResumeId.value,
            comparisonResumeIds: [
              ...form.querySelectorAll('[name="comparisonResumeIds"]:checked'),
            ].map((x) => x.value),
            requestedOutputs: [
              ...form.querySelectorAll('[name="outputs"]:checked'),
            ].map((x) => x.value),
            language: form.elements.language.value,
            afterReady: form.elements.afterReady.value,
            autoApproveSafe: form.elements.autoApproveSafe.checked,
            acknowledgedBlockedJobIds: blocked,
          }),
        });
        await api(
          `/api/resume-batches/${encodeURIComponent(result.batch.id)}/compare`,
          { method: "POST", body: "{}" },
        );
        sessionStorage.removeItem(BATCH_SELECTION_KEY);
        location.assign(
          `/resume-batches/${encodeURIComponent(result.batch.id)}`,
        );
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  persist();
}

export async function renderOpportunityWorkspace({ root, route }) {
  let preferredResumeId = "";
  try {
    preferredResumeId = JSON.parse(
      localStorage.getItem(`career.resumeChoice.${route.id}`) || "{}",
    ).resumeId || "";
  } catch {}
  const workspaceParams = new URLSearchParams();
  if (preferredResumeId) workspaceParams.set("resumeId", preferredResumeId);
  const { workspace } = await api(
      `/api/opportunities/${encodeURIComponent(route.id)}/workspace${workspaceParams.size ? `?${workspaceParams}` : ""}`,
    ),
    job = workspace.job,
    currentDecision = workspace.feedback?.userDecision || "";
  root.innerHTML = `<div class="workspace-page opportunity-workspace"><header class="workspace-header"><a class="back-link" data-link href="/opportunities">← Voltar para vagas</a><div class="workspace-title"><div><p class="eyebrow">Oportunidade</p><h1>${escapeHtml(job.title || "Oportunidade")}</h1><p>${escapeHtml([job.company, job.location, job.workModel].filter(Boolean).join(" · "))}</p></div>${job.url ? `<a class="button quiet" href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">Ver vaga original ${icon("external")}</a>` : ""}</div></header><div class="workspace-body opportunity-workspace-flow"><section class="opportunity-decision-hero" aria-labelledby="opportunity-next-action"><div>${nextActionPanel(workspace)}</div><div class="opportunity-decision-actions">${decisionSnapshot(workspace)}<div><strong>Sua decisão</strong><p>Use sua avaliação real para calibrar as próximas recomendações.</p></div><div class="opportunity-decision-buttons" role="group" aria-label="Sua decisão sobre esta vaga"><button class="button ${currentDecision === "APPLY" ? "primary" : "quiet"}" type="button" data-opportunity-decision="APPLY">Aplicaria</button><button class="button ${currentDecision === "REVIEW" ? "primary" : "quiet"}" type="button" data-opportunity-decision="REVIEW">Talvez aplicaria</button><button class="button ${currentDecision === "REJECT" ? "danger" : "quiet"}" type="button" data-opportunity-reject-choice data-show-workspace-rejection>Não aplicaria</button></div><p class="decision-feedback" data-decision-feedback role="status">${currentDecision ? `Decisão salva: ${escapeHtml(decisionLabel(currentDecision))}. Ela já saiu das filas pendentes e está em Minhas decisões.` : "Esta decisão organiza sua fila e não envia nenhuma candidatura."}</p><div class="workspace-rejection" data-workspace-rejection hidden><label><span>Por que você não aplicaria?</span><select data-workspace-rejection-reason><option value="NOT_INTERESTED">Não tenho interesse</option><option value="BAD_ROLE">Cargo diferente do que procuro</option><option value="BAD_SENIORITY">Senioridade inadequada</option><option value="BAD_LOCATION">Localização inadequada</option><option value="LOW_PAY">Remuneração baixa</option><option value="BAD_COMPANY">Empresa não desejada</option><option value="MISSING_REQUIREMENT">Falta requisito importante</option><option value="OTHER">Outro motivo</option></select></label><div class="button-row"><button class="button danger" type="button" data-confirm-workspace-rejection>Confirmar que não aplicaria</button><button class="button quiet" type="button" data-cancel-workspace-rejection>Cancelar</button></div></div></div></section><div id="opportunity-summary" class="workspace-section">${renderSummary(workspace)}</div><details open id="opportunity-analysis" class="workspace-section workspace-collapsible"><summary><span><span class="eyebrow">Compatibilidade</span><h2>Por que esta vaga combina com você</h2><small>Pontos fortes, lacunas, métricas e requisitos analisados.</small></span><span class="workspace-collapsible-action" aria-hidden="true"></span></summary><div class="workspace-collapsible-body">${evidenceHighlights(workspace)}${renderAnalysis(workspace)}</div></details><details open id="opportunity-resume" class="workspace-section workspace-collapsible"><summary><span><span class="eyebrow">Currículo</span><h2>Prepare uma versão para esta vaga</h2><small>Escolha a base, compare o score e revise antes de aprovar.</small></span><span class="workspace-collapsible-action" aria-hidden="true"></span></summary><div class="workspace-collapsible-body">${renderResume(workspace)}</div></details><details open id="opportunity-application" class="workspace-section workspace-collapsible"><summary><span><span class="eyebrow">Candidatura</span><h2>Próximo passo no processo</h2><small>Preparação e acompanhamento sem envio automático.</small></span><span class="workspace-collapsible-action" aria-hidden="true"></span></summary><div class="workspace-collapsible-body">${renderApplication(workspace)}</div></details><details id="opportunity-history" class="workspace-advanced"><summary>Sistema, disponibilidade e histórico</summary><div>${workspaceStatus(workspace)}${resumeRecommendation(workspace)}${applicationMethod(workspace)}${renderHistory(workspace)}</div></details></div></div>`;
  root.querySelector(".opportunity-workspace-flow")?.insertAdjacentHTML(
    "afterbegin",
    '<nav class="workspace-jump-nav" aria-label="Seções da oportunidade"><a href="#opportunity-summary">Resumo</a><a href="#opportunity-analysis">Compatibilidade</a><a href="#opportunity-resume">Currículo</a><a href="#opportunity-application">Candidatura</a><a href="#opportunity-history">Histórico</a></nav>',
  );
  root.querySelectorAll(".workspace-collapsible").forEach((section) => {
    section.open = true;
    section.querySelector("summary")?.addEventListener("click", (event) =>
      event.preventDefault(),
    );
  });
  if (workspace.evidenceGaps?.some((item) => item.status === "OPEN"))
    root
      .querySelector(".analysis-stack")
      ?.insertAdjacentHTML(
        "afterbegin",
        renderEvidenceGaps(workspace.evidenceGaps),
      );
  bindWorkspaceActions(root, workspace, route);
  const target = {
    analysis: "opportunity-analysis",
    resume: "opportunity-resume",
    application: "opportunity-application",
    history: "opportunity-history",
  }[route.tab];
  if (target)
    requestAnimationFrame(() => {
      const section = document.getElementById(target);
      if (section instanceof HTMLDetailsElement) section.open = true;
      section?.scrollIntoView({ block: "start" });
    });
}
function renderEvidenceGaps(gaps = []) {
  const open = gaps.filter((item) => item.status === "OPEN");
  const visible = open.slice(0, 5);
  const remaining = open.length - visible.length;
  return `<section class="content-card evidence-gap-panel"><div class="section-heading"><div><p class="eyebrow">Evidências prioritárias</p><h2>${open.length} requisito(s) sem confirmação</h2><p>Mostramos apenas os itens mais importantes desta vaga. Ausência de evidência não significa falta de conhecimento.</p></div>${pill("Coverage + Confidence", "attention")}</div><div class="gap-link-list">${visible.map((item) => `<article><div><strong>${escapeHtml(item.requirementLabel)}</strong><small>${escapeHtml(item.importance === "REQUIRED" ? "Obrigatório" : "Importante")}</small></div><a class="button" data-link href="/knowledge?section=reviews&gap=${encodeURIComponent(item.id)}">Tenho experiência com isso</a></article>`).join("")}</div>${remaining > 0 ? `<div class="evidence-gap-more"><span>Mais ${remaining} item(ns) estão disponíveis para revisão.</span><a class="button quiet" data-link href="/knowledge?section=reviews">Revisar todos</a></div>` : ""}</section>`;
}
function workspaceStatus(workspace) {
  const current=workspace.freshness?.current;
  const availability = workspace.job.availability || {};
  const availabilityLabel = workspace.job.lifecycleStatus === "CLOSED" ? "Encerrada no portal" : availability.status === "INCONCLUSIVE" ? "Disponibilidade não confirmada" : current ? "Disponibilidade confirmada" : "Atualização recomendada";
  return `<section class="status-strip"><div><span class="status-symbol ${workspace.analysis ? "complete" : "pending"}">${icon(workspace.analysis ? "check" : "clock")}</span><span><small>Status da análise</small><strong>${workspace.analysis ? "Analisada" : "Ainda não analisada"}</strong></span></div><div><span class="status-symbol">${icon("arrow")}</span><span><small>Próxima ação</small><strong>${escapeHtml(workspace.nextAction.label)}</strong></span></div><div><span class="status-symbol ${current?"complete":"pending"}">${icon(current?"check":"clock")}</span><span><small>Disponibilidade</small><strong>${availabilityLabel}</strong><small>${availability.checkedAt ? escapeHtml(formatDate(availability.checkedAt, {dateStyle:"short",timeStyle:"short"})) : "Sem verificação no portal"}${availability.reason ? ` · ${escapeHtml(availability.reason)}` : ""}</small></span><button class="button quiet" type="button" data-verify-workspace>Verificar</button></div></section>`;
}
function decisionSnapshot(w) {
  const confidence = analysisConfidenceBand(w.analysis, w.priority);
  return `<dl class="decision-snapshot"><div><dt>Compatibilidade</dt><dd>${w.analysis ? score(w.priority.technicalMatch) : "—"}</dd></div><div><dt>Cobertura</dt><dd>${w.analysis ? score(w.analysis.evidenceCoverage) : "—"}</dd></div><div><dt>Confiança</dt><dd>${w.analysis ? escapeHtml(statusLabel(confidence)) : "—"}</dd></div></dl>`;
}
function evidenceHighlights(w) {
  if (!w.analysis) return "";
  const strengths = (w.analysisItems || []).filter((item) => item.status === "MATCH").map(requirementDisplayName).slice(0, 5);
  const gaps = [
    ...(w.analysisItems || []).filter((item) => ["PARTIAL_MATCH", "NO_MATCH", "UNKNOWN"].includes(item.status)).map(requirementDisplayName),
    ...(w.analysis.missing || []).map((item) => humanizeRequirement(typeof item === "string" ? item : item?.label || item?.message)),
  ].filter(Boolean).filter((item, index, values) => values.indexOf(item) === index).slice(0, 5);
  return `<div class="opportunity-evidence-highlights"><section><h3>Pontos fortes</h3>${listOrEmpty(strengths, "Nenhuma evidência forte confirmada ainda.")}</section><section><h3>O que está faltando</h3>${listOrEmpty(gaps, "Nenhuma lacuna relevante identificada.")}</section></div>`;
}
function rankingExplanation(priority = {}, decision = {}) {
  const components = priority.components || {};
  const contributions = priority.trace?.contributions || {};
  const rows = [
    ["Compatibilidade", components.compatibility, contributions.compatibility],
    ["Requisitos obrigatórios", components.hardRequirementCoverage, contributions.hardRequirementCoverage],
    ["Família profissional", components.careerFamilyRelevance, contributions.careerFamilyRelevance],
    ["Senioridade", components.seniorityCompatibility, contributions.seniorityCompatibility],
    ["Localização", components.locationCompatibility, contributions.locationCompatibility],
    ["Confiança da análise", components.confidence, contributions.confidence],
    ["Atualidade", components.freshness, contributions.freshness],
  ];
  return `<details class="content-card progressive-details"><summary>Como a prioridade ${score(priority.score)} foi calculada</summary><div class="metric-grid ranking-breakdown">${rows.map(([label, value, contribution]) => `<article><small>${escapeHtml(label)}</small><strong>${value == null ? "—" : score(value)}</strong><span>${contribution == null ? "Sem contribuição registrada" : `${Number(contribution).toFixed(2)} ponto(s) no score`}</span></article>`).join("")}</div>${priority.trace?.bonuses?.length ? `<p><strong>Bônus:</strong> ${escapeHtml(priority.trace.bonuses.map((item) => `${statusLabel(item.code)} +${item.points}`).join(" · "))}</p>` : ""}${priority.trace?.penalties?.length ? `<p><strong>Penalidades:</strong> ${escapeHtml(priority.trace.penalties.map((item) => `${statusLabel(item.code)} -${item.points}`).join(" · "))}</p>` : ""}<p><strong>Filtro:</strong> ${escapeHtml(statusLabel(decision.disposition || "UNKNOWN"))}${decision.reasons?.length ? ` · ${escapeHtml(decision.reasons.map(decisionReason).join(" · "))}` : ""}</p></details>`;
}
function renderSummary(w) {
  if (w.analysis && w.analysis.analysisStatus !== "CURRENT") w = { ...w, analysis: null };
  const j = w.job;
  const confidenceBand = analysisConfidenceBand(w.analysis, w.priority);
  return `<div class="opportunity-overview-grid"><section class="content-card opportunity-decision-summary"><div class="section-heading"><div><p class="eyebrow">Sua decisão</p><h2>Esta oportunidade vale seu tempo?</h2></div>${pill(statusLabel(w.decision?.disposition || w.priority.level), w.decision?.visibility?.recommended ? "success" : w.decision?.hardBlockers?.length ? "critical" : "attention")}</div><p class="truth-note"><strong>Por que ${escapeHtml(statusLabel(w.decision?.disposition || "REVIEW"))}?</strong> ${escapeHtml(w.decision?.decisionExplanation?.summary || w.decision?.reasons?.map(decisionReason).join(" · ") || "A decisão será refinada quando houver análise e evidência suficientes.")}</p><dl class="match-trust-summary"><div><dt>Compatibilidade estimada</dt><dd>${w.analysis ? score(w.priority.technicalMatch) : "Não analisado"}</dd></div><div><dt>Cobertura</dt><dd>${w.analysis ? score(w.analysis.evidenceCoverage) : "—"}</dd></div><div><dt>Confiança</dt><dd>${w.analysis ? escapeHtml(statusLabel(confidenceBand)) : "—"}</dd></div></dl>${w.decision?.hardBlockers?.length ? `<div class="partial-banner critical" role="alert"><strong>Bloqueio</strong><span>${escapeHtml(w.decision.hardBlockers.map((item) => typeof item === "string" ? item : item.message || item.label).filter(Boolean).join(" · "))}</span></div>` : ""}${w.analysis ? evidenceCoverageWarning(w.analysis) : ""}<dl class="definition-grid opportunity-facts"><div><dt>Empresa</dt><dd>${escapeHtml(j.company || "Não informada")}</dd></div><div><dt>Localização</dt><dd>${escapeHtml(j.location || "Não informada")}</dd></div><div><dt>Modelo</dt><dd>${escapeHtml(j.workModel || "Não informado")}</dd></div><div><dt>Senioridade</dt><dd>${escapeHtml(j.seniority || "Não informada")}</dd></div><div><dt>Fonte</dt><dd>${escapeHtml(j.provider || j.source || "Manual")}</dd></div><div><dt>Situação</dt><dd>${escapeHtml(statusLabel(j.lifecycleStatus))}</dd></div></dl></section><section class="content-card opportunity-description-card"><h2>Sobre a vaga</h2><div class="job-description">${escapeHtml(j.description || "Descrição não disponível.").replaceAll("\n", "<br>")}</div></section></div>`;
}
function renderAnalysis(w) {
  if (!w.analysis)
    return `<section class="action-empty"><span>${icon("search")}</span><p class="eyebrow">Análise necessária</p><h2>Entenda o match antes de preparar a candidatura</h2><p>O Career Unified compara a vaga com o Candidate Knowledge e, se houver, com um currículo. A compatibilidade documental fica separada.</p><button class="button primary" type="button" data-analyze>Analisar agora</button>${w.resumeRecommendation ? "" : "<small>Sem currículo: o match técnico continuará e o documento ficará como não avaliado.</small>"}<p class="form-status" data-analysis-status role="status"></p></section>`;
  const legacy = w.analysis.analysisStatus !== "CURRENT";
  if (legacy) w = { ...w, analysis: { ...w.analysis, calibratedMatchScore: null, knownEvidenceMatch: null, overallScore: null, score: null } };
  const
    groups = { MATCH: [], PARTIAL_MATCH: [], NO_MATCH: [], UNKNOWN: [] };
  for (const item of w.analysisItems || [])
    (groups[item.status] ||= []).push(item);
  return `<div class="analysis-stack">${legacy ? '<div class="partial-banner" role="status"><strong>Análise antiga</strong><span>O histórico foi preservado. Atualize para recalcular com o Matcher atual.</span><button class="button" type="button" data-analyze>Atualizar análise</button></div>' : ""}<div class="metric-grid"><article><small>Compatibilidade estimada</small><strong>${score(w.analysis.calibratedMatchScore ?? w.analysis.overallScore ?? w.analysis.score)}</strong><span>Calibrada por cobertura e confiança</span></article><article><small>Match conhecido</small><strong>${score(w.analysis.knownEvidenceMatch ?? w.analysis.overallScore)}</strong><span>Somente requisitos avaliados</span></article><article><small>Cobertura de evidências</small><strong>${score(w.analysis.evidenceCoverage)}</strong><span>Requisitos com evidência conhecida</span></article><article><small>Confiança</small><strong>${statusLabel(analysisConfidenceBand(w.analysis, w.priority))} · ${score(w.analysis.matchConfidence ?? w.priority.components.confidence)}</strong><span>Qualidade da análise, não compatibilidade</span></article><article><small>Elegibilidade</small><strong>${statusLabel(w.analysis.eligibility)}</strong><span>Não compõe o match</span></article><article><small>Prioridade</small><strong>${statusLabel(w.priority.level)}</strong><span>${score(w.priority.score)} interno</span></article></div>${rankingExplanation(w.priority, w.decision)}${evidenceCoverageWarning(w.analysis)}${w.analysis.unknownRequirements?.some((item) => item.required) ? '<div class="partial-banner" role="status"><strong>Revisão necessária</strong><span>Ao menos um requisito obrigatório permanece UNKNOWN.</span></div>' : ""}${atsCompatibility(w.analysis)}<section class="content-card"><div class="section-heading"><div><h2>Requisitos da oportunidade</h2><p>Evidências e lacunas que sustentam a análise.</p></div><details><summary>Detalhes técnicos</summary><p>Algoritmo: ${escapeHtml(w.analysis.algorithmVersion || "não informado")}</p></details></div>${Object.entries(
    groups,
  )
    .map(([status, values]) => requirementGroup(status, values))
    .join(
      "",
    )}</section><div class="split-cards"><section class="content-card"><h3>Possíveis bloqueadores</h3>${listOrEmpty(w.analysis.blockingIssues, "Nenhum bloqueador comprovado.")}</section><section class="content-card"><h3>Principais lacunas</h3>${listOrEmpty(w.analysis.missing, "Nenhuma lacuna relevante identificada.")}</section></div></div>`;
}
function atsCompatibility(a) {
  const p = a.resumeParseability || {};
  if (p.status === "NOT_EVALUATED")
    return `<section class="ats-compat"><div><span class="status-symbol">${icon("document")}</span><span><h3>Compatibilidade do documento com ATS</h3><p>Não avaliada: nenhum currículo foi selecionado. Isso não altera a compatibilidade técnica.</p></span></div></section>`;
  return `<section class="ats-compat"><div><span class="status-symbol complete">${icon("document")}</span><span><h3>Compatibilidade do documento com ATS</h3><p>Verificações próprias de extração e estrutura; não é pontuação do fornecedor.</p></span></div><dl><div><dt>Pontuação</dt><dd>${p.score == null ? "—" : score(p.score)}</dd></div><div><dt>Estrutura</dt><dd>${statusLabel(p.status || "Verificada")}</dd></div></dl></section>`;
}
function requirementGroup(status, items) {
  const labels = {
      MATCH: ["Com evidência", "success"],
      PARTIAL_MATCH: ["Parcial", "attention"],
      NO_MATCH: ["Lacuna", "critical"],
      UNKNOWN: ["Desconhecido", "neutral"],
    },
    [label, tone] = labels[status] || [status, "neutral"];
  return `<section class="requirement-group"><header>${pill(`${label} (${items.length})`, tone)}</header>${items.length ? items.map((item) => `<article><div><strong>${escapeHtml(requirementDisplayName(item))}</strong><p>${escapeHtml(item.explanation || "Sem explicação adicional.")}</p></div><small>${escapeHtml(item.evidence?.[0]?.text || item.evidence?.[0]?.source || "Sem evidência vinculada")}</small></article>`).join("") : '<p class="muted">Nenhum item neste grupo.</p>'}</section>`;
}
function renderResume(w) {
  if (!w.resumeRecommendation)
    return `<section class="action-empty"><span>${icon("document")}</span><h2>Adicione um currículo base</h2><p>O sistema precisa de um currículo real para recomendar e preparar uma versão específica.</p><a class="button primary" data-link href="/resumes">Ir para currículos</a></section>`;
  const r = w.resumeRecommendation,
    v = w.resumeVersion,
    tailoring = w.resumeTailoring,
    tailoringLocked =
      !v && ["REVIEW_REQUIRED", "APPROVED"].includes(tailoring?.state),
    activeResumeId = tailoringLocked
      ? tailoring.resumeId
      : r.selectedResumeId,
    bases = r.baseOptions?.length ? r.baseOptions : [{resumeId:r.selectedResumeId,title:r.resume?.title||"Currículo base",language:r.resume?.language||"pt-BR",analysisId:w.analysis?.id||"",analysisScore:r.coverage,recommended:true}],
    activeBase = bases.find((item) => item.resumeId === activeResumeId) || r.resume,
    templateRecommendation = r.templateRecommendation?.candidates?.length ? r.templateRecommendation : { recommendedTemplateId: "BASE_01", candidates: [{id:"BASE_01",name:"BASE 01 fiel",purpose:"Estrutura aprovada do PDF BASE 01",reasons:["Mantém a estrutura visual aprovada e os links clicáveis."],recommended:true}] },
    selectedTemplate = templateRecommendation.recommendedTemplateId || "BASE_01",
    prepareBlocked =
      !w.analysis ||
      (!v && ["REVIEW_REQUIRED", "APPROVED"].includes(tailoring?.state)),
    prepareLabel =
      !v && tailoring?.state === "REVIEW_REQUIRED"
        ? "Ajustes aguardando revisão"
        : !v && tailoring?.state === "APPROVED"
          ? "Gerando versão específica"
          : "Gerar proposta de ajustes";
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Base real + modelo de saída</p><h2>Como este currículo será preparado</h2></div>${pill("Você decide", "success")}</div><div class="resume-choice-grid"><label><span>Base de conteúdo</span><select data-resume-base-select ${tailoringLocked ? "disabled" : ""}>${bases.map((item)=>`<option value="${escapeHtml(item.resumeId)}" data-analysis-id="${escapeHtml(item.analysisId||"")}" data-score="${item.analysisScore??""}" data-language="${escapeHtml(item.language||"pt-BR")}" ${item.resumeId===activeResumeId?"selected":""}>${escapeHtml(item.title)}${item.recommended?" · recomendado":""}${item.analysisScore==null?"":` · ${score(item.analysisScore)}`}</option>`).join("")}</select><small>${tailoringLocked?"A base fica travada somente enquanto estes ajustes estão em revisão.":"Este currículo fornece somente fatos e experiências comprovados."}</small></label><label><span>Modelo ATS da versão</span><select data-resume-template-select>${templateRecommendation.candidates.map((item)=>`<option value="${escapeHtml(item.id)}" data-purpose="${escapeHtml(item.purpose||"")}" data-reason="${escapeHtml(item.reasons?.[0]||"")}" ${item.id===selectedTemplate?"selected":""}>${escapeHtml(item.name)}${item.recommended?" · recomendado":""}</option>`).join("")}</select><small data-template-reason>${escapeHtml(templateRecommendation.candidates.find((item)=>item.id===selectedTemplate)?.reasons?.[0]||"Modelo ATS de uma coluna.")}</small></label></div><div class="resume-choice-summary"><span class="document-icon">${icon("document")}</span><div><h3 data-resume-choice-title>${escapeHtml(activeBase?.title || "Currículo base")}</h3><p><strong>Score original:</strong> <span data-resume-choice-score>${activeBase?.analysisScore == null ? "será calculado" : score(activeBase.analysisScore)}</span> · <strong>Score proposto:</strong> aparece antes de você aprovar</p><p data-resume-template-summary>${escapeHtml(templateRecommendation.candidates.find((item)=>item.id===selectedTemplate)?.purpose||"Compatibilidade ATS")}</p><ul>${(
    r.reasons || []
  )
    .slice(0, 4)
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join(
      "",
    )}</ul></div></div><button class="button primary" type="button" data-prepare-resume ${prepareBlocked ? "disabled" : ""}>${prepareLabel}</button><p class="form-status">${w.analysis ? "Primeiro você revisa a proposta. Só depois da sua aprovação uma nova versão é gerada." : "Analise a oportunidade antes de preparar uma versão."}</p></section>${tailoring && !v ? renderTailoringReview(tailoring, w.analysis?.candidateEvidence || [], activeBase?.title) : ""}${v ? resumeReview(v, w) : ""}`;
}
function renderTailoringReview(tailoring, evidence = [], baseTitle = "") {
  const changes = tailoring.changes || [],
    pending = tailoring.state === "REVIEW_REQUIRED",
    approved = tailoring.state === "APPROVED",
    fallbackReasons = [
      ...(tailoring.evidenceStatus && tailoring.evidenceStatus !== "VALID" ? ["EVIDENCE_GUARD_FAILED"] : []),
      ...(changes.some((change)=>change.validationStatus && change.validationStatus !== "VALID") ? ["EVIDENCE_CHANGE_INVALID"] : []),
      ...(tailoring.originalScore != null && tailoring.tailoredScore != null && Number(tailoring.tailoredScore) < Number(tailoring.originalScore) ? ["ATS_MATCH_REGRESSION"] : []),
    ],
    quality = tailoring.quality || { allowed: !fallbackReasons.length, reasons: fallbackReasons, delta: tailoring.originalScore == null || tailoring.tailoredScore == null ? null : Number(tailoring.tailoredScore) - Number(tailoring.originalScore) },
    evidenceById = new Map(evidence.map((item) => [item.id, item]));
  return `<section class="content-card resume-review" data-tailoring-review="${escapeHtml(tailoring.id)}"><div class="section-heading"><div><p class="eyebrow">Antes e depois</p><h2>Ajustes preparados</h2><p>Base: ${escapeHtml(baseTitle||"currículo escolhido")}. O motor compara perspectivas factuais e mostra a melhor para esta vaga.</p></div>${pill(quality.allowed?statusLabel(tailoring.state):"Regressão bloqueada", quality.allowed?(pending ? "attention" : approved ? "success" : "neutral"):"critical")}</div><div class="review-summary"><div><small>Score original</small><strong>${tailoring.originalScore == null ? "—" : score(tailoring.originalScore)}</strong></div><div><small>Score gerado</small><strong>${tailoring.tailoredScore == null ? "—" : score(tailoring.tailoredScore)}</strong></div><div><small>Resultado</small><strong>${quality.delta==null?"Sem comparação":quality.delta>0?`+${quality.delta} pontos`:quality.delta===0?"Sem alteração":`${quality.delta} pontos`}</strong></div></div>${quality.allowed?"":`<p class="inline-alert critical">${quality.reasons?.some((reason)=>reason.startsWith("EVIDENCE_"))?"Há afirmações sem evidência suficiente. Esta versão não pode ser aprovada nem usada em candidatura.":"Esta versão reduziu o score. Ela não pode ser aprovada nem usada em candidatura."}</p>`}${
    changes.length
      ? `<div class="change-list">${changes
          .slice(0, 30)
          .map((change) => {
            const linked = (change.sourceEvidenceIds || [])
              .map((id) => evidenceById.get(id))
              .filter(Boolean);
            return `<article><span><small>Antes</small><p>${escapeHtml(change.original || "—")}</p></span><span><small>Depois</small><p>${escapeHtml(change.proposed || "—")}</p></span><span><small>Motivo e evidência</small><p>${escapeHtml(change.reason || "Ajuste sustentado por evidência existente.")}</p><small>${
              linked.length
                ? linked
                    .map(
                      (item) =>
                        `${item.normalizedName} · ${item.metadata?.contextType || item.source} · ${item.metadata?.depth || item.strength}`,
                    )
                    .map(escapeHtml)
                    .join(" | ")
                : `${(change.sourceEvidenceIds || []).length} evidência(s) vinculada(s)`
            }</small></span></article>`;
          })
          .join("")}</div>`
      : '<p class="muted">Nenhuma alteração textual foi proposta; a versão manterá o conteúdo factual da base.</p>'
  }${tailoring.state === "REJECTED" ? '<div class="resume-recovery-guidance"><h3>Como seguir agora</h3><p>Os ajustes foram descartados e o currículo base continua intacto. Você pode gerar uma versão com a base atual, trocar a base ou o modelo acima, ou pedir uma nova tentativa de ajuste.</p><ul><li><strong>Editar manualmente:</strong> gere a versão base e use a aba Editar no currículo completo.</li><li><strong>Melhorar com IA:</strong> tente novos ajustes depois de escolher outra base ou atualizar suas evidências em Conhecimento.</li><li><strong>Adicionar experiência nova:</strong> registre primeiro o fato em Conhecimento para que a validação não aceite informação sem comprovação.</li></ul></div>' : ""}<div class="button-row">${pending ? `<button class="button primary" data-review-tailoring="APPROVED" type="button" ${quality.allowed?"":"disabled"}>Aprovar ajustes e gerar versão</button><button class="button" data-review-tailoring="REJECTED" type="button">Rejeitar ajustes</button>` : approved ? '<button class="button primary" data-build-tailoring-version type="button">Gerar versão específica</button>' : tailoring.state === "REJECTED" ? '<button class="button primary" data-use-base-resume type="button">Usar currículo base sem ajustes</button><button class="button" data-retry-tailoring type="button">Tentar novos ajustes</button>' : ""}</div><p class="form-status" data-tailoring-status role="status"></p></section>`;
}
function resumeReview(v, w) {
  return renderResumeReview(v, {
    jobTitle: w.job?.title,
    baseTitle: w.resumeRecommendation?.resume?.title,
  });
}
function renderApplication(w) {
  const a = w.application,
    m = w.applicationMethod;
  if (!a)
    return `<section class="action-empty"><span>${icon("send")}</span><h2>Prepare a candidatura com contexto</h2><p>O plano registra a análise e a versão exata do currículo aprovada. O Career Unified não envia automaticamente.</p><button class="button primary" type="button" data-create-application ${w.analysis && ["APPROVED", "READY"].includes(w.resumeVersion?.status) ? "" : "disabled"}>Preparar candidatura</button>${w.analysis && ["APPROVED", "READY"].includes(w.resumeVersion?.status) ? "" : "<small>Conclua a análise e aprove uma versão específica antes de criar a candidatura.</small>"}</section>`;
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Plano de candidatura</p><h2>${statusLabel(a.status)}</h2></div>${pill(statusLabel(a.status), a.status === "READY_TO_SUBMIT" ? "success" : "attention")}</div><dl class="definition-grid"><div><dt>Método</dt><dd>${escapeHtml(statusLabel(m.method))}</dd></div><div><dt>ATS</dt><dd>${escapeHtml(m.atsType)}</dd></div><div><dt>Capacidade</dt><dd>${escapeHtml(m.capability.label)}</dd></div><div><dt>Currículo exato</dt><dd>${escapeHtml(a.resumeVersionId || a.resumeId || "Ainda não selecionado")}</dd></div><div><dt>Status</dt><dd>${escapeHtml(statusLabel(a.status))}</dd></div><div><dt>Próxima ação</dt><dd>${escapeHtml(w.nextAction.label)}</dd></div></dl><a class="button primary" data-link href="/applications/${encodeURIComponent(a.id)}">Abrir candidatura ${icon("arrow")}</a></section>`;
}
function renderHistory(w) {
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Proveniência</p><h2>Histórico da oportunidade</h2></div></div><ol class="timeline">${w.timeline.length ? w.timeline.map((item) => `<li><span></span><div><strong>${escapeHtml(item.label)}</strong><p>${formatDate(item.at, { dateStyle: "medium", timeStyle: "short" })} · ${escapeHtml(item.source || "Career Unified")}</p></div></li>`).join("") : "<li><p>Nenhum evento registrado.</p></li>"}</ol></section>`;
}
function nextActionPanel(w) {
  return `<section class="rail-panel action-panel"><p class="eyebrow">Próxima ação recomendada</p><h2 id="opportunity-next-action">${escapeHtml(w.nextAction.label)}</h2><p>${escapeHtml(nextActionReason(w.nextAction))}</p><a class="button primary full" data-link href="/opportunities/${encodeURIComponent(w.job.id)}?tab=${w.nextAction.tab}">${escapeHtml(w.nextAction.label)} ${icon("arrow")}</a></section>`;
}

function nextActionReason(nextAction = {}) {
  if (/changeset/i.test(nextAction.reason || "")) {
    return "Os ajustes do currículo estão prontos e precisam da sua revisão antes de gerar a versão.";
  }
  return nextAction.reason || "Revise o contexto e escolha como seguir com esta oportunidade.";
}
function resumeRecommendation(w) {
  const r = w.resumeRecommendation;
  return `<section class="rail-panel"><h3>Currículo base recomendado</h3>${r ? `<div class="rail-document">${icon("document")}<span><strong>${escapeHtml(r.resume?.title || "Currículo base")}</strong><small>${escapeHtml(r.selectedArchetypeId || "GENERAL")} · ${r.coverage == null ? "a analisar" : score(r.coverage)}</small></span></div><p>${escapeHtml(r.reasons?.[0] || "Selecionado pelas evidências disponíveis.")}</p>` : '<p class="muted">Nenhum currículo base disponível.</p>'}</section>`;
}
function applicationMethod(w) {
  const m = w.applicationMethod;
  return `<section class="rail-panel"><h3>Candidatura</h3><dl class="compact-definition"><div><dt>Método</dt><dd>${escapeHtml(statusLabel(m.method))}</dd></div><div><dt>ATS</dt><dd>${escapeHtml(m.atsType)}</dd></div><div><dt>Adaptador</dt><dd>${escapeHtml(m.capability.label)}</dd></div></dl><p class="truth-note">Nenhum envio acontece sem sua ação explícita no site de destino.</p></section>`;
}
function listOrEmpty(items, empty) {
  return items?.length
    ? `<ul class="plain-list">${items.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item.message || item.label || JSON.stringify(item))}</li>`).join("")}</ul>`
    : `<p class="muted">${escapeHtml(empty)}</p>`;
}
function bindWorkspaceActions(root, w, route) {
  const resumeBaseSelect=root.querySelector("[data-resume-base-select]"),resumeTemplateSelect=root.querySelector("[data-resume-template-select]"),resumePreferenceKey=`career.resumeChoice.v2.${w.job.id}`;
  const syncResumeChoice=()=>{const baseOption=resumeBaseSelect?.selectedOptions?.[0],templateOption=resumeTemplateSelect?.selectedOptions?.[0],title=root.querySelector("[data-resume-choice-title]"),scoreNode=root.querySelector("[data-resume-choice-score]"),templateReason=root.querySelector("[data-template-reason]"),templateSummary=root.querySelector("[data-resume-template-summary]");if(title&&baseOption)title.textContent=baseOption.textContent.replace(/ · recomendado| · \d+%/g,"");if(scoreNode&&baseOption)scoreNode.textContent=baseOption.dataset.score?`${Math.round(Number(baseOption.dataset.score))}%`:"será calculado";if(templateReason&&templateOption)templateReason.textContent=templateOption.dataset.reason||"Modelo ATS de uma coluna.";if(templateSummary&&templateOption)templateSummary.textContent=templateOption.dataset.purpose||"Compatibilidade ATS";try{localStorage.setItem(resumePreferenceKey,JSON.stringify({resumeId:resumeBaseSelect?.value||"",templateId:resumeTemplateSelect?.value||""}));}catch{}};
  try{const saved=JSON.parse(localStorage.getItem(resumePreferenceKey)||"{}");if(resumeBaseSelect&&!resumeBaseSelect.disabled&&[...resumeBaseSelect.options].some(item=>item.value===saved.resumeId))resumeBaseSelect.value=saved.resumeId;if(resumeTemplateSelect&&[...resumeTemplateSelect.options].some(item=>item.value===saved.templateId))resumeTemplateSelect.value=saved.templateId;}catch{}
  resumeBaseSelect?.addEventListener("change",syncResumeChoice);
  resumeTemplateSelect?.addEventListener("change",syncResumeChoice);
  syncResumeChoice();
  root.querySelector("[data-verify-workspace]")?.addEventListener("click",async event=>{const button=event.currentTarget;button.disabled=true;button.textContent="Verificando…";try{const result=await api(`/api/opportunities/${encodeURIComponent(w.job.id)}/verify`,{method:"POST"});toast(result.availability?.status==="AVAILABLE"?"Disponibilidade confirmada.":result.availability?.status==="CLOSED"?"A vaga foi marcada como encerrada.":"O portal não permitiu confirmar a vaga.",result.availability?.status==="CLOSED"?"error":"default");await renderOpportunityWorkspace({root,route});}catch(error){button.disabled=false;button.textContent="Verificar";toast(error.message,"error");}});
  const buildResumeVersion = async (button, { withTailoring = true } = {}) => {
    const status = root.querySelector("[data-tailoring-status]");
    button.disabled = true;
    if (status)
      status.textContent = withTailoring
        ? "Criando versão do currículo com os ajustes aprovados…"
        : "Criando versão segura a partir do currículo base…";
    try {
      const prepared = await api("/api/resume-documents/versions", {
        method: "POST",
        skipInvalidation: true,
        body: JSON.stringify({
          resumeId: withTailoring
            ? w.resumeTailoring.resumeId
            : resumeBaseSelect?.value || w.resumeRecommendation.selectedResumeId,
          jobId: w.job.id,
          applicationId: w.application?.id || "",
          templateId: resumeTemplateSelect?.value || "BASE_01",
          archetypeId: w.resumeRecommendation?.selectedArchetypeId || "GENERAL",
          language: resumeBaseSelect?.selectedOptions?.[0]?.dataset.language || w.resumeRecommendation?.resume?.language || "pt-BR",
          tailoringRunId: withTailoring ? w.resumeTailoring.id : "",
        }),
      });
      trackBackgroundJob({
        id: prepared.job.id,
        kind: "RESUME_VERSION",
        statusUrl: `/api/resume-documents/jobs/${encodeURIComponent(prepared.job.id)}`,
          label: withTailoring
            ? "Gerando versão ajustada do currículo…"
            : "Gerando versão do currículo base…",
        targetUrl: `/opportunities/${encodeURIComponent(w.job.id)}?tab=resume`,
      });
      if (status) status.textContent = "A versão está sendo gerada em segundo plano.";
      toast("Geração iniciada. Você pode continuar usando o sistema.");
    } catch (error) {
      if (status) status.textContent = error.message;
      if (withTailoring && w.resumeTailoring?.state === "APPROVED") {
        toast(error.message, "error");
        await renderOpportunityWorkspace({
          root,
          route: { ...route, id: w.job.id, tab: "resume" },
        });
      } else button.disabled = false;
    }
  };
  root.querySelectorAll("[data-review-tailoring]").forEach((button) =>
    button.addEventListener("click", async () => {
      const status = root.querySelector("[data-tailoring-status]"),
        state = button.dataset.reviewTailoring;
      root
        .querySelectorAll("[data-review-tailoring]")
        .forEach((item) => (item.disabled = true));
      if (status) status.textContent = "Registrando revisão dos ajustes…";
      try {
        await api(
          `/api/intelligence/tailoring/${encodeURIComponent(w.resumeTailoring.id)}/review`,
          { method: "POST", body: JSON.stringify({ state }) },
        );
        if (state === "APPROVED") {
          w.resumeTailoring.state = "APPROVED";
          await buildResumeVersion(button);
          return;
        }
        toast("Ajustes rejeitados. A base foi preservada.");
        await renderOpportunityWorkspace({
          root,
          route: { ...route, id: w.job.id, tab: "resume" },
        });
      } catch (error) {
        if (status) status.textContent = error.message;
        root
          .querySelectorAll("[data-review-tailoring]")
          .forEach((item) => (item.disabled = false));
      }
    }),
  );
  root
    .querySelector("[data-build-tailoring-version]")
    ?.addEventListener("click", (event) =>
      buildResumeVersion(event.currentTarget),
    );
  root
    .querySelector("[data-use-base-resume]")
    ?.addEventListener("click", (event) =>
      buildResumeVersion(event.currentTarget, { withTailoring: false }),
    );
  root
    .querySelector("[data-retry-tailoring]")
    ?.addEventListener("click", () =>
      root.querySelector("[data-prepare-resume]")?.click(),
    );
  const recordDecision = async (
    userDecision,
    rejectionReason = "",
    button = null,
  ) => {
      if (button) button.disabled = true;
      try {
        await api(`/api/opportunities/${encodeURIComponent(w.job.id)}/feedback`, {
        method: "PUT",
        body: JSON.stringify({ userDecision, rejectionReason }),
      });
      root
        .querySelectorAll("[data-opportunity-decision]")
        .forEach((item) => {
          const selected = item.dataset.opportunityDecision === userDecision;
          item.classList.toggle("primary", selected);
          item.classList.toggle("quiet", !selected);
          item.disabled = false;
        });
      const rejectChoice = root.querySelector("[data-opportunity-reject-choice]");
      rejectChoice?.classList.toggle("danger", userDecision === "REJECT");
      rejectChoice?.classList.toggle("quiet", userDecision !== "REJECT");
      root.querySelector("[data-workspace-rejection]").hidden = true;
      const feedback = root.querySelector("[data-decision-feedback]");
      if (feedback)
        feedback.textContent = `${
          userDecision === "APPLY"
            ? "Aplicaria"
            : userDecision === "REVIEW"
              ? "Talvez aplicaria"
              : "Não aplicaria"
        } salvo. Esta vaga saiu das filas pendentes e está em Minhas decisões.`;
      toast(
        userDecision === "APPLY"
          ? "Marcada como uma vaga em que você aplicaria."
          : userDecision === "REVIEW"
            ? "Marcada para talvez aplicar."
            : "Marcada como uma vaga em que você não aplicaria.",
      );
      } catch (error) {
        if (button) button.disabled = false;
        toast(error.message, "error");
      }
  };
  root.querySelectorAll("[data-opportunity-decision]").forEach((button) =>
    button.addEventListener("click", () =>
      recordDecision(button.dataset.opportunityDecision, "", button),
    ),
  );
  root.querySelector("[data-show-workspace-rejection]")?.addEventListener("click", () => {
    root.querySelector("[data-workspace-rejection]").hidden = false;
  });
  root.querySelector("[data-cancel-workspace-rejection]")?.addEventListener("click", () => {
    root.querySelector("[data-workspace-rejection]").hidden = true;
  });
  root.querySelector("[data-confirm-workspace-rejection]")?.addEventListener("click", (event) => {
    const reason = root.querySelector("[data-workspace-rejection-reason]").value;
    recordDecision("REJECT", reason, event.currentTarget);
  });
  root
    .querySelector("[data-analyze]")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const status =
        root.querySelector("[data-analysis-status]") ||
        button.parentElement.querySelector(".form-status");
      button.disabled = true;
      button.textContent = w.analysis ? "Atualizando análise…" : "Analisando…";
      if (status)
        status.textContent =
          "Comparando requisitos com Candidate Knowledge e evidências do currículo…";
      try {
        const selectedResumeId = resumeBaseSelect?.value ||
          w.resumeRecommendation?.selectedResumeId || null;
        await api("/api/unified/ats", {
          method: "POST",
          body: JSON.stringify({
            jobId: w.job.id,
            resumeId: selectedResumeId,
          }),
        });
        toast("Análise concluída.");
        await renderOpportunityWorkspace({
          root,
          route: { ...route, id: w.job.id, tab: "analysis" },
        });
      } catch (error) {
        button.disabled = false;
        button.textContent = w.analysis
          ? "Tentar atualizar novamente"
          : "Tentar analisar novamente";
        if (status)
          status.textContent = `Não foi possível concluir: ${error.message}`;
        toast(error.message, "error");
      }
    });
  root
    .querySelector("[data-prepare-resume]")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const status = button.parentElement.querySelector(".form-status");
      button.disabled = true;
      button.textContent = "Iniciando preparação…";
      try {
        const selectedResumeId=resumeBaseSelect?.value||w.resumeRecommendation.selectedResumeId,
          selectedOption=resumeBaseSelect?.selectedOptions?.[0];
        let analysisId=selectedOption?.dataset.analysisId||"";
        if(!analysisId){
          button.textContent="Calculando score original…";
          const analyzed=await api("/api/unified/ats",{method:"POST",skipInvalidation:true,body:JSON.stringify({jobId:w.job.id,resumeId:selectedResumeId})});
          analysisId=analyzed.analysis.id;
          if(selectedOption){selectedOption.dataset.analysisId=analysisId;selectedOption.dataset.score=analyzed.analysis.overallScore??analyzed.analysis.score??"";}
          syncResumeChoice();
        }
        const result = await api("/api/resume-documents/tailor", {
          method: "POST",
          skipInvalidation: true,
          body: JSON.stringify({
            jobId: w.job.id,
            resumeId: selectedResumeId,
            analysisId,
            applicationId: w.application?.id || "",
          }),
        });
        trackBackgroundJob({
          id: result.job.id,
          kind: "RESUME_TAILORING",
          statusUrl: `/api/intelligence/jobs/${encodeURIComponent(result.job.id)}`,
          label: "Ajustando currículo…",
          targetUrl: `/opportunities/${encodeURIComponent(w.job.id)}?tab=resume`,
        });
        button.textContent = "Preparando em segundo plano";
        if (status) status.textContent = "Você pode navegar normalmente enquanto o currículo é preparado.";
        toast("Preparação iniciada. Você pode continuar usando o sistema.");
      } catch (error) {
        button.disabled = false;
        button.textContent = "Tentar novamente";
        if (status) status.textContent = error.message;
        toast(error.message, "error");
      }
    });
  root
    .querySelector("[data-create-application]")
    ?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      const result = await api("/api/unified/application", {
        method: "POST",
        body: JSON.stringify({
          jobId: w.job.id,
          resumeId: w.resumeRecommendation.selectedResumeId,
          resumeVersionId: ["APPROVED", "READY"].includes(
            w.resumeVersion?.status,
          )
            ? w.resumeVersion.id
            : "",
          status: "PLANNED",
        }),
      });
      const applicationId =
        result.application?.id || result.data?.application?.id;
      await api(
        `/api/unified/applications/${encodeURIComponent(applicationId)}/plan`,
        {
          method: "POST",
          body: JSON.stringify({ analysisId: w.analysis?.id || "" }),
        },
      );
      location.assign(
        `/applications/${encodeURIComponent(applicationId)}?tab=summary`,
      );
    });
  if (w.resumeVersion)
    bindResumeReview(root, w.resumeVersion, {
      onComplete: async (_result, context) => {
        if (context?.action !== "REVISED") return;
        await renderOpportunityWorkspace({
          root,
          route: { ...route, id: w.job.id, tab: "resume" },
        });
      },
    });
}
