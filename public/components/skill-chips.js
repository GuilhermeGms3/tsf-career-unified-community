import {escapeHtml} from "../sanitize.js";

export function renderSkillChips(items,{expanded=false}={}){
  if(!items.length)return '<div class="knowledge-empty"><p>Nenhuma competência cadastrada.</p><button type="button" data-add-knowledge="SKILL">Adicionar competência</button></div>';
  const visible=expanded?items:items.slice(0,17),remaining=Math.max(0,items.length-visible.length);
  return `<div class="skill-chip-list">${visible.map(item=>`<button class="skill-chip" type="button" data-knowledge-key="${escapeHtml(item.key)}"><span>${escapeHtml(item.label)}</span><small>${item.verificationStatus==="USER_CONFIRMED"?"Confirmada":item.verificationStatus==="REVIEW_REQUIRED"?"Revisar":"Extraída"}</small></button>`).join("")}${remaining?`<button class="skill-chip skill-chip-more" type="button" data-expand-skills>+ ${remaining} competências</button>`:""}</div>`;
}
