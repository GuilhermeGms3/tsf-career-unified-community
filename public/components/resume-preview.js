import { escapeHtml } from "../app/ui.js";

const list = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const text = (value) =>
  typeof value === "string" ? value.trim() : String(value?.text || "").trim();
const line = (...values) => values.map(text).filter(Boolean).join(" · ");

function bullets(items = []) {
  const values = list(items).map(text).filter(Boolean);
  return values.length
    ? `<ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "";
}

function datedItem(title, context, dates, content) {
  return `<article class="resume-preview-item"><header><div><h4>${escapeHtml(title || "Experiência")}</h4>${context ? `<p>${escapeHtml(context)}</p>` : ""}</div>${dates ? `<small>${escapeHtml(dates)}</small>` : ""}</header>${content}</article>`;
}

function section(title, content) {
  return content ? `<section class="resume-preview-section"><h3>${title}</h3>${content}</section>` : "";
}

export function hasResumePreviewContent(spec = {}) {
  const candidate = spec?.candidate || {};
  const body = [
    text(spec.summary),
    ...list(spec.experiences).flatMap((item) => [text(item?.title), ...list(item?.bullets).map(text)]),
    ...list(spec.projects).flatMap((item) => [text(item?.name), text(item?.description), ...list(item?.bullets).map(text)]),
    ...list(spec.education).map((item) => line(item?.institution, item?.degree, item?.field)),
    ...list(spec.certifications).map((item) => text(item?.name || item)),
    ...list(spec.skills).map((item) => text(item?.name || item)),
    ...list(spec.languages).map((item) => line(item?.name || item, item?.level)),
  ].filter(Boolean);
  return Boolean(text(candidate.fullName) && body.length);
}

export function renderResumePreview(spec = {}, { versionId = "" } = {}) {
  const candidate = spec?.candidate || {};
  const contact = line(candidate.email, candidate.phone, candidate.location);
  const links = list(candidate.links)
    .map((item) => item?.url || item?.label)
    .filter(Boolean)
    .map((item) => escapeHtml(item))
    .join(" · ");
  const experiences = list(spec.experiences)
    .map((item) =>
      datedItem(
        item?.title,
        line(item?.company, item?.location),
        line(item?.startDate, item?.endDate),
        bullets(item?.bullets),
      ),
    )
    .join("");
  const projects = list(spec.projects)
    .map((item) =>
      datedItem(
        item?.name || "Projeto",
        list(item?.links).map((link) => link?.url || link).filter(Boolean).join(" · "),
        "",
        `${text(item?.description) ? `<p>${escapeHtml(text(item.description))}</p>` : ""}${bullets(item?.bullets)}`,
      ),
    )
    .join("");
  const education = list(spec.education)
    .map((item) =>
      datedItem(
        item?.degree || item?.field || "Formação",
        line(item?.institution, item?.field),
        line(item?.startDate, item?.endDate),
        "",
      ),
    )
    .join("");
  const certifications = list(spec.certifications)
    .map((item) => text(item?.name || item))
    .filter(Boolean);
  const skills = list(spec.skills)
    .map((item) => text(item?.name || item))
    .filter(Boolean);
  const languages = list(spec.languages)
    .map((item) => line(item?.name || item, item?.level))
    .filter(Boolean);
  const ready = hasResumePreviewContent(spec);

  if (!ready)
    return `<div class="resume-preview-unavailable" data-resume-preview="${escapeHtml(versionId)}" data-preview-ready="false" role="status"><h3>Prévia ainda indisponível</h3><p>Esta versão não contém conteúdo estruturado suficiente para uma revisão segura. Gere novamente a versão antes de aprová-la.</p></div>`;

  return `<article class="resume-preview-document" data-resume-preview="${escapeHtml(versionId)}" data-preview-ready="true" aria-label="Prévia completa do currículo"><header class="resume-preview-header"><h2>${escapeHtml(text(candidate.fullName))}</h2>${text(candidate.headline) ? `<p>${escapeHtml(text(candidate.headline))}</p>` : ""}${contact ? `<small>${escapeHtml(contact)}</small>` : ""}${links ? `<small>${links}</small>` : ""}</header>${section("Resumo profissional", text(spec.summary) ? `<p>${escapeHtml(text(spec.summary))}</p>` : "")}${section("Experiência", experiences)}${section("Projetos", projects)}${section("Formação", education)}${section("Certificações", certifications.length ? `<p>${certifications.map(escapeHtml).join(" · ")}</p>` : "")}${section("Competências", skills.length ? `<p>${skills.map(escapeHtml).join(" · ")}</p>` : "")}${section("Idiomas", languages.length ? `<p>${languages.map(escapeHtml).join(" · ")}</p>` : "")}</article>`;
}
