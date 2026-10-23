import { createHash } from "node:crypto";
import {
  educationLevel,
  findCertificationMentions,
  findLanguageMentions,
  findSkillMentions,
  foldText,
  languageLevel,
  normalizeSkillName,
  seniorityLevel,
  slugify
} from "./normalization.mjs";
import { normalizeJobDescription } from "./job-description-normalizer.mjs";

const requiredLanguage = /\b(obrigatorio|obrigatoria|necessario|necessaria|requisito|required|mandatory|must.have|minimum|minimo|minima|essencial|essential|indispensavel|precisa ter|exigido|exigida)\b/;
const preferredLanguage = /\b(desejavel|desirable|diferencial|differential|plus|preferred|nice.to.have|bonus|sera considerado|sera um plus|diferencial sera)\b/;
const importantLanguage = /\b(strong|solid|advanced|fluent|proficien(?:t|cy)|extensive|hands.on|robust|forte|solido|avancado|fluente|proficiencia|dominio)\b/;
const sectionHeaders = Object.freeze([
  ["REQUIRED", /^(?:requisitos(?: obrigatorios)?|required (?:skills|qualifications)|minimum (?:requirements|qualifications)|basic qualifications|requirements|qualifications|must[ .-]?have|what you need|what you(?: will|.ll) need|minimo necessario)$/],
  ["PREFERRED", /^(?:diferenciais|desejaveis|preferred(?: skills| qualifications)?|nice[ .-]?to[ .-]?have|bonus|desirable|desired (?:skills|qualifications)|differential|plus|sera um diferencial)$/],
  ["CONTEXT", /^(?:responsibilities|your responsibilities|what you(?: will|.ll) do|what you(?: will|.ll) be doing|what you(?: will|.ll) bring|what you bring|the role|role overview|about (?:the|this) role|about the position|who you are|who we(?: are|.re) looking for|what we(?: are|.re) looking for|your profile|skills and experience|experience and skills|day to day|responsabilidades|o que voce fara|atividades)$/],
  ["IGNORE", /^(?:about us|about the company|company|benefits|perks|what we offer|compensation|salary|pay range|equal opportunity|privacy|sobre nos|sobre a empresa|beneficios|remuneracao)$/],
]);
const skillRequirementTypes = new Set(["skill", "tool", "framework", "platform", "cloud", "operating_system", "methodology"]);

function requirementId(jobId, type, normalizedName, originalText) {
  const digest = createHash("sha1").update(`${jobId}|${type}|${normalizedName}|${foldText(originalText)}`).digest("hex").slice(0, 16);
  return `requirement-${digest}`;
}

function lineImportance(line, sectionImportance = "unspecified") {
  const normalized = foldText(line);
  if (requiredLanguage.test(normalized)) return { importance: "required", required: true, confidence: 0.96 };
  if (preferredLanguage.test(normalized)) return { importance: "preferred", required: false, confidence: 0.94 };
  if (sectionImportance === "required") return { importance: "required", required: true, confidence: 0.84 };
  if (sectionImportance === "preferred") return { importance: "preferred", required: false, confidence: 0.84 };
  if (importantLanguage.test(normalized)) return { importance: "unspecified", required: false, confidence: 0.88, criticality: "IMPORTANT" };
  return { importance: "unspecified", required: false, confidence: 0.68 };
}

function createRequirement(jobId, input) {
  const importance = input.importance || "unspecified";
  const required = Boolean(input.required || importance === "required");
  const normalizedName = String(input.normalizedName || "").trim();
  const provenance = input.metadata?.provenance || (
    input.source === "job.title" ? "INFERRED_FROM_TITLE"
      : ["job.location", "job.workModel", "job.jobType", "job.salary"].includes(input.source) ? "CLASSIFICATION_CONTEXT"
        : required || importance === "preferred" ? "EXPLICIT_REQUIREMENT" : "INFERRED_FROM_DESCRIPTION"
  );
  return {
    id: requirementId(jobId, input.type, normalizedName, input.originalText),
    type: input.type,
    normalizedName,
    originalText: String(input.originalText || "").trim(),
    importance,
    required,
    weight: Number(input.weight ?? (required ? 1 : importance === "preferred" ? 0.55 : 0.72)),
    source: input.source || "job.description",
    confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.7))),
    metadata: { ...(input.metadata || {}), provenance, ...(input.criticality ? { criticality: input.criticality } : {}) }
  };
}

function addRequirement(collection, jobId, input) {
  if (!input.normalizedName || !input.originalText) return;
  const candidate = createRequirement(jobId, input);
  const existing = collection.find((item) => item.normalizedName === candidate.normalizedName && (
    item.type === candidate.type || (skillRequirementTypes.has(item.type) && skillRequirementTypes.has(candidate.type))
  ));
  if (!existing) {
    collection.push(candidate);
    return;
  }
  if (candidate.required && !existing.required) {
    existing.required = true;
    existing.importance = "required";
    existing.weight = Math.max(existing.weight, candidate.weight);
  } else if (candidate.importance === "preferred" && existing.importance === "unspecified") {
    existing.importance = "preferred";
  }
  existing.confidence = Math.max(existing.confidence, candidate.confidence);
  existing.metadata = { ...existing.metadata, ...candidate.metadata };
}

function descriptionLines(description) {
  return normalizeJobDescription(description)
    .split(/\r?\n|(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕ])/)
    .map((line) => line.replace(/^[\s*•\-–—]+/, "").trim())
    .filter(Boolean);
}

export function classifyRequirementSection(line) {
  const heading = foldText(line).replace(/^#{1,6}\s*/, "").replace(/[:：]$/, "").trim();
  return sectionHeaders.find(([, pattern]) => pattern.test(heading))?.[0] || null;
}

function genericSkillCandidates(line) {
  const normalized = foldText(line);
  const matches = [];
  const patterns = [
    /(?:experiencia|experiência|conhecimento|dominio|domínio|familiaridade)\s+(?:profissional\s+)?(?:em|com)\s+([^.;:]{2,100})/gi,
    /(?:experience|knowledge|proficiency|hands.on experience|familiarity)\s+(?:in|with)\s+([^.;:]{2,100})/gi
  ];
  for (const pattern of patterns) {
    for (const match of line.matchAll(pattern)) {
      const parts = match[1].split(/,|\/|\s+e\s+|\s+and\s+/i);
      for (const part of parts) {
        const cleaned = part
          .replace(requiredLanguage, "")
          .replace(preferredLanguage, "")
          .replace(/\b\d+\+?\s*(anos?|years?)\b/gi, "")
          .replace(/\s+(?:is|are|would be|will be|e|sao)\s+(?:a\s+)?(?:plus|preferred|required|mandatory|bonus|desirable).*$/i, "")
          .replace(/\b(?:para|for|que|who|the|uma?|an?)\b.*$/i, "")
          .trim();
        const words = cleaned.split(/\s+/).filter(Boolean);
        if (words.length >= 1 && words.length <= 4 && cleaned.length >= 2 && cleaned.length <= 48) {
          matches.push({ name: normalizeSkillName(cleaned, normalized), text: cleaned });
        }
      }
    }
  }
  return matches.filter((item) => item.name && !["experiencia", "experience", "conhecimento", "knowledge"].includes(item.name));
}

function specificExperienceCandidate(line) {
  const match = line.match(/(?:experiencia|experiência)\s+(?:profissional\s+)?(?:(?:obrigatoria|obrigatório|obrigatorio|comprovada|minima)\s+)?(?:em|com)\s+([^.;:]{8,140})/i)
    || line.match(/(?:professional\s+)?experience\s+(?:(?:required|proven|minimum)\s+)?(?:in|with)\s+([^.;:]{8,140})/i);
  if (!match) return null;
  const text = match[1].replace(requiredLanguage, "").replace(preferredLanguage, "").trim();
  if (text.length < 8) return null;
  const keywords = foldText(text).split(/[^a-z0-9+#.]+/).filter((word) => word.length > 3 && !["experiencia", "experience", "obrigatorio", "required", "desejavel", "preferred", "years", "anos"].includes(word));
  return keywords.length ? { text, keywords } : null;
}

function domainName(value) {
  const text = foldText(value);
  const domains = [
    ["noc", /\bnoc\b|network operations/], ["soc", /\bsoc\b|security operations/],
    ["devops", /\bdevops\b|site reliability|\bsre\b/], ["backend", /back.?end/],
    ["frontend", /front.?end/], ["data", /dados|\bdata\b|analytics/],
    ["cloud", /\bcloud\b|nuvem/], ["security", /seguranca|security|cyber/],
    ["networking", /redes|networking|network infrastructure/], ["support", /suporte|support|service desk/]
  ];
  return domains.find(([, pattern]) => pattern.test(text))?.[0] || "";
}

function workModel(value) {
  const text = foldText(value);
  if (/\b(hibrido|hybrid)\b/.test(text)) return "hybrid";
  if (/\b(remoto|remote|home.office|work from home)\b/.test(text)) return "remote";
  if (/\b(presencial|on.site|onsite|in.office)\b/.test(text)) return "onsite";
  return "";
}

function languageRequirement(line, language) {
  const level = languageLevel(line);
  return { level, levelName: level ? ["", "basic", "intermediate", "advanced", "fluent", "native"][level] : "unspecified" };
}

export function extractJobRequirements(job) {
  const jobId = String(job.id || job.externalId || "job");
  const requirements = [];
  const description = normalizeJobDescription(job.description);
  const lines = descriptionLines(description);
  let section = "UNSPECIFIED";

  addRequirement(requirements, jobId, {
    type: "role", normalizedName: slugify(job.title), originalText: job.title,
    importance: "unspecified", required: false, weight: 0.4, confidence: 0.98, source: "job.title", metadata: { provenance: "CLASSIFICATION_CONTEXT" }
  });
  const domain = domainName(`${job.title} ${description.slice(0, 1200)}`);
  if (domain) addRequirement(requirements, jobId, { type: "domain", normalizedName: domain, originalText: job.title || domain, importance: "unspecified", required: false, weight: 0.5, confidence: 0.82, source: "job.title", metadata: { provenance: "CLASSIFICATION_CONTEXT" } });

  const seniority = seniorityLevel(`${job.title} ${description.slice(0, 700)}`);
  if (seniority !== null) addRequirement(requirements, jobId, { type: "seniority", normalizedName: String(seniority), originalText: job.title || description.slice(0, 180), importance: "required", required: true, confidence: 0.86, source: "job.title", metadata: { level: seniority } });

  for (const line of lines) {
    const normalizedLine = foldText(line);
    const looksLikeHeader = line.length <= 90 && (/[:：]$/.test(line) || !/[.!?]$/.test(line));
    const nextSection = looksLikeHeader ? classifyRequirementSection(line) : null;
    if (nextSection) {
      section = nextSection;
      continue;
    }
    if (section === "IGNORE") continue;
    const sectionImportance = section === "REQUIRED" ? "required" : section === "PREFERRED" ? "preferred" : "unspecified";
    const importance = lineImportance(line, sectionImportance);

    const knownSkills = findSkillMentions(line);
    for (const skill of knownSkills) {
      // Rotulos ESCO vem de uma taxonomia ampla; confianca um pouco menor que a do dicionario curado.
      addRequirement(requirements, jobId, { type: skill.type || "skill", normalizedName: skill.name, originalText: line, ...importance, confidence: Math.max(importance.confidence, skill.source === "esco" ? 0.82 : 0.9), metadata: { alias: skill.alias, ...(skill.escoId ? { escoId: skill.escoId, escoLabel: skill.label } : {}) } });
    }
    for (const skill of genericSkillCandidates(line).filter((candidate) => !knownSkills.some((known) => known.name === candidate.name || findSkillMentions(candidate.text).some((mention) => mention.name === known.name)))) {
      addRequirement(requirements, jobId, { type: "skill", normalizedName: skill.name, originalText: line, ...importance, confidence: Math.min(0.78, importance.confidence), metadata: { extractedText: skill.text } });
    }
    const specificExperience = specificExperienceCandidate(line);
    if (specificExperience) {
      addRequirement(requirements, jobId, { type: "specific_experience", normalizedName: slugify(specificExperience.text), originalText: line, ...importance, confidence: Math.min(0.82, importance.confidence), metadata: { keywords: specificExperience.keywords } });
    }

    const yearsMatch = normalizedLine.match(/(?:minimum|minimo|minimo de|ao menos|at least)?\s*(\d{1,2})\+?\s*(?:anos?|years?)\s+(?:(?:de|of)\s+)?(?:experiencia|experience)/)
      || normalizedLine.match(/(?:experiencia|experience)[^\d]{0,30}(\d{1,2})\+?\s*(?:anos?|years?)/);
    if (yearsMatch) addRequirement(requirements, jobId, { type: "experience_years", normalizedName: `${yearsMatch[1]}-years`, originalText: line, ...importance, required: importance.required || /minimum|minimo|at least/.test(normalizedLine), confidence: 0.96, metadata: { minimumYears: Number(yearsMatch[1]) } });

    const education = educationLevel(line);
    if (education !== null && /formacao|graduacao|ensino|degree|bachelor|education|curso superior|tecnico|technical/.test(normalizedLine)) {
      addRequirement(requirements, jobId, { type: "education", normalizedName: String(education), originalText: line, ...importance, confidence: 0.9, metadata: { minimumLevel: education, equivalentExperienceAccepted: /(?:ou|or)\s+(?:experiencia|experience)\s+(?:equivalente|equivalent)/.test(normalizedLine) } });
    }
    for (const certification of findCertificationMentions(line)) {
      addRequirement(requirements, jobId, { type: "certification", normalizedName: certification.name, originalText: line, ...importance, confidence: 0.94, metadata: { alias: certification.alias } });
    }
    for (const language of findLanguageMentions(line)) {
      const details = languageRequirement(line, language.name);
      addRequirement(requirements, jobId, { type: "language", normalizedName: language.name, originalText: line, ...importance, confidence: 0.92, metadata: details });
    }

    if (/work authorization|authorized to work|authorization to work|autorizacao para trabalhar|autorizado a trabalhar|visto de trabalho/.test(normalizedLine)) {
      addRequirement(requirements, jobId, { type: "work_authorization", normalizedName: "work-authorization", originalText: line, ...importance, required: true, importance: "required", confidence: 0.95 });
    }
    if (/disponibilidade para viajar|travel required|willingness to travel|viagens?/.test(normalizedLine)) {
      addRequirement(requirements, jobId, { type: "travel", normalizedName: "travel", originalText: line, ...importance, confidence: 0.88 });
    }
    if (/disponibilidade para mudanca|disponibilidade para mudança|relocation|required to relocate|willing to relocate/.test(normalizedLine)) {
      addRequirement(requirements, jobId, { type: "relocation", normalizedName: "relocation", originalText: line, ...importance, confidence: 0.9 });
    }
    if (/disponibilidade imediata|inicio imediato|immediate start|plantao|plantão|on.call|turno|shift/.test(normalizedLine)) {
      addRequirement(requirements, jobId, { type: "availability", normalizedName: slugify(line.slice(0, 80)), originalText: line, ...importance, confidence: 0.78 });
    }
  }

  const combinedWorkModel = workModel(`${job.workModel || ""} ${description.slice(0, 2500)}`);
  if (combinedWorkModel) addRequirement(requirements, jobId, { type: "work_model", normalizedName: combinedWorkModel, originalText: job.workModel || lines.find((line) => workModel(line)) || combinedWorkModel, importance: "required", required: true, confidence: job.workModel ? 0.95 : 0.82, source: job.workModel ? "job.workModel" : "job.description" });

  const location = String(job.location || "").trim();
  if (location && !/nao informado|not specified/i.test(foldText(location))) {
    addRequirement(requirements, jobId, { type: "location", normalizedName: slugify(location), originalText: location, importance: combinedWorkModel === "remote" ? "unspecified" : "required", required: combinedWorkModel === "onsite", confidence: 0.92, source: "job.location", metadata: { location } });
  }

  const contractText = `${job.jobType || ""} ${description.slice(0, 2500)}`;
  const contract = foldText(contractText).match(/\b(clt|pj|contractor|full.time|part.time|estagio|internship|temporary|temporario)\b/);
  if (contract) addRequirement(requirements, jobId, { type: "employment_type", normalizedName: slugify(contract[1]), originalText: job.jobType || contract[0], importance: "unspecified", required: false, confidence: 0.8, source: job.jobType ? "job.jobType" : "job.description" });

  const salaryText = String(job.salary || description.match(/(?:R\$|BRL|USD|US\$)\s*[\d.,]+(?:\s*(?:a|-|ate|até)\s*(?:R\$|BRL|USD|US\$)?\s*[\d.,]+)?/i)?.[0] || "");
  if (salaryText || Number(job.salaryMin || job.salaryMax)) {
    addRequirement(requirements, jobId, { type: "salary", normalizedName: slugify(`${job.salaryCurrency || ""}-${job.salaryMin || ""}-${job.salaryMax || ""}`) || slugify(salaryText), originalText: salaryText || `${job.salaryMin}-${job.salaryMax}`, importance: "unspecified", required: false, confidence: 0.84, source: job.salary ? "job.salary" : "job.description", metadata: { minimum: Number(job.salaryMin || 0) || null, maximum: Number(job.salaryMax || 0) || null, currency: job.salaryCurrency || "" } });
  }

  return requirements.sort((left, right) => Number(right.required) - Number(left.required) || right.weight - left.weight || left.type.localeCompare(right.type));
}
