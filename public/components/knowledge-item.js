import {escapeHtml} from "../sanitize.js";
import {humanText} from "../app/presentation.js";

const statusLabel=status=>({USER_CONFIRMED:"Confirmado",IMPORTED_CONFIRMED:"Importado e confirmado",SYSTEM_EXTRACTED:"Extraído pelo sistema",REVIEW_REQUIRED:"Revisar",REJECTED:"Incorreto"})[status]||"Não verificado";
const reuseLabel=policy=>({REUSABLE:"Reutilizável",REUSABLE_WITH_CONFIRMATION:"Confirmar antes de reutilizar",APPLICATION_SPECIFIC:"Uso específico",SENSITIVE_CONFIRM_EACH_TIME:"Sempre confirmar",NEVER_AUTO_REUSE:"Não reutilizar automaticamente"})[policy]||"Uso controlado";
const text=value=>String(value??"").trim();
const list=value=>Array.isArray(value)?value.map(item=>typeof item==="string"?item:text(item?.name||item?.technology||item)).filter(Boolean):text(value).split(/[\n;,]/).map(item=>item.trim()).filter(Boolean);

function structured(item){
  const value=item.value||{};
  if(item.unitType==="WORK_EXPERIENCE")return `<div class="knowledge-structured"><strong>${escapeHtml(value.role||value.title||item.label)}</strong>${value.company?`<span>${escapeHtml(value.company)}</span>`:""}${value.startDate||value.endDate?`<small>${escapeHtml([value.startDate,value.endDate].filter(Boolean).join(" – "))}</small>`:""}${list(value.responsibilities||value.bullets).length?`<ul>${list(value.responsibilities||value.bullets).slice(0,3).map(line=>`<li>${escapeHtml(line)}</li>`).join("")}</ul>`:""}${list(value.technologies).length?`<p class="knowledge-tech">${list(value.technologies).map(escapeHtml).join(" · ")}</p>`:""}</div>`;
  if(item.unitType==="EDUCATION")return `<div class="knowledge-structured"><strong>${escapeHtml(value.course||value.field||value.degree||item.label)}</strong>${value.institution?`<span>${escapeHtml(value.institution)}</span>`:""}${value.status?`<small>${escapeHtml(humanText(value.status))}</small>`:""}</div>`;
  if(item.unitType==="PROJECT")return `<div class="knowledge-structured"><strong>${escapeHtml(value.name||item.label)}</strong>${value.description?`<p>${escapeHtml(value.description)}</p>`:""}${list(value.technologies).length?`<p class="knowledge-tech">${list(value.technologies).map(escapeHtml).join(" · ")}</p>`:""}</div>`;
  return `<strong>${escapeHtml(item.label)}</strong>`;
}

export function renderKnowledgeItem(item){
  if(item.unitType==="LANGUAGE")return `<button class="knowledge-row" type="button" data-knowledge-key="${escapeHtml(item.key)}"><span><strong>${escapeHtml(item.label)}</strong>${item.language?.evidence?`<small>${escapeHtml(item.language.evidence)}</small>`:""}</span><span>${escapeHtml(item.language?.level||"Nível não informado")}</span><span class="knowledge-state">${statusLabel(item.verificationStatus)}</span></button>`;
  const body=["WORK_EXPERIENCE","EDUCATION","PROJECT"].includes(item.unitType)?structured(item):`<strong>${escapeHtml(item.sensitive?"Informação protegida":item.label)}</strong>`;
  return `<button class="knowledge-item" type="button" data-knowledge-key="${escapeHtml(item.key)}"><span>${body}</span><span class="knowledge-item-meta"><span class="knowledge-state">${statusLabel(item.verificationStatus)}</span><small>${reuseLabel(item.reusePolicy)}</small></span></button>`;
}

export {reuseLabel,statusLabel};
