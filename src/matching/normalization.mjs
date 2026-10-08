import { CERTIFICATION_DEFINITIONS, LANGUAGE_DEFINITIONS, SKILL_DEFINITIONS } from "./constants.mjs";

export function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value) {
  return foldText(value)
    .replace(/\bc\+\+\b/g, "cpp")
    .replace(/[^a-z0-9+#.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasPattern(alias) {
  const normalized = foldText(alias);
  const source = escaped(normalized).replace(/\\ /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${source}(?=$|[^a-z0-9])`, "i");
}

function findDefinitions(text, definitions, { includeAmbiguous = false } = {}) {
  const normalized = foldText(text);
  const matches = [];
  for (const definition of definitions) {
    const aliases = [...definition.aliases];
    if (includeAmbiguous && definition.ambiguousAliases) aliases.push(...definition.ambiguousAliases);
    for (const alias of aliases.sort((left, right) => right.length - left.length)) {
      const match = normalized.match(aliasPattern(alias));
      if (!match) continue;
      matches.push({ ...definition, alias, index: match.index + match[1].length });
      break;
    }
  }
  return matches;
}

export function findSkillMentions(text) {
  const normalized = foldText(text);
  const matches = findDefinitions(normalized, SKILL_DEFINITIONS);
  if (/\bactive directory\b/.test(normalized) || /\bad\b.{0,30}\b(domain|windows|identity|usuarios|users)\b/.test(normalized)) {
    const definition = SKILL_DEFINITIONS.find((item) => item.name === "active-directory");
    if (!matches.some((item) => item.name === definition.name)) {
      matches.push({ ...definition, alias: "ad", index: normalized.search(/\bad\b/) });
    }
  }
  return matches;
}

export function normalizeSkillName(value, context = "") {
  const normalized = foldText(value);
  for (const definition of SKILL_DEFINITIONS) {
    if (definition.aliases.some((alias) => foldText(alias) === normalized)) return definition.name;
    if (definition.ambiguousAliases?.some((alias) => foldText(alias) === normalized)) {
      return findSkillMentions(`${value} ${context}`).some((item) => item.name === definition.name)
        ? definition.name
        : null;
    }
  }
  return slugify(value) || null;
}

export function findCertificationMentions(text) {
  return findDefinitions(text, CERTIFICATION_DEFINITIONS);
}

export function findLanguageMentions(text) {
  return findDefinitions(text, LANGUAGE_DEFINITIONS);
}

export function textSnippet(text, index, radius = 90) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const safeIndex = Math.max(0, Math.min(raw.length, Number(index || 0)));
  const start = Math.max(0, safeIndex - radius);
  const end = Math.min(raw.length, safeIndex + radius);
  return `${start ? "..." : ""}${raw.slice(start, end).trim()}${end < raw.length ? "..." : ""}`;
}

export function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function languageLevel(value) {
  const text = foldText(value);
  if (/\b(native|nativo|materno|c2)\b/.test(text)) return 5;
  if (/\b(fluent|fluente|c1)\b/.test(text)) return 4;
  if (/\b(advanced|avancado|b2)\b/.test(text)) return 3;
  if (/\b(intermediate|intermediario|b1)\b/.test(text)) return 2;
  if (/\b(basic|basico|a1|a2)\b/.test(text)) return 1;
  return null;
}

export function seniorityLevel(value) {
  const text = foldText(value);
  if (/\b(intern|estagio|estagiario|aprendiz|trainee)\b/.test(text)) return 0;
  if (/\b(junior|jr\.?|entry.level)\b/.test(text)) return 1;
  if (/\b(pleno|mid.level|mid)\b/.test(text)) return 2;
  if (/\b(senior|sr\.?|especialista|lead|staff|principal)\b/.test(text)) return 3;
  if (/\b(manager|gerente|coordenador|head|director|diretor)\b/.test(text)) return 4;
  return null;
}

export function educationLevel(value) {
  const text = foldText(value);
  if (/\b(phd|doctorate|doutorado)\b/.test(text)) return 5;
  if (/\b(master|mestrado|mba)\b/.test(text)) return 4;
  if (/\b(bachelor|bacharel(?:ado)?|graduacao|graduado|ensino superior|degree)\b/.test(text)) return 3;
  if (/\b(tecnico|technical degree|tecnologo)\b/.test(text)) return 2;
  if (/\b(ensino medio|high school)\b/.test(text)) return 1;
  return null;
}
