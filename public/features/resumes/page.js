import { api } from "../shared/data.js";
import {
  emptyState,
  escapeHtml,
  formatDate,
  icon,
  pageHeader,
  pill,
  statusLabel, humanText, technicalDetails,
  tabs,
  toast,
} from "../../app/ui.js";
import {
  bindResumeReview,
  renderResumeReview,
} from "../shared/resume-review.js";
import { isTerminalJobStatus, requiresHumanReview } from "../shared/job-status.js";
import { trackBackgroundJob } from "../../app/background-jobs.js";
import { navigate } from "../../app/router.js";
let currentBatches = [];
let currentResumeOperations = { archetypes: [], compiler: {}, metrics: {}, benchmarks: [] };
let currentDefaultResumeId = "";

export async function renderResumes({ root }) {
  const section =
      new URLSearchParams(location.search).get("section") || "library",
    [resumeResult, templateResult, batchResult, operationsResult] = await Promise.allSettled([
      api("/api/experience/resumes"),
      api("/api/resume-documents/templates"),
      section === "batches"
        ? api("/api/resume-batches")
        : Promise.resolve({ batches: [] }),
      section === "templates"
        ? Promise.all([
            api("/api/resume-archetypes"),
            api("/api/resume-documents/compiler-health", { cache: false }),
            api("/api/resume-documents/metrics", { cache: false }),
            api("/api/resume-documents/templates/benchmarks", { cache: false }),
          ])
        : Promise.resolve([]),
    ]),
    resumes =
      resumeResult.status === "fulfilled"
        ? resumeResult.value.resumes || []
        : [],
    templates =
      templateResult.status === "fulfilled"
        ? templateResult.value.templates || []
        : [],
    batches =
      batchResult.status === "fulfilled" ? batchResult.value.batches || [] : [],
    versions = resumes.flatMap((item) => item.versions || []);
  currentBatches = batches;
  currentDefaultResumeId =
    resumeResult.status === "fulfilled"
      ? resumeResult.value.defaultResumeId || ""
      : "";
  if (operationsResult.status === "fulfilled" && operationsResult.value.length) {
    const [archetypes, compiler, metrics, benchmarks] = operationsResult.value;
    currentResumeOperations = {
      archetypes: archetypes.items || [],
      compiler: compiler.health || {},
      metrics: metrics.metrics || {},
      benchmarks: benchmarks.benchmarks || [],
    };
  } else if (section === "templates") {
    currentResumeOperations = { archetypes: [], compiler: {}, metrics: {}, benchmarks: [], error: operationsResult.reason };
  }
  root.innerHTML = `<div class="page resumes-page">${pageHeader({ eyebrow: "Seus documentos", title: "Currículos", description: "Encontre suas bases, revise versões preparadas para vagas e baixe documentos aprovados.", actions: '<button class="button primary" type="button" data-import-resume>Importar currículo</button>' })}${resumeResult.status === "rejected" ? '<div class="status-banner danger" role="alert"><strong>Não foi possível abrir seus currículos.</strong> Tente novamente; suas vagas e candidaturas continuam disponíveis.</div>' : templateResult.status === "rejected" ? '<div class="status-banner attention" role="status">Seus currículos estão disponíveis, mas os modelos de documento não puderam ser carregados agora.</div>' : ""}${tabs(
    [
      ["library", "Visão geral"],
      ["review", `Para revisar (${versions.filter((v) => v.status === "REVIEW_REQUIRED").length})`],
      ["approved", "Prontos para uso"],
      ["templates", "Modelos ATS"],
    ].map(([id, label]) => ({ id, label, href: `/resumes?section=${id}` })),
    section,
  )}<details class="page-secondary-navigation"><summary>Mais opções de currículo</summary><nav aria-label="Opções avançadas de currículo"><a data-link href="/resumes?section=versions">Todas as versões</a><a data-link href="/resumes?section=batches">Preparação em lote</a><a data-link href="/resumes?section=history">Histórico</a></nav></details><div class="resume-summary"><article><strong>${resumes.length}</strong><span>Currículos base</span></article><article><strong>${new Set(templates.filter((template) => template.atsOptimized).map((template) => template.id)).size}</strong><span>Modelos ATS</span></article><article><strong>${versions.filter((v) => v.status === "REVIEW_REQUIRED").length}</strong><span>Aguardando sua revisão</span></article><article><strong>${versions.filter((v) => ["APPROVED", "READY"].includes(v.status)).length}</strong><span>Prontos para uso</span></article></div>${resumeSection(section, resumes, versions, templates)}<dialog id="resume-import-dialog"><form class="dialog-card" data-resume-import><header><div><p class="eyebrow">Adicionar currículo base</p><h2>Importar currículo</h2></div><button class="icon-button" type="button" data-close-import aria-label="Fechar">×</button></header><label><span>Arquivo PDF, DOCX ou TXT</span><input name="file" type="file" accept=".pdf,.docx,.txt" required /></label><label><span>Nome na biblioteca</span><input name="title" maxlength="160" /></label><label><span>Foco opcional</span><input name="focus" maxlength="160" /></label><button class="button primary" type="submit">Importar currículo</button><p class="form-status" role="status"></p></form></dialog></div>`;
  bindResumeLibrary(root);
  bindResumeOperations(root, section);
}
function resumeSection(section, resumes, versions, templates) {
  if (section === "batches") return batchesView(currentBatches);
  if (section === "templates") return templatesView(templates, currentResumeOperations);
  if (section === "review")
    return versionsView(
      versions.filter((version) => version.status === "REVIEW_REQUIRED"),
      "Nenhuma versão aguarda revisão",
    );
  if (section === "approved")
    return versionsView(
      versions.filter((version) => ["APPROVED", "READY"].includes(version.status)),
      "Nenhum currículo pronto para uso",
    );
  if (section === "versions")
    return versionsView(versions, "Nenhuma versão específica produzida");
  if (section === "history")
    return versionsView(
      [...versions].sort(
        (a, b) =>
          new Date(b.createdAt || b.updatedAt || 0) -
          new Date(a.createdAt || a.updatedAt || 0),
      ),
      "O histórico será formado por versões imutáveis",
    );
  return resumeDashboard(resumes, versions);
}

function resumeDashboard(resumes, versions) {
  const review = versions.filter((version) => version.status === "REVIEW_REQUIRED");
  const ready = versions.filter((version) => ["APPROVED", "READY"].includes(version.status));
  const archived = versions.filter((version) => ["REJECTED", "CANCELLED"].includes(version.status));
  const bases = resumes.length
    ? `<section class="resume-library">${resumes.map(resumeCard).join("")}</section>`
    : `<section class="action-empty"><span>${icon("document")}</span><h2>Nenhum currículo base</h2><p>Importe um currículo para preparar versões específicas para suas vagas.</p><button class="button primary" type="button" data-import-resume>Importar currículo</button></section>`;
  return `<div class="resume-dashboard"><section aria-labelledby="resume-bases-title"><div class="section-heading"><div><p class="eyebrow">Ponto de partida</p><h2 id="resume-bases-title">Currículos base</h2><p>Documentos que preservam seu histórico e alimentam versões específicas.</p></div></div>${bases}</section><section aria-labelledby="resume-review-title"><div class="section-heading"><div><p class="eyebrow">Sua decisão</p><h2 id="resume-review-title">Prontos para revisão</h2><p>Leia o currículo completo antes de aprovar.</p></div>${review.length ? `<a class="button quiet" data-link href="/resumes?section=review">Ver todos (${review.length})</a>` : ""}</div>${versionsView(review.slice(0, 4), "Nenhum currículo aguardando revisão")}</section><section aria-labelledby="resume-ready-title"><div class="section-heading"><div><p class="eyebrow">Documentos finais</p><h2 id="resume-ready-title">Aprovados e prontos</h2><p>Versões que já podem ser usadas ou exportadas.</p></div>${ready.length ? '<a class="button quiet" data-link href="/resumes?section=approved">Ver todos</a>' : ""}</div>${versionsView(ready.slice(0, 4), "Nenhum currículo pronto para uso")}</section>${archived.length ? `<details class="archived-resumes"><summary>Arquivados (${archived.length})</summary>${versionsView(archived, "")}</details>` : ""}</div>`;
}
function batchesView(batches) {
  return `<section><div class="section-heading"><div><p class="eyebrow">Preparação de currículos em lote</p><h2>Preparações em lote</h2><p>Compare bases, revise mudanças e gere documentos para várias oportunidades com falhas isoladas.</p></div><a class="button primary" data-link href="/opportunities?section=recommended">Selecionar oportunidades</a></div>${batches.length ? `<div class="compact-record-list">${batches.map((batch) => `<a class="compact-record" data-link href="/resume-batches/${encodeURIComponent(batch.id)}"><span><strong>${batch.totalItems} oportunidade(s)</strong><small>${formatDate(batch.createdAt)} · ${batch.completedItems} pronta(s) · ${batch.failedItems} falha(s)</small></span>${pill(statusLabel(batch.status), batch.status === "COMPLETED" ? "success" : batch.reviewRequiredItems ? "attention" : "info")}${icon("arrow")}</a>`).join("")}</div>` : `<div class="action-empty"><span class="document-icon">${icon("document")}</span><h2>Nenhum batch criado</h2><p>Comece selecionando oportunidades nas listas Recomendadas, Vale revisar, Stretch ou Todas.</p><a class="button primary" data-link href="/opportunities?section=recommended">Selecionar oportunidades</a></div>`}</section>`;
}
function versionsView(versions, emptyTitle) {
  if (!versions.length)
    return emptyState(
      emptyTitle,
      "Versões são criadas pelo fluxo de preparação de uma oportunidade e nunca sobrescrevem o histórico.",
    );
  return `<section class="compact-record-list" aria-label="Versões de currículo">${versions
    .map(
      (version) =>
        `<a class="compact-record" data-link href="/resumes/${encodeURIComponent(version.id)}"><span><strong>${escapeHtml(version.title || version.jobTitle || `Versão ${version.versionNumber || ""}`.trim())}</strong><small>${escapeHtml([statusLabel(version.archetypeId || "GENERAL", "resume"), statusLabel(version.templateId, "resume"), statusLabel(version.language, "resume")].filter(Boolean).join(" · "))}</small></span>${pill(statusLabel(version.status, "resume"), version.status === "REVIEW_REQUIRED" ? "attention" : "success")}<small>${formatDate(version.createdAt || version.updatedAt)}</small>${icon("arrow")}</a>`,
    )
    .join("")}</section>`;
}
function templatesView(templates, operations) {
  const assignments = operations.archetypes.flatMap((item) => item.assignments || []),
    pending = assignments.filter((item) => item.status === "REVIEW_REQUIRED"),
    benchmarkByTemplate = new Map(operations.benchmarks.map((item) => [item.templateId, item]));
  return `<section><div class="section-heading"><div><p class="eyebrow">Geração verificável</p><h2>Modelos ATS e bases recomendadas</h2><p>O currículo base fornece seu conteúdo real. O modelo ATS define como uma nova versão organiza esse conteúdo para cada vaga.</p></div><button class="button" type="button" data-prepare-archetypes>Atualizar recomendações</button></div>${operations.error ? `<div class="status-banner attention" role="alert">Não foi possível carregar o diagnóstico completo dos modelos.</div>` : ""}<div class="diagnostic-grid"><article><small>Gerador de PDF</small><strong>${escapeHtml(statusLabel(operations.compiler.status || "UNKNOWN"))}</strong></article><article><small>Perfis disponíveis</small><strong>${operations.archetypes.length}</strong></article><article><small>Recomendações para revisar</small><strong>${pending.length}</strong></article><article><small>Benchmarks registrados</small><strong>${operations.benchmarks.length}</strong></article></div><p class="form-status" data-archetype-status role="status"></p><div class="company-grid">${operations.archetypes.map(archetypeCard).join("") || '<p class="muted">Nenhum perfil de currículo habilitado.</p>'}</div><div class="section-heading"><div><h2>Modelos de saída</h2><p>Você escolhe um destes modelos dentro da vaga; o currículo importado continua sendo a base factual.</p></div></div><div class="company-grid">${templates.map((template) => { const benchmark=benchmarkByTemplate.get(template.id); return `<article class="content-card"><span class="document-icon">${icon("document")}</span><h2>${escapeHtml(statusLabel(template.id))}</h2><p>${escapeHtml(template.purpose?.replace("ATS-safe","compatível com sistemas de recrutamento"))}</p><dl class="compact-definition"><div><dt>Versão</dt><dd>${escapeHtml(template.version)}</dd></div><div><dt>Organização visual</dt><dd>${escapeHtml(statusLabel(template.layoutType))}</dd></div><div><dt>Idiomas</dt><dd>${escapeHtml((template.supportedLanguages || []).map(statusLabel).join(", "))}</dd></div><div><dt>ATS</dt><dd>${template.atsOptimized ? "Otimizado" : "Editorial"}</dd></div><div><dt>Leitura medida</dt><dd>${benchmark ? `${Number(benchmark.parseabilityScore || 0)}%` : "Ainda não medida"}</dd></div></dl></article>`; }).join("") || '<p class="muted">Nenhum modelo habilitado.</p>'}</div><details><summary>Métricas técnicas dos documentos</summary><pre>${escapeHtml(JSON.stringify(operations.metrics, null, 2))}</pre></details></section>`;
}

function archetypeCard(item) {
  const archetype = item.archetype || {}, assignment = (item.assignments || [])[0];
  return `<article class="content-card"><h3>${escapeHtml(statusLabel(archetype.id, "resume"))}</h3><p>${escapeHtml((archetype.targetTitles || []).slice(0, 4).join(" · ") || "Perfil técnico")}</p><dl class="compact-definition"><div><dt>Base recomendada</dt><dd>${escapeHtml(assignment?.resumeTitle || "Atualize as recomendações")}</dd></div><div><dt>Cobertura factual</dt><dd>${assignment ? `${Math.round(Number(assignment.evidenceCoverage || 0) * 100)}%` : "Não calculada"}</dd></div><div><dt>Estado</dt><dd>${escapeHtml(statusLabel(assignment?.status || "NOT_ATTEMPTED"))}</dd></div></dl>${assignment?.status === "REVIEW_REQUIRED" ? `<div class="button-row"><button class="button primary" type="button" data-review-archetype="APPROVED" data-assignment-id="${escapeHtml(assignment.id)}">Aprovar base</button><button class="button" type="button" data-review-archetype="REJECTED" data-assignment-id="${escapeHtml(assignment.id)}">Rejeitar</button></div>` : ""}</article>`;
}

function bindResumeOperations(root, section) {
  if (section !== "templates") return;
  const status = root.querySelector("[data-archetype-status]");
  root.querySelector("[data-prepare-archetypes]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget, original = button.textContent;
    button.disabled = true; status.textContent = "Comparando suas bases com os perfis…";
    try {
      await api("/api/resume-archetypes/prepare", { method: "POST", body: "{}" });
      toast("Recomendações de base atualizadas.");
      await renderResumes({ root });
    } catch (error) { status.textContent = error.message; button.disabled = false; button.textContent = original; }
  });
  root.querySelectorAll("[data-review-archetype]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true; status.textContent = "Registrando sua decisão…";
    try {
      await api(`/api/resume-archetypes/assignments/${encodeURIComponent(button.dataset.assignmentId)}/review`, { method: "POST", body: JSON.stringify({ status: button.dataset.reviewArchetype }) });
      toast(button.dataset.reviewArchetype === "APPROVED" ? "Base aprovada." : "Recomendação rejeitada.");
      await renderResumes({ root });
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  }));
}
function resumeCard(item) {
  const r = item.resume,
    latest = item.versions[0],
    isDefault = r.id === currentDefaultResumeId;
  const importNeedsReview = r.importStatus === "IMPORTED_NEEDS_REVIEW";
  const sourceOnly = r.resumeKind !== "BASE";
  return `<article class="resume-card"><span class="document-icon">${icon("document")}</span><div><div class="record-title"><h2>${escapeHtml(r.title || r.fileName || "Currículo base")}</h2>${isDefault ? pill("Base aprovada", "success") : pill(importNeedsReview ? "Dados para confirmar" : sourceOnly ? "Fonte de conhecimento" : "Importado", importNeedsReview ? "attention" : "info")}</div><p>${escapeHtml(r.focus || "Perfil geral")} · ${escapeHtml(statusLabel(r.language || "pt-BR", "resume"))}</p><small>Atualizado em ${formatDate(r.updatedAt)} · ${item.versions.length} versão(ões)</small>${sourceOnly ? '<p class="truth-note">Este documento fornece fatos e evidências, mas não é usado como modelo para gerar currículos.</p>' : ""}${importNeedsReview ? '<p class="truth-note">O arquivo foi importado. Confirme email ou telefone antes de preparar uma versão.</p>' : ""}${item.assignment ? `<p>Foco: <strong>${escapeHtml(statusLabel(item.assignment.archetypeId, "resume"))}</strong></p>` : ""}</div><div class="record-actions">${latest ? `<a class="button" data-link href="/resumes/${encodeURIComponent(latest.id)}">Abrir versão</a>` : importNeedsReview ? '<a class="button primary" data-link href="/settings?section=general">Confirmar dados</a>' : ""}${isDefault ? "" : `<button class="button quiet" type="button" data-default-resume="${escapeHtml(r.id)}">Usar como base aprovada</button>`}<span>${isDefault ? "Usado automaticamente como BASE 01" : sourceOnly ? "Somente conhecimento" : latest ? statusLabel(latest.status, "resume") : "Importado"}</span></div></article>`;
}
export async function renderResumeWorkspace({ root, route }) {
  const data = await api(
      `/api/resume-documents/versions/${encodeURIComponent(route.id)}`,
    ),
    v = data.version;
  const historyOpen = route.tab === "history" ? "open" : "";
  root.innerHTML = `<div class="workspace-page resume-workspace"><header class="workspace-header"><a class="back-link" data-link href="/resumes">← Voltar para currículos</a><div class="workspace-title"><div><p class="eyebrow">Currículo específico</p><h1>${escapeHtml(v.title || "Versão de currículo")}</h1><p>Leia o documento completo e registre sua decisão.</p></div>${pill(statusLabel(v.status, "resume"), v.status === "REVIEW_REQUIRED" ? "attention" : "success")}</div></header><div class="workspace-body resume-workspace-body">${renderResumeReview(v)}<section class="resume-output-actions"><div><p class="eyebrow">Arquivos</p><h2>${data.artifacts.length ? "Currículo pronto para uso" : "Exportação final"}</h2><p>${data.artifacts.length ? "Baixe os arquivos gerados para esta versão." : v.status === "REVIEW_REQUIRED" ? "A exportação será liberada depois da sua aprovação." : "Gere o documento final sem bloquear sua navegação."}</p></div><div class="artifact-list">${data.artifacts.map((artifact) => `<a class="button primary" href="/api/resume-documents/artifacts/${encodeURIComponent(artifact.id)}/download">Baixar ${escapeHtml(artifact.artifactType)}</a>`).join("")}${["APPROVED", "READY", "FAILED"].includes(v.status) ? `<button class="button" type="button" data-render-resume>${v.status === "FAILED" ? "Tentar gerar novamente" : v.status === "READY" ? "Gerar novo PDF" : "Gerar PDF"}</button>` : ""}</div><p class="form-status" data-render-status role="status"></p></section><details class="workspace-advanced" ${historyOpen}><summary>Histórico e detalhes técnicos</summary><div>${resumeHistory(data)}${technicalDetails({versionId:v.id,templateId:v.templateId,archetypeId:v.archetypeId,jobId:v.jobId,source:v.source})}</div></details></div></div>`;
  bindResumeReview(root, v, {
    onComplete: async (result, context) => {
      if (context?.action === "REVISED" && result.version?.id !== v.id) {
        navigate(`/resumes/${encodeURIComponent(result.version.id)}`);
        return;
      }
      await renderResumeWorkspace({ root, route });
    },
  });
  root
    .querySelector("[data-render-resume]")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget,
        status = root.querySelector("[data-render-status]");
      button.disabled = true;
      status.textContent = "Geração de arquivos na fila…";
      try {
        const result = await api(
          `/api/resume-documents/versions/${encodeURIComponent(v.id)}/render`,
          { method: "POST", body: "{}" },
        );
        trackBackgroundJob({
          id: result.job.id,
          kind: "RESUME_RENDER",
          statusUrl: `/api/resume-documents/jobs/${encodeURIComponent(result.job.id)}`,
          label: "Gerando PDF do currículo…",
          targetUrl: `/resumes/${encodeURIComponent(v.id)}`,
        });
        status.textContent = "PDF em preparação. Você pode continuar usando o sistema.";
        toast("Geração iniciada. O resultado ficará disponível para revisão.");
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
}

function resumeHistory(data) {
  const events = [
    ...(data.renderRuns || []).map((item) => ({
      at: item.startedAt || item.createdAt,
      label: `Render ${statusLabel(item.status)}`,
      detail: item.errorCode || item.compilerVersion || "",
    })),
    ...(data.exports || []).map((item) => ({
      at: item.createdAt,
      label: `Export ${statusLabel(item.status)}`,
      detail: item.destination || "",
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return `<section class="content-card"><h2>Histórico real</h2>${events.length ? `<ol class="timeline">${events.map((item) => `<li><span></span><div><strong>${escapeHtml(item.label)}</strong><p>${formatDate(item.at, { dateStyle: "medium", timeStyle: "short" })} · ${escapeHtml(item.detail)}</p></div></li>`).join("")}</ol>` : '<p class="muted">Ainda não há renders ou exports registrados para esta versão.</p>'}</section>`;
}

async function pollJob(url, status, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const data = await api(url),
      job = data.job;
    status.textContent = `Processamento: ${statusLabel(job.status)}.`;
    if (job.status === "COMPLETED" || requiresHumanReview(job.status)) return job;
    if (isTerminalJobStatus(job.status))
      throw new Error(
        job.errorMessage || job.lastErrorMessage || "A operação falhou.",
      );
  }
  throw new Error(
    "A operação continua em segundo plano. Atualize o estado em instantes.",
  );
}

function bindResumeLibrary(root) {
  const dialog = root.querySelector("#resume-import-dialog");
  root.querySelectorAll("[data-default-resume]").forEach((button) =>
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api("/api/experience/resumes/default", {
          method: "POST",
          body: JSON.stringify({ resumeId: button.dataset.defaultResume }),
        });
        toast("Currículo padrão atualizado.");
        await renderResumes({ root });
      } catch (error) {
        toast(error.message || "Não foi possível atualizar o currículo padrão.");
        button.disabled = false;
      }
    }),
  );
  root
    .querySelectorAll("[data-import-resume]")
    .forEach((button) =>
      button.addEventListener("click", () => dialog.showModal()),
    );
  root
    .querySelector("[data-close-import]")
    ?.addEventListener("click", () => dialog.close());
  root
    .querySelector("[data-resume-import]")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        file = form.elements.file.files[0],
        status = form.querySelector(".form-status"),
        button = event.submitter;
      if (!file) return;
      button.disabled = true;
      status.textContent = "Enviando e extraindo o documento…";
      let imported;
      try {
        const fileData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        imported = await api("/api/unified/resume", {
          method: "POST",
          body: JSON.stringify({
            fileName: file.name,
            fileData,
            title: form.elements.title.value,
            focus: form.elements.focus.value,
          }),
        });
        status.textContent = "✓ Currículo importado com sucesso.";
        toast("Currículo importado e adicionado à biblioteca.");
      } catch (error) {
        status.textContent = `Não foi possível extrair o arquivo: ${error.message}`;
        button.disabled = false;
        return;
      }
      if (imported.resume.importStatus === "IMPORTED_NEEDS_REVIEW") {
        status.innerHTML =
          '✓ Currículo importado com sucesso.<br>⚠ Precisamos confirmar email ou telefone antes de prepará-lo. <a data-link href="/settings?section=general">Confirmar dados</a>';
        button.disabled = false;
        return;
      }
      try {
        status.textContent =
          "✓ Importado. Preparando uma versão factual para revisão…";
        const prepared = await api("/api/resume-documents/versions", {
          method: "POST",
          body: JSON.stringify({
            resumeId: imported.resume.id,
            templateId: "ATS_STRICT",
            archetypeId: "GENERAL",
            language: "pt-BR",
          }),
        });
        await pollJob(
          `/api/resume-documents/jobs/${encodeURIComponent(prepared.job.id)}`,
          status,
        );
        status.innerHTML =
          '✓ Currículo importado e preparado. <a data-link href="/resumes">Atualizar biblioteca</a>';
        toast("Currículo preparado para revisão.");
      } catch (error) {
        status.innerHTML = `✓ Currículo importado com sucesso.<br>⚠ A preparação precisa de revisão: ${escapeHtml(error.message)}. <a data-link href="/resumes">Ver na biblioteca</a>`;
      } finally {
        button.disabled = false;
      }
    });
}
