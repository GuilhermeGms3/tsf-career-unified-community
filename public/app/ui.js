import { escapeHtml } from "../sanitize.js";
import { icon } from "./icons.js";
import {humanLabel,humanError,humanText} from './presentation.js';
export { escapeHtml, icon };
export const formatDate = (value, options = { dateStyle: "medium" }) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat("pt-BR", options).format(new Date(value))
    : "Não informado";
export const relativeDate = (value) => {
  if (!value) return "sem data";
  const days = Math.round((new Date(value).getTime() - Date.now()) / 86400000);
  return new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" }).format(
    days,
    "day",
  );
};
export const score = (value) =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value))
    ? `${Math.round(Number(value))}%`
    : "Não analisado";
export const statusLabel = (value = "", domain = "common") => humanLabel(value, domain);
export {humanLabel, humanError, humanText};
export const formatDateTime = value => value && Number.isFinite(new Date(value).getTime()) ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : 'Não informado';
export const technicalDetails = value => '<details><summary>Detalhes técnicos</summary><pre>'+escapeHtml(typeof value==='string'?value:JSON.stringify(value,null,2))+'</pre></details>';
export function pill(value, tone = "neutral") {
  return `<span class="pill pill-${tone}">${escapeHtml(value)}</span>`;
}
export function emptyState(title, message, action = "") {
  return `<section class="empty-state">${icon("spark")}<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>${action}</section>`;
}
export function loading(message = "Carregando…") {
  return `<div class="route-loading" role="status"><span class="spinner"></span><p>${escapeHtml(message)}</p></div>`;
}
export function errorState(error, retry = true) {
  const view=humanError(error);
  return `<section class="empty-state error-state"><h2>Não foi possível carregar</h2><p>${escapeHtml(view.message)} ${escapeHtml(view.nextAction)}</p>${technicalDetails(view.code)}${retry ? '<button class="button" type="button" data-retry>Carregar novamente</button>' : ""}</section>`;
}
export function pageHeader({
  eyebrow = "",
  title,
  description = "",
  actions = "",
}) {
  return `<header class="page-header"><div>${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ""}<h1>${escapeHtml(title)}</h1>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div>${actions ? `<div class="page-actions">${actions}</div>` : ""}</header>`;
}
export function tabs(items, active) {
  return `<nav class="tabs" aria-label="Seções">${items.map((item) => `<a data-link href="${item.href}" class="${item.id === active ? "active" : ""}" ${item.id === active ? 'aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`).join("")}</nav>`;
}
export function toast(message, tone = "success") {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const item = document.createElement("div");
  item.className = `toast toast-${tone}`;
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), 4500);
}
