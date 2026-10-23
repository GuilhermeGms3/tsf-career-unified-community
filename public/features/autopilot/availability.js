import { api } from "../shared/data.js";
import { escapeHtml, formatDate, icon, pill, toast } from "../../app/ui.js";

const date = value => value ? formatDate(value, { dateStyle: "short", timeStyle: "short" }) : "Ainda não realizada";
const label = value => ({ AVAILABLE: "Ativa", CLOSED: "Encerrada", INCONCLUSIVE: "Não confirmada" })[value] || "Não confirmada";
const reasons = {
  CLOSED_PAGE_CONTENT: "Portal informa encerramento", ABSENT_FROM_OFFICIAL_LIST: "Ausente do catálogo oficial completo",
  OFFICIAL_JOB_UNPUBLISHED: "Publicação retirada", OFFICIAL_JOB_PRESENT: "Publicação presente na API oficial",
  HTTP_404: "Publicação não encontrada (404)", HTTP_410: "Publicação removida (410)", HTTP_403: "Acesso bloqueado (403)",
  HTTP_502: "Portal indisponível (502)", ENGINE_TIMEOUT: "Consulta excedeu o tempo limite",
  JOB_PAGE_REDIRECTED: "Redirecionamento: identidade não confirmada", JOB_OPEN_NOT_PROVEN: "Página acessível, sem comprovação de vaga ativa",
  MATCHING_JOB_POSTING: "Dados estruturados correspondem à vaga", MATCHING_JOB_WITH_APPLY_ACTION: "Vaga identificada com ação de candidatura",
  OFFICIAL_VALID_THROUGH_PASSED: "Prazo declarado pelo portal encerrado", GUPY_MATCHING_PUBLIC_JOB: "Publicação Gupy identificada",
  EXPIRY_CONFLICTS_WITH_APPLY_ACTION: "Portal informa prazo passado, mas ainda oferece candidatura",
  GUPY_JOB_UNPUBLISHED: "Gupy informa publicação encerrada", HUMAN_VERIFICATION_REQUIRED: "Portal pediu verificação humana",
  API_LIST_INCOMPLETE: "Catálogo incompleto ou formato não reconhecido", API_IDENTITY_MISMATCH: "API retornou outra identidade",
  API_REDIRECTED: "API redirecionou para outra página", MISSING_PUBLIC_URL: "Sem endereço público",
};

export function availabilityView(data = {}, unavailable = false) {
  const policy = data.policy || {}, run = data.run;
  return `<section class="availability-control" aria-labelledby="availability-title" data-availability-control>
    <div class="section-heading"><div><p class="eyebrow">Manutenção das vagas</p><h2 id="availability-title">Checagem periódica</h2></div>${pill(policy.enabled ? "Ligada" : "Desligada", policy.enabled ? "success" : "neutral")}</div>
    ${unavailable ? '<p role="alert">Não foi possível consultar a agenda. Recarregue para tentar novamente.</p>' : ""}
    <form class="availability-config" data-availability-policy>
      <label class="check"><input type="checkbox" name="enabled" ${policy.enabled ? "checked" : ""} ${unavailable ? "disabled" : ""}/> Verificar vagas automaticamente</label>
      <label><span>Intervalo (horas)</span><input type="number" name="everyHours" min="1" max="168" step="1" value="${Number(policy.everyHours) || 24}" required/></label>
      <label><span>Vagas por rodada</span><input type="number" name="batchSize" min="10" max="300" step="1" value="${Number(policy.batchSize) || 100}" required/></label>
      <div class="button-row"><button class="button primary" type="submit" ${unavailable ? "disabled" : ""}>${icon("check")} Salvar agenda</button><button class="button" type="button" data-check-catalog ${unavailable || run?.status === "RUNNING" ? "disabled" : ""}>${icon("refresh")} Verificar agora</button></div>
      <p class="form-status" role="status"></p>
    </form>
    <dl class="definition-grid"><div><dt>Última rodada agendada</dt><dd>${escapeHtml(date(policy.lastStartedAt))}</dd></div><div><dt>Próxima rodada</dt><dd>${data.continuingSweep ? "Próximo lote em até 1 minuto" : policy.enabled ? escapeHtml(date(policy.nextRunAt)) : "Agenda desligada"}</dd></div></dl>
    ${policy.lastError ? `<p role="alert">Falha ao iniciar a rodada: ${escapeHtml(policy.lastError)}</p>` : ""}
    <div data-availability-results aria-live="polite">${availabilityResults(data)}</div>
  </section>`;
}

export function availabilityResults({ run, runs = [] } = {}) {
  if (!run) return '<p class="muted">Nenhuma verificação registrada.</p>';
  const checks = run.result?.checks || [], running = run.status === "RUNNING";
  return `<div class="availability-run"><strong>${running ? "Verificando vagas" : run.status === "FAILED" ? "Verificação interrompida" : "Última verificação"}</strong><span>${escapeHtml(date(run.startedAt))} · ${run.verificationChecked || 0}/${run.verificationTotal || 0}</span>
    <progress max="${Math.max(1, run.verificationTotal || 0)}" value="${run.verificationChecked || 0}" aria-label="Vagas verificadas"></progress>
    <div class="availability-counts"><span><b>${run.availableCount || 0}</b> ativas</span><span><b>${run.closedCount || 0}</b> encerradas</span><span><b>${run.inconclusiveCount || 0}</b> não confirmadas</span><span><b>${run.remainingCount || 0}</b> aguardando outra rodada</span></div>
    ${run.errorCode ? `<p role="alert">${escapeHtml(run.errorCode)}</p>` : ""}
    ${checks.length ? `<div class="availability-check-list" tabindex="0" role="region" aria-label="Resultados por vaga">${[...checks].reverse().map(check => `<article><div><a data-link href="/opportunities/${encodeURIComponent(check.jobId)}">${escapeHtml(check.title)}</a><small>${escapeHtml(check.provider)} · ${escapeHtml(date(check.checkedAt))}</small><span>${escapeHtml(reasons[check.reason] || check.reason)}</span></div>${pill(label(check.status), check.status === "CLOSED" ? "critical" : check.status === "AVAILABLE" ? "success" : "attention")}<button type="button" class="button quiet" data-recheck-job="${escapeHtml(check.jobId)}" title="Reverificar esta vaga" aria-label="Reverificar ${escapeHtml(check.title)}">${icon("refresh")}</button></article>`).join("")}</div>` : ""}
  </div>${runs.length > 1 ? `<div class="availability-run-history"><h3>Rodadas anteriores</h3>${runs.filter(item => item.id !== run.id).slice(0, 5).map(item => `<p><span>${escapeHtml(date(item.startedAt))}</span><span>${item.verificationChecked || 0} verificadas · ${item.closedCount || 0} encerradas · ${item.inconclusiveCount || 0} não confirmadas</span></p>`).join("")}</div>` : ""}`;
}

export function bindAvailability(root, initial = {}) {
  const form = root.querySelector("[data-availability-policy]");
  if (!form) return;
  const status = form.querySelector(".form-status"), results = root.querySelector("[data-availability-results]"), start = root.querySelector("[data-check-catalog]");
  let timer;
  const refresh = async () => {
    if (!root.isConnected || !form.isConnected) return;
    try {
      const data = await api("/api/opportunities/verification-policy", { cache: false });
      results.innerHTML = availabilityResults(data);
      const dates = root.querySelectorAll("[data-availability-control] .definition-grid dd");
      dates[0].textContent = date(data.policy.lastStartedAt);
      dates[1].textContent = data.continuingSweep ? "Próximo lote em até 1 minuto" : data.policy.enabled ? date(data.policy.nextRunAt) : "Agenda desligada";
      start.disabled = data.run?.status === "RUNNING";
      if (data.run?.status === "RUNNING") timer = setTimeout(refresh, 4000);
    } catch (error) { status.textContent = `Acompanhamento indisponível: ${error.message}`; }
  };
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const data = await api("/api/opportunities/verification-policy", { method: "PUT", body: JSON.stringify({ enabled: form.elements.enabled.checked, everyHours: Number(form.elements.everyHours.value), batchSize: Number(form.elements.batchSize.value) }) });
      status.textContent = data.policy.enabled ? `Agenda ligada. Próxima rodada: ${date(data.policy.nextRunAt)}.` : "Agenda desligada. Uma rodada já iniciada continua até terminar.";
      toast("Agenda de verificação salva.");
      root.querySelector("[data-availability-control] .pill").outerHTML = pill(data.policy.enabled ? "Ligada" : "Desligada", data.policy.enabled ? "success" : "neutral");
      const dates = root.querySelectorAll("[data-availability-control] .definition-grid dd");
      dates[1].textContent = data.policy.enabled ? date(data.policy.nextRunAt) : "Agenda desligada";
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  start.addEventListener("click", async () => {
    start.disabled = true;
    try {
      const { run } = await api("/api/opportunities/verify", { method: "POST", body: "{}" });
      results.innerHTML = availabilityResults({ run });
      status.textContent = "Verificação iniciada. Nenhuma busca ou candidatura será disparada.";
      clearTimeout(timer);
      await refresh();
    } catch (error) { status.textContent = error.message; start.disabled = false; }
  });
  results.addEventListener("click", async event => {
    const button = event.target.closest("[data-recheck-job]");
    if (!button) return;
    button.disabled = true;
    try {
      const { availability } = await api(`/api/opportunities/${encodeURIComponent(button.dataset.recheckJob)}/verify`, { method: "POST", body: "{}" });
      status.textContent = `${label(availability.status)}: ${reasons[availability.reason] || availability.reason}`;
      toast(status.textContent);
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
  if (initial.run?.status === "RUNNING") timer = setTimeout(refresh, 4000);
}
