import {
  escapeLatex,
  LatexSafetyValidator,
} from "../validation/latex-safety-validator.mjs";
import { renderApprovedTemplate } from "./approved-template-renderers.mjs";

const compact = (value) =>
  String(value ?? "")
    .replace(/[-_=]{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const lines = (value) => (Array.isArray(value) ? value : []);
const labels = {
  "pt-BR": {
    summary: "Resumo Profissional",
    experience: "Experiencia Profissional",
    projects: "Projetos",
    education: "Formacao",
    certifications: "Certificacoes",
    skills: "Competencias Tecnicas",
    languages: "Idiomas",
  },
  en: {
    summary: "Professional Summary",
    experience: "Professional Experience",
    projects: "Projects",
    education: "Education",
    certifications: "Certifications",
    skills: "Technical Skills",
    languages: "Languages",
  },
};
const legacyLabels = {
  "pt-BR": {
    summary: "Resumo",
    experience: "Experiencia",
    projects: "Projetos",
    education: "Formacao",
    certifications: "Certificacoes",
    skills: "Competencias",
    languages: "Idiomas",
  },
  en: {
    summary: "Summary",
    experience: "Experience",
    projects: "Projects",
    education: "Education",
    certifications: "Certifications",
    skills: "Skills",
    languages: "Languages",
  },
};
const bullets = (items) =>
  items.length
    ? `\\begin{itemize}\n${items.map((item) => `  \\item ${escapeLatex(compact(item?.text ?? item))}`).join("\n")}\n\\end{itemize}`
    : "";
const section = (language, key, body, legacy = false) =>
  body
    ? `\\section*{${escapeLatex((legacy ? legacyLabels : labels)[language]?.[key] || key)}}\n${body}\n`
    : "";

const templateLayout = (template, spec) => {
  const defaultOrder = spec.sectionOrder || [
    "summary",
    "experience",
    "projects",
    "education",
    "certifications",
    "skills",
    "languages",
  ];
  const layouts = {
    ATS_TECH: {
      order: ["summary", "skills", "experience", "projects", "education", "certifications", "languages"],
      margin: "1.65cm",
      sectionSize: "\\large",
    },
    ATS_BALANCED: {
      order: ["summary", "skills", "experience", "projects", "education", "certifications", "languages"],
      margin: "1.7cm",
      sectionSize: "\\large",
    },
    ATS_EARLY_CAREER: {
      order: ["summary", "skills", "projects", "education", "experience", "certifications", "languages"],
      margin: "1.6cm",
      sectionSize: "\\normalsize",
    },
    ATS_IMPACT: {
      order: ["summary", "experience", "skills", "projects", "certifications", "education", "languages"],
      margin: "1.8cm",
      sectionSize: "\\large",
    },
    COMPACT: { order: defaultOrder, margin: "1.35cm", sectionSize: "\\normalsize" },
    PROFESSIONAL: { order: defaultOrder, margin: "1.8cm", sectionSize: "\\large" },
  };
  return layouts[template.id] || {
    order: defaultOrder,
    margin: "1.65cm",
    sectionSize: "\\large",
  };
};

export class LatexTemplateRenderer {
  constructor({ safetyValidator = new LatexSafetyValidator() } = {}) {
    this.safetyValidator = safetyValidator;
  }
  render(
    spec,
    { template = { id: "ATS_STRICT", version: "ats-strict-v1" } } = {},
  ) {
    const approvedTemplate = renderApprovedTemplate(spec, template);
    if (approvedTemplate) {
      this.safetyValidator.assertSafeSource(approvedTemplate.source, {
        systemGenerated: true,
      });
      return approvedTemplate;
    }
    const language = spec.language || "pt-BR",
      candidate = spec.candidate || {};
    const contact = [
      candidate.email,
      candidate.phone,
      candidate.location,
      ...lines(candidate.links).map((x) => x.url || x),
    ]
      .filter(Boolean)
      .map(compact)
      .join(" -- ");
    const bodies = {
      summary: escapeLatex(compact(spec.summary?.text ?? spec.summary)),
      experience: lines(spec.experiences)
        .map(
          (item) =>
            `\\textbf{${escapeLatex(compact(item.title))}}${item.company ? ` -- ${escapeLatex(compact(item.company))}` : ""}\\hfill ${escapeLatex([item.startDate, item.endDate].filter(Boolean).join(" -- "))}\\par\n${item.location ? `${escapeLatex(compact(item.location))}\\par\n` : ""}${bullets(item.bullets || [])}`,
        )
        .join("\n\n"),
      projects: lines(spec.projects)
        .map(
          (item) =>
            `\\textbf{${escapeLatex(compact(item.name))}}${item.description ? ` -- ${escapeLatex(compact(item.description))}` : ""}\\par\n${bullets(item.bullets || [])}`,
        )
        .join("\n\n"),
      education: lines(spec.education)
        .map(
          (item) =>
            `\\textbf{${escapeLatex(compact(item.institution))}}${item.degree ? ` -- ${escapeLatex(compact(item.degree))}` : ""}${item.field ? `, ${escapeLatex(compact(item.field))}` : ""}\\hfill ${escapeLatex([item.startDate, item.endDate].filter(Boolean).join(" -- "))}\\par`,
        )
        .join("\n"),
      certifications: lines(spec.certifications)
        .map((x) => escapeLatex(compact(x.name || x)))
        .join(" \\textbullet{} "),
      skills: lines(spec.skills)
        .map((x) => escapeLatex(compact(x.name || x)))
        .join(", "),
      languages: lines(spec.languages)
        .map((x) =>
          escapeLatex(
            compact(`${x.name || x}${x.level ? `: ${x.level}` : ""}`),
          ),
        )
        .join(", "),
    };
    const legacy =
      template.id === "ATS_CLEAN" && template.version === "ats-clean-v1";
    const layout = templateLayout(template, spec),
      order = layout.order,
      margin = layout.margin;
    const body = order
      .map((key) => section(language, key, bodies[key], legacy))
      .join("");
    const source = `\\documentclass[10pt,a4paper]{article}
\\usepackage[margin=${margin}]{geometry}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{parskip}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlist[itemize]{leftmargin=*,nosep,topsep=2pt}
\\titleformat{\\section}{${layout.sectionSize}\\bfseries}{}{0pt}{}[\\vspace{-2pt}\\hrule]
\\titlespacing*{\\section}{0pt}{8pt}{4pt}
\\begin{document}
{\\LARGE\\bfseries ${escapeLatex(compact(candidate.fullName))}}\\par
${candidate.headline ? `${escapeLatex(compact(candidate.headline))}\\par\n` : ""}${contact ? `${escapeLatex(contact)}\\par\n` : ""}
${body}\\end{document}
`;
    this.safetyValidator.assertSafeSource(source, { systemGenerated: true });
    return {
      source,
      templateId: template.id,
      templateVersion: template.version,
      language,
      legacyCompatible: legacy,
    };
  }
}
