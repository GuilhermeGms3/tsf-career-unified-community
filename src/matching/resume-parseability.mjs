import { foldText } from "./normalization.mjs";

export function evaluateResumeParseability(resume = {}) {
  const text = String(resume.text || "").trim();
  const evaluated=Boolean(String(resume.id||"").trim()||text||Object.keys(resume.sections||{}).length);
  if(!evaluated)return {score:null,status:"NOT_EVALUATED",checks:[],issues:[],strengths:[],disclaimer:"Compatibilidade documental não avaliada porque nenhum currículo foi selecionado."};
  const normalized = foldText(text);
  const sections = resume.sections && typeof resume.sections === "object" ? resume.sections : {};
  const recognizedSections = Object.keys(sections).filter((key) => ["summary", "skills", "experience", "education", "certifications", "projects", "languages", "header"].includes(key) && String(sections[key] || "").trim());
  const checks = [];
  const add = (id, label, points, passed, message) => checks.push({ id, label, points, earned: passed ? points : 0, status: passed ? "PASS" : "ISSUE", message });

  add("content", "Conteudo extraivel", 20, text.length >= 120, text.length >= 120 ? "Ha texto suficiente para analise." : "O curriculo possui pouco texto extraivel.");
  add("sections", "Secoes reconheciveis", 15, recognizedSections.length >= 3, recognizedSections.length >= 3 ? `${recognizedSections.length} secoes reconhecidas.` : "Poucas secoes foram reconhecidas.");
  add("experience", "Experiencia", 20, Boolean(sections.experience) || /\b(experiencia|experience|historico profissional|employment)\b/.test(normalized), "A secao de experiencia deve estar claramente identificada.");
  add("education", "Formacao", 10, Boolean(sections.education) || /\b(formacao|education|graduacao|bachelor|degree)\b/.test(normalized), "A formacao deve estar claramente identificada quando aplicavel.");
  add("dates", "Datas", 10, /\b(?:19|20)\d{2}\b|\b(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s+\d{4}\b/i.test(text), "Datas ajudam parsers genericos a ordenar experiencias.");
  add("contact", "Contato", 10, /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) || /(?:\+?\d[\s().-]*){8,}/.test(text), "Inclua email ou telefone em texto selecionavel.");
  add("headings", "Titulos de secao", 5, recognizedSections.length >= 2 || /^(experiencia|experience|formacao|education|skills|competencias)/im.test(text), "Use titulos de secao simples.");
  add("links", "Links legiveis", 5, /https?:\/\/|linkedin\.com|github\.com/i.test(text), "Links em texto completo sao mais faceis de interpretar.");
  const extractionHealthy = !resume.extraction?.warning && !/ocr/i.test(String(resume.extraction?.method || ""));
  add("extraction", "Extracao", 5, extractionHealthy, extractionHealthy ? "Nenhum alerta de extracao foi registrado." : "OCR ou fallback de extracao pode exigir revisao manual.");

  let score = checks.reduce((sum, check) => sum + check.earned, 0);
  const issues = checks.filter((check) => check.status === "ISSUE").map((check) => check.message);
  const strengths = checks.filter((check) => check.status === "PASS").map((check) => check.label);
  if (text.length > 30000) {
    score = Math.max(0, score - 8);
    issues.push("O curriculo tem texto excessivo e pode perder objetividade em parsers genericos.");
  }
  if (!text) score = 0;
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    status: text ? (score >= 75 ? "GOOD" : score >= 50 ? "REVIEW" : "POOR") : "UNREADABLE",
    checks,
    issues,
    strengths,
    disclaimer: "Estimativa estrutural generica; nao simula fielmente nenhum ATS comercial especifico."
  };
}
