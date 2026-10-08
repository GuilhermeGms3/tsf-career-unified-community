import {api} from "../api/client.js";
import {escapeHtml,statusLabel} from "./ui.js";

const terminal=new Set(["COMPLETED","PARTIAL_SUCCESS","FAILED","CANCELLED"]),working=new Set(["ANALYZING","TAILORING","BUILDING_VERSION","RENDERING"]),storageKey="career.resumeQueue.minimized";
let timer=null,stopped=false;
const narrative=item=>({SELECTED:"Aguardando início da comparação",ANALYZING:"Comparando os currículos disponíveis",ANALYZED:"Comparação concluída",BASE_SELECTED:"Base escolhida para esta vaga",TAILORING:"Ajustando o conteúdo para a vaga",TAILORING_REVIEW_REQUIRED:"Aguardando sua revisão dos ajustes",TAILORING_APPROVED:"Ajustes aprovados",BUILDING_VERSION:"Montando a versão do currículo",VERSION_REVIEW_REQUIRED:"Aguardando sua revisão do currículo",VERSION_APPROVED:"Versão aprovada; aguardando documentos",RENDERING:"Gerando LaTeX e PDF",READY:"Currículo pronto",BLOCKED:"Bloqueado pelo gate de qualidade",FAILED:"Falha isolada",CANCELLED:"Item cancelado"})[item.status]||statusLabel(item.status);
const minimized=()=>localStorage.getItem(storageKey)==="true";

export function initResumeQueuePanel(){
  const panel=document.querySelector("#resume-queue-panel"),reopen=document.querySelector("#resume-queue-reopen");if(!panel||!reopen)return;
  reopen.addEventListener("click",()=>{localStorage.setItem(storageKey,"false");reopen.hidden=true;panel.hidden=false;refresh();});
  document.addEventListener("click",event=>{if(event.target.closest("[data-resume-queue-minimize]")){localStorage.setItem(storageKey,"true");panel.hidden=true;reopen.hidden=false;}});
  window.addEventListener("beforeunload",()=>{stopped=true;clearTimeout(timer);},{once:true});refresh();
}
async function refresh(){
  clearTimeout(timer);if(stopped)return;const panel=document.querySelector("#resume-queue-panel"),reopen=document.querySelector("#resume-queue-reopen");
  try{
    const {batches=[]}=await api("/api/resume-batches",{cache:false}),summary=batches.find(batch=>!terminal.has(batch.status));
    if(!summary){panel.hidden=true;reopen.hidden=true;return;}
    const {batch}=await api(`/api/resume-batches/${encodeURIComponent(summary.id)}`,{cache:false}),isMinimized=minimized();panel.innerHTML=markup(batch);panel.hidden=isMinimized;reopen.hidden=!isMinimized;reopen.textContent=`Fila de currículos · ${batch.items.filter(item=>working.has(item.status)).length||batch.reviewRequiredItems||batch.totalItems}`;
  }catch(error){if(!panel.hidden)panel.innerHTML=`<div class="resume-queue-head"><div><small>Fila de currículos</small><strong>Não foi possível atualizar</strong></div><button class="icon-button" data-resume-queue-minimize aria-label="Minimizar fila">−</button></div><p>${escapeHtml(error.message)}</p>`;}
  finally{timer=setTimeout(refresh,2000);}
}
function markup(batch){
  const done=batch.completedItems+batch.failedItems+batch.items.filter(item=>item.status==="CANCELLED").length,percent=batch.totalItems?Math.round(done/batch.totalItems*100):0,current=batch.items.find(item=>working.has(item.status))||batch.items.find(item=>item.reviewState==="REVIEW_REQUIRED")||batch.items.find(item=>!terminal.has(item.status))||batch.items[0];
  return `<div class="resume-queue-head"><div><small>Fila de currículos</small><strong>${escapeHtml(current?narrative(current):statusLabel(batch.status))}</strong></div><button class="icon-button" type="button" data-resume-queue-minimize aria-label="Minimizar fila">−</button></div><div class="resume-queue-progress"><span style="width:${percent}%"></span></div><p class="resume-queue-current">${current?`<strong>${escapeHtml(current.job?.title||"Vaga selecionada")}</strong><span>${escapeHtml(current.job?.company||"")}</span>`:""}</p><ol>${batch.items.slice(0,5).map(item=>`<li class="${working.has(item.status)?"is-running":item.status==="READY"?"is-ready":""}"><span></span><div><strong>${escapeHtml(item.job?.title||"Oportunidade")}</strong><small>${escapeHtml(narrative(item))}</small>${item.tailoring?.quality?.status?`<small>Qualidade: ${escapeHtml(statusLabel(item.tailoring.quality.status))} · ${Math.round(item.tailoring.quality.score||0)}%</small>`:""}</div></li>`).join("")}</ol>${batch.totalItems>5?`<p class="truth-note">Mais ${batch.totalItems-5} item(ns) nesta fila.</p>`:""}<a class="button primary" data-link href="/resume-batches/${encodeURIComponent(batch.id)}">Abrir fila completa</a>`;
}
