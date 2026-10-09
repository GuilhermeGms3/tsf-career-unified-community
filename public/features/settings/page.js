import { allSettledMap, api } from "../shared/data.js";
import {
  escapeHtml,
  pageHeader,
  pill,
  statusLabel,
  tabs,
  toast,
} from "../../app/ui.js";
import { renderObservability } from "../observability/page.js";

const settingsTabs = [
  ["general", "Geral"],
  ["intelligence", "Inteligência"],
  ["data", "Dados e backup"],
  ["integrations", "Integrações"],
  ["diagnostics", "Diagnóstico"],
  ["security", "Segurança"],
];
const localIntelligenceProviders = {
  ollama: {
    label: "Ollama",
    endpoint: "http://host.docker.internal:11434",
  },
  "lm-studio": {
    label: "LM Studio",
    endpoint: "http://host.docker.internal:1234/v1",
  },
};

function intelligenceModelSelect(name, label, current, models) {
  const available = [...new Set(models.filter(Boolean))],
    options = current && !available.includes(current) ? [current, ...available] : available;
  return `<label><span>${label}</span><select name="${name}"><option value="">Não usar</option>${options.map((model) => `<option value="${escapeHtml(model)}" ${model === current ? "selected" : ""}>${escapeHtml(model)}</option>`).join("")}</select></label>`;
}
export async function renderSettings({ root }) {
  const section =
    new URLSearchParams(location.search).get("section") || "general";
  if (section === "logs") {
    return renderObservability({root,route:{section:'logs'}});
  }
  if (section === "integrations") {
    root.innerHTML = `<div class="page settings-page">${pageHeader({ eyebrow: "Configuração real", title: "Configurações", description: "Preferências, integrações e diagnóstico com estados explícitos." })}${tabs(
      settingsTabs.map(([id, label]) => ({
        id,
        label,
        href: `/settings?section=${id}`,
      })),
      section,
    )}<section class="settings-panel integrations-authority"><div class="section-heading"><div><p class="eyebrow">Automação externa</p><h2>Integrações</h2><p>O n8n é a única integração operacional configurada nesta área. Descoberta fica em Fontes, contas de portais ficam em Cofres e WhatsApp fica na seção própria da Automação.</p></div></div><div data-integrations-host></div></section></div>`;
    const n8nRequest = api("/api/integrations/n8n").catch((error) => ({ error }));
    const host = root.querySelector("[data-integrations-host]");
    host.innerHTML = "";
    const n8n = await n8nRequest;
    host.insertAdjacentHTML("beforeend", n8nIntegration(n8n));
    bindN8nIntegration(root);
    return;
  }
  const dependencyLoaders = {
      general: () => ({ profile: api("/api/profile") }),
      intelligence: () => ({
        intelligence: api("/api/intelligence/settings"),
        status: api("/api/intelligence/status"),
      }),
      diagnostics: () => ({
        status: api("/api/intelligence/status"),
        engine: api("/api/engine/status"),
        runtime: api("/api/runtime-diagnostics", { cache: false }),
        compiler: api("/api/resume-documents/compiler-health", { cache: false }),
        documentMetrics: api("/api/resume-documents/metrics", { cache: false }),
      }),
      data: () => ({}),
      security: () => ({}),
    },
    data = await allSettledMap(dependencyLoaders[section]?.() || {});
  root.innerHTML = `<div class="page settings-page">${pageHeader({ eyebrow: "Configuração real", title: "Configurações", description: "Preferências, inteligência local, dados, integrações e diagnóstico. Internos técnicos ficam em segundo plano." })}${tabs(
    settingsTabs.map(([id, label]) => ({
      id,
      label,
      href: `/settings?section=${id}`,
    })),
    section,
  )}${settingsSection(section, data)}</div>`;
  bindSettings(root, section);
}
function injectBatchLogFilters(root, params) {
  const search = root.querySelector('[data-log-filters] [name="search"]')?.closest("label");
  if (!search) return;
  search.insertAdjacentHTML("beforebegin", [["batchRunId","Lote de currículos"],["batchItemId","Item do lote"],["jobId","Vaga"],["resumeId","Currículo"]].map(([name,label])=>`<label><span>${label}</span><input name="${name}" value="${escapeHtml(params.get(name)||"")}"/></label>`).join(""));
}
function logsSection(data, params) {
  const logs = data.logs || [];
  return `<section class="settings-panel"><div class="section-heading"><div><h2>Logs de descoberta</h2><p>Retenção de ${data.retention?.days || 30} dias e no máximo ${data.retention?.maxRows || 5000} eventos. Segredos, tokens, cookies e credenciais são removidos antes da persistência.</p></div>${pill(`${logs.length} evento(s)`, "info")}</div><form class="log-filters" data-log-filters><label><span>Nível</span><select name="level"><option value="">Todos</option>${["DEBUG", "INFO", "WARN", "ERROR"].map((value) => `<option value="${value}" ${params.get("level") === value ? "selected" : ""}>${statusLabel(value)}</option>`).join("")}</select></label><label><span>Categoria</span><input name="category" value="${escapeHtml(params.get("category") || "")}" placeholder="DISCOVERY"/></label><label><span>Fonte</span><input name="provider" value="${escapeHtml(params.get("provider") || "")}" placeholder="jobspy"/></label><label><span>Execução</span><input name="runId" value="${escapeHtml(params.get("runId") || "")}"/></label><label><span>Buscar</span><input name="search" type="search" value="${escapeHtml(params.get("search") || "")}" placeholder="evento, consulta ou código"/></label><button class="button primary" type="submit">Filtrar</button></form>${data.error ? `<div class="safety-banner"><strong>Logs indisponíveis</strong><span>${escapeHtml(data.error)}</span></div>` : ""}<div class="log-list">${logs.length ? logs.map((item) => `<article class="log-entry"><header><div>${pill(statusLabel(item.level), item.level === "ERROR" ? "attention" : item.level === "WARN" ? "neutral" : "info")} <strong>${escapeHtml(statusLabel(item.event))}</strong></div><time>${escapeHtml(formatLogTime(item.timestamp))}</time></header><p>${escapeHtml(statusLabel(item.event))}</p><dl class="compact-definition"><div><dt>Status</dt><dd>${escapeHtml(statusLabel(item.status))}</dd></div><div><dt>Provedor / fonte</dt><dd>${escapeHtml([item.provider, item.source].filter(Boolean).join(" / ") || "—")}</dd></div><div><dt>Resultados</dt><dd>${item.resultCount || 0}</dd></div><div><dt>Duração</dt><dd>${item.durationMs || 0} ms</dd></div>${item.reasonCode ? `<div><dt>Código</dt><dd>${escapeHtml(statusLabel(item.reasonCode))}</dd></div>` : ""}</dl>${item.query ? `<small>Consulta: ${escapeHtml(item.query)}</small>` : ""}<details><summary>Metadados sanitizados</summary><pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre></details></article>`).join("") : `<div class="calm-state"><h3>Nenhum evento encontrado</h3><p>Ajuste os filtros ou execute uma descoberta.</p></div>`}</div></section>`;
}
const formatLogTime = (value) => {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(value));
  } catch {
    return String(value || "");
  }
};
function bindLogFilters(root) {
  root
    .querySelector("[data-log-filters]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const params = new URLSearchParams({ section: "logs" });
      for (const [key, value] of new FormData(event.currentTarget))
        if (String(value).trim()) params.set(key, String(value).trim());
      location.href = `/settings?${params}`;
    });
}
function settingsSection(section, d) {
  if (section === "general") {
    const p = d.profile.value?.profile || d.profile.value || {};
    return `<section class="settings-panel"><h2>Geral</h2><p>Dados principais usados em currículos e candidatura.</p><form id="general-settings" class="settings-form"><label><span>Nome completo</span><input name="personal.fullName" value="${escapeHtml(p.personal?.fullName || "")}" autocomplete="name" /></label><label><span>Email</span><input name="personal.email" type="email" value="${escapeHtml(p.personal?.email || "")}" autocomplete="email" /></label><label><span>Título profissional</span><input name="career.headline" value="${escapeHtml(p.career?.headline || "")}" /></label><button class="button primary" type="submit">Salvar configurações</button><p class="form-status" role="status"></p></form></section>`;
  }
  if (section === "intelligence") {
    const s = d.status.value || {},
      cfg = d.intelligence.value?.settings || {},
      provider = cfg.provider || s.provider || "ollama",
      providerConfig = localIntelligenceProviders[provider] || localIntelligenceProviders.ollama,
      models = (s.models || []).filter((item) => item.installed !== false).map((item) => item.modelName);
    const health = s.health?.status || s.status || "NOT_CONFIGURED";
    return `<section class="settings-panel"><div class="section-heading"><div><h2>Inteligência local</h2><p>Ollama ou LM Studio apoiam tarefas delimitadas; regras de estado e evidências continuam determinísticas.</p></div>${pill(statusLabel(health), health === "HEALTHY" ? "success" : "attention")}</div><form id="intelligence-settings" class="settings-form"><label><span>Servidor local</span><select name="provider" data-intelligence-provider>${Object.entries(localIntelligenceProviders).map(([value,item])=>`<option value="${value}" ${provider===value?"selected":""}>${item.label}</option>`).join("")}</select></label><label><span data-intelligence-endpoint-label>URL do ${providerConfig.label}</span><input name="endpoint" data-intelligence-endpoint type="url" value="${escapeHtml(cfg.endpoint || s.endpoint || providerConfig.endpoint)}" /></label>${intelligenceModelSelect("fastModel", "Modelo rápido", cfg.fastModel || "", models)}${intelligenceModelSelect("balancedModel", "Modelo equilibrado", cfg.balancedModel || "", models)}${intelligenceModelSelect("qualityModel", "Modelo de maior qualidade", cfg.qualityModel || "", models)}<label><span>Perfil de hardware</span><select name="hardwareProfile">${["AUTO","LOW_VRAM","BALANCED","HIGH_MEMORY"].map((value)=>`<option value="${value}" ${cfg.hardwareProfile===value?"selected":""}>${statusLabel(value)}</option>`).join("")}</select></label><label><span>Janela de contexto</span><input name="contextBudget" type="number" min="512" max="32768" value="${Number(cfg.contextBudget || 4096)}" /></label><div class="button-row"><button class="button primary" type="submit">Salvar inteligência</button><button class="button" type="button" data-refresh-models>Atualizar modelos</button><button class="button" type="button" data-run-intelligence-benchmark>Executar benchmark</button></div><p class="form-status" role="status">${models.length ? `${models.length} modelo(s) disponível(is) em ${escapeHtml(providerConfig.label)}.` : `Salve e atualize para carregar os modelos de ${escapeHtml(providerConfig.label)}.`}</p></form></section>`;
  }
  if (section === "data")
    return `<section class="settings-panel data-portability"><div><p class="eyebrow">Portabilidade</p><h2>Dados do Career Unified</h2><p>O código fica no Git. Seu perfil, currículos e histórico ficam localmente; um novo clone funciona como uma instalação nova até que um backup seja restaurado.</p></div><div class="safety-banner"><strong>Segredos não são incluídos</strong><span>Tokens, senhas, cookies, headers de autorização, variáveis de ambiente e credenciais de contas conectadas ficam de fora.</span></div><div class="button-row"><a class="button primary" href="/api/unified/backup">Criar backup completo</a><button class="button" type="button" data-select-backup>Restaurar backup</button><input type="file" accept="application/json,.json" data-backup-file hidden /></div><section data-backup-inspection aria-live="polite"></section><p class="form-status" data-backup-status role="status"></p><details><summary>Outras operações de dados</summary><div class="button-row"><button class="button quiet" type="button" data-export-profile="career-ops">Atualizar CareerOps</button><button class="button quiet" type="button" data-export-profile="auto-apply">Atualizar AutoApply</button><button class="button quiet" type="button" data-sync-legacy>Sincronizar dados legados</button><a class="button quiet" href="/api/unified">Inspecionar estado unificado</a></div><p class="form-status" data-data-operation-status role="status"></p></details></section>`;
  if (section === "diagnostics") {
    const e = d.engine.value || {},
      s = d.status.value || {},
      runtime = d.runtime.value?.components || {},
      compiler = d.compiler.value?.health || d.compiler.value || {},
      documentMetrics = d.documentMetrics.value?.metrics || {},
      cards = [
        ["Discovery", runtime.discovery?.status],
        ["Career Engine", runtime.careerEngine?.status],
        ["Inteligência local", runtime.ollama?.status],
        ["n8n", runtime.n8n?.status],
        ["Evolution", runtime.evolution?.status],
        ["WhatsApp", runtime.whatsapp?.status],
        ["Busca pública na web", runtime.publicWeb?.status],
        ["Fontes", runtime.providers?.status],
      ];
    return `<section class="settings-panel"><div class="section-heading"><div><h2>Diagnóstico de capacidades</h2><p>Disponível e configurado são estados diferentes. Por exemplo, o n8n pode estar acessível, mas ainda precisar de configuração.</p></div><button class="button" type="button" data-refresh-diagnostics>Atualizar</button></div><div class="diagnostic-grid">${cards.map(([label, value]) => `<article><small>${escapeHtml(label)}</small><strong>${escapeHtml(statusLabel(value || "UNKNOWN"))}</strong></article>`).join("")}<article><small>Preparação de candidaturas</small><strong>${e.ok ? "Disponível" : escapeHtml(statusLabel(e.status || e.health || "UNAVAILABLE"))}</strong></article><article><small>Gerador de PDF</small><strong>${escapeHtml(statusLabel(compiler.status || "UNKNOWN"))}</strong></article><article><small>Documentos gerados</small><strong>${Number(documentMetrics.versionCount || 0)}</strong></article><article><small>Persistência</small><strong>SQLite local</strong></article></div><div class="button-row"><button class="button" type="button" data-recalculate-ats>Recalcular análises ATS</button></div><p class="form-status" data-diagnostic-action-status role="status"></p><details><summary>Detalhes técnicos sem segredos</summary><pre>${escapeHtml(JSON.stringify({ runtime, engine: e, intelligence: s, compiler, documentMetrics, routePerformance: globalThis.__careerPerformance || [], apiPerformance: globalThis.__careerApiPerformance || [] }, null, 2))}</pre></details></section>`;
  }
  return `<section class="settings-panel"><h2>Segurança</h2><div class="safety-banner"><strong>Princípios ativos</strong><p>Sem envio automático, sem contorno de CAPTCHA ou MFA, credenciais protegidas no servidor, autenticação HMAC em automações e confirmação humana para dados sensíveis.</p></div><ul class="plain-list"><li>Credenciais não são retornadas ao navegador.</li><li>Dados sensíveis do seu perfil exigem confirmação por candidatura.</li><li>A verificação das evidências bloqueia afirmações sem comprovação.</li><li>O envio externo continua sujeito às autorizações e aos bloqueios existentes.</li></ul></section>`;
}
function bindSettings(root, section) {
  if (section === "data") {
    bindBackup(root);
    bindDataOperations(root);
  }
  root
    .querySelector("[data-refresh-diagnostics]")
    ?.addEventListener("click", () => renderSettings({ root }));
  root
    .querySelector("#general-settings")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        flat = Object.fromEntries(new FormData(form)),
        current = (await api("/api/profile")).profile || {};
      const payload = {
        ...current,
        personal: {
          ...(current.personal || {}),
          fullName: flat["personal.fullName"],
          email: flat["personal.email"],
        },
        career: {
          ...(current.career || {}),
          headline: flat["career.headline"],
        },
      };
      try {
        await api("/api/profile", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast("Configurações salvas.");
      } catch (error) {
        form.querySelector(".form-status").textContent = error.message;
      }
    });
  root
    .querySelector("#intelligence-settings")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await api("/api/intelligence/settings", {
        method: "POST",
        body: JSON.stringify(
          Object.fromEntries(new FormData(event.currentTarget)),
        ),
      });
      toast("Inteligência atualizada.");
      await renderSettings({ root });
    });
  root
    .querySelector("[data-intelligence-provider]")
    ?.addEventListener("change", (event) => {
      const form = event.currentTarget.form,
        provider = localIntelligenceProviders[event.currentTarget.value] || localIntelligenceProviders.ollama,
        endpoint = form.querySelector("[data-intelligence-endpoint]");
      endpoint.value = provider.endpoint;
      form.querySelector("[data-intelligence-endpoint-label]").textContent = `URL do ${provider.label}`;
      for (const select of form.querySelectorAll('select[name$="Model"]'))
        select.replaceChildren(new Option("Não usar", ""));
      form.querySelector(".form-status").textContent = `Salve para consultar os modelos de ${provider.label}.`;
    });
  root.querySelector("[data-refresh-models]")?.addEventListener("click", async (event) => {
    await runButtonAction(event.currentTarget, root.querySelector("#intelligence-settings .form-status"), "Atualizando modelos…", async () => {
      await api("/api/intelligence/models/refresh", { method: "POST", body: "{}" });
      toast("Lista de modelos atualizada.");
      await renderSettings({ root });
    });
  });
  root.querySelector("[data-run-intelligence-benchmark]")?.addEventListener("click", async (event) => {
    await runButtonAction(event.currentTarget, root.querySelector("#intelligence-settings .form-status"), "Benchmark colocado na fila…", async () => {
      await api("/api/intelligence/benchmark", { method: "POST", body: "{}" });
      toast("Benchmark iniciado. O resultado aparecerá no estado da inteligência.");
    });
  });
  root.querySelector("[data-recalculate-ats]")?.addEventListener("click", async (event) => {
    const status = root.querySelector("[data-diagnostic-action-status]");
    await runButtonAction(event.currentTarget, status, "Recalculando análises…", async () => {
      const result = await api("/api/ats/recalculate", { method: "POST", body: JSON.stringify({ limit: 500 }) });
      status.textContent = `${Number(result.report?.processed || 0)} análise(s) processada(s).`;
      toast("Recálculo ATS concluído.");
    });
  });
}

function n8nIntegration(data) {
  if (data.error) return `<article class="content-card"><h2>Automação n8n</h2><div class="status-banner attention" role="alert">Não foi possível carregar a configuração: ${escapeHtml(data.error.message)}</div></article>`;
  const settings = data.settings || {};
  return `<article class="content-card"><div class="section-heading"><div><p class="eyebrow">Automação opcional</p><h2>n8n</h2><p>Recebe somente eventos permitidos. O Career Unified continua decidindo, persistindo e exigindo revisão humana.</p></div>${pill(settings.enabled ? "Ativo" : "Desativado", settings.enabled ? "success" : "neutral")}</div><form class="settings-form" data-n8n-settings><label><span>Webhook</span><input name="webhookUrl" type="url" value="${escapeHtml(settings.webhookUrl || "")}" placeholder="http://n8n:5678/webhook/career-whatsapp-alerts" /></label><label><span>Variável do segredo</span><input name="secretEnvName" value="${escapeHtml(settings.secretEnvName || "CAREER_N8N_WEBHOOK_SECRET")}" /></label><label><span>Tempo limite (ms)</span><input name="timeoutMs" type="number" min="1000" max="30000" value="${Number(settings.timeoutMs || 5000)}" /></label><label class="checkbox-row"><input name="enabled" type="checkbox" ${settings.enabled ? "checked" : ""} /><span>Ativar entrega de alertas</span></label><fieldset><legend>Eventos permitidos</legend>${[["JOB_HIGH_MATCH","Vaga de alta prioridade"],["JOB_MATCH_DIGEST_READY","Resumo de vagas"],["INTEGRATION_TEST","Teste explícito"]].map(([value,label])=>`<label class="checkbox-row"><input type="checkbox" name="eventAllowlist" value="${value}" ${(settings.eventAllowlist || []).includes(value) ? "checked" : ""} /><span>${label}</span></label>`).join("")}</fieldset><div class="button-row"><button class="button primary" type="submit">Salvar n8n</button><button class="button" type="button" data-test-n8n>Testar integração</button></div><p class="form-status" role="status"></p></form></article>`;
}

function bindN8nIntegration(root) {
  const form = root.querySelector("[data-n8n-settings]");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector(".form-status"), values = new FormData(form);
    status.textContent = "Salvando configuração…";
    try {
      await api("/api/integrations/n8n", { method: "POST", body: JSON.stringify({ webhookUrl: values.get("webhookUrl"), secretEnvName: values.get("secretEnvName"), timeoutMs: Number(values.get("timeoutMs")), enabled: values.get("enabled") === "on", eventAllowlist: values.getAll("eventAllowlist") }) });
      status.textContent = "Configuração salva.";
      toast("Integração n8n atualizada.");
    } catch (error) { status.textContent = error.message; }
  });
  form.querySelector("[data-test-n8n]")?.addEventListener("click", async (event) => {
    await runButtonAction(event.currentTarget, form.querySelector(".form-status"), "Enviando evento de teste…", async () => {
      await api("/api/integrations/n8n/test", { method: "POST", body: "{}" });
      form.querySelector(".form-status").textContent = "Evento de teste entregue ou colocado na fila de retentativa.";
      toast("Teste do n8n executado.");
    });
  });
}

function bindDataOperations(root) {
  const status = root.querySelector("[data-data-operation-status]");
  root.querySelectorAll("[data-export-profile]").forEach((button) => button.addEventListener("click", async (event) => {
    await runButtonAction(event.currentTarget, status, "Atualizando projeto integrado…", async () => {
      const target = event.currentTarget.dataset.exportProfile;
      const result = await api("/api/profile/export", { method: "POST", body: JSON.stringify({ target }) });
      status.textContent = `${target === "career-ops" ? "CareerOps" : "AutoApply"} atualizado (${result.files?.length || 0} arquivo(s)).`;
      toast("Projeto integrado atualizado.");
    });
  }));
  root.querySelector("[data-sync-legacy]")?.addEventListener("click", async (event) => {
    await runButtonAction(event.currentTarget, status, "Sincronizando dados legados…", async () => {
      const result = await api("/api/unified/sync-legacy", { method: "POST", body: "{}" });
      status.textContent = result.message || "Sincronização concluída.";
      toast("Dados legados sincronizados.");
    });
  });
}

async function runButtonAction(button, status, pendingText, action) {
  const original = button.textContent;
  button.disabled = true;
  status.textContent = pendingText;
  try { await action(); }
  catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; button.textContent = original; }
}
function bindBackup(root) {
  const input = root.querySelector("[data-backup-file]"),
    host = root.querySelector("[data-backup-inspection]"),
    status = root.querySelector("[data-backup-status]");
  root
    .querySelector("[data-select-backup]")
    ?.addEventListener("click", () => input.click());
  input?.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    status.textContent = "Inspecionando compatibilidade…";
    try {
      const fileData = await readFileData(file),
        result = await api("/api/unified/backup/inspect", {
          method: "POST",
          body: JSON.stringify({ fileData }),
        }),
        summary = result.summary;
      host.innerHTML = `<article class="content-card"><h3>Backup compatível</h3><dl class="definition-grid"><div><dt>Formato</dt><dd>v${summary.backupVersion}</dd></div><div><dt>Schema</dt><dd>${summary.schemaVersion}</dd></div><div><dt>Criado em</dt><dd>${escapeHtml(summary.createdAt)}</dd></div><div><dt>Currículos</dt><dd>${summary.legacyState.resumes}</dd></div><div><dt>Oportunidades</dt><dd>${summary.legacyState.opportunities}</dd></div><div><dt>Segredos</dt><dd>Não incluídos</dd></div></dl><button class="button primary" type="button" data-confirm-restore>Confirmar restauração</button></article>`;
      status.textContent = "Revise o conteúdo antes de confirmar.";
      host
        .querySelector("[data-confirm-restore]")
        .addEventListener("click", async (event) => {
          if (!confirm("Restaurar este backup no estado local atual?")) return;
          event.currentTarget.disabled = true;
          status.textContent = "Restaurando dados validados…";
          await api("/api/unified/backup/restore", {
            method: "POST",
            body: JSON.stringify({ fileData }),
          });
          status.textContent =
            "Backup restaurado. Recarregue a aplicação para ver todos os dados.";
          toast("Backup restaurado com sucesso.");
        });
    } catch (error) {
      host.innerHTML = "";
      status.textContent = error.message;
    }
  });
}
function readFileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
