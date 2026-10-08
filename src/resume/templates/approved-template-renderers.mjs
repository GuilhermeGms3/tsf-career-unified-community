import { escapeLatex } from "../validation/latex-safety-validator.mjs";

const list = (value) => (Array.isArray(value) ? value : []);
const text = (value) =>
  String(value ?? "")
    .replace(/[-_=]{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const latex = (value) => escapeLatex(text(value));
const period = (item = {}) =>
  latex([item.startDate, item.endDate].filter(Boolean).join(" -- "));
const normalized = (value) =>
  text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function safeLinkTarget(value) {
  try {
    const url = new URL(text(value));
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return "";
    return escapeLatex(url.href);
  } catch {
    return "";
  }
}

function href(target, label) {
  const safe = safeLinkTarget(target);
  return safe ? `\\href{${safe}}{${latex(label)}}` : latex(label);
}

function candidateLinks(candidate = {}) {
  const links = list(candidate.links)
    .map((item) => ({
      label: text(item?.label || item?.url || item),
      url: text(item?.url || item),
    }))
    .filter((item) => item.url);
  const weight = (item) =>
    /github/i.test(`${item.label} ${item.url}`)
      ? 0
      : /linkedin/i.test(`${item.label} ${item.url}`)
        ? 1
        : 2;
  return links
    .sort((a, b) => weight(a) - weight(b))
    .map((item) => href(item.url, item.label || item.url));
}

function contactLine(candidate = {}) {
  return [
    candidate.location && latex(candidate.location),
    candidate.phone && latex(candidate.phone),
    candidate.email && href(`mailto:${candidate.email}`, candidate.email),
  ]
    .filter(Boolean)
    .join(" \\textbar{} ");
}

function base01Headline(candidate = {}) {
  return latex(
    text(candidate.headline)
      .replace(/\s*(?:,|\be\b)\s*/giu, " | ")
      .toUpperCase(),
  );
}

function bullets(items = []) {
  const content = list(items)
    .map((item) => text(item?.text ?? item))
    .filter(Boolean);
  return content.length
    ? `\\begin{itemize}\n${content.map((item) => `  \\item ${latex(item)}`).join("\n")}\n\\end{itemize}`
    : "";
}

function experiences(spec = {}, { companyFirst = true } = {}) {
  return list(spec.experiences)
    .map((item) => {
      const primary = companyFirst ? item.company || item.title : item.title || item.company;
      const secondary = companyFirst ? item.title : item.company;
      return `\\textbf{${latex(primary)}}\\hfill ${period(item)}\\par
${secondary ? `\\textit{${latex(secondary)}}\\par\n` : ""}${item.location ? `${latex(item.location)}\\par\n` : ""}${bullets(item.bullets)}`;
    })
    .join("\n\\vspace{1pt}\n");
}

function projects(spec = {}) {
  return list(spec.projects)
    .map(
      (item) =>
        `\\textbf{${latex(item.name)}}${item.description ? `\\hfill ${latex(item.description)}` : ""}\\par\n${bullets(item.bullets)}`,
    )
    .join("\n\\vspace{1pt}\n");
}

function education(spec = {}) {
  return list(spec.education)
    .map((item) => {
      const detail = [item.degree, item.field].filter(Boolean).join(" - ");
      return `\\textbf{${latex(item.institution)}}\\hfill ${period(item)}\\par${detail ? `\n${latex(detail)}\\par` : ""}`;
    })
    .join("\n\\vspace{2pt}\n");
}

const skillGroups = Object.freeze([
  ["Suporte e infraestrutura", /windows|hardware|active directory|azure|linux|troubleshoot|service desk|support|suporte/i],
  ["Redes e conectividade", /tcp\/?ip|dns|dhcp|nginx|cloudflare|network|rede/i],
  ["Monitoramento e observabilidade", /zabbix|grafana|prometheus|observab|monitoramento/i],
  ["Automacao e ferramentas", /powershell|python|docker|terraform|git|ci\/?cd|power bi|playwright|beautifulsoup/i],
]);

function groupedSkills(spec = {}) {
  const remaining = list(spec.skills)
    .map((item) => text(item?.name || item))
    .filter(Boolean);
  const groups = skillGroups.map(([label, pattern]) => {
    const values = remaining.filter((item) => pattern.test(normalized(item)));
    for (const value of values) remaining.splice(remaining.indexOf(value), 1);
    return { label, values };
  });
  if (remaining.length) groups.push({ label: "Outras competencias", values: remaining });
  const languageValues = list(spec.languages)
    .map((item) => text(`${item?.name || item}${item?.level ? ` - ${item.level}` : ""}`))
    .filter(Boolean);
  if (languageValues.length) groups.push({ label: "Idiomas", values: languageValues });
  return groups
    .filter((group) => group.values.length)
    .map((group) => `\\textbf{${latex(group.label)}:} ${group.values.map(latex).join(", ")}.\\par`)
    .join("\n");
}

function certifications(spec = {}) {
  return list(spec.certifications)
    .map((item) => latex(item?.name || item))
    .filter(Boolean)
    .join(" \\textbullet{} ");
}

function base01Source(spec = {}) {
  const candidate = spec.candidate || {};
  const links = candidateLinks(candidate).join(" \\textbar{} ");
  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[top=1.15cm,bottom=1.05cm,left=1.35cm,right=1.35cm]{geometry}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{parskip}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\setlist[itemize]{leftmargin=*,itemsep=1pt,topsep=2pt,parsep=0pt}
\\titleformat{\\section}{\\large\\bfseries}{}{0pt}{}[\\vspace{-2pt}\\hrule]
\\titlespacing*{\\section}{0pt}{7pt}{4pt}
\\begin{document}
\\begin{center}
{\\LARGE\\bfseries ${latex(text(candidate.fullName).toUpperCase())}}\\par
\\vspace{2pt}
{\\large\\bfseries ${base01Headline(candidate)}}\\par
\\vspace{3pt}
${contactLine(candidate)}\\par
${links ? `${links}\\par` : ""}
\\end{center}
\\vspace{-4pt}
\\section*{${spec.language === "en" ? "PROFESSIONAL SUMMARY" : "RESUMO PROFISSIONAL"}}
${latex(spec.summary?.text ?? spec.summary)}\\par
\\section*{${spec.language === "en" ? "PROFESSIONAL EXPERIENCE" : "EXPERIÊNCIA PROFISSIONAL"}}
${experiences(spec)}
\\section*{${spec.language === "en" ? "TECHNICAL PROJECTS" : "PROJETOS TÉCNICOS"}}
${projects(spec)}
\\section*{${spec.language === "en" ? "EDUCATION" : "FORMAÇÃO ACADÊMICA"}}
${education(spec)}
\\section*{${spec.language === "en" ? "TECHNICAL SKILLS" : "COMPETÊNCIAS TÉCNICAS"}}
${groupedSkills(spec)}
\\end{document}
`;
}

function blueSource(spec = {}) {
  const candidate = spec.candidate || {}, links = candidateLinks(candidate).join(" / ");
  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[top=1.2cm,bottom=1.2cm,left=1.4cm,right=1.4cm]{geometry}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{xcolor}
\\definecolor{titleblue}{RGB}{35,75,120}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlist[itemize]{leftmargin=*,itemsep=2pt,topsep=2pt}
\\titleformat{\\section}{\\large\\bfseries\\centering}{}{0pt}{}[\\vspace{-2pt}\\titlerule]
\\titlespacing*{\\section}{0pt}{8pt}{6pt}
\\begin{document}
\\noindent\\begin{minipage}[t]{0.57\\textwidth}
{\\LARGE\\bfseries\\textcolor{titleblue}{${latex(text(candidate.fullName).toUpperCase())}}}\\par
\\vspace{2pt}${candidate.location ? `${latex(candidate.location)}\\par` : ""}${links ? `${links}\\par` : ""}
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.41\\textwidth}\\raggedleft
${candidate.email ? `\\textbf{Email:} ${href(`mailto:${candidate.email}`, candidate.email)}\\par` : ""}
${candidate.phone ? `\\textbf{Telefone:} ${latex(candidate.phone)}\\par` : ""}
${candidate.headline ? `\\textbf{Area:} ${latex(candidate.headline)}\\par` : ""}
\\end{minipage}
\\vspace{5pt}\\hrule
\\section*{${spec.language === "en" ? "EDUCATION" : "FORMAÇÃO"}}
${education(spec)}
\\section*{${spec.language === "en" ? "SKILLS SUMMARY" : "RESUMO DE COMPETÊNCIAS"}}
${groupedSkills(spec)}
\\section*{${spec.language === "en" ? "PROFESSIONAL EXPERIENCE" : "EXPERIÊNCIA PROFISSIONAL"}}
${experiences(spec)}
\\section*{${spec.language === "en" ? "PROJECTS" : "PROJETOS"}}
${projects(spec)}
${certifications(spec) ? `\\section*{${spec.language === "en" ? "CERTIFICATIONS" : "CERTIFICAÇÕES"}}\n${certifications(spec)}\\par\n` : ""}
\\end{document}
`;
}

function classicSource(spec = {}) {
  const candidate = spec.candidate || {}, links = candidateLinks(candidate).join(" \\textbar{} ");
  return `\\documentclass[10pt,a4paper]{article}
\\usepackage[left=1.4cm,top=0.8cm,right=1.2cm,bottom=1cm]{geometry}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{xcolor}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlist[itemize]{leftmargin=*,itemsep=1pt,topsep=2pt}
\\newcommand{\\sectionbar}[1]{\\vspace{4pt}\\noindent\\colorbox{black!12}{\\parbox{\\dimexpr\\textwidth-2\\fboxsep\\relax}{\\textbf{\\large #1}}}\\vspace{3pt}}
\\begin{document}
\\noindent\\begin{minipage}[t]{0.58\\textwidth}
{\\Large\\bfseries ${latex(candidate.fullName)}}\\par
${candidate.headline ? `${latex(candidate.headline)}\\par\n` : ""}${candidate.location ? `${latex(candidate.location)}\\par\n` : ""}
\\end{minipage}\\hfill
\\begin{minipage}[t]{0.4\\textwidth}\\raggedleft
${candidate.phone ? `${latex(candidate.phone)}\\par` : ""}${candidate.email ? `${href(`mailto:${candidate.email}`, candidate.email)}\\par` : ""}${links ? `${links}\\par` : ""}
\\end{minipage}
\\sectionbar{${spec.language === "en" ? "Education" : "Formação"}}
${education(spec)}
\\sectionbar{${spec.language === "en" ? "Personal Projects" : "Projetos"}}
${projects(spec)}
\\sectionbar{${spec.language === "en" ? "Experience" : "Experiência"}}
${experiences(spec, { companyFirst: false })}
\\sectionbar{${spec.language === "en" ? "Technical Skills and Interests" : "Competências Técnicas"}}
${groupedSkills(spec)}
${certifications(spec) ? `\\sectionbar{${spec.language === "en" ? "Certifications" : "Certificações"}}\n${certifications(spec)}\\par\n` : ""}
\\end{document}
`;
}

export function renderApprovedTemplate(spec, template) {
  const renderers = {
    BASE_01: base01Source,
    OVERLEAF_BLUE: blueSource,
    OVERLEAF_CLASSIC: classicSource,
  };
  const renderer = renderers[template?.id];
  if (!renderer) return null;
  return {
    source: renderer(spec),
    templateId: template.id,
    templateVersion: template.version,
    language: spec.language || "pt-BR",
    legacyCompatible: false,
  };
}
