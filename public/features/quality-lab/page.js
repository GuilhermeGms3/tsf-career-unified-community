import { api } from "../../api/client.js";
import { escapeHtml as e, pageHeader } from "../../app/ui.js";

const list = (items) => (items || []).map((item) => item.name || item.normalizedName).filter(Boolean).join(", ");
const checked = (value, expected) => value === expected ? "checked" : "";

const coverageStatus = Object.freeze({
  FOUND_AUTOMATICALLY: "Encontrada automaticamente", FOUND_BY_OTHER_SOURCE: "Encontrada por outra fonte",
  FOUND_BUT_FILTERED: "Encontrada, mas filtrada", FOUND_BUT_RANKED_LOW: "Encontrada com ranking baixo",
  MISSED_QUERY: "Consulta não alcançou", MISSED_PLANNER_BUDGET: "Fora do budget do planner",
  MISSED_PAGINATION: "Página não percorrida", MISSED_PROVIDER_LIMIT: "Depois do limite da fonte",
  MISSED_PARSER: "Falha de parsing", MISSED_LOCATION: "Descartada por localização",
  MISSED_DEDUPLICATION: "Falha de deduplicação", MISSED_SOURCE: "Fonte somente manual",
  SOURCE_BLOCKED: "Fonte bloqueada", SOURCE_NOT_CONFIGURED: "Fonte não configurada",
  SOURCE_NOT_IMPLEMENTED: "Discovery não implementado", UNKNOWN: "Causa ainda desconhecida",
});
const foundStatus = (status) => String(status || "").startsWith("FOUND_");

export async function renderQualityLab({ root, route }) {
  if (route?.section === "coverage") return renderCoverageBenchmark({ root });
  const data = await api("/api/quality-lab", { cache: false }), next = data.items.find((item) => !item.label?.labeledAt) || data.items[0];
  root.innerHTML = `<div class="page quality-lab-page">${qualityHeader("matcher")}<section class="daily-brief"><div><span>Vagas reais</span><strong>${data.summary.jobs}</strong></div><div><span>Rotuladas</span><strong>${data.summary.labeled}</strong></div><div><span>Aguardando</span><strong>${data.summary.awaitingLabels}</strong></div></section>${next ? form(next) : `<section class="calm-state"><div><h2>Nenhum dataset disponível</h2><p>Execute <code>npm run benchmark:jobs</code> para montar o conjunto real antes de rotular.</p></div></section>`}</div>`;
  const element = root.querySelector("[data-quality-label]");
  if (element) element.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = element.querySelector("[data-status]"), submit = element.querySelector('button[type="submit"]');
    submit.disabled = true; status.textContent = "Salvando rótulo…";
    try {
      const values = Object.fromEntries(new FormData(element)), nullable = (name) => values[name] === "true" ? true : values[name] === "false" ? false : null;
      const split = (name) => String(values[name] || "").split(/[,;\n]/).map((value) => value.trim()).filter(Boolean);
      await api(`/api/quality-lab/${encodeURIComponent(element.dataset.jobId)}/label`, { method: "PUT", body: JSON.stringify({ ...values, relevant: nullable("relevant"), seniorityCorrect: nullable("seniorityCorrect"), locationAcceptable: nullable("locationAcceptable"), openAtLabelTime: nullable("openAtLabelTime"), requiredSkills: split("requiredSkills"), preferredSkills: split("preferredSkills"), hardRequirements: split("hardRequirements"), blockingRequirements: split("blockingRequirements") }) });
      await renderQualityLab({ root });
    } catch (error) { status.textContent = error.message; submit.disabled = false; }
  });
}

function qualityHeader(active) {
  return `${pageHeader({ eyebrow: "Validação humana", title: "Laboratório de qualidade", description: "Compare descoberta, ranking e decisões com vagas reais conhecidas." })}<nav class="section-tabs" aria-label="Áreas do laboratório"><a class="${active === "coverage" ? "active" : ""}" data-link href="/quality-lab?section=coverage">Coverage Benchmark</a><a class="${active === "matcher" ? "active" : ""}" data-link href="/quality-lab">Rótulos do matcher</a></nav>`;
}

async function renderCoverageBenchmark({ root }) {
  const data = await api("/api/coverage-benchmark", { cache: false }), summary = data.summary || {};
  root.innerHTML = `<div class="page quality-lab-page coverage-page">${qualityHeader("coverage")}
    <section class="daily-brief"><div><span>Coverage geral</span><strong>${Math.round(Number(summary.coverageRate || 0) * 100)}%</strong></div><div><span>Total referência</span><strong>${summary.totalReferenceJobs || 0}</strong></div><div><span>Encontradas</span><strong>${summary.found || 0}</strong></div><div><span>Perdidas</span><strong>${summary.missed || 0}</strong></div></section>
    <section class="coverage-actions"><form class="content-card coverage-diagnose" data-coverage-diagnose><div><p class="eyebrow">Diagnóstico direto</p><h2>Por que o TSF não encontrou esta vaga?</h2></div><label><span>URL pública</span><input name="url" type="url" required placeholder="https://..." /></label><button class="button primary" type="submit">Diagnosticar</button><p class="form-status" role="status"></p></form><div data-coverage-diagnostic></div></section>
    <section class="coverage-entry-grid"><form class="content-card" data-coverage-reference><div><p class="eyebrow">Ground truth</p><h2>Adicionar vaga de referência</h2></div><label><span>URL</span><input name="url" type="url" placeholder="https://..." /></label><label><span>Texto público, inclusive LinkedIn Post</span><textarea name="sourceText" rows="5" placeholder="Cole o texto público quando a URL não trouxer a descrição."></textarea></label><details><summary>Completar dados conhecidos</summary><div class="form-grid"><label><span>Cargo</span><input name="title" /></label><label><span>Empresa</span><input name="company" /></label><label><span>Fonte percebida</span><input name="perceivedSource" placeholder="Remotar, Gupy, LinkedIn Post..." /></label><label><span>Localização</span><input name="location" /></label><label><span>Modalidade</span><input name="workModel" /></label><label><span>Interesse</span><input name="interest" /></label><label><span>Página comprovada</span><input name="sourcePage" type="number" min="1" /></label><label><span>Posição comprovada</span><input name="providerPosition" type="number" min="1" /></label></div><label><span>Observações</span><textarea name="notes" rows="3"></textarea></label></details><button class="button primary" type="submit">Adicionar referência</button><p class="form-status" role="status"></p></form>
    <form class="content-card" data-coverage-bulk><div><p class="eyebrow">Importação simples</p><h2>Múltiplas referências</h2></div><label><span>Formato</span><select name="format"><option value="URLS">Uma URL por linha</option><option value="CSV">CSV</option><option value="JSON">JSON</option></select></label><label><span>Conteúdo</span><textarea name="content" rows="10" required></textarea></label><button class="button" type="submit">Importar dataset</button><p class="form-status" role="status"></p></form></section>
    <section class="section-heading coverage-heading"><div><p class="eyebrow">Benchmark atual</p><h2>Vagas de referência</h2><p>Cada causa abaixo aponta para evidências persistidas, ou permanece desconhecida.</p></div><button class="button" type="button" data-run-coverage>Executar benchmark</button></section>
    ${coverageBreakdowns(summary)}${coverageList(data.diagnostics || [])}</div>`;
  bindCoverageActions(root);
}

function coverageBreakdowns(summary) {
  const sources = Object.entries(summary.coverageBySource || {}).sort((a, b) => b[1].missed - a[1].missed).slice(0, 10);
  const reasons = Object.entries(summary.missedByReason || {}).filter(([status, count]) => count && !foundStatus(status)).sort((a, b) => b[1] - a[1]);
  return `<section class="coverage-breakdowns"><article><h3>Por fonte</h3>${sources.length ? `<ul>${sources.map(([source, item]) => `<li><span>${e(source)}</span><strong>${item.found}/${item.total}</strong></li>`).join("")}</ul>` : `<p>Nenhuma referência cadastrada.</p>`}</article><article><h3>Por motivo</h3>${reasons.length ? `<ul>${reasons.map(([status, count]) => `<li><span>${e(coverageStatus[status] || status)}</span><strong>${count}</strong></li>`).join("")}</ul>` : `<p>Nenhuma perda classificada.</p>`}</article></section>`;
}

function coverageList(items) {
  if (!items.length) return `<section class="calm-state"><div><h2>Ground truth vazio</h2><p>Adicione uma URL ou importe um conjunto simples para começar a medir cobertura.</p></div></section>`;
  return `<section class="coverage-list">${items.map((item) => `<article class="content-card coverage-row"><div class="coverage-row-main"><div><span class="status-badge ${foundStatus(item.status) ? "success" : item.status === "UNKNOWN" ? "neutral" : "warning"}">${e(coverageStatus[item.status] || item.status)}</span><h3>${e(item.reference.title || item.reference.canonicalUrl || "Vaga de referência")}</h3><p>${e([item.reference.company, item.surface?.displayName, item.reference.location].filter(Boolean).join(" · "))}</p></div><dl><div><dt>Encontrada?</dt><dd>${foundStatus(item.status) ? "Sim" : "Não"}</dd></div><div><dt>Ranking</dt><dd>${item.rankingPosition || "—"}</dd></div><div><dt>Como</dt><dd>${e(item.status === "FOUND_BY_OTHER_SOURCE" ? "Outra fonte" : item.status === "FOUND_AUTOMATICALLY" ? "Discovery" : coverageStatus[item.status] || item.status)}</dd></div></dl></div><div class="button-row"><a class="button quiet" href="${e(item.reference.canonicalUrl || item.reference.originalUrl || "#")}" target="_blank" rel="noreferrer">Abrir vaga</a>${!foundStatus(item.status) && !item.reference.importedJobId ? `<button class="button" type="button" data-import-reference="${e(item.reference.id)}">Importar e analisar</button>` : ""}</div><details><summary>Abrir diagnóstico</summary>${diagnosticMarkup(item)}</details></article>`).join("")}</section>`;
}

function diagnosticMarkup(item) {
  return `<div class="coverage-diagnostic"><ol>${(item.timeline || []).map((step) => `<li><strong>${e(step.stage)}</strong><span>${e(step.detail)}</span><small>${e(step.status)}</small></li>`).join("")}</ol><h4>Evidências</h4><ul>${(item.evidence || []).map((proof) => `<li><strong>${e(proof.code)}</strong> ${e(proof.detail)}</li>`).join("")}</ul></div>`;
}

function formPayload(form) {
  const values = Object.fromEntries(new FormData(form));
  return Object.fromEntries(Object.entries(values).filter(([, value]) => String(value).trim() !== ""));
}

function bindCoverageActions(root) {
  root.querySelector("[data-coverage-reference]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const formElement = event.currentTarget, status = formElement.querySelector(".form-status"); status.textContent = "Salvando referência…";
    try { await api("/api/coverage-benchmark/references", { method: "POST", body: JSON.stringify(formPayload(formElement)) }); await renderCoverageBenchmark({ root }); }
    catch (error) { status.textContent = error.message; }
  });
  root.querySelector("[data-coverage-bulk]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const formElement = event.currentTarget, status = formElement.querySelector(".form-status"); status.textContent = "Importando referências…";
    try { await api("/api/coverage-benchmark/import", { method: "POST", body: JSON.stringify(formPayload(formElement)) }); await renderCoverageBenchmark({ root }); }
    catch (error) { status.textContent = error.message; }
  });
  root.querySelector("[data-coverage-diagnose]")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const formElement = event.currentTarget, status = formElement.querySelector(".form-status"), output = root.querySelector("[data-coverage-diagnostic]"); status.textContent = "Cruzando URL, proveniência, runs e ranking…";
    try { const result = await api("/api/coverage-benchmark/diagnose", { method: "POST", body: JSON.stringify(formPayload(formElement)) }); status.textContent = "Diagnóstico concluído."; output.innerHTML = `<article class="content-card"><h3>${e(coverageStatus[result.diagnostic.status] || result.diagnostic.status)}</h3>${diagnosticMarkup(result.diagnostic)}</article>`; }
    catch (error) { status.textContent = error.message; }
  });
  root.querySelector("[data-run-coverage]")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true; event.currentTarget.textContent = "Executando…";
    try { await api("/api/coverage-benchmark/runs", { method: "POST", body: "{}" }); await renderCoverageBenchmark({ root }); }
    catch (error) { event.currentTarget.disabled = false; event.currentTarget.textContent = error.message; }
  });
  root.querySelectorAll("[data-import-reference]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true; button.textContent = "Importando…";
    try { await api(`/api/coverage-benchmark/references/${encodeURIComponent(button.dataset.importReference)}/import`, { method: "POST", body: "{}" }); await renderCoverageBenchmark({ root }); }
    catch (error) { button.disabled = false; button.textContent = error.message; }
  }));
}

function form({ record, label = {} }) {
  const requirements = record.matcher?.extractedRequirements || [], required = requirements.filter((item) => item.required), preferred = requirements.filter((item) => item.importance === "preferred");
  return `<form class="quality-label-form" data-quality-label data-job-id="${e(record.benchmarkJobId)}"><section class="quality-job"><p class="eyebrow">Próxima vaga para rotular</p><h2>${e(record.title || "Vaga sem título")}</h2><p>${e([record.company, record.location, record.sourcePortal].filter(Boolean).join(" · "))}</p><a href="${e(record.canonicalUrl || "#")}" target="_blank" rel="noreferrer">Abrir anúncio original</a><div class="quality-description">${e(record.normalizedDescription || "Descrição indisponível.")}</div></section><section class="quality-system-result"><h2>Resultado atual do sistema</h2><dl class="match-trust-summary"><div><dt>Score calibrado</dt><dd>${record.matcher?.calibratedMatchScore ?? "N/A"}</dd></div><div><dt>Cobertura</dt><dd>${record.matcher?.evidenceCoverage ?? "N/A"}</dd></div><div><dt>Ranking</dt><dd>${record.ranking?.score ?? "N/A"}</dd></div></dl><p><strong>Obrigatórios extraídos:</strong> ${e(list(required) || "nenhum")}</p><p><strong>Preferenciais extraídos:</strong> ${e(list(preferred) || "nenhum")}</p></section><section class="quality-human-label"><h2>Sua avaliação</h2>${choice("Você aplicaria?", "applicationDecision", [["APPLY", "Aplicaria"], ["MAYBE", "Talvez"], ["DO_NOT_APPLY", "Não aplicaria"]], label.applicationDecision)}${choice("A vaga é relevante?", "relevant", [["true", "Relevante"], ["false", "Irrelevante"], ["", "Não sei"]], label.relevant == null ? "" : String(label.relevant))}${choice("Senioridade identificada corretamente?", "seniorityCorrect", [["true", "Sim"], ["false", "Não"], ["", "Não sei"]], label.seniorityCorrect == null ? "" : String(label.seniorityCorrect))}${choice("Localização aceitável?", "locationAcceptable", [["true", "Sim"], ["false", "Não"], ["", "Não sei"]], label.locationAcceptable == null ? "" : String(label.locationAcceptable))}${choice("A vaga estava aberta ao conferir?", "openAtLabelTime", [["true", "Sim"], ["false", "Não"], ["", "Não sei"]], label.openAtLabelTime == null ? "" : String(label.openAtLabelTime))}<label>Família correta<input name="jobFamily" value="${e(label.jobFamily ?? record.matcher?.predictedJobFamily ?? "")}" maxlength="120"></label><label>Senioridade correta<input name="seniority" value="${e(label.seniority ?? record.matcher?.predictedSeniority ?? "")}" maxlength="80"></label><label>Prioridade humana (0–100)<input name="humanPriority" type="number" min="0" max="100" value="${e(label.humanPriority ?? "")}"></label><label>Hard requirements confirmados<textarea name="hardRequirements">${e((label.hardRequirements || required.map((item) => item.name)).join("\n"))}</textarea></label><label>Skills obrigatórias confirmadas<textarea name="requiredSkills">${e((label.requiredSkills || []).join("\n"))}</textarea></label><label>Skills preferenciais confirmadas<textarea name="preferredSkills">${e((label.preferredSkills || preferred.map((item) => item.name)).join("\n"))}</textarea></label><label>Bloqueios confirmados<textarea name="blockingRequirements">${e((label.blockingRequirements || []).join("\n"))}</textarea></label><label>Observações<textarea name="notes" maxlength="1000">${e(label.notes || "")}</textarea></label><div class="button-row"><button class="button primary" type="submit">Salvar e abrir próxima</button><a class="button" data-link href="/">Voltar para Hoje</a></div><p data-status role="status"></p></section></form>`;
}

function choice(legend, name, options, selected) {
  return `<fieldset><legend>${e(legend)}</legend><div class="quality-options">${options.map(([value, text]) => `<label><input type="radio" name="${e(name)}" value="${e(value)}" ${checked(selected, value)} ${name === "applicationDecision" && value === "MAYBE" && !selected ? "checked" : ""}> ${e(text)}</label>`).join("")}</div></fieldset>`;
}
