import { api } from "../shared/data.js";
import {
  escapeHtml,
  formatDate,
  icon,
  pill,
  statusLabel, humanText, humanError, technicalDetails,
  toast,
} from "../../app/ui.js";
import { requiresHumanReview } from "../shared/job-status.js";
import { currentRoute, onRouteChange } from "../../app/router.js";

let pollTimer = null;
let generation = 0;
let resumeTitles = new Map();
onRouteChange(() => { clearTimeout(pollTimer); generation++; });
const labels = { DRAFT:"Seleção pronta", ANALYZING:"Comparando bases", ANALYZED:"Comparação pronta", BASE_SELECTED:"Base confirmada", AWAITING_SELECTION:"Escolha por vaga", TAILORING:"Preparando ajustes", TAILORING_REVIEW_REQUIRED:"Revise os ajustes", TAILORING_APPROVED:"Ajustes aprovados", BUILDING_VERSION:"Criando versão", VERSION_REVIEW_REQUIRED:"Revise a versão", VERSION_APPROVED:"Pronto para gerar", AWAITING_REVIEW:"Aguardando revisão", GENERATING:"Preparando documentos", RENDERING:"Gerando documentos", READY:"Pronto", COMPLETED:"Concluído", PARTIAL_SUCCESS:"Concluído parcialmente", FAILED:"Falha isolada", CANCELLED:"Cancelado", BLOCKED:"Precisa de atenção", NOT_REQUESTED:"Não solicitado", PENDING:"Pendente" };
const label = state => labels[state] || statusLabel(state);
const safeTailoring = item => item.tailoring?.evidenceStatus === "VALID" && item.tailoring?.quality?.status !== "BLOCKED" && !(item.tailoring.changes || []).some(change => change.validationStatus !== "VALID");

export async function renderResumeBatchWorkspace({ root, route }) {
  if (currentRoute().name !== "resume-batch" || currentRoute().id !== route.id) return;
  clearTimeout(pollTimer);
  const requestGeneration = ++generation, wasMounted = root.isConnected;
  const { batch } = await api(
    `/api/resume-batches/${encodeURIComponent(route.id)}`,
    { cache: false },
  );
  if (requestGeneration !== generation || (wasMounted && !root.isConnected)) return;
  resumeTitles = new Map((batch.resumes || []).map(resume => [resume.id, resume.title]));
  const openDetails = [...root.querySelectorAll("details")].map((node,index)=>node.open?index:-1);
  root.innerHTML = `<div class="workspace-page batch-workspace"><header class="workspace-header"><a class="back-link" data-link href="/resumes?section=batches">← Currículos em lote</a><div class="workspace-title"><div><p class="eyebrow">Preparação de currículos em lote</p><h1>${batch.totalItems} currículos em preparação</h1><p>Criado em ${formatDate(batch.createdAt)}</p></div>${pill(statusLabel(batch.status), batch.status === "COMPLETED" ? "success" : requiresHumanReview(batch.status) ? "attention" : "info")}</div></header><div class="workspace-body">${progress(batch)}${actions(batch)}${matrix(batch)}${items(batch)}</div></div>`;
  bind(root, batch, route);
  root.querySelectorAll("details").forEach((node,index)=>{if(openDetails.includes(index))node.open=true;});
  if (
    batch.items.some((item) =>
      ["ANALYZING", "TAILORING", "BUILDING_VERSION", "RENDERING"].includes(
        item.status,
      ),
    )
  )
    pollTimer = setTimeout(
      () => { if (root.isConnected) renderResumeBatchWorkspace({ root, route }).catch(error => { const status = root.querySelector(".form-status"); if (status) status.textContent = error.message; }); },
      1200,
    );
}

function progress(batch) {
  const finished = batch.completedItems + batch.failedItems + batch.items.filter(item=>item.status==="CANCELLED").length,
    percent = batch.totalItems
      ? Math.round((finished / batch.totalItems) * 100)
      : 0;
  return `<section class="content-card batch-progress" aria-live="polite"><div class="section-heading"><div><p class="eyebrow">Progresso persistente</p><h2>${finished} de ${batch.totalItems} item(ns) encerrados</h2></div><strong>${percent}%</strong></div><progress max="${batch.totalItems}" value="${finished}"></progress><div class="batch-counts"><span>${batch.completedItems} prontos</span><span>${batch.reviewRequiredItems} aguardando revisão</span><span>${batch.failedItems} falharam</span></div></section>`;
}
function actions(batch) {
  const statuses = new Set(batch.items.map((item) => item.status));
  return `<section class="batch-action-bar"><div><strong>Próxima ação</strong><span>${nextLabel(batch, statuses)}</span></div><div class="button-row">${batch.status === "DRAFT" ? '<button class="button primary" data-batch-action="compare">Comparar currículos</button>' : ""}${batch.status === "AWAITING_SELECTION" ? '<button class="button primary" data-batch-action="select-tailor">Confirmar seleção e ajustar</button>' : ""}${statuses.has("TAILORING_REVIEW_REQUIRED") ? '<button class="button primary" data-batch-action="approve-tailoring">Aprovar ajustes seguros</button>' : ""}${statuses.has("VERSION_REVIEW_REQUIRED") ? '<button class="button primary" data-batch-action="approve-version">Aprovar versões</button>' : ""}${statuses.has("VERSION_APPROVED") ? '<button class="button primary" data-batch-action="render">Gerar documentos</button>' : ""}${batch.failedItems ? '<button class="button" data-batch-action="retry">Repetir falhas</button>' : ""}${["COMPLETED", "PARTIAL_SUCCESS"].includes(batch.status) ? `<a class="button primary" href="/api/resume-batches/${encodeURIComponent(batch.id)}/export">Baixar pacote ZIP</a>` : ""}${!["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"].includes(batch.status) ? '<button class="button quiet" data-batch-action="cancel">Cancelar restantes</button>' : ""}</div><p class="form-status" role="status"></p></section>`;
}
function nextLabel(batch, statuses) {
  if (batch.status === "DRAFT") return "Execute a comparação vaga × currículo.";
  if (batch.status === "ANALYZING")
    return "Comparações são executadas com concorrência limitada.";
  if (batch.status === "AWAITING_SELECTION")
    return "Escolha a melhor base por vaga.";
  if (statuses.has("TAILORING_REVIEW_REQUIRED"))
    return "Revise os ajustes propostos antes de criar versões.";
  if (statuses.has("VERSION_REVIEW_REQUIRED"))
    return "Aprove as versões imutáveis antes de gerar os arquivos.";
  if (batch.status === "GENERATING")
    return "PDF, LaTeX e arquivos para exportação estão sendo produzidos.";
  return "Consulte resultados e falhas isoladas.";
}
function matrix(batch) {
  if (!batch.comparisons?.length) return "";
  const resumeIds = [
    ...new Set(batch.comparisons.map((item) => item.resumeId)),
  ];
  return `<section class="content-card batch-matrix"><div class="section-heading"><div><p class="eyebrow">Matriz de comparação</p><h2>Vaga × currículo</h2><p>Pontuações e evidências pertencem a cada par; resultados idênticos podem ser reutilizados pelo aplicativo.</p></div></div><div class="matrix-scroll"><table><thead><tr><th>Oportunidade</th>${resumeIds.map((id) => `<th>${escapeHtml(shortId(id))}</th>`).join("")}</tr></thead><tbody>${batch.items
    .map(
      (item) =>
        `<tr><th>${escapeHtml(item.job?.title || "Vaga selecionada")}<small>${escapeHtml(item.job?.company || "")}</small></th>${resumeIds
          .map((resumeId) => {
            const comparison = item.comparisons.find(
              (x) => x.resumeId === resumeId,
            );
            return `<td>${comparison?.status === "COMPLETED" ? `<details><summary><strong>${Math.round(comparison.score || 0)}%</strong> · detalhes</summary>${comparisonDetails(comparison)}${comparison.reused ? "<small>Reutilizado do cache</small>" : ""}</details>` : `<span>${escapeHtml(label(comparison?.status || "PENDING"))}</span>`}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></div></section>`;
}
function items(batch) {
  return `<section class="batch-item-list" aria-label="Itens do lote">${batch.items.map(item => itemCard(item, batch)).join("")}</section>`;
}
function itemCard(item, batch) {
  const comparisons = item.comparisons
      .filter((x) => x.status === "COMPLETED")
      .sort((a, b) => Number(b.score) - Number(a.score)),
    tailoring = item.tailoring;
  const selected = item.finalResumeId || item.selectedBaseResumeId || batch.baseResumeId;
  const canChoose = ["ANALYZED", "BASE_SELECTED"].includes(item.status);
  const choice = canChoose ? `<label><span>Currículo escolhido</span><select data-item-resume>${comparisons.some(c => c.resumeId === selected) ? "" : `<option value="" selected>Escolha inicial indisponível — selecione uma base</option>`}${comparisons.map(c => `<option value="${escapeHtml(c.resumeId)}" ${c.resumeId === selected ? "selected" : ""}>${escapeHtml(shortId(c.resumeId))} · ${Math.round(c.score || 0)}%</option>`).join("")}</select></label><p class="truth-note">Sua escolha: ${escapeHtml(shortId(selected))}. Recomendação: ${escapeHtml(shortId(item.recommendedResumeId))}.</p>${item.recommendedResumeId !== selected ? '<button class="button quiet" data-use-recommended>Usar recomendação</button>' : ""}` : `<p>Base confirmada: ${escapeHtml(shortId(selected))}</p>`;
  const reviewActions = item.status === "TAILORING_REVIEW_REQUIRED" ? `<button class="button primary" data-item-action="approve-tailoring" ${safeTailoring(item) ? "" : "disabled"}>Aprovar ajustes desta vaga</button><button class="button quiet" data-item-action="reject-tailoring">Rejeitar ajustes</button>` : item.status === "VERSION_REVIEW_REQUIRED" ? '<button class="button primary" data-item-action="approve-version">Aprovar versão desta vaga</button><button class="button quiet" data-item-action="reject-version">Rejeitar versão</button>' : item.status === "FAILED" ? '<button class="button" data-item-action="retry">Repetir este item</button>' : item.status === "VERSION_APPROVED" ? '<button class="button" data-item-action="render">Gerar este documento</button>' : "";
  return `<article class="content-card batch-item" data-batch-item="${escapeHtml(item.id)}"><div class="section-heading"><div><p class="eyebrow">${escapeHtml(item.job?.company || "Empresa")}</p><h2>${escapeHtml(item.job?.title || "Vaga selecionada")}</h2><p>${escapeHtml([item.job?.location, item.job?.workModel ? statusLabel(item.job.workModel) : ""].filter(Boolean).join(" · "))}</p></div>${pill(label(item.status), item.status === "READY" ? "success" : item.status === "FAILED" ? "critical" : requiresHumanReview(item.status) ? "attention" : "info")}</div>${choice}${tailoring ? tailoringReview(tailoring) : ""}${item.version ? versionReview(item.version) : ""}${item.failureCode ? `<div class="status-banner danger"><strong>${escapeHtml(humanError({code:item.failureCode},"resume").message)}</strong><span>${escapeHtml(humanError({code:item.failureCode},"resume").nextAction)}</span></div>` : ""}<dl class="compact-definition">${["pdf","latex","overleaf"].map(output => `<div><dt>${output === "pdf" ? "PDF" : output === "latex" ? "LaTeX" : "Overleaf"}</dt><dd>${escapeHtml(label(item.outputStatus?.[output] || (batch.requestedOutputs[output] ? "PENDING" : "NOT_REQUESTED")))}</dd></div>`).join("")}</dl>${technicalDetails({itemId:item.id,jobId:item.jobId,failureCode:item.failureCode,failureMessage:item.failureMessage})}<div class="button-row">${reviewActions}${item.resumeVersionId ? `<a class="button quiet" data-link href="/resumes/${encodeURIComponent(item.resumeVersionId)}">Abrir versão e arquivos</a>` : ""}</div><p class="form-status" role="status"></p></article>`;
}
function comparisonDetails(comparison) {
  const result = comparison.result || {}, rows = result.items || [];
  const list = values => values.length ? `<ul>${values.map(value => `<li>${escapeHtml(typeof value === "string" ? value : value.requirement?.originalText || value.requirement?.normalizedName || (typeof value.requirement === "string" ? value.requirement : "") || value.text || value.reason || value.status || "Evidência registrada")}${value.resolution?.reason ? ` · ${escapeHtml(value.resolution.reason)}` : ""}</li>`).join("")}</ul>` : '<p class="muted">Nenhum item registrado nesta categoria.</p>';
  const metric = value => Number.isFinite(value) ? `${Math.round(value)}%` : "Não avaliado";
  return `<dl class="compact-definition"><div><dt>Compatibilidade técnica</dt><dd>${metric(result.technicalMatch ?? comparison.score)}</dd></div><div><dt>Cobertura de evidências</dt><dd>${metric(result.evidenceCoverage)}</dd></div><div><dt>Confiança da análise</dt><dd>${metric(result.matchConfidence)}</dd></div><div><dt>ATS documental</dt><dd>${metric(result.resumeAtsScore)}</dd></div><div><dt>Afinidade com a área</dt><dd>${escapeHtml(result.familyFit ? `${statusLabel(result.familyFit.primary)} · ${statusLabel(result.familyFit.level)}` : "Não avaliado neste par")}</dd></div></dl><h4>Pontos fortes</h4>${list(rows.filter(item => item.status === "MATCH"))}${[["TRANSFERABLE","Evidência transferível"],["LEARNABLE_GAP","Lacunas aprendíveis"],["NON_MATERIAL_GAP","Pontos não materiais a confirmar"],["MATERIAL_GAP","Lacunas materiais"],["BLOCKING_GAP","Lacunas bloqueantes"]].map(([state,title])=>`<h4>${title}</h4>${list((result.gaps || []).filter(gap=>gap.status===state))}`).join("")}<h4>Bloqueios explícitos</h4>${list(result.blockingIssues || [])}<p class="truth-note">Repositórios ainda não analisados não comprovam ausência de competência. A decisão da oportunidade permanece separada desta pontuação.</p>`;
}
function versionReview(version) {
  const spec = version.resumeSpec || {};
  return `<details><summary>Revisar conteúdo da versão</summary><p>${escapeHtml(typeof spec.summary === "string" ? spec.summary : spec.summary?.text || "")}</p>${["experiences","projects","skills","education","certifications"].map(key => `<section><h4>${({experiences:"Experiência",projects:"Projetos",skills:"Competências",education:"Educação",certifications:"Certificações"})[key]}</h4>${(Array.isArray(spec[key]) ? spec[key] : []).map(entry => `<p>${escapeHtml(typeof entry === "string" ? entry : [entry.title || entry.role || entry.name || entry.degree, entry.company || entry.institution, entry.description, ...(entry.bullets || []).map(bullet=>typeof bullet === "string"?bullet:bullet.text)].filter(Boolean).join(" · "))}</p>`).join("")}</section>`).join("")}<p>Modelo: ${escapeHtml(statusLabel(version.templateId))} · ${escapeHtml(statusLabel(version.language))}</p>${technicalDetails({templateId:version.templateId,language:version.language})}</details>`;
}
function tailoringReview(run) {
  const quality=run.quality||{},issues=[...(quality.blockingReasons||[]),...(quality.warnings||[])];
  return `<section class="review-diff"><h3>Ajustes propostos</h3><p>${run.originalScore ?? "—"} → ${run.tailoredScore ?? "—"} · Evidências ${escapeHtml(statusLabel(run.evidenceStatus))}</p>${quality.status?`<div class="status-banner ${quality.status==="BLOCKED"?"danger":quality.status==="PASS"?"success":"warning"}"><strong>Qualidade editorial: ${escapeHtml(statusLabel(quality.status))} · ${Math.round(quality.score||0)}%</strong><span>${quality.autoApplyEligible?"Pode seguir para a política de AutoApply depois da sua aprovação.":"Exige revisão humana; não seguirá automaticamente."}</span>${issues.length?`<ul>${issues.map(reason=>`<li>${escapeHtml(humanText(reason))}</li>`).join("")}</ul>`:""}</div>`:""}${(run.changes || []).map((change) => `<article><strong>${escapeHtml(statusLabel(change.type))}</strong><div class="diff-before"><small>Antes</small><p>${escapeHtml(change.original)}</p></div><div class="diff-after"><small>Depois</small><p>${escapeHtml(change.proposed)}</p></div><small>${escapeHtml(humanText(change.reason))} · ${escapeHtml(statusLabel(change.validationStatus))}</small></article>`).join("") || '<p class="muted">Nenhuma alteração factual necessária.</p>'}</section>`;
}
function shortId(id) {
  if (resumeTitles.get(id)) return resumeTitles.get(id);
  return id ? "Currículo selecionado" : "Currículo não selecionado";
}

function bind(root, batch, route) {
  const ready=batch.items.filter(item=>item.status==="READY"&&item.resumeVersionId);
  if(ready.length){
    const actions=root.querySelector(".batch-action-bar .button-row"),button=document.createElement("button");
    button.className="button";button.textContent="Preparar candidaturas dos currículos prontos";
    button.onclick=async()=>{button.disabled=true;try{const {prepareApplications}=await import("../application-batches/page.js");await prepareApplications(ready.map(i=>i.jobId),Object.fromEntries(ready.map(i=>[i.jobId,i.resumeVersionId])));}catch(error){toast(error.message,"error");button.disabled=false;}};
    actions?.append(button);
  }
  root.querySelectorAll("[data-batch-item]").forEach(card => {
    const item = batch.items.find(value => value.id === card.dataset.batchItem), select = card.querySelector("[data-item-resume]");
    const saveChoice = async () => {
      const status = card.querySelector(".form-status");
      if (!select.value) return;
      select.disabled = true;
      try { await mutate(batch.id, "selections", {selections:[{itemId:item.id,resumeId:select.value}]}); item.finalResumeId=select.value; status.textContent="Escolha salva para esta vaga."; }
      catch(error) { status.textContent=error.message; }
      finally { select.disabled=false; }
    };
    select?.addEventListener("change", saveChoice);
    card.querySelector("[data-use-recommended]")?.addEventListener("click", async () => { select.value=item.recommendedResumeId; await saveChoice(); });
    card.querySelectorAll("[data-item-action]").forEach(button => button.addEventListener("click", async () => {
      const action=button.dataset.itemAction, status=card.querySelector(".form-status"); button.disabled=true;
      try {
        if (action.includes("tailoring") || action.includes("version")) await mutate(batch.id,"approve",{phase:action.includes("tailoring")?"TAILORING":"VERSION",state:action.startsWith("reject")?"REJECTED":"APPROVED",itemIds:[item.id]});
        else await mutate(batch.id,action,{itemIds:[item.id]});
        await renderResumeBatchWorkspace({root,route});
      } catch(error) {status.textContent=error.message;button.disabled=false;}
    }));
  });
  root.querySelectorAll("[data-batch-action]").forEach((button) =>
    button.addEventListener("click", async () => {
      const action = button.dataset.batchAction,
        status = root.querySelector(".batch-action-bar .form-status");
      button.disabled = true;
      status.textContent = "Atualizando a preparação…";
      try {
        if (action === "compare") await mutate(batch.id, "compare", {});
        else if (action === "select-tailor") {
          const selections = [...root.querySelectorAll("[data-batch-item]")]
            .map((card) => ({
              itemId: card.dataset.batchItem,
              resumeId: card.querySelector("[data-item-resume]")?.value,
            }))
            .filter((x) => x.resumeId);
          await mutate(batch.id, "selections", { selections });
          await mutate(batch.id, "tailor", {
            itemIds: selections.map((x) => x.itemId),
          });
        } else if (action === "approve-tailoring") {
          const itemIds=batch.items.filter(item => item.status === "TAILORING_REVIEW_REQUIRED" && safeTailoring(item)).map(item=>item.id);
          if (!itemIds.length) throw new Error("Nenhum ajuste validado está disponível para aprovação em lote.");
          await mutate(batch.id, "approve", {
            phase: "TAILORING",
            state: "APPROVED",
            itemIds,
          });
        } else if (action === "approve-version")
          await mutate(batch.id, "approve", {
            phase: "VERSION",
            state: "APPROVED",
          });
        else if (action === "render") await mutate(batch.id, "render", {});
        else if (action === "retry") await mutate(batch.id, "retry", {});
        else if (action === "cancel") await mutate(batch.id, "cancel", {});
        toast("Lote atualizado.");
        await renderResumeBatchWorkspace({ root, route });
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    }),
  );
}
const mutate = (id, action, body) =>
  api(`/api/resume-batches/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
