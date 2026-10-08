import { api } from "./data.js";
import {
  escapeHtml,
  pill,
  statusLabel,
  humanText,
  technicalDetails,
  toast,
} from "../../app/ui.js";
import {
  hasResumePreviewContent,
  renderResumePreview,
} from "../../components/resume-preview.js";

const list = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const valueText = (value) =>
  typeof value === "string" ? value : String(value?.text || "");
const lines = (value) =>
  String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

function textField(label, value, attribute, { multiline = false } = {}) {
  const tag = multiline
    ? `<textarea ${attribute} rows="4">${escapeHtml(value)}</textarea>`
    : `<input ${attribute} type="text" value="${escapeHtml(value)}">`;
  return `<label><span>${escapeHtml(label)}</span>${tag}</label>`;
}

function renderResumeEditor(version) {
  const spec = version.resumeSpec || {},
    candidate = spec.candidate || {},
    experiences = list(spec.experiences),
    projects = list(spec.projects),
    skills = list(spec.skills)
      .map((item) => item?.name || item)
      .filter(Boolean)
      .join("\n");
  return `<form class="resume-editor" data-resume-editor>
    <div class="resume-editor-guidance" role="note">
      <strong>Edite sem perder o original</strong>
      <p>Ao salvar, o sistema cria uma nova versão para revisão. Use apenas fatos verdadeiros já presentes no currículo ou no Conhecimento.</p>
    </div>
    <div class="resume-editor-grid">
      ${textField("Título profissional", candidate.headline || "", 'data-edit-candidate="headline"')}
      ${textField("Resumo profissional", valueText(spec.summary), "data-edit-summary", { multiline: true })}
      ${textField("Competências, uma por linha", skills, "data-edit-skills", { multiline: true })}
    </div>
    <div class="resume-editor-sections">
      <h3>Experiências</h3>
      ${experiences.length ? experiences.map((item, index) => `<details data-edit-experience="${index}" ${index === 0 ? "open" : ""}><summary>${escapeHtml(item.title || item.company || `Experiência ${index + 1}`)}</summary><div class="resume-editor-grid compact">${textField("Cargo", item.title || "", 'data-edit-field="title"')}${textField("Empresa", item.company || "", 'data-edit-field="company"')}${textField("Local", item.location || "", 'data-edit-field="location"')}${textField("Início", item.startDate || "", 'data-edit-field="startDate"')}${textField("Fim", item.endDate || "", 'data-edit-field="endDate"')}${textField("Realizações, uma por linha", list(item.bullets).map(valueText).join("\n"), "data-edit-bullets", { multiline: true })}</div></details>`).join("") : '<p class="muted">Nenhuma experiência estruturada nesta versão.</p>'}
      ${projects.length ? `<h3>Projetos</h3>${projects.map((item, index) => `<details data-edit-project="${index}"><summary>${escapeHtml(item.name || `Projeto ${index + 1}`)}</summary><div class="resume-editor-grid compact">${textField("Nome", item.name || "", 'data-edit-field="name"')}${textField("Descrição", item.description || "", 'data-edit-field="description"', { multiline: true })}${textField("Destaques, um por linha", list(item.bullets).map(valueText).join("\n"), "data-edit-bullets", { multiline: true })}</div></details>`).join("")}` : ""}
    </div>
    <div class="resume-editor-actions"><button class="button primary" type="submit">Salvar como nova versão</button><p class="form-status" data-editor-status role="status"></p></div>
  </form>`;
}

function preserveEvidenceItems(current, nextValues, key = "text") {
  const available = list(current);
  return nextValues.map((next, index) => {
    const exact = available.find(
      (item) => valueText(key === "name" ? item?.name || item : item) === next,
    );
    const source = exact || available[index];
    if (typeof source === "string" || !source)
      return key === "name"
        ? { name: next, evidenceIds: [] }
        : { text: next, evidenceIds: [] };
    return { ...source, [key]: next };
  });
}

function editedResumeSpec(form, version) {
  const spec = structuredClone(version.resumeSpec || {}),
    headline =
      form.querySelector('[data-edit-candidate="headline"]')?.value.trim() ||
      "",
    summary = form.querySelector("[data-edit-summary]")?.value.trim() || "";
  spec.candidate = { ...(spec.candidate || {}), headline };
  spec.summary =
    typeof spec.summary === "string"
      ? summary
      : { ...(spec.summary || {}), text: summary };
  spec.skills = preserveEvidenceItems(
    spec.skills,
    lines(form.querySelector("[data-edit-skills]")?.value),
    "name",
  );
  form.querySelectorAll("[data-edit-experience]").forEach((section) => {
    const index = Number(section.dataset.editExperience),
      current = spec.experiences[index] || {};
    for (const field of [
      "title",
      "company",
      "location",
      "startDate",
      "endDate",
    ])
      current[field] =
        section.querySelector(`[data-edit-field="${field}"]`)?.value.trim() ||
        "";
    current.bullets = preserveEvidenceItems(
      current.bullets,
      lines(section.querySelector("[data-edit-bullets]")?.value),
    );
    spec.experiences[index] = current;
  });
  form.querySelectorAll("[data-edit-project]").forEach((section) => {
    const index = Number(section.dataset.editProject),
      current = spec.projects[index] || {};
    for (const field of ["name", "description"])
      current[field] =
        section.querySelector(`[data-edit-field="${field}"]`)?.value.trim() ||
        "";
    current.bullets = preserveEvidenceItems(
      current.bullets,
      lines(section.querySelector("[data-edit-bullets]")?.value),
    );
    spec.projects[index] = current;
  });
  return spec;
}

export function renderResumeReview(
  version,
  { jobTitle = "", baseTitle = "" } = {},
) {
  if (!version) return "";
  const changes = Array.isArray(version.changeset)
      ? version.changeset
      : version.changeset?.changes || [],
    previewReady = hasResumePreviewContent(version.resumeSpec),
    changesMarkup = changes.length
      ? `<div class="change-list">${changes.slice(0, 30).map((change) => `<article><span><small>Antes</small><p>${escapeHtml(change.before || change.original || "—")}</p></span><span><small>Depois</small><p>${escapeHtml(change.after || change.replacement || "—")}</p></span><span><small>Motivo e evidência</small><p>${escapeHtml(humanText(change.reason || "Melhorar alinhamento sem inventar experiência."))}</p><small>${escapeHtml(change.evidence || change.evidenceId || "Verificação das evidências")}</small></span></article>`).join("")}</div>`
      : '<p class="muted">Nenhuma alteração textual estruturada foi registrada para esta versão.</p>';
  return `<section class="content-card resume-review" data-resume-review="${escapeHtml(version.id)}"><div class="section-heading"><div><p class="eyebrow">Versão específica</p><h2>Revise o currículo completo</h2><p>${escapeHtml([jobTitle, baseTitle].filter(Boolean).join(" · ") || "Versão factual preparada pelo aplicativo")}</p></div>${pill(statusLabel(version.status), version.status === "REVIEW_REQUIRED" ? "attention" : "success")}</div><div class="resume-review-tabs" role="tablist" aria-label="Revisão do currículo"><button class="is-active" type="button" role="tab" aria-selected="true" data-resume-review-tab="preview">Currículo</button><button type="button" role="tab" aria-selected="false" data-resume-review-tab="edit">Editar</button><button type="button" role="tab" aria-selected="false" data-resume-review-tab="changes">Alterações (${changes.length})</button></div><div data-resume-review-panel="preview">${renderResumePreview(version.resumeSpec, { versionId: version.id })}</div><div data-resume-review-panel="edit" hidden>${renderResumeEditor(version)}</div><div data-resume-review-panel="changes" hidden><div class="review-summary"><div><small>Modelo</small><strong>${escapeHtml(statusLabel(version.templateId))}</strong></div><div><small>Arquétipo</small><strong>${escapeHtml(statusLabel(version.archetypeId || "GENERAL"))}</strong></div><div><small>Verificação das evidências</small><strong>Aplicado</strong></div></div>${changesMarkup}</div>${version.status === "REVIEW_REQUIRED" ? `<div class="resume-review-actions"><p>${previewReady ? "Confira o documento acima antes de registrar sua decisão." : "A aprovação será liberada quando a prévia completa estiver disponível."}</p><div class="button-row"><button class="button primary" data-review-resume="APPROVED" type="button" ${previewReady ? "" : "disabled"}>Aprovar currículo</button><button class="button" data-review-resume="REJECTED" type="button">Rejeitar</button></div></div>` : ""}${technicalDetails({ versionId: version.id, templateId: version.templateId, archetypeId: version.archetypeId })}<p class="form-status" data-review-status role="status"></p></section>`;
}

export function bindResumeReview(root, version, { onComplete = null } = {}) {
  root.querySelectorAll("[data-resume-review-tab]").forEach((button) =>
    button.addEventListener("click", () => {
      const review = button.closest("[data-resume-review]");
      review.querySelectorAll("[data-resume-review-tab]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-selected", String(active));
      });
      review.querySelectorAll("[data-resume-review-panel]").forEach((panel) => {
        panel.hidden =
          panel.dataset.resumeReviewPanel !== button.dataset.resumeReviewTab;
      });
    }),
  );
  root.querySelectorAll("[data-resume-editor]").forEach((form) =>
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector("[data-editor-status]"),
        button = event.submitter;
      button.disabled = true;
      status.textContent =
        "Validando evidências e criando uma nova versão…";
      try {
        const result = await api(
          `/api/resume-documents/versions/${encodeURIComponent(version.id)}/revise`,
          {
            method: "POST",
            body: JSON.stringify({
              resumeSpec: editedResumeSpec(form, version),
            }),
          },
        );
        status.textContent = "Nova versão criada para revisão.";
        toast("Edição salva como uma nova versão.");
        if (onComplete) await onComplete(result, { action: "REVISED" });
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    }),
  );
  root.querySelectorAll("[data-review-resume]").forEach((button) =>
    button.addEventListener("click", async () => {
      const review = button.closest("[data-resume-review]"),
        status = review.querySelector("[data-review-status]");
      if (
        button.dataset.reviewResume === "APPROVED" &&
        !review.querySelector(
          `[data-resume-preview="${CSS.escape(version.id)}"][data-preview-ready="true"]`,
        )
      ) {
        status.textContent =
          "A prévia completa precisa estar disponível antes da aprovação.";
        return;
      }
      button.disabled = true;
      status.textContent = "Registrando revisão…";
      try {
        const result = await api(
          `/api/resume-documents/versions/${encodeURIComponent(version.id)}/review`,
          {
            method: "POST",
            body: JSON.stringify({ state: button.dataset.reviewResume }),
          },
        );
        const message =
          button.dataset.reviewResume === "APPROVED"
            ? "Currículo aprovado."
            : "Currículo rejeitado.";
        status.textContent = message;
        toast(message);
        review
          .querySelectorAll("[data-review-resume]")
          .forEach((item) => (item.disabled = true));
        if (onComplete) await onComplete(result, { action: "REVIEWED" });
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    }),
  );
}
