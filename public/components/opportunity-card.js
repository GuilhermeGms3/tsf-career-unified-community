import { escapeHtml } from "../sanitize.js";

const label = (value) =>
  typeof value === "string"
    ? value
    : value?.originalText ||
      value?.requirement ||
      value?.normalizedName ||
      value?.label ||
      "";
const chips = (items, empty) =>
  items?.length
    ? items
        .slice(0, 4)
        .map((item) => `<span>${escapeHtml(label(item))}</span>`)
        .join("")
    : `<small>${escapeHtml(empty)}</small>`;

export function renderOpportunityMetrics(item, { compact = false } = {}) {
  const priority = item.priority,
    analysis = item.analysis || {},
    job = item.job || {};
  const percent = (value) =>
    value === null || value === undefined || value === ""
      ? "—"
      : `${Math.round(Number(value))}%`;
  return `<div class="opportunity-metrics" aria-label="Indicadores da oportunidade"><span><strong>${percent(priority.technicalMatch)}</strong> compatibilidade técnica conhecida</span><span><strong>${percent(analysis.evidenceCoverage)}</strong> cobertura de evidências</span><span><strong>${priority.score}</strong> prioridade</span><span><strong>${percent(analysis.matchConfidence ?? priority.components.confidence)}</strong> confiança da análise</span><span>${escapeHtml(priority.reasons.find((reason) => /Publicada|Data de publicação/.test(reason)) || "Atualidade não confirmada")}</span></div>${analysis.unknownRequirements?.some((item) => item.required) ? '<p class="truth-note">Há requisito obrigatório desconhecido: revisão necessária antes de avançar.</p>' : ""}${compact ? "" : `<div class="evidence-summary"><div><strong>Correspondências</strong><div class="evidence-chips matched">${chips(analysis.matched, "Sem correspondências detalhadas disponíveis.")}</div></div><div><strong>Lacunas</strong><div class="evidence-chips gaps">${chips(analysis.missing, "Sem lacunas negativas comprovadas.")}</div></div></div>`}`;
}

export function renderPriorityDetails(priority) {
  const c = priority.components;
  return `<details><summary>Como a prioridade foi calculada</summary><ul>${priority.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul><small>Compatibilidade ${c.technicalMatch} · confiança ${c.confidence} · atualidade ${c.freshness} · preferências ${c.preferenceFit} · qualidade do anúncio ${c.listingQuality} · esforço ${c.applicationEffort} · penalidades ${c.penalties}</small><small>Versão ${escapeHtml(priority.algorithmVersion)}</small></details>`;
}
