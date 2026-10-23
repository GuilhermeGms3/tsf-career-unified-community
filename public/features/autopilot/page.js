import { allSettledMap, api } from "../shared/data.js";
import { availabilityView, bindAvailability } from "./availability.js";
import {questionFallbackView,bindQuestionFallback} from "./question-fallback.js";
import {
  escapeHtml,
  formatDate,
  icon,
  pageHeader,
  pill,
  statusLabel, humanText,
  tabs,
  toast,
} from "../../app/ui.js";

const sections = [
  ["profiles", "Busca e envio"],
  ["companies", "Empresas"],
  ["notifications", "WhatsApp"],
  ["runs", "Execuções"],
];
let whatsappPollGeneration = 0;
const diagnosticApi=(path,timeoutMs=2500)=>Promise.race([api(path),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Diagnóstico temporariamente indisponível.")),timeoutMs))]);
export async function renderAutopilot({ root, sectionOverride = "", embedded = false }) {
  const section = sectionOverride ||
      new URLSearchParams(location.search).get("section") || "profiles",
    requests=section==="profiles"?{profiles:api("/api/job-hunt/profiles"),capabilities:api("/api/job-hunt/capabilities"),families:api("/api/discovery-v3/job-families"),runs:api("/api/job-hunt/runs?limit=20&detail=summary"),autoApplyPolicy:api("/api/auto-apply/policy")}:section==="companies"?{companies:api("/api/source-center/companies"),recommendations:api("/api/source-center/companies/recommendations")}:section==="notifications"?{whatsapp:diagnosticApi("/api/whatsapp/status"),profiles:api("/api/job-hunt/profiles"),community:api("/api/discovery-v4/community-sources"),evolutionWebhook:diagnosticApi("/api/discovery-v4/evolution-webhook")}:{runs:api("/api/job-hunt/runs?limit=20")},
    data = await allSettledMap(requests);
  if (section === "profiles") data.availability = (await allSettledMap({ availability: api("/api/opportunities/verification-policy") })).availability;
  for(const key of ["profiles","capabilities","families","runs","autoApplyPolicy","sources","companies","recommendations","whatsapp","community","evolutionWebhook"])data[key]??={ok:true,value:{}};
  const content=`${partialWarning(data)}${renderSection(section, data)}${embedded&&section==="sources"?whatsappInfrastructureView(data.whatsapp.value):""}`;
  root.innerHTML = embedded ? content : `<div class="page">${pageHeader({ eyebrow: "Descoberta contínua", title: "Automação", description: "Políticas, fontes, notificações e aplicação controlada em um único lugar." })}${tabs(
    sections.map(([id, label]) => ({
      id,
      label,
      href: `/autopilot?section=${id}`,
    })),
    section,
  )}${content}</div>`;
  if (section === "notifications")
    renderEvolutionWebhookStatus(
      root,
      data.evolutionWebhook.value?.webhook || {},
    );
  root.querySelector(".community-source-card")?.setAttribute("id", "whatsapp-groups");
  bindAutopilotActions(root, data, section, embedded);
  if (section === "profiles") bindAvailability(root, data.availability?.value);
}
export const renderSourceIntegrations=({root})=>renderAutopilot({root,sectionOverride:"sources",embedded:true});
export async function renderOperationalIntegrations({ root }) {
  const data = await allSettledMap({
    whatsapp: diagnosticApi("/api/whatsapp/status"),
  });
  for (const key of [
    "profiles",
    "sources",
    "community",
    "evolutionWebhook",
    "whatsapp",
  ])
    data[key] ??= { ok: true, value: {} };
  root.innerHTML = `${partialWarning(data)}${whatsappInfrastructureView(data.whatsapp.value)}`;
  bindAutopilotActions(root, data, "sources", true);
}
function renderEvolutionWebhookStatus(root, webhook) {
  const host = root.querySelector(".section-heading")?.parentElement;
  if (!host) return;
  host.insertAdjacentHTML(
    "afterbegin",
    `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Evolution inbound</p><h2>Webhook de grupos</h2><p>Recebe apenas eventos novos; segredo e payload bruto não aparecem no navegador.</p></div>${pill(statusLabel(webhook.status || "NOT_CONFIGURED"), webhook.status === "CONFIGURED" ? "success" : "attention")}</div><dl class="definition-grid"><div><dt>MESSAGES_UPSERT</dt><dd>${webhook.messagesUpsertEnabled ? "Habilitado" : "Não confirmado"}</dd></div><div><dt>Destino</dt><dd>${webhook.targetMatches ? "Correto" : "Não confirmado"}</dd></div><div><dt>Autenticação</dt><dd>${webhook.customHeaderConfigured ? "Header configurado" : webhook.secretConfigured ? "Segredo disponível" : "Segredo ausente"}</dd></div></dl>${webhook.status === "CONFIGURED" ? "" : '<button class="button" type="button" data-configure-evolution-webhook>Configurar webhook explicitamente</button>'}<p class="form-status" data-evolution-webhook-status role="status"></p></section>`,
  );
}
function partialWarning(data) {
  const failed = Object.entries(data)
    .filter(([, result]) => !result.ok)
    .map(([key]) => key);
  return failed.length
    ? `<div class="partial-banner" role="status"><strong>Dados parciais</strong><span>Não foi possível carregar: ${escapeHtml(failed.join(", "))}. As áreas disponíveis continuam utilizáveis.</span></div>`
    : "";
}
function renderSection(section, data) {
  if (section === "profiles")
    return automationMasterControl(
      data.profiles.value?.profiles || [],
      data.autoApplyPolicy.value?.policy,
    ) + availabilityView(data.availability?.value, data.availability?.ok === false) + simpleAutopilotView(
      data.profiles.value?.profiles || [],
      data.families.value?.families || [],
      data.capabilities.value?.sources || [],
    ) + autoApplyPolicyView(data.autoApplyPolicy.value?.policy) + questionFallbackView(data.autoApplyPolicy.value?.questionFallbackPolicy) + effectiveThresholdsView(data.profiles.value?.profiles || []) + `<details class="content-card advanced-config"><summary>Configurações avançadas</summary>${profilesView(
      data.profiles.value?.profiles || [],
      {recentRuns:data.runs.value?.runs||[]},
      data.families.value?.families || [],
      data.capabilities.value || {},
    )}</details>`;
  if (section === "companies") return companyConnectionView(data.companies.value, data.recommendations.value);
  if (section === "notifications")
    return `${whatsappInfrastructureView(data.whatsapp.value)}${notificationPolicyView(data.whatsapp.value, data.profiles.value?.profiles || [])}${sourcesView([],data.community.value?.sources || [],data.whatsapp.value,data.evolutionWebhook.value?.webhook || {})}`;
  return runsView(data.runs.value?.runs || []);
}
function automationMasterControl(profiles = [], autoApplyPolicy = {}) {
  const current = profiles.find((item) => item.enabled) || profiles[0],
    enabled = current?.enabled === true,
    state = !current ? "not-configured" : enabled ? "enabled" : "paused";
  return `<section class="automation-master-control" data-automation-state="${state}" aria-labelledby="automation-master-title"><div class="automation-master-copy"><span class="automation-state-dot" aria-hidden="true"></span><div><p class="eyebrow">Controle da automação</p><h2 id="automation-master-title">${!current ? "Automação não configurada" : enabled ? "Automação ligada" : "Automação pausada"}</h2><p>${enabled ? "A busca recorrente está ativa e seguirá a frequência configurada." : "Nenhuma nova busca será iniciada pela agenda. O Mass Hunt manual continua disponível."}</p></div></div><div class="automation-master-actions">${pill(enabled ? "Ligada" : "Desligada", enabled ? "success" : "neutral")}<button class="button ${enabled ? "" : "primary"}" type="button" data-toggle-job-automation data-profile-id="${escapeHtml(current?.id || "")}" aria-pressed="${enabled}" ${current ? "" : "disabled"}>${icon(enabled ? "clock" : "spark")}${enabled ? "Pausar automação" : "Ligar automação"}</button></div><p class="form-status" data-automation-toggle-status role="status">${current ? "" : "Salve sua busca abaixo para habilitar este controle."}</p><small>Este botão controla a busca agendada. A política de AutoApply por nota permanece independente por segurança.</small></section>`;
}
function simpleAutopilotView(profiles = [], families = [], sources = []) {
  const current=profiles.find(item=>item.enabled)||profiles[0]||{},selectedFamilies=new Set(current.jobFamilies||[]),selectedSources=new Set(current.sourcePreferences?.length?current.sourcePreferences:sources),priorities=current.locationPolicy?.priorities||[],hasLocation=(pattern,remote=false)=>priorities.some(item=>(!remote||item.workModel==="REMOTE")&&pattern.test(`${item.location||""} ${item.remoteScope||""}`)),localDf=hasLocation(/bras[ií]lia|distrito federal|\bdf\b/i),remoteBrazil=hasLocation(/brasil/i,true),localLisbon=hasLocation(/lisboa|lisbon/i),localPorto=hasLocation(/\bporto\b/i),localBraga=hasLocation(/\bbraga\b/i),remotePortugal=hasLocation(/portugal/i,true),frequency=current.schedule?.mode==="INTERVAL"?Number(current.schedule.everyHours||6):24,sourceLabels={indeed:"Indeed",linkedin:"LinkedIn",glassdoor:"Glassdoor",google:"Google Jobs",greenhouse:"Greenhouse",lever:"Lever",ashby:"Ashby",smartrecruiters:"SmartRecruiters",workable:"Workable",iel:"IEL",programathor:"ProgramaThor",solides:"Sólides",recrutei:"Recrutei",nerdin:"Nerdin",remotar:"Remotar",monitored_companies:"Empresas monitoradas"};
  return `<section class="task-hero"><div><p class="eyebrow">Configuração da busca</p><h2>Onde e quando procurar</h2><p>Escolha o que importa em linguagem simples. Use o controle acima para ligar ou pausar a agenda.</p></div><form class="task-form" data-autopilot-simple><fieldset><legend>O que procurar</legend><div class="choice-grid">${families.map(item=>`<label class="check"><input type="checkbox" name="jobFamilies" value="${escapeHtml(item.id)}" ${selectedFamilies.has(item.id)?"checked":""}/> ${escapeHtml(item.label)}</label>`).join("")}</div></fieldset><fieldset><legend>Onde</legend><div class="choice-grid"><label class="check"><input type="checkbox" name="geographies" value="LOCAL_LISBON" ${localLisbon||!profiles.length?"checked":""}/> Lisboa</label><label class="check"><input type="checkbox" name="geographies" value="LOCAL_PORTO" ${localPorto||!profiles.length?"checked":""}/> Porto</label><label class="check"><input type="checkbox" name="geographies" value="LOCAL_BRAGA" ${localBraga?"checked":""}/> Braga</label><label class="check"><input type="checkbox" name="geographies" value="REMOTE_PORTUGAL" ${remotePortugal||!profiles.length?"checked":""}/> Remoto Portugal</label><label class="check"><input type="checkbox" name="geographies" value="LOCAL_DF" ${localDf?"checked":""}/> Brasília / DF</label><label class="check"><input type="checkbox" name="geographies" value="REMOTE_BRAZIL" ${remoteBrazil?"checked":""}/> Remoto Brasil</label></div></fieldset><fieldset><legend>Fontes da busca</legend><div class="choice-grid">${sources.map(source=>`<label class="check"><input type="checkbox" name="sourcePreferences" value="${escapeHtml(source)}" ${selectedSources.has(source)?"checked":""}/> ${escapeHtml(sourceLabels[source]||source)}</label>`).join("")}</div></fieldset><label><span>Frequência</span><select name="everyHours"><option value="6" ${frequency===6?"selected":""}>A cada 6 horas</option><option value="12" ${frequency===12?"selected":""}>A cada 12 horas</option><option value="24" ${frequency===24?"selected":""}>Uma vez por dia</option></select></label><fieldset><legend>Quando encontrar</legend><div class="choice-grid"><label class="check"><input type="checkbox" checked disabled/> Salvar oportunidades</label><label class="check"><input type="checkbox" name="notify" checked/> Me avisar</label><label class="check"><input type="checkbox" name="whatsapp" checked/> Avisar por WhatsApp</label></div></fieldset><button class="button primary" type="submit">Salvar configuração</button><p class="form-status" role="status"></p></form></section>`;
}
function autoApplyPolicyView(policy = {}) {
  const minimumAtsScore = Number(policy.minimumAtsScore ?? 80);
  const whatsappMinimum=Number(policy.whatsappMinimumAtsScore ?? 60),whatsappMaximum=Number(policy.whatsappMaximumAtsScore ?? 79);
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">AutoApply por nota</p><h2>Destino por nota ATS</h2><p>Vale para Mass Hunt, busca específica e vagas adicionadas por link.</p></div>${pill(policy.enabled ? "Ativo" : "Desligado", policy.enabled ? "success" : "neutral")}</div><form class="task-form" data-auto-apply-policy><label class="check"><input type="checkbox" name="enabled" ${policy.enabled ? "checked" : ""}/> Usar os limites abaixo</label><div class="form-grid"><label><span>AutoApply a partir de</span><input name="minimumAtsScore" type="number" min="1" max="100" step="1" value="${minimumAtsScore}" /></label><label><span>WhatsApp a partir de</span><input name="whatsappMinimumAtsScore" type="number" min="0" max="100" step="1" value="${whatsappMinimum}" /></label><label><span>WhatsApp até</span><input name="whatsappMaximumAtsScore" type="number" min="0" max="100" step="1" value="${whatsappMaximum}" /></label></div><p class="field-help">Com a política ativa, notas a partir de ${minimumAtsScore} iniciam AutoApply e, nos destinos homologados, AutoSubmit. De ${whatsappMinimum} a ${whatsappMaximum}, o currículo segue ao WhatsApp para revisão. Fora dessas faixas, fica na plataforma. Qualidade editorial, evidências, elegibilidade, disponibilidade, sessão, formulário, idempotência e recibo continuam obrigatórios.</p><button class="button primary" type="submit">Salvar política de AutoApply</button><p class="form-status" role="status"></p></form></section>`;
}
function effectiveThresholdsView(profiles) {
  const current=profiles.find(profile=>profile.enabled)||profiles[0],limits=current?.effectiveThresholds;
  if(!limits)return "";
  return `<section class="content-card"><h2>Limites efetivos da busca</h2><p>${limits.authority==="AUTO_APPLY_POLICY"?"Política global de encaminhamento ativa":"Limites do perfil de busca"}</p><div class="policy-thresholds"><span>Considerar <strong>${limits.consider}</strong></span><span>Preparar currículo <strong>${limits.prepareResume}</strong></span><span>Notificar <strong>${limits.notify}</strong></span></div></section>`;
}
function profilesView(profiles, status = {}, families = [], capabilities = {}) {
  const runs = status?.recentRuns || [],
    choices = (name, items, label = (item) => item, legend = name) =>
      `<fieldset><legend>${escapeHtml(legend)}</legend><div class="choice-grid">${items.map((item) => `<label class="check"><input type="checkbox" name="${name}" value="${escapeHtml(typeof item === "string" ? item : item.id)}" /> ${escapeHtml(label(item))}</label>`).join("")}</div></fieldset>`,
    sourceLabels = {
      indeed: "Indeed",
      linkedin: "LinkedIn",
      glassdoor: "Glassdoor",
      google: "Google Jobs",
      greenhouse: "Greenhouse",
      lever: "Lever",
      ashby: "Ashby",
      smartrecruiters: "SmartRecruiters",
      workable: "Workable",
      monitored_companies: "Empresas monitoradas",
    };
  return `<section class="autopilot-overview"><div class="autopilot-summary"><article><strong>${profiles.filter((p) => p.enabled).length}</strong><span>Perfis ativos</span></article><article><strong>${runs.reduce((n, r) => n + (r.discoveredCount || 0), 0)}</strong><span>Descobertas recentes</span></article><article><strong>${runs.reduce((n, r) => n + (r.matchedCount || 0), 0)}</strong><span>Consideradas</span></article><article><strong>${runs.reduce((n, r) => n + (r.resumePreparationCount || 0), 0)}</strong><span>Currículos preparados</span></article></div><div class="section-heading"><div><h2>Perfis de busca</h2><p>Search Intent, localização, budget e agenda reais.</p></div><button class="button primary" type="button" data-new-profile>Novo perfil</button></div><div class="profile-list">${profiles.map((p) => `<article class="policy-card"><header><div><h3>${escapeHtml(p.name)}</h3>${pill(p.enabled ? "Ativo" : "Pausado", p.enabled ? "success" : "neutral")}</div><div class="button-row"><button class="button quiet" type="button" data-edit-profile="${escapeHtml(p.id)}">Editar</button><button class="button quiet" type="button" data-run-profile="${escapeHtml(p.id)}">Executar agora</button></div></header><p>${escapeHtml([...(p.jobFamilies || []), ...(p.queries || [])].join(" · ") || "Intent não configurado")}</p><div class="policy-thresholds"><span>Considerar <strong>${p.considerThreshold}</strong></span><span>Preparar <strong>${p.prepareResumeThreshold}</strong></span><span>Notificar <strong>${p.notifyThreshold}</strong></span></div><footer><span>${(p.locationPolicy?.priorities || []).length} prioridade(s) geográfica(s) · ${p.queryBudget?.maxQueries || 0} queries</span><span>Próxima: ${p.nextRunAt ? formatDate(p.nextRunAt, { dateStyle: "short", timeStyle: "short" }) : "pausada"}</span></footer></article>`).join("") || '<div class="empty-inline"><h2>Nenhum perfil criado</h2><p>Crie uma política; ela será salva pausada até sua ativação explícita.</p></div>'}</div><dialog id="profile-dialog" class="wide-dialog"><form method="dialog" class="dialog-card"><header><div><p class="eyebrow">Policy Builder V3</p><h2>Perfil de busca</h2></div><button class="icon-button" value="cancel" aria-label="Fechar">×</button></header><input type="hidden" name="id"/><label><span>Nome</span><input name="name" required /></label><label><span>Termos adicionais, separados por vírgula</span><input name="queries" placeholder="Platform Engineer, Java" /></label>${choices("jobFamilies", families, (item) => item.label, "Famílias profissionais")}${choices("seniorities", capabilities.seniorities || [], (item) => ({ INTERNSHIP: "Estágio", JUNIOR: "Júnior", MID: "Pleno", SENIOR: "Sênior" })[item] || item, "Senioridades")}${choices("workModels", capabilities.workModels || [], (item) => ({ REMOTE: "Remoto", HYBRID: "Híbrido", ONSITE: "Presencial" })[item] || item, "Modalidades")}${choices("sourcePreferences", capabilities.sources || [], (item) => sourceLabels[item] || item, "Fontes")}<fieldset><legend>Prioridade geográfica</legend><div class="location-policy-editor">${[1, 2, 3].map((priority) => `<div><strong>Prioridade ${priority}</strong><input name="location${priority}" placeholder="${priority === 3 ? "Portugal" : priority === 1 ? "Lisboa" : "Porto"}" /><select name="locationModel${priority}"><option value="ONSITE">Presencial</option><option value="HYBRID">Híbrido</option><option value="REMOTE"${priority === 3 ? " selected" : ""}>Remoto</option></select><input name="remoteScope${priority}" placeholder="Escopo remoto (Portugal)" /></div>`).join("")}</div></fieldset><div class="policy-thresholds"><label><span>Considerar</span><input name="considerThreshold" type="number" min="0" max="100" value="70" /></label><label><span>Preparar</span><input name="prepareResumeThreshold" type="number" min="0" max="100" value="82" /></label><label><span>Notificar</span><input name="notifyThreshold" type="number" min="0" max="100" value="90" /></label></div><fieldset><legend>Agenda</legend><div class="form-grid"><label><span>Modo</span><select name="scheduleMode"><option value="WEEKLY">Semanal</option><option value="INTERVAL">Intervalo</option></select></label><label><span>Dias (0–6)</span><input name="scheduleDays" value="1,5" /></label><label><span>Horário</span><input name="scheduleTime" type="time" value="09:00" /></label><label><span>Intervalo em horas</span><input name="everyHours" type="number" min="1" max="168" value="24" /></label></div></fieldset><details><summary>Query Budget avançado</summary><div class="form-grid"><label><span>Máx. queries</span><input name="maxQueries" type="number" min="1" max="60" value="24" /></label><label><span>Queries/provider</span><input name="maxQueriesPerProvider" type="number" min="1" max="30" value="12" /></label><label><span>Máx. requests</span><input name="maxRequests" type="number" min="1" max="240" value="80" /></label><p class="field-help">Execução efetiva: concorrência 1. Deadlines, tentativas e backoff são controlados pelo servidor.</p></div></details><label class="check"><input type="checkbox" name="massHunt" /> Mass Hunt</label><label class="check"><input type="checkbox" name="enabled" /> Ativar execução recorrente</label><div class="button-row"><button class="button" type="button" data-preview-profile>Ver queries</button><button class="button" type="button" data-test-profile>Testar busca</button><button class="button primary" value="save">Salvar perfil</button></div><div class="query-preview" data-query-preview hidden></div><p class="form-status" role="status"></p></form></dialog></section>`;
}
function communityActivity(item) {
  const latest =
    item.lastOpportunityGeneratedAt ||
    item.lastSignalAt ||
    item.lastEventReceivedAt;
  return latest
    ? `Última atividade ${formatDate(latest, { dateStyle: "short", timeStyle: "short" })}`
    : "Nenhuma atividade nova registrada";
}
function communitySavedList(sources = []) {
  return (
    sources
      .map(
        (item) =>
          `<article class="compact-record"><span><strong>${escapeHtml(item.displayName)}</strong><small>${item.enabled ? "Monitoramento opt-in ativo" : "Pausado"} · ${escapeHtml(communityActivity(item))}</small></span>${pill(item.enabled ? "Monitorado" : "Não monitorado", item.enabled ? "success" : "neutral")}</article>`,
      )
      .join("") ||
    '<div class="calm-state"><h3>Nenhum grupo monitorado</h3><p>Grupos novos nunca são habilitados automaticamente.</p></div>'
  );
}
const sourceTone=status=>status==="OPERATIONAL_REAL"?"success":["DEGRADED","BLOCKED"].includes(status)?"attention":"neutral";
const sourceHistory=surface=>{
  const latest=surface.observation||{},history=surface.history||[];
  return `<article class="source-surface"><header><div><strong>${escapeHtml(surface.display_name)}</strong><small>${escapeHtml(surface.discovery_mode)} · ${surface.enabled?"ativada":"desativada"}</small></div>${pill(statusLabel(surface.status),sourceTone(surface.status))}</header><dl class="compact-definition"><div><dt>Última tentativa</dt><dd>${latest.finishedAt?formatDate(latest.finishedAt,{dateStyle:"short",timeStyle:"short"}):"Nunca"}</dd></div><div><dt>Último sucesso real</dt><dd>${latest.lastSuccessAt?formatDate(latest.lastSuccessAt,{dateStyle:"short",timeStyle:"short"}):"Não comprovado"}</dd></div><div><dt>Válidas / novas</dt><dd>${latest.lastValidCount||0} / ${latest.lastNewCount||0}</dd></div><div><dt>Páginas / limite</dt><dd>${latest.pagesScanned||0} / ${latest.resultsLimit||surface.current_limit||0}</dd></div><div><dt>Falhas consecutivas</dt><dd>${latest.consecutiveFailures||0}</dd></div><div><dt>Último erro</dt><dd>${escapeHtml(latest.lastErrorCode||"Nenhum registrado")}</dd></div></dl>${history.length?`<details><summary>Histórico recente</summary><div class="compact-record-list">${history.map(item=>`<article><span><strong>${escapeHtml(statusLabel(item.status))}</strong><small>${formatDate(item.finishedAt,{dateStyle:"short",timeStyle:"short"})} · ${item.lastValidCount} válida(s) · ${item.durationMs} ms</small></span></article>`).join("")}</div></details>`:""}</article>`;
};
function sourceConnectionView(sources, communitySources, whatsapp, evolutionWebhook) {
  const catalog=sources.filter(item=>item.providerId!=="whatsapp"),ready=catalog.filter(item=>item.operationalStatus==="OPERATIONAL_REAL").length,credentialBased=source=>["API_KEY","TOKEN"].includes(source.setupType||source.onboardingType),costLabel=source=>source.costClass==="PAID_OPTIONAL"?"Pago opcional":source.costClass==="PARTNER"?"Parceiro / limitado":"Grátis",actionLabel=source=>source.onboardingType==="TARGET"?"Escolher empresas":credentialBased(source)?source.credentialStatus==="CONNECTED"?"Gerenciar conexão":"Conectar":"Ver detalhes";
  const operationalTelemetry=source=>source.providerId!=="github"&&source.surfaces?.length?`<details class="source-operational" ${source.providerId==="jobspy"?"open":""}><summary>Saúde operacional por fonte</summary><div class="source-surface-list">${source.surfaces.map(sourceHistory).join("")}</div></details>`:"";
  const githubTelemetry=source=>source.providerId==="github"&&source.credentialStatus==="CONNECTED"?`<dl class="compact-definition source-quality"><div><dt>Repositórios</dt><dd>${source.sync?.details?.indexed||0} de ${source.sync?.details?.repositories||0} indexados</dd></div><div><dt>Evidências técnicas</dt><dd>${source.sync?.details?.evidenceItems||0}</dd></div></dl>`:"";
  const qualityTelemetry=source=>source.semanticQuality?`<dl class="compact-definition source-quality"><div><dt>Qualidade semântica</dt><dd>${source.semanticQuality.semanticQualityScore}%</dd></div><div><dt>Vagas analisáveis</dt><dd>${source.semanticQuality.analyzableRate}%</dd></div><div><dt>Duplicadas</dt><dd>${source.semanticQuality.duplicateRate}%</dd></div><div><dt>Cobertura média</dt><dd>${source.semanticQuality.averageEvidenceCoverage==null?"Ainda não medida":`${source.semanticQuality.averageEvidenceCoverage}%`}</dd></div></dl>`:"";
  const sourceQualityTelemetry=source=>source.sourcePortalQuality?.length?`<details class="source-portal-quality"><summary>Qualidade por portal</summary><dl class="compact-definition">${source.sourcePortalQuality.map(item=>`<div><dt>${escapeHtml(item.sourcePortal)}</dt><dd>${item.analyzableRate}% analisáveis · ${item.descriptionAvailableRate}% com descrição</dd></div>`).join("")}</dl></details>`:"";
  const cards=catalog.map(source=>`<article class="source-card" data-source-status="${escapeHtml(source.operationalStatus||source.status)}" data-source-category="${escapeHtml(source.category)}"><header><div><p>${escapeHtml(source.category)}</p><h3>${escapeHtml(source.displayName)}</h3><div class="source-meta">${pill(costLabel(source),source.costClass==="PAID_OPTIONAL"?"neutral":"info")}${pill(source.setupType==="PUBLIC"?"Fonte pública":source.setupType==="TOKEN"?"Token somente leitura":statusLabel(source.setupType),"neutral")}</div></div>${pill(statusLabel(source.operationalStatus||source.status),sourceTone(source.operationalStatus||source.status))}</header><p>${escapeHtml(source.helpText||source.description)}</p><p class="source-session-note">${escapeHtml(source.accountSessionStatus==="NOT_MANAGED"?"A sessão da sua conta não é gerenciada pelo Career Unified.":source.accountSessionStatus==="NOT_REQUIRED"?"Login de conta não é necessário para esta fonte.":"Credencial e sessão de conta são estados separados.")}</p><p class="source-next-action"><strong>${source.nextAction?.includes("Nenhuma ação")?"Estado:":"Configuração:"}</strong> ${escapeHtml(source.nextAction)}</p>${githubTelemetry(source)}${operationalTelemetry(source)}${qualityTelemetry(source)}${sourceQualityTelemetry(source)}${source.providerId==="github"&&source.credentialStatus==="CONNECTED"&&source.syncStatus!=="READY"?`<button class="button primary" type="button" data-sync-github>Sincronizar GitHub</button>`:""}${["MANUAL","PARTNER","UNSUPPORTED"].includes(source.onboardingType)?source.officialDocsUrl?`<a class="button" href="${escapeHtml(source.officialDocsUrl)}" target="_blank" rel="noreferrer">${source.onboardingType==="MANUAL"?"Abrir portal":"Ver canal oficial"} ${icon("external")}</a>`:"":`<button class="button${source.requiredForCoreProduct&&["TARGET_REQUIRED","CREDENTIAL_REQUIRED"].includes(source.status)?" primary":""}" type="button" data-source-dialog="${escapeHtml(source.providerId)}">${actionLabel(source)}</button>`}</article>`).join("");
  const summary=`<section><div class="autopilot-summary source-summary"><article><strong>${ready}</strong><span>Fontes prontas</span></article><article><strong>${catalog.filter(item=>item.costClass==="FREE").length}</strong><span>Fontes gratuitas</span></article><article><strong>${catalog.filter(item=>item.credentialStatus==="NOT_CONFIGURED"&&item.costClass!=="PAID_OPTIONAL").length}</strong><span>Conexões úteis</span></article><article><strong>${catalog.filter(item=>["DEGRADED","ERROR"].includes(item.operationalStatus||item.status)&&item.costClass!=="PAID_OPTIONAL").length}</strong><span>Precisam de atenção</span></article></div><div class="section-heading"><div><h2>Integrações e fontes</h2><p>Fonte pública, credencial, sessão de conta e sincronização são estados separados. O produto principal não exige APIs pagas.</p></div></div><div class="source-grid">${cards}</div></section>`;
  return summary+sourcesView([],communitySources,whatsapp,evolutionWebhook).replace("<h2>Central de Fontes V2</h2>","<h2>Conexões comunitárias</h2>");
}

function companyConnectionView(data={},recommendationData={}) {
  const companies=data.companies||[],recommendations=recommendationData.items||[];
  return `<section><div class="section-heading"><div><h2>Descobrir empresas</h2><p>Recomendações usam somente targets e proveniência já conhecidos, filtrados pelo Search Intent e PreMatch R2.</p></div>${pill(`${companies.filter(item=>item.active).length} ativa(s)`,companies.length?"info":"neutral")}</div><form id="company-search-form" class="inline-form"><label><span>Pesquisar empresa conhecida</span><input name="name" required minlength="2" placeholder="Nome da empresa" /></label><button class="button" type="submit">Pesquisar</button><p class="form-status" role="status"></p><div data-company-search-results></div></form><div class="recommendation-grid">${recommendations.map(item=>`<article class="content-card"><p class="eyebrow">${escapeHtml(item.provider)}</p><h3>${escapeHtml(item.company)}</h3><p>${escapeHtml(humanText(item.reason))}</p><dl class="compact-definition"><div><dt>Amostra</dt><dd>${item.totalJobs} vaga(s)</dd></div><div><dt>PASS</dt><dd>${item.counts.PASS}</dd></div><div><dt>Com alertas</dt><dd>${item.counts.PASS_WITH_WARNINGS}</dd></div><div><dt>Rejeitadas</dt><dd>${item.counts.REJECT}</dd></div></dl>${item.monitored?pill("Já monitorada","success"):`<button class="button primary" type="button" data-recommend-company="${escapeHtml(item.company)}" data-career-url="${escapeHtml(item.careerUrl||"")}">Revisar e adicionar</button>`}</article>`).join("")||'<div class="calm-state"><h3>Sem recomendações ainda</h3><p>Adicione uma URL pública ou execute buscas para criar proveniência real. Não inventamos um diretório global.</p></div>'}</div><div class="section-heading"><div><h2>Adicionar por URL</h2><p>A URL é validada contra SSRF e redirects privados antes de qualquer consulta.</p></div></div><form id="company-form" class="inline-form"><label><span>Empresa</span><input name="company" required /></label><label><span>URL pública de carreiras</span><input name="careerUrl" type="url" required /></label><button class="button" type="button" data-detect-company>Detectar e pré-visualizar</button><button class="button primary" type="submit" disabled data-monitor-company>Monitorar empresa</button><p class="form-status" role="status"></p><div data-company-preview></div></form><div class="section-heading"><div><h2>Empresas monitoradas</h2><p>Pausar não remove vagas, análises, candidaturas nem proveniência.</p></div></div><div class="company-list">${companies.map(item=>`<article><div><h3>${escapeHtml(item.company)}</h3><p>${escapeHtml(item.careerUrl)}</p><small>${escapeHtml(item.provider)} · ${item.stats?.openJobs||0} aberta(s) · última atividade ${item.stats?.lastSeenAt?formatDate(item.stats.lastSeenAt,{dateStyle:"short"}):"não registrada"}</small></div><label class="check"><input type="checkbox" data-company-active="${escapeHtml(item.watchlistId||item.watchlist?.id||"")}" ${item.active?"checked":""}/> Monitorar</label></article>`).join("")||'<div class="empty-inline"><h2>Nenhuma empresa monitorada</h2><p>Nada é ativado automaticamente.</p></div>'}</div></section>`;
}
function sourcesView(
  sources,
  communitySources = [],
  whatsapp = {},
  evolutionWebhook = {},
) {
  const evolutionOnline = whatsapp?.api?.online === true,
    connectionState = whatsapp?.whatsapp?.connectionState || "UNKNOWN",
    connected = connectionState === "CONNECTED",
    monitored = communitySources.filter((item) => item.enabled).length,
    webhookStatus = evolutionWebhook.status || "NOT_CONFIGURED";
  return `<section><div class="section-heading"><div><h2>Central de Fontes V2</h2><p>Capacidade comprovada, configuração e saúde de cada fonte.</p></div></div><div class="source-grid">${sources
    .map(
      (s) =>
        `<article class="source-card"><header><div><p>${escapeHtml(s.category || "Fonte")}</p><h3>${escapeHtml(s.displayName || s.label || s.providerId || s.id)}</h3></div>${pill(s.statusLabel || statusLabel(s.setupStatus || "Não configurada"), s.setupStatus === "READY" ? "success" : "neutral")}</header><p>${escapeHtml(s.whatItDoes || s.description || "Integração de descoberta configurável.")}</p><ul>${(
          s.capabilities || []
        )
          .slice(0, 5)
          .map(
            (c) =>
              `<li>${escapeHtml(typeof c === "string" ? c : c.label || c.capability)}</li>`,
          )
          .join(
            "",
          )}</ul><dl class="compact-definition"><div><dt>Última verificação</dt><dd>${s.lastDiagnostic?.testedAt || s.lastTest?.checkedAt ? formatDate(s.lastDiagnostic?.testedAt || s.lastTest?.checkedAt, { dateStyle: "short", timeStyle: "short" }) : "Nunca"}</dd></div><div><dt>Vagas no teste</dt><dd>${s.lastDiagnostic?.jobsFound ?? s.lastTest?.resultCount ?? 0}</dd></div><div><dt>Problema atual</dt><dd>${escapeHtml(s.lastDiagnostic?.humanMessage || s.lastTest?.message || s.missing || "Nenhum diagnóstico")}</dd></div><div><dt>Próxima ação</dt><dd>${escapeHtml(s.lastDiagnostic?.recommendedAction || s.missing || "Revalidar quando necessário")}</dd></div></dl><button class="button" type="button" data-source-dialog="${escapeHtml(s.providerId || s.id)}">Configurar fonte</button></article>`,
    )
    .join(
      "",
    )}</div><section class="content-card community-source-card" data-evolution-online="${evolutionOnline}" data-whatsapp-connected="${connected}"><div class="section-heading"><div><p class="eyebrow">Fontes comunitárias</p><h2>Grupos do WhatsApp</h2><p>Escolha no Career Unified quais grupos podem originar oportunidades. Nenhum grupo é inferido ou ativado pelo nome.</p></div>${pill(connected ? "Conectado" : "Configuração necessária", connected ? "success" : "attention")}</div><dl class="definition-grid community-runtime-grid"><div><dt>Evolution API</dt><dd>${statusLabel(evolutionOnline ? "ONLINE" : "OFFLINE")}</dd></div><div><dt>WhatsApp</dt><dd>${escapeHtml(statusLabel(connectionState))}</dd></div><div><dt>Recebimento de eventos</dt><dd>${escapeHtml(statusLabel(webhookStatus === "CONFIGURED" ? "CONFIGURED" : webhookStatus === "ERROR" ? "ERROR" : "CONFIG_REQUIRED"))}</dd></div><div><dt>Grupos disponíveis</dt><dd data-available-groups>—</dd></div><div><dt>Grupos monitorados</dt><dd data-monitored-groups>${monitored}</dd></div></dl><div class="safety-banner community-privacy-note"><strong>Somente mensagens novas após a ativação.</strong><span>Nenhuma conversa antiga é importada. Mensagens privadas, enviadas por você ou de grupos não selecionados não entram na busca de vagas.</span></div><div class="compact-record-list" data-community-saved-list>${communitySavedList(communitySources)}</div><div class="button-row"><button class="button primary" type="button" data-manage-groups>Gerenciar grupos monitorados</button></div><p class="form-status" data-group-status role="status">${connected ? "Pronto para carregar os grupos da conta." : evolutionOnline ? "Conecte o WhatsApp para gerenciar grupos." : "Evolution API indisponível."}</p></section><dialog id="whatsapp-groups-dialog" class="wide-dialog"><form method="dialog" class="dialog-card community-groups-dialog"><header><div><p class="eyebrow">Evolution API 2.3.7</p><h2>Grupos monitorados</h2><p>Marque um ou mais grupos e salve a autorização. Participantes e conversas não são carregados.</p></div><button class="icon-button" value="cancel" aria-label="Fechar">×</button></header><div class="community-group-toolbar"><label class="search-field"><span class="sr-only">Pesquisar grupos</span>${icon("search")}<input type="search" data-group-search placeholder="Pesquisar grupos..." aria-label="Pesquisar grupos" disabled /></label><span data-group-dialog-count>Lista ainda não carregada</span></div><div data-group-list data-state="idle"><div class="calm-state"><h3>Lista ainda não carregada</h3><p>Ao abrir, o Career Unified consulta somente nome e identidade técnica dos grupos.</p></div></div><p class="muted" data-group-search-empty hidden>Nenhum grupo corresponde à pesquisa.</p><div class="button-row"><button class="button" type="button" data-load-groups>Atualizar lista</button><button class="button primary" type="button" data-save-groups disabled>Salvar grupos monitorados</button></div><p class="form-status" role="status" aria-live="polite"></p></form></dialog><dialog id="source-dialog" class="wide-dialog"><form method="dialog" class="dialog-card"><header><div><p class="eyebrow">Central de Fontes</p><h2 data-source-title>Configurar fonte</h2><p data-source-description></p></div><button class="icon-button" value="cancel" aria-label="Fechar">×</button></header><input type="hidden" name="providerId" /><div class="source-wizard-summary" data-source-summary></div><label><span>Empresa</span><input name="company" maxlength="160" /></label><label><span>URL pública de carreiras</span><input name="careerUrl" type="url" maxlength="500" /></label><details><summary>Detalhes técnicos</summary><label><span>Identidade do board</span><input name="organizationKey" maxlength="160" /></label><div data-source-credentials></div><div data-source-diagnostic></div></details><label class="check"><input type="checkbox" name="enabled" checked /> Fonte habilitada</label><div class="button-row"><button class="button" type="button" data-detect-source>Detectar da URL</button><button class="button primary" value="save">Salvar</button><button class="button" type="button" data-test-source>Testar conexão</button><button class="button" type="button" data-search-source>Buscar agora</button><a class="button quiet" data-source-docs target="_blank" rel="noreferrer">Documentação oficial ${icon("external")}</a></div><p class="form-status" role="status"></p></form></dialog></section>`;
}
function companiesView(data = {}) {
  const companies = data?.companies || data?.configurations || [];
  return `<section><div class="section-heading"><div><h2>Empresas monitoradas</h2><p>Somente watchlists explicitamente adicionadas aparecem no Company Radar.</p></div>${pill(`${companies.length} monitorada(s)`, companies.length ? "info" : "neutral")}</div><form id="company-form" class="inline-form"><label><span>Empresa</span><input name="company" required /></label><label><span>URL de carreiras</span><input name="careerUrl" type="url" required /></label><label><span>Domínio</span><input name="domain" placeholder="empresa.com" /></label><label><span>ATS opcional</span><select name="providerHint"><option value="">Detectar automaticamente</option><option value="greenhouse">Greenhouse</option><option value="lever">Lever</option><option value="ashby">Ashby</option><option value="smartrecruiters">SmartRecruiters</option><option value="workable">Workable</option></select></label><div class="button-row"><button class="button" type="button" data-detect-company>Detectar ATS</button><button class="button primary" type="submit">Validar e monitorar</button></div><p class="form-status" role="status"></p></form><details class="content-card"><summary>Adicionar várias empresas</summary><p>Uma empresa por linha no formato <code>Nome | URL pública</code>. Cada item é validado isoladamente.</p><textarea data-company-bulk rows="5" placeholder="Empresa A | https://jobs.lever.co/empresa-a"></textarea><button class="button" type="button" data-save-company-bulk>Validar e monitorar lista</button><p class="form-status" data-company-bulk-status></p></details><div class="company-list">${companies.map((c) => `<article><div><h3>${escapeHtml(c.company || c.name)}</h3><p>${escapeHtml(c.careerUrl || c.url)}</p><small>${escapeHtml(c.domain || "")} · ${escapeHtml(c.providerHint || c.detection?.provider || "ATS em revisão")}</small></div>${pill(statusLabel(c.detectionStatus || c.status || "Monitorada"), "neutral")}</article>`).join("") || '<div class="empty-inline"><h2>Nenhuma empresa monitorada</h2><p>Empresas encontradas nas vagas não são adicionadas automaticamente ao radar.</p></div>'}</div></section>`;
}
function notificationsView(w = {}, s = {}) {
  const connected = w?.whatsapp?.connectionState === "CONNECTED";
  return `<section class="notification-layout"><article class="content-card"><div class="section-heading"><div><p class="eyebrow">Canal</p><h2>WhatsApp</h2><p>Receba alertas de alta prioridade com deep link para a oportunidade.</p></div>${pill(connected ? "Conectado" : "Configuração necessária", connected ? "success" : "attention")}</div><dl class="definition-grid"><div><dt>Destino</dt><dd>${escapeHtml(w?.whatsapp?.maskedNumber || w?.configuration?.maskedTarget || "Não configurado")}</dd></div><div><dt>Estado</dt><dd data-whatsapp-state>${escapeHtml(statusLabel(w?.whatsapp?.connectionState))}</dd></div><div><dt>Última verificação</dt><dd>${formatDate(w?.whatsapp?.lastCheckedAt, { dateStyle: "short", timeStyle: "short" })}</dd></div></dl><div class="whatsapp-actions">${connected ? '<button class="button" type="button" data-test-whatsapp>Enviar mensagem de teste</button><button class="button" type="button" data-refresh-whatsapp>Atualizar estado</button><button class="button quiet" type="button" data-connect-whatsapp>Reconectar</button>' : '<button class="button primary" type="button" data-connect-whatsapp>Conectar WhatsApp</button><button class="button" type="button" data-refresh-whatsapp>Atualizar estado</button>'}<a class="button" target="_blank" rel="noreferrer" href="${escapeHtml(w?.configuration?.managerUrl || "http://127.0.0.1:8081/manager")}">Abrir Evolution Manager</a><a class="button" data-link href="/autopilot?section=notifications#whatsapp-groups">Gerenciar grupos monitorados</a><p class="form-status" data-whatsapp-status role="status"></p><div data-whatsapp-qr></div></div><details><summary>Detalhes avançados</summary><dl class="compact-definition"><div><dt>Evolution API</dt><dd>${w?.api?.online ? "Online" : "Offline"}</dd></div><div><dt>n8n</dt><dd>${w?.n8n?.online ? "Online" : w?.n8n?.configured ? "Offline" : "Não configurado"}</dd></div><div><dt>Webhook</dt><dd>${w?.webhook?.configured ? "Configurado" : "Não configurado"}</dd></div><div><dt>Dispatcher</dt><dd>${w?.dispatcher?.enabled ? "Ativo" : "Inativo"}</dd></div><div><dt>Instância</dt><dd>${escapeHtml(w?.configuration?.instanceName || "Não configurada")}</dd></div></dl>${w?.whatsapp?.instanceExists ? '<div class="button-row"><button class="button quiet" type="button" data-whatsapp-danger="logout">Logout</button><button class="button quiet" type="button" data-whatsapp-danger="instance">Excluir instância</button></div>' : ""}</details></article><article class="content-card"><h2>Política humana</h2><p>Alertas informam por que a oportunidade importa e abrem diretamente seu workspace. O QR é temporário e nunca é persistido, enviado ao n8n ou incluído em telemetria.</p></article></section>`;
}
function whatsappInfrastructureView(w={}){
  const connected=w?.whatsapp?.connectionState==="CONNECTED";
  return `<section class="content-card" id="whatsapp-connection"><div class="section-heading"><div><p class="eyebrow">Infraestrutura</p><h2>Conexão do WhatsApp</h2><p>Conecte ou verifique o canal. As preferências sobre quais vagas enviar ficam no Autopilot → Notificações.</p></div>${pill(connected?"Conectado":"Configuração necessária",connected?"success":"attention")}</div><dl class="definition-grid"><div><dt>Destino</dt><dd>${escapeHtml(w?.whatsapp?.maskedNumber||w?.configuration?.maskedTarget||"Não configurado")}</dd></div><div><dt>Estado</dt><dd data-whatsapp-state>${escapeHtml(statusLabel(w?.whatsapp?.connectionState||"DISCONNECTED"))}</dd></div></dl><div class="whatsapp-actions">${connected?'<button class="button" type="button" data-refresh-whatsapp>Atualizar estado</button><button class="button quiet" type="button" data-connect-whatsapp>Reconectar</button>':'<button class="button primary" type="button" data-connect-whatsapp>Conectar WhatsApp</button><button class="button" type="button" data-refresh-whatsapp>Atualizar estado</button>'}<a class="button" target="_blank" rel="noreferrer" href="${escapeHtml(w?.configuration?.managerUrl||"http://127.0.0.1:8081/manager")}">Abrir Evolution Manager</a><p class="form-status" data-whatsapp-status role="status"></p><div data-whatsapp-qr></div></div></section>`;
}
function notificationPolicyView(w={},profiles=[]) {
  const connected=w?.whatsapp?.connectionState==="CONNECTED",current=profiles.find(item=>item.enabled)||profiles[0]||{},policy=current.notificationPolicy||{},classes=new Set(policy.decisionClasses?.length?policy.decisionClasses:["RECOMMENDED","REVIEW"]),delivery=new Set(policy.delivery?.length?policy.delivery:["WHATSAPP"]),fields=new Set(policy.summaryFields?.length?policy.summaryFields:["ROLE","COMPANY","LOCATION","RECOMMENDATION","STRENGTHS_GAPS","JOB_LINK"]);
  return `<section class="notification-layout"><article class="content-card"><div class="section-heading"><div><p class="eyebrow">Comportamento do produto</p><h2>O que devo enviar?</h2><p>Escolha tipos de oportunidade; os limites de AutoApply ficam em Busca e envio.</p></div>${pill(connected?"WhatsApp conectado":"Conexão necessária",connected?"success":"attention")}</div><form class="task-form" data-notification-policy><fieldset><legend>Avise quando encontrar</legend><div class="choice-grid">${[["RECOMMENDED","Oportunidade recomendada"],["REVIEW","Oportunidade que vale revisar"],["STRETCH","Oportunidade de desenvolvimento"]].map(([value,label])=>`<label class="check"><input type="checkbox" name="decisionClasses" value="${value}" ${classes.has(value)?"checked":""}/> ${label}</label>`).join("")}</div></fieldset><fieldset><legend>Entrega</legend><label class="check"><input type="checkbox" name="delivery" value="WHATSAPP" ${delivery.has("WHATSAPP")?"checked":""}/> WhatsApp</label></fieldset><details><summary>Conteúdo do resumo</summary><div class="choice-grid">${[["ROLE","Cargo"],["COMPANY","Empresa"],["LOCATION","Localização"],["RECOMMENDATION","Recomendação"],["STRENGTHS_GAPS","Principais pontos fortes e lacunas"],["JOB_LINK","Link da vaga"]].map(([value,label])=>`<label class="check"><input type="checkbox" name="summaryFields" value="${value}" ${fields.has(value)?"checked":""}/> ${label}</label>`).join("")}</div></details><button class="button primary" type="submit" ${profiles.length?"":"disabled"}>Salvar preferências</button><p class="form-status" role="status">${profiles.length?"":"Crie primeiro uma busca automática para salvar preferências."}</p></form></article><article class="content-card"><h2>${connected?"WhatsApp pronto para alertas":"Conecte o WhatsApp para receber alertas"}</h2><p>Conexão, alertas e grupos monitorados estão reunidos nesta página.</p><div class="button-row"><a class="button" href="#whatsapp-connection">Ver conexão</a><a class="button" href="#whatsapp-groups">Gerenciar grupos monitorados</a>${connected?'<button class="button" type="button" data-test-whatsapp>Enviar mensagem de teste</button>':""}</div><p class="form-status" data-whatsapp-status role="status"></p></article></section>`;
}
function runInspector(run){const report=run.report||{},planner=report.queryPlanner||{},coverage=report.coverage||{},sources=report.sourceReports||[],used=sources.filter(item=>item.called!==false&&item.status!=="BUDGET_SKIPPED"),filters=report.filterReasons||{},errors=report.errors||[];return `<details class="run-inspector"><summary>Inspecionar execução</summary><dl class="definition-grid"><div><dt>Consultas planejadas / executadas</dt><dd>${planner.configuredQueryBudget??report.expandedQueries?.length??0} / ${run.queryCount||report.expandedQueryDetails?.length||0}</dd></div><div><dt>Providers planejados / utilizados</dt><dd>${report.providers?.length||0} / ${used.length}</dd></div><div><dt>Combinações família × geografia</dt><dd>${coverage.queryCombinationCoverage?.covered||0} / ${coverage.queryCombinationCoverage?.total||planner.requiredCombinationCount||0}</dd></div><div><dt>Requests executadas / possíveis</dt><dd>${coverage.providerQueryCoverage?.executed||0} / ${coverage.providerQueryCoverage?.potential||0}</dd></div></dl>${planner.diagnostics?.length?`<div class="safety-banner"><strong>Limite de cobertura</strong><span>${planner.diagnostics.map(item=>escapeHtml(item.message)).join(" ")}</span></div>`:""}<h4>Resultados por fonte</h4><div class="compact-record-list">${sources.map(item=>`<article><span><strong>${escapeHtml(item.provider)}</strong><small>${item.rawResults||0} bruta(s) · ${item.newResults||0} nova(s) · ${item.duplicates||0} duplicada(s) · ${item.requestCount||0} request(s)</small></span>${pill(statusLabel(item.status),sourceTone(item.status))}${item.sites?.length?`<small>${item.sites.map(site=>`${escapeHtml(site.site||site.source)}: ${escapeHtml(statusLabel(site.status))} (${site.acceptedResults||0})`).join(" · ")}</small>`:""}</article>`).join("")||"<p>Nenhum provider executado.</p>"}</div><h4>Filtros e descartes</h4><p>${Object.entries(filters).map(([key,value])=>`${escapeHtml(humanText(key))}: ${Number(value)||0}`).join(" · ")||"Nenhum descarte registrado."}</p><p><strong>Duplicatas:</strong> ${run.duplicateCount||0} · <strong>Erros:</strong> ${errors.length}</p>${errors.length?`<ul>${errors.slice(0,10).map(item=>`<li>${escapeHtml(item.errorCode||item.stage||"Erro não classificado")}</li>`).join("")}</ul>`:""}</details>`;}
function runsView(runs) {
  return `<section><div class="section-heading"><div><h2>Execuções</h2><p>Resultados reais do Mass Hunt e das buscas agendadas.</p></div></div><div class="run-list">${runs.map((r) => `<article><span class="run-status ${String(r.status).toLowerCase()}">${icon(r.status === "COMPLETED" ? "check" : "clock")}</span><div><h3>${escapeHtml(statusLabel(r.status))}</h3><p>${r.queryCount || 0} consultas · ${r.discoveredCount || 0} descobertas · ${r.matchedCount || 0} consideradas · ${r.alertCount || 0} alertas</p><small>${formatDate(r.startedAt || r.createdAt, { dateStyle: "medium", timeStyle: "short" })}</small>${runInspector(r)}</div></article>`).join("") || '<p class="muted">Nenhuma execução registrada.</p>'}</div></section>`;
}
function profilePayload(form, existing = {}) {
  const value = Object.fromEntries(new FormData(form)),
    split = (text) =>
      String(text || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    checked = (name) =>
      [...form.querySelectorAll(`[name="${name}"]:checked`)].map(
        (item) => item.value,
      ),
    priorities = [1, 2, 3]
      .map((priority) => ({
        priority,
        location: value[`location${priority}`],
        workModel: value[`locationModel${priority}`],
        remoteScope: value[`remoteScope${priority}`],
        accepted: true,
      }))
      .filter((item) => item.location || item.workModel === "REMOTE");
  return {
    ...existing,
    name: value.name,
    queries: split(value.queries),
    jobFamilies: checked("jobFamilies"),
    seniorities: checked("seniorities"),
    locations: priorities.map((item) => item.location).filter(Boolean),
    locationPolicy: { priorities, allowOnsiteOutsideArea: false },
    sourcePreferences: checked("sourcePreferences"),
    workModels: checked("workModels"),
    considerThreshold: Number(value.considerThreshold),
    prepareResumeThreshold: Number(value.prepareResumeThreshold),
    notifyThreshold: Number(value.notifyThreshold),
    prepareResume: true,
    massHunt: form.elements.massHunt.checked,
    enabled: form.elements.enabled.checked,
    schedule: {
      mode: value.scheduleMode,
      days: split(value.scheduleDays).map(Number),
      time: value.scheduleTime,
      everyHours: Number(value.everyHours),
    },
    queryBudget: {
      maxQueries: Number(value.maxQueries),
    maxRequests: Number(value.maxRequests),
      maxQueriesPerProvider: Number(value.maxQueriesPerProvider),
    },
    allowedEligibility: existing.allowedEligibility || [
      "ELIGIBLE",
      "ELIGIBLE_WITH_WARNINGS",
    ],
    notificationPolicy: existing.notificationPolicy || {
      maxInstantAlerts: 3,
      digestEnabled: true,
      quietHours: { enabled: true, start: "22:00", end: "08:00" },
    },
  };
}
function bindAutopilotActions(root, data, section, embedded = false) {
  bindQuestionFallback(root);
  root.querySelector("[data-auto-apply-policy]")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget,status=form.querySelector(".form-status"),minimumAtsScore=Number(form.elements.minimumAtsScore.value),whatsappMinimumAtsScore=Number(form.elements.whatsappMinimumAtsScore.value),whatsappMaximumAtsScore=Number(form.elements.whatsappMaximumAtsScore.value);
    if(![minimumAtsScore,whatsappMinimumAtsScore,whatsappMaximumAtsScore].every(Number.isInteger)||minimumAtsScore<1||minimumAtsScore>100||whatsappMinimumAtsScore<0||whatsappMinimumAtsScore>whatsappMaximumAtsScore||whatsappMaximumAtsScore>=minimumAtsScore){status.textContent="Defina uma faixa de WhatsApp válida abaixo da nota de envio automático.";return;}
    status.textContent="Salvando política…";
    try{await api("/api/auto-apply/policy",{method:"PUT",body:JSON.stringify({enabled:form.elements.enabled.checked,minimumAtsScore,whatsappMinimumAtsScore,whatsappMaximumAtsScore})});await renderAutopilot({root,sectionOverride:section,embedded});toast("Política de AutoApply atualizada.");}
    catch(error){status.textContent=error.message;}
  });
  root
    .querySelector("[data-configure-evolution-webhook]")
    ?.addEventListener("click", async (event) => {
      const status = root.querySelector("[data-evolution-webhook-status]");
      event.currentTarget.disabled = true;
      status.textContent = "Configurando somente MESSAGES_UPSERT…";
      try {
        const result = await api(
          "/api/discovery-v4/evolution-webhook/configure",
          { method: "POST", body: "{}" },
        );
        status.textContent =
          result.webhook.status === "CONFIGURED"
            ? "Webhook configurado."
            : "A Evolution respondeu, mas a configuração ainda não foi confirmada.";
        toast(status.textContent);
      } catch (error) {
        status.textContent = error.message;
        event.currentTarget.disabled = false;
      }
    });
  root.querySelectorAll('dialog [value="cancel"]').forEach((button) =>
    button.addEventListener("click", (event) => {
      event.preventDefault();
      button.closest("dialog").close("cancel");
    }),
  );
  const profileDialog = root.querySelector("#profile-dialog"),
    profiles = data.profiles.value?.profiles || [];
  const simpleForm=root.querySelector("[data-autopilot-simple]"),currentProfile=profiles.find(profile=>profile.enabled)||profiles[0];
  if(simpleForm && currentProfile){
    simpleForm.elements.notify.checked=currentProfile.notificationPolicy?.decisionClasses?.length!==0;
    simpleForm.elements.whatsapp.checked=currentProfile.notificationPolicy?.delivery?.includes("WHATSAPP")!==false;
  }
  root.querySelector("[data-toggle-job-automation]")?.addEventListener("click",async event=>{
    const button=event.currentTarget,profile=profiles.find(item=>item.id===button.dataset.profileId),status=root.querySelector("[data-automation-toggle-status]");
    if(!profile){status.textContent="Salve primeiro uma configuração de busca.";return;}
    const enabled=profile.enabled!==true;
    button.disabled=true;
    status.textContent=enabled?"Ligando automação…":"Pausando automação…";
    try{
      await api(`/api/job-hunt/profiles/${encodeURIComponent(profile.id)}`,{method:"PUT",body:JSON.stringify({...profile,enabled})});
      await renderAutopilot({root,sectionOverride:section,embedded});
      toast(enabled?"Automação ligada.":"Automação pausada.");
    }catch(error){
      button.disabled=false;
      status.textContent=error.message;
      toast("Não foi possível alterar a automação.","error");
    }
  });
  root.querySelector("[data-autopilot-simple]")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget,status=form.querySelector(".form-status"),current=profiles.find(item=>item.enabled)||profiles[0]||{},familyIds=[...form.querySelectorAll('[name="jobFamilies"]:checked')].map(item=>item.value),geographies=[...form.querySelectorAll('[name="geographies"]:checked')].map(item=>item.value);
    if(!familyIds.length){status.textContent="Escolha ao menos uma área.";return;}
    if(!geographies.length){status.textContent="Escolha ao menos uma região em Portugal ou no Brasil.";return;}
    const priorities=[];
    if(geographies.includes("LOCAL_DF"))priorities.push({priority:priorities.length+1,location:"Brasília, DF",workModel:"HYBRID",remoteScope:"",accepted:true});
    if(geographies.includes("REMOTE_BRAZIL"))priorities.push({priority:priorities.length+1,location:"Brasil",workModel:"REMOTE",remoteScope:"Brasil",accepted:true});
    if(geographies.includes("LOCAL_LISBON"))priorities.push({priority:priorities.length+1,location:"Lisboa, Portugal",workModel:"HYBRID",remoteScope:"",accepted:true});
    if(geographies.includes("LOCAL_PORTO"))priorities.push({priority:priorities.length+1,location:"Porto, Portugal",workModel:"HYBRID",remoteScope:"",accepted:true});
    if(geographies.includes("LOCAL_BRAGA"))priorities.push({priority:priorities.length+1,location:"Braga, Portugal",workModel:"HYBRID",remoteScope:"",accepted:true});
    if(geographies.includes("REMOTE_PORTUGAL"))priorities.push({priority:priorities.length+1,location:"Portugal",workModel:"REMOTE",remoteScope:"Portugal",accepted:true});
    const sourcePreferences=[...form.querySelectorAll('[name="sourcePreferences"]:checked')].map(item=>item.value);
    if(!sourcePreferences.length){status.textContent="Selecione ao menos uma fonte de vagas.";return;}
    const payload={...current,name:current.name||"Minha busca automática",enabled:current.enabled===true,jobFamilies:familyIds,seniorities:current.seniorities?.length?current.seniorities:["INTERNSHIP","JUNIOR"],locations:priorities.map(item=>item.location),locationPolicy:{priorities,allowOnsiteOutsideArea:false},workModels:[...new Set(priorities.map(item=>item.workModel))],sourcePreferences,considerThreshold:current.considerThreshold??70,prepareResumeThreshold:current.prepareResumeThreshold??82,notifyThreshold:current.notifyThreshold??90,prepareResume:true,schedule:{...(current.schedule||{}),mode:"INTERVAL",everyHours:Number(form.elements.everyHours.value)},queryBudget:{...(current.queryBudget||{}),maxQueries:Math.max(6,Number(current.queryBudget?.maxQueries)||0),maxQueriesPerProvider:Math.max(2,Number(current.queryBudget?.maxQueriesPerProvider)||0),maxRequests:Math.max(20,Number(current.queryBudget?.maxRequests)||0),concurrency:1},notificationPolicy:{...(current.notificationPolicy||{}),decisionClasses:form.elements.notify.checked?["RECOMMENDED","REVIEW"]:[],delivery:form.elements.whatsapp.checked?["WHATSAPP"]:[]}};
    status.textContent="Salvando automação…";
    try{await api(current.id?`/api/job-hunt/profiles/${encodeURIComponent(current.id)}`:"/api/job-hunt/profiles",{method:current.id?"PUT":"POST",body:JSON.stringify(payload)});await renderAutopilot({root,sectionOverride:section,embedded});toast("Configuração da busca atualizada.");}catch(error){status.textContent=error.message;}
  });
  root.querySelector("[data-notification-policy]")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget,status=form.querySelector(".form-status"),current=profiles.find(item=>item.enabled)||profiles[0];
    if(!current){status.textContent="Crie primeiro uma busca automática.";return;}
    const checked=name=>[...form.querySelectorAll(`[name="${name}"]:checked`)].map(item=>item.value),payload={...current,notificationPolicy:{...(current.notificationPolicy||{}),decisionClasses:checked("decisionClasses"),delivery:checked("delivery"),summaryFields:checked("summaryFields")}};
    status.textContent="Salvando preferências…";
    try{await api(`/api/job-hunt/profiles/${encodeURIComponent(current.id)}`,{method:"PUT",body:JSON.stringify(payload)});status.textContent="Preferências de notificação salvas.";toast("Preferências salvas.");}catch(error){status.textContent=error.message;}
  });
  const openProfile = (profile = null) => {
    const form = profileDialog.querySelector("form");
    form.reset();
    form.elements.id.value = profile?.id || "";
    form.elements.name.value = profile?.name || "";
    form.elements.queries.value = (profile?.queries || []).join(", ");
    const selected = {
      jobFamilies: profile?.jobFamilies || [],
      seniorities: profile?.seniorities || ["INTERNSHIP", "JUNIOR"],
      workModels: profile?.workModels || ["REMOTE", "HYBRID", "ONSITE"],
      sourcePreferences: profile?.sourcePreferences || [
        "indeed",
        "linkedin",
        "glassdoor",
        "google",
      ],
    };
    for (const [name, values] of Object.entries(selected))
      form
        .querySelectorAll(`[name="${name}"]`)
        .forEach((input) => (input.checked = values.includes(input.value)));
    const priorities = profile?.locationPolicy?.priorities || [
      {
        priority: 1,
        location: "Portugal",
        workModel: "REMOTE",
        remoteScope: "Portugal",
      },
    ];
    for (let priority = 1; priority <= 3; priority += 1) {
      const item =
        priorities.find((value) => value.priority === priority) || {};
      form.elements[`location${priority}`].value = item.location || "";
      form.elements[`locationModel${priority}`].value =
        item.workModel || (priority === 3 ? "REMOTE" : "ONSITE");
      form.elements[`remoteScope${priority}`].value = item.remoteScope || "";
    }
    form.elements.considerThreshold.value = profile?.considerThreshold ?? 70;
    form.elements.prepareResumeThreshold.value =
      profile?.prepareResumeThreshold ?? 82;
    form.elements.notifyThreshold.value = profile?.notifyThreshold ?? 90;
    form.elements.massHunt.checked = profile?.massHunt === true;
    form.elements.enabled.checked = profile?.enabled === true;
    form.elements.scheduleMode.value = profile?.schedule?.mode || "WEEKLY";
    form.elements.scheduleDays.value = (profile?.schedule?.days || [1, 5]).join(
      ",",
    );
    form.elements.scheduleTime.value = profile?.schedule?.time || "09:00";
    form.elements.everyHours.value = profile?.schedule?.everyHours || 24;
    for (const [name, fallback] of Object.entries({
      maxQueries: 24,
      maxRequests: 80,
      maxQueriesPerProvider: 12,
    }))
      form.elements[name].value = profile?.queryBudget?.[name] ?? fallback;
    profileDialog.showModal();
  };
  root
    .querySelector("[data-new-profile]")
    ?.addEventListener("click", () => openProfile());
  root
    .querySelectorAll("[data-edit-profile]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        openProfile(
          profiles.find((item) => item.id === button.dataset.editProfile),
        ),
      ),
    );
  profileDialog?.addEventListener("close", async () => {
    if (profileDialog.returnValue !== "save") return;
    const form = profileDialog.querySelector("form"),
      value = Object.fromEntries(new FormData(form)),
      existing = profiles.find((item) => item.id === value.id),
      payload = profilePayload(form, existing),
      consider = payload.considerThreshold,
      prepare = payload.prepareResumeThreshold,
      notify = payload.notifyThreshold,
      status = form.querySelector(".form-status");
    if (!(consider <= prepare && prepare <= notify)) {
      status.textContent =
        "Os limiares devem crescer de considerar para preparar e notificar.";
      profileDialog.showModal();
      return;
    }
    try {
      await api(
        value.id
          ? `/api/job-hunt/profiles/${encodeURIComponent(value.id)}`
          : "/api/job-hunt/profiles",
        { method: value.id ? "PUT" : "POST", body: JSON.stringify(payload) },
      );
      toast(value.id ? "Perfil atualizado." : "Perfil criado.");
      location.reload();
    } catch (error) {
      status.textContent = error.message;
      profileDialog.showModal();
    }
  });
  const previewProfile = async (test = false) => {
    const form = profileDialog.querySelector("form"),
      existing =
        profiles.find((item) => item.id === form.elements.id.value) || {},
      payload = profilePayload(form, existing),
      status = form.querySelector(".form-status"),
      panel = form.querySelector("[data-query-preview]");
    status.textContent = test
      ? "Executando busca pequena…"
      : "Expandindo Search Intent…";
    try {
      const response = await api(
        test
          ? "/api/job-hunt/test-search"
          : "/api/discovery-v3/search-intent/preview",
        {
          method: "POST",
          body: JSON.stringify(
            test
              ? payload
              : {
                  intent: {
                    name: payload.name,
                    families: payload.jobFamilies,
                    customTerms: payload.queries,
                    seniorities: payload.seniorities,
                    locationPolicy: payload.locationPolicy,
                  },
                  queryBudget: payload.queryBudget,
                },
          ),
        },
      );
      const result = test ? response.result : response.preview,
        queries = result.preview?.queries || result.queries || [];
      const summary = test
        ? `<dl class="definition-grid"><div><dt>Vagas recebidas</dt><dd>${result.summary.rawJobs}</dd></div><div><dt>Normalizadas</dt><dd>${result.summary.normalized}</dd></div><div><dt>Duplicadas</dt><dd>${result.summary.duplicates}</dd></div><div><dt>Novas</dt><dd>${result.summary.newJobs}</dd></div><div><dt>Erros</dt><dd>${result.summary.errors}</dd></div></dl><p>Nenhum agendamento foi ativado.</p>`
        : "";
      panel.hidden = false;
      panel.innerHTML = `<h3>${test ? "Resultado do teste de busca" : "Como o Career Unified vai buscar"}</h3><ol>${queries.map((item) => `<li><strong>${escapeHtml(item.query)}</strong><span>${escapeHtml(item.reason || "")}</span></li>`).join("")}</ol>${summary}`;
      status.textContent = test
        ? "Teste concluído."
        : result.truncated
          ? "Prévia limitada pelo limite de consultas."
          : "Prévia atualizada.";
    } catch (error) {
      status.textContent = error.message;
    }
  };
  profileDialog
    ?.querySelector("[data-preview-profile]")
    ?.addEventListener("click", () => previewProfile(false));
  profileDialog
    ?.querySelector("[data-test-profile]")
    ?.addEventListener("click", () => previewProfile(true));
  root.querySelectorAll("[data-run-profile]").forEach((button) =>
    button.addEventListener("click", async () => {
      button.disabled = true;
      await api(
        `/api/job-hunt/profiles/${encodeURIComponent(button.dataset.runProfile)}/run`,
        { method: "POST", body: "{}" },
      );
      toast("Busca concluída.");
      location.reload();
    }),
  );
  const groupsDialog = root.querySelector("#whatsapp-groups-dialog"),
    savedGroups = new Map(
      (data.community.value?.sources || []).map((item) => [
        item.groupJid,
        item,
      ]),
    ),
    communityCard = root.querySelector(".community-source-card"),
    groupList = groupsDialog?.querySelector("[data-group-list]"),
    groupSearch = groupsDialog?.querySelector("[data-group-search]"),
    groupSearchEmpty = groupsDialog?.querySelector(
      "[data-group-search-empty]",
    ),
    groupDialogCount = groupsDialog?.querySelector(
      "[data-group-dialog-count]",
    ),
    loadGroupsButton = groupsDialog?.querySelector("[data-load-groups]"),
    saveGroupsButton = groupsDialog?.querySelector("[data-save-groups]"),
    groupsStatus = groupsDialog?.querySelector(".form-status"),
    splitGroupFilter = (value) =>
      String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    filtersCount = (filters = {}) =>
      Object.values(filters).reduce(
        (total, values) => total + (Array.isArray(values) ? values.length : 0),
        0,
      );
  let groupsLoaded = false;
  const updateGroupRow = (input) => {
      const row = input.closest("[data-community-source]"),
        status = row.querySelector("[data-group-monitoring-status]"),
        summary = row.querySelector("[data-group-filter-summary]"),
        filters = Object.fromEntries(
          [...row.querySelectorAll("[data-filter]")].map((field) => [
            field.dataset.filter,
            splitGroupFilter(field.value),
          ]),
        ),
        count = filtersCount(filters);
      status.textContent = input.checked ? "MONITORADO" : "NÃO MONITORADO";
      status.className = `pill ${input.checked ? "pill-success" : "pill-neutral"}`;
      summary.textContent = count
        ? `${count} restrição(ões) adicional(is)`
        : "Sem filtros adicionais";
    },
    filterGroupRows = () => {
      const query = String(groupSearch?.value || "")
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toLowerCase()
          .trim(),
        rows = [...(groupList?.querySelectorAll("[data-community-source]") || [])];
      rows.forEach((row) => {
        row.hidden = Boolean(query && !row.dataset.searchValue.includes(query));
      });
      const visible = rows.filter((row) => !row.hidden).length,
        selected = rows.filter(
          (row) => row.querySelector('[name="communityGroup"]')?.checked,
        ).length;
      if (groupSearchEmpty) groupSearchEmpty.hidden = visible > 0;
      if (groupDialogCount)
        groupDialogCount.textContent = `${visible} de ${rows.length} grupo(s) · ${selected} selecionado(s)`;
    },
    renderGroups = (groups) => {
      groupList.innerHTML = groups.length
        ? `<div class="community-filter-list">${groups
            .map((group) => {
              const saved = savedGroups.get(group.groupJid),
                filters = saved?.filters || {},
                checked = saved?.enabled === true,
                searchValue = `${group.displayName} ${group.groupJid}`
                  .normalize("NFD")
                  .replace(/\p{Diacritic}/gu, "")
                  .toLowerCase();
              return `<article class="community-group-row" data-community-source data-search-value="${escapeHtml(searchValue)}"><div class="community-group-heading"><label class="check"><input type="checkbox" name="communityGroup" value="${escapeHtml(group.groupJid)}" data-group-name="${escapeHtml(group.displayName)}" ${checked ? "checked" : ""}/> <span><strong>${escapeHtml(group.displayName)}</strong><small>Grupo da instância conectada · participantes não carregados</small></span></label><span class="pill ${checked ? "pill-success" : "pill-neutral"}" data-group-monitoring-status>${checked ? "MONITORADO" : "NÃO MONITORADO"}</span></div><div class="community-group-options"><span data-group-filter-summary>${filtersCount(filters) ? `${filtersCount(filters)} restrição(ões) adicional(is)` : "Sem filtros adicionais"}</span><details><summary>Configurar filtros</summary><p class="muted">O Search Intent global continua valendo; estes filtros apenas restringem este grupo.</p><div class="form-grid"><label><span>Famílias</span><input data-filter="jobFamilies" value="${escapeHtml((filters.jobFamilies || []).join(", "))}" placeholder="NOC, infraestrutura"/></label><label><span>Senioridades</span><input data-filter="seniorities" value="${escapeHtml((filters.seniorities || []).join(", "))}" placeholder="INTERNSHIP, JUNIOR"/></label><label><span>Localizações</span><input data-filter="locationHints" value="${escapeHtml((filters.locationHints || []).join(", "))}" placeholder="Lisboa, Porto, Portugal"/></label><label><span>Termos adicionais</span><input data-filter="includeTerms" value="${escapeHtml((filters.includeTerms || []).join(", "))}" placeholder="Linux, Zabbix"/></label><label><span>Termos excluídos</span><input data-filter="excludeTerms" value="${escapeHtml((filters.excludeTerms || []).join(", "))}" placeholder="sênior, vendas"/></label></div></details><details><summary>Detalhes técnicos</summary><dl class="compact-definition"><div><dt>Provider</dt><dd>EVOLUTION_WHATSAPP</dd></div><div><dt>External ID</dt><dd><code>${escapeHtml(group.groupJid)}</code></dd></div></dl></details></div></article>`;
            })
            .join("")}</div>`
        : '<div class="calm-state"><h3>Nenhum grupo disponível</h3><p>A instância conectada não retornou grupos.</p></div>';
      groupList.dataset.state = groups.length ? "ready" : "empty";
      groupsLoaded = true;
      groupSearch.disabled = !groups.length;
      saveGroupsButton.disabled = !groups.length;
      communityCard.querySelector("[data-available-groups]").textContent =
        String(groups.length);
      groupList
        .querySelectorAll('[name="communityGroup"]')
        .forEach(updateGroupRow);
      filterGroupRows();
    },
    loadGroups = async () => {
      const evolutionOnline = communityCard.dataset.evolutionOnline === "true",
        connected = communityCard.dataset.whatsappConnected === "true";
      if (!evolutionOnline || !connected) {
        const message = !evolutionOnline
          ? "Evolution API offline. A lista não pode ser carregada agora."
          : "WhatsApp desconectado. Reconecte a instância antes de listar grupos.";
        groupList.dataset.state = "unavailable";
        groupList.innerHTML = `<div class="calm-state"><h3>Grupos indisponíveis</h3><p>${escapeHtml(message)}</p></div>`;
        groupsStatus.textContent = message;
        return;
      }
      loadGroupsButton.disabled = true;
      saveGroupsButton.disabled = true;
      groupSearch.disabled = true;
      groupList.dataset.state = "loading";
      groupList.innerHTML =
        '<div class="community-groups-loading" role="status"><span class="spinner"></span><strong>Carregando grupos reais…</strong><small>Somente nomes e identidades técnicas, sem participantes.</small></div>';
      groupsStatus.textContent = "Consultando metadados na Evolution API…";
      try {
        const result = await api("/api/discovery-v4/whatsapp/groups");
        renderGroups(result.groups || []);
        groupsStatus.textContent = `${(result.groups || []).length} grupo(s) encontrado(s). Nenhum grupo novo foi ativado automaticamente.`;
      } catch (error) {
        groupsLoaded = false;
        groupList.dataset.state = "error";
        groupList.innerHTML = `<div class="calm-state"><h3>Não foi possível carregar os grupos</h3><p>${escapeHtml(error.message)}</p></div>`;
        groupsStatus.textContent = `Erro ao carregar grupos: ${error.message}`;
      } finally {
        loadGroupsButton.disabled = false;
      }
    };
  root
    .querySelector("[data-manage-groups]")
    ?.addEventListener("click", () => {
      groupsDialog.showModal();
      if (!groupsLoaded) loadGroups();
    });
  loadGroupsButton?.addEventListener("click", loadGroups);
  groupSearch?.addEventListener("input", filterGroupRows);
  groupList?.addEventListener("change", (event) => {
    if (event.target.matches('[name="communityGroup"],[data-filter]')) {
      const input = event.target
        .closest("[data-community-source]")
        ?.querySelector('[name="communityGroup"]');
      if (input) updateGroupRow(input);
      filterGroupRows();
    }
  });
  groupsDialog
    ?.querySelector("[data-save-groups]")
    ?.addEventListener("click", async (event) => {
      const saveButton = event.currentTarget,
        visible = [
          ...groupsDialog.querySelectorAll('[name="communityGroup"]'),
        ];
      if (!groupsLoaded) return;
      saveButton.disabled = true;
      loadGroupsButton.disabled = true;
      try {
        const sources = visible
          .filter((input) => input.checked || savedGroups.has(input.value))
          .map((input) => {
          const card = input.closest("[data-community-source]"),
            filters = Object.fromEntries(
              [...card.querySelectorAll("[data-filter]")].map((field) => [
                field.dataset.filter,
                splitGroupFilter(field.value),
              ]),
            );
          return {
            groupJid: input.value,
            displayName: input.dataset.groupName,
            enabled: input.checked,
            filters,
          };
          });
        const result = await api("/api/discovery-v4/community-sources", {
          method: "PUT",
          body: JSON.stringify({ sources }),
        });
        savedGroups.clear();
        (result.sources || sources).forEach((item) =>
          savedGroups.set(item.groupJid, item),
        );
        const saved = [...savedGroups.values()],
          monitored = saved.filter((item) => item.enabled).length;
        communityCard.querySelector("[data-monitored-groups]").textContent =
          String(monitored);
        communityCard.querySelector("[data-community-saved-list]").innerHTML =
          communitySavedList(saved);
        communityCard.querySelector("[data-group-status]").textContent =
          `${monitored} grupo(s) monitorado(s). Somente mensagens novas serão analisadas.`;
        groupsStatus.textContent = "Grupos monitorados e filtros salvos.";
        visible.forEach(updateGroupRow);
        toast("Grupos monitorados atualizados.");
      } catch (error) {
        groupsStatus.textContent = `Erro ao salvar grupos: ${error.message}`;
      } finally {
        saveButton.disabled = false;
        loadGroupsButton.disabled = false;
      }
    });
  root.querySelectorAll("[data-sync-github]").forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;const original=button.textContent;button.textContent="Sincronizando…";try{const result=await api("/api/candidate-knowledge/providers/github/sync",{method:"POST",body:"{}"}),summary=result.sync||{};toast(`GitHub sincronizado: ${summary.indexed||0} repositório(s), ${summary.evidenceItems||0} evidência(s).`);await renderAutopilot({root,sectionOverride:section,embedded});}catch(error){button.disabled=false;button.textContent=original;toast(`Falha na sincronização: ${error.message}`);}}));
  const dialog = root.querySelector("#source-dialog");
  root.querySelectorAll("[data-source-dialog]").forEach((button) =>
    button.addEventListener("click", () => {
      const source = (data.sources.value?.sources || []).find(
          (item) =>
            (item.providerId || item.id) === button.dataset.sourceDialog,
        ),
        form = dialog.querySelector("form"),
        diagnostic = source?.lastDiagnostic || {};
      if(source?.onboardingType==="TARGET"){location.href="/autopilot?section=companies";return;}
      form.reset();
       if(!form.elements.credential)form.querySelector("details").insertAdjacentHTML("beforebegin",`<label data-credential-field><span data-credential-label>Credencial</span><input name="credential" type="password" autocomplete="new-password" maxlength="500" placeholder="Nunca será exibida novamente" /><small data-credential-help></small></label><div class="button-row" data-credential-actions><button class="button" type="button" data-validate-credential>Testar conexão</button><button class="button primary" type="button" data-connect-credential>Conectar</button><button class="button quiet" type="button" data-remove-credential>Remover conexão</button></div>`);
      form.querySelectorAll("[data-validate-credential],[data-connect-credential],[data-remove-credential]").forEach(action=>{if(action.dataset.credentialBound)return;action.dataset.credentialBound="true";action.addEventListener("click",async event=>{event.stopPropagation();const provider=form.elements.providerId.value,status=form.querySelector(".form-status"),credential=form.elements.credential?.value||"";action.disabled=true;try{if(action.matches("[data-remove-credential]")){await api(`/api/source-center/credentials/${encodeURIComponent(provider)}`,{method:"DELETE"});form.elements.credential.value="";dialog.close("removed");toast("Conexão removida.");await renderAutopilot({root,sectionOverride:section,embedded});}else if(action.matches("[data-validate-credential]")){const result=await api(`/api/source-center/credentials/${encodeURIComponent(provider)}/validate`,{method:"POST",body:JSON.stringify({credential})});status.textContent=`Credencial válida (${result.result.latencyMs} ms). Ela ainda não foi salva.`;}else{await api(`/api/source-center/credentials/${encodeURIComponent(provider)}`,{method:"POST",body:JSON.stringify({credential})});form.elements.credential.value="";dialog.close("connected");toast("Fonte conectada. Sincronize para indexar as evidências.");await renderAutopilot({root,sectionOverride:section,embedded});}}catch(error){status.textContent=error.message;}finally{action.disabled=false;}});});
      form.elements.providerId.value = button.dataset.sourceDialog;
      form.elements.company.value = source?.identity?.company || "";
      form.elements.careerUrl.value = source?.identity?.careerUrl || "";
      form.elements.organizationKey.value =
        source?.identity?.organizationKey || "";
      form.elements.enabled.checked = source?.enabled !== false;
      dialog.querySelector("[data-source-title]").textContent =
        source?.displayName || source?.providerId || "Configurar fonte";
      dialog.querySelector("[data-source-description]").textContent =
        source?.whatItDoes || source?.description || "";
       const sync=source?.sync?.details||{};
       dialog.querySelector("[data-source-summary]").innerHTML =
         `<strong>${escapeHtml(source?.statusLabel || statusLabel(source?.status))}</strong><p>${escapeHtml(source?.nextAction || "Fonte pronta para revalidação.")}</p><dl class="compact-definition"><div><dt>Disponibilidade</dt><dd>${escapeHtml(statusLabel(source?.availabilityStatus))}</dd></div><div><dt>Credencial</dt><dd>${escapeHtml(statusLabel(source?.credentialStatus))}</dd></div><div><dt>Sessão da conta</dt><dd>${escapeHtml(statusLabel(source?.accountSessionStatus))}</dd></div><div><dt>Sincronização</dt><dd>${escapeHtml(statusLabel(source?.syncStatus))}</dd></div>${source?.providerId==="github"?`<div><dt>Repositórios</dt><dd>${sync.repositories||0} descobertos · ${sync.indexed||0} indexados</dd></div><div><dt>Evidências</dt><dd>${sync.evidenceItems||0}</dd></div>`:""}</dl>${source?.coverage?`<details><summary>Capacidade e limitações</summary><dl class="compact-definition"><div><dt>Cobertura</dt><dd>${escapeHtml(source.coverage.locations||"Não informado")}</dd></div><div><dt>Modo de descoberta</dt><dd>${escapeHtml(source.coverage.discoveryMode||"Não informado")}</dd></div><div><dt>Tipos</dt><dd>${escapeHtml((source.coverage.opportunityTypes||[]).join(", ")||"Não informado")}</dd></div><div><dt>Autenticação</dt><dd>${escapeHtml(source.coverage.authentication||"Não informado")}</dd></div><div><dt>Limitações</dt><dd>${escapeHtml(source.coverage.limitations||"Nenhuma declarada")}</dd></div></dl></details>`:""}`;
      dialog.querySelector("[data-source-credentials]").innerHTML = (
        source?.credential ? [source.credential] : []
      ).length
        ? `<h3>Credencial protegida</h3><p>${escapeHtml(source.credential.maskedHint)} · validada em ${formatDate(source.credential.validatedAt,{dateStyle:"short",timeStyle:"short"})}</p>`
        : "<p>Nenhuma credencial é necessária para esta capacidade.</p>";
      dialog.querySelector("[data-source-diagnostic]").innerHTML =
        `<h3>Último diagnóstico</h3><dl class="compact-definition"><div><dt>Mensagem</dt><dd>${escapeHtml(diagnostic.humanMessage || source?.lastTest?.message || "Nunca testada")}</dd></div><div><dt>Ação recomendada</dt><dd>${escapeHtml(diagnostic.recommendedAction || source?.missing || "Testar quando necessário")}</dd></div><div><dt>Capability</dt><dd>${escapeHtml(diagnostic.capability || "Não testada")}</dd></div><div><dt>Latência</dt><dd>${diagnostic.latencyMs ?? source?.lastTest?.latencyMs ?? 0} ms</dd></div><div><dt>Vagas</dt><dd>${diagnostic.jobsFound ?? source?.lastTest?.resultCount ?? 0}</dd></div><div><dt>Código</dt><dd>${escapeHtml(diagnostic.errorCode || source?.lastTest?.errorCode || "—")}</dd></div></dl>`;
      const docs = dialog.querySelector("[data-source-docs]");
      docs.href = source?.officialDocsUrl || "#";
      docs.hidden = !source?.officialDocsUrl;
       const credentialBased=["API_KEY","TOKEN"].includes(source?.setupType||source?.onboardingType);
       form.querySelector("[data-credential-field]").hidden=!credentialBased;
       form.querySelector("[data-credential-actions]").hidden=!credentialBased;
       form.querySelector("[data-credential-label]").textContent=source?.setupType==="TOKEN"?"GitHub Fine-grained Personal Access Token":"Chave de API";
       form.querySelector("[data-credential-help]").textContent=source?.setupType==="TOKEN"?"Permissões: leitura de metadados e conteúdos apenas nos repositórios autorizados.":"A credencial é testada e armazenada no cofre local criptografado.";
      form.querySelector("[data-remove-credential]").hidden=!source?.credential;
      for(const name of ["company","careerUrl","organizationKey","enabled"])form.elements[name]?.closest("label")?.toggleAttribute("hidden",source?.onboardingType!=="TARGET");
      form.querySelector('button[value="save"]').hidden=source?.onboardingType!=="TARGET";
      form.querySelector("[data-detect-source]").hidden=source?.onboardingType!=="TARGET";
      form.querySelector("[data-test-source]").hidden=!["NONE","TARGET"].includes(source?.onboardingType);
      dialog.querySelector("[data-search-source]").disabled =
        !source?.supportsSearch || !["READY","CONNECTED"].includes(source?.status);
       dialog.showModal();
    }),
  );
  const requestedProvider=new URLSearchParams(location.search).get("provider");
  if(requestedProvider)root.querySelector(`[data-source-dialog="${CSS.escape(requestedProvider)}"]`)?.click();
  dialog?.addEventListener("close", async () => {
    if (dialog.returnValue !== "save") return;
    const form = dialog.querySelector("form"),
      values = Object.fromEntries(new FormData(form));
    values.enabled = form.elements.enabled.checked;
    const provider = values.providerId,
      status = form.querySelector(".form-status");
    try {
      await api(`/api/source-configurations/${encodeURIComponent(provider)}`, {
        method: "PUT",
        body: JSON.stringify(values),
      });
      toast("Fonte salva.");
    } catch (error) {
      status.textContent = error.message;
      dialog.showModal();
    }
  });
  dialog
    ?.querySelector("[data-test-source]")
    ?.addEventListener("click", async (event) => {
      const form = dialog.querySelector("form"),
        status = form.querySelector(".form-status"),
        values = Object.fromEntries(new FormData(form)),
        provider = values.providerId;
      values.enabled = form.elements.enabled.checked;
      event.currentTarget.disabled = true;
      status.textContent = "Salvando configuração e testando conexão…";
      try {
        await api(
          `/api/source-configurations/${encodeURIComponent(provider)}`,
          { method: "PUT", body: JSON.stringify(values) },
        );
        const data = await api(
            `/api/source-configurations/${encodeURIComponent(provider)}/test`,
            { method: "POST", body: "{}" },
          ),
          diagnostic = data.diagnostic || data.result || {};
        status.textContent =
          diagnostic.humanMessage || diagnostic.message || "Teste concluído.";
        toast("Teste de fonte concluído.");
      } catch (error) {
        status.textContent = error.message;
      } finally {
        event.currentTarget.disabled = false;
      }
    });
  dialog
    ?.querySelector("[data-detect-source]")
    ?.addEventListener("click", async () => {
      const form = dialog.querySelector("form"),
        status = form.querySelector(".form-status");
      status.textContent = "Detectando ATS e identidade…";
      try {
        const data = await api("/api/source-configurations/detect", {
          method: "POST",
          body: JSON.stringify({ careerUrl: form.elements.careerUrl.value }),
        });
        form.elements.organizationKey.value =
          data.detection.organizationKey || "";
        status.textContent = data.detection.humanMessage;
      } catch (error) {
        status.textContent = error.message;
      }
    });
  dialog
    ?.querySelector("[data-search-source]")
    ?.addEventListener("click", async (event) => {
      const form = dialog.querySelector("form"),
        status = form.querySelector(".form-status"),
        provider = form.elements.providerId.value;
      event.currentTarget.disabled = true;
      status.textContent = "Executando busca pequena…";
      try {
        const data = await api(
            `/api/source-configurations/${encodeURIComponent(provider)}/search`,
            {
              method: "POST",
              body: JSON.stringify({
                query: "vagas",
                location: "Portugal",
                limit: 10,
              }),
            },
          ),
          result = data.result;
        status.textContent = `${result.discoveredCount || 0} encontradas · ${result.newCount || 0} novas · ${result.duplicateCount || 0} duplicadas.`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        event.currentTarget.disabled = false;
      }
    });
  root
    .querySelector("#company-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        status = form.querySelector(".form-status");
      try {
        await api("/api/source-center/companies/monitor", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        toast("Empresa adicionada ao radar.");
        location.reload();
      } catch (error) {
        status.textContent = error.message;
      }
    });
  root
    .querySelector("[data-detect-company]")
    ?.addEventListener("click", async () => {
      const form = root.querySelector("#company-form"),
        status = form.querySelector(".form-status");
      status.textContent = "Detectando ATS…";
      try {
        const data = await api("/api/source-center/companies/preview", {
          method: "POST",
          body: JSON.stringify(Object.fromEntries(new FormData(form))),
        });
        form.dataset.previewReady=data.detection.status==="READY"?"true":"false";
        form.querySelector("[data-monitor-company]").disabled=data.detection.status!=="READY";
        form.querySelector("[data-company-preview]").innerHTML=`<dl class="compact-definition"><div><dt>ATS detectado</dt><dd>${escapeHtml(data.detection.provider||"Em revisão")}</dd></div><div><dt>Vagas consultadas</dt><dd>${data.assessment?.totalJobs||0}</dd></div><div><dt>PASS</dt><dd>${data.assessment?.counts?.PASS||0}</dd></div><div><dt>Com alertas</dt><dd>${data.assessment?.counts?.PASS_WITH_WARNINGS||0}</dd></div></dl><p>${escapeHtml(data.assessment?.reason||data.detection.humanMessage)}</p>`;
        status.textContent = data.detection.status==="READY"?"Prévia concluída. Revise e confirme o monitoramento.":data.detection.humanMessage;
      } catch (error) {
        status.textContent = error.message;
      }
    });
  root.querySelector("#company-search-form")?.addEventListener("submit",async event=>{event.preventDefault();const form=event.currentTarget,status=form.querySelector(".form-status"),results=form.querySelector("[data-company-search-results]");try{const response=await api("/api/source-center/companies/search",{method:"POST",body:JSON.stringify(Object.fromEntries(new FormData(form)))});status.textContent=response.message;results.innerHTML=(response.items||[]).map(item=>`<article class="compact-record"><span><strong>${escapeHtml(item.company)}</strong><small>${escapeHtml(item.provider)} · ${item.stats?.knownJobs||0} vaga(s) conhecida(s)</small></span></article>`).join("");}catch(error){status.textContent=error.message;}});
  root.querySelectorAll("[data-company-active]").forEach(input=>input.addEventListener("change",async()=>{input.disabled=true;try{await api(`/api/source-center/companies/${encodeURIComponent(input.dataset.companyActive)}/active`,{method:"PATCH",body:JSON.stringify({active:input.checked})});toast(input.checked?"Monitoramento ativado.":"Monitoramento pausado; histórico preservado.");}catch(error){input.checked=!input.checked;toast(error.message);}finally{input.disabled=false;}}));
  root.querySelectorAll("[data-recommend-company]").forEach(button=>button.addEventListener("click",()=>{const form=root.querySelector("#company-form");form.elements.company.value=button.dataset.recommendCompany;form.elements.careerUrl.value=button.dataset.careerUrl;form.scrollIntoView({behavior:"smooth",block:"center"});form.elements.careerUrl.focus();}));
  root
    .querySelector("[data-save-company-bulk]")
    ?.addEventListener("click", async () => {
      const status = root.querySelector("[data-company-bulk-status]"),
        companies = String(
          root.querySelector("[data-company-bulk]").value || "",
        )
          .split(/\r?\n/)
          .map((line) => {
            const [name, careerUrl] = line
              .split("|")
              .map((value) => value.trim());
            return { name, careerUrl };
          })
          .filter((item) => item.name && item.careerUrl);
      status.textContent = "Validando empresas…";
      try {
        const data = await api("/api/discovery-v3/company-radar/bulk", {
            method: "POST",
            body: JSON.stringify({ companies }),
          }),
          ok = data.results.filter((item) => item.ok).length;
        status.textContent = `${ok} monitorada(s); ${data.results.length - ok} item(ns) exigem correção.`;
      } catch (error) {
        status.textContent = error.message;
      }
    });
  root
    .querySelector("[data-connect-whatsapp]")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget,
        status = root.querySelector("[data-whatsapp-status]"),
        qr = root.querySelector("[data-whatsapp-qr]"),
        generation = ++whatsappPollGeneration;
      button.disabled = true;
      try {
        const connection = await api("/api/whatsapp/connect", {
          method: "POST",
          body: "{}",
        });
        if (connection.qr)
          qr.innerHTML = `<img class="whatsapp-qr" src="${escapeHtml(connection.qr)}" alt="QR Code temporário para conectar o WhatsApp" /><p data-qr-countdown>QR gerado. Tempo estimado: ${connection.expiresInSeconds || 60}s.</p><button class="button" type="button" data-generate-whatsapp-qr>Gerar novo QR</button>`;
        button.disabled = false;
        status.textContent =
          "Abra Dispositivos conectados no WhatsApp e leia o QR. Aguardando pareamento…";
        for (let attempt = 0; attempt < 40; attempt += 1) {
          if (attempt > 0)
            await new Promise((resolve) => setTimeout(resolve, 3000));
          if (generation !== whatsappPollGeneration) return;
          const result = await api("/api/whatsapp/connection-state", { cache: false });
          if (result.whatsapp?.connectionState === "CONNECTED") {
            status.textContent = "WhatsApp conectado";
            root.querySelector("[data-whatsapp-state]").textContent =
              "Conectado";
            button.textContent = "Conectado";
            return;
          }
          const countdown = qr.querySelector("[data-qr-countdown]");
          if (countdown)
            countdown.textContent = `Aguardando pareamento… ${Math.max(0, 120 - (attempt + 1) * 3)}s da janela de acompanhamento.`;
        }
        status.textContent =
          "Código expirado ou pareamento ainda pendente. Gere um novo QR ou atualize o estado.";
        button.disabled = false;
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
  root
    .querySelector("[data-whatsapp-qr]")
    ?.addEventListener("click", (event) => {
      if (event.target.closest("[data-generate-whatsapp-qr]"))
        root.querySelector("[data-connect-whatsapp]")?.click();
    });
  root
    .querySelector("[data-refresh-whatsapp]")
    ?.addEventListener("click", async (event) => {
      const status = root.querySelector("[data-whatsapp-status]");
      event.currentTarget.disabled = true;
      try {
        const data = await api("/api/whatsapp/connection-state", { cache: false });
        root.querySelector("[data-whatsapp-state]").textContent = statusLabel(
          data.whatsapp?.connectionState,
        );
        status.textContent = `Estado atualizado: ${statusLabel(data.whatsapp?.connectionState)}.`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        event.currentTarget.disabled = false;
      }
    });
  root.querySelectorAll("[data-whatsapp-danger]").forEach((button) =>
    button.addEventListener("click", async () => {
      const instance = data.whatsapp.value?.configuration?.instanceName,
        status = root.querySelector("[data-whatsapp-status]"),
        confirmation = window.prompt(`Digite ${instance} para confirmar.`);
      if (confirmation !== instance) {
        status.textContent = "Ação cancelada: confirmação não confere.";
        return;
      }
      try {
        await api(`/api/whatsapp/${button.dataset.whatsappDanger}`, {
          method: "DELETE",
          body: JSON.stringify({ confirmation }),
        });
        status.textContent = "Ação concluída.";
        location.reload();
      } catch (error) {
        status.textContent = error.message;
      }
    }),
  );
  root
    .querySelector("[data-test-whatsapp]")
    ?.addEventListener("click", async (event) => {
      const status = root.querySelector("[data-whatsapp-status]");
      event.currentTarget.disabled = true;
      try {
        await api("/api/whatsapp/test-message", { method: "POST", body: "{}" });
        status.textContent = "Mensagem enviada para o destino configurado.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        event.currentTarget.disabled = false;
      }
    });
}
