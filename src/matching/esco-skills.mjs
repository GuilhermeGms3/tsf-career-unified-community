import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CERTIFICATION_DEFINITIONS, LANGUAGE_DEFINITIONS, SKILL_DEFINITIONS } from "./constants.mjs";
import { foldText, slugify } from "./normalization.mjs";
import { ESCO_MARKET_TERMS } from "./esco/esco-market-terms.mjs";

// ESCO (European Skills, Competences, Qualifications and Occupations), (c) Uniao Europeia.
// Extrato gerado por scripts/esco-sync-skills.mjs; o dicionario curado de constants.mjs tem prioridade,
// depois os termos de mercado de esco-market-terms.mjs, depois os rotulos oficiais PT/EN.
const dataFile = fileURLToPath(new URL("./esco/esco-skills.json", import.meta.url));
const MAX_LABEL_WORDS = 4;
const TOKEN = /[a-z0-9+#]+/g;

// Rotulos ESCO estao em portugues europeu: palavras de Portugal e do Brasil caem na mesma chave,
// tanto no rotulo quanto no texto da vaga ou do curriculo (chaves ja sem plural).
const PT_BR_WORDS = new Map([
  ["planeamento", "planejamento"], ["planear", "planejar"], ["equipa", "equipe"], ["registo", "registro"], ["controlo", "controle"],
  ["gerir", "gerenciar"], ["ficheiro", "arquivo"], ["utilizador", "usuario"], ["contabilistico", "contabil"], ["contabilistica", "contabil"],
  ["facturacao", "faturamento"], ["faturacao", "faturamento"], ["existencia", "estoque"], ["stock", "estoque"], ["rececao", "recepcao"],
  ["telemovel", "celular"], ["telemovei", "celular"]
]);

// Palavras soltas comuns demais em vagas (ou ambiguas fora da ESCO) para virar requisito sem contexto.
const GENERIC_SINGLE_WORDS = new Set([
  "gestao", "management", "vendas", "sales", "comunicacao", "communication", "lideranca", "leadership", "design", "marketing",
  "ensino", "teaching", "seguranca", "security", "qualidade", "quality", "investigacao", "research", "comercio", "trade",
  "logistica", "logistics", "financas", "finance", "economia", "economics", "estatistica", "statistics", "matematica", "mathematics",
  "fisica", "physics", "quimica", "chemistry", "biologia", "biology", "musica", "music", "arte", "art", "historia", "history",
  "direito", "law", "psicologia", "psychology", "tecnologia", "technology", "engenharia", "engineering", "informatica", "saude", "health",
  "inovacao", "innovation", "estrategia", "strategy", "negociacao", "negotiation", "ingles", "english", "portugues", "portuguese",
  "less", "dies", "hair", "logging", "migration", "migracao", "energy", "energia", "consultation", "consulta", "cameras", "camaras",
  "spelling", "ortografia", "grammar", "gramatica", "prayer", "oracao", "protein", "proteina", "politics", "politica", "morality",
  "logic", "logica", "semantics", "semantica", "sensors", "sensores", "patents", "patentes", "literature", "literatura", "terminology",
  "terminologia", "typology", "tipologia", "similitude", "percolation", "reflexion", "reflexao", "crafting", "betting", "apostas",
  "ethics", "etica", "maquinas", "machinery", "golf", "golfe", "football", "futebol", "tennis", "tenis", "yoga", "ioga"
]);

const reservedAliases = () => new Set([...SKILL_DEFINITIONS, ...CERTIFICATION_DEFINITIONS, ...LANGUAGE_DEFINITIONS]
  .flatMap((definition) => [...definition.aliases, ...(definition.ambiguousAliases || [])])
  .map((alias) => tokensOf(foldText(alias)).map((token) => token.value).join(" ")));

// Chave tolerante a plural, a "infeção/infecção" e a grafia PT/BR: aplicada igualmente aos rotulos e ao texto.
function tokenKey(token) {
  const value = token.replace(/cc/g, "c");
  const singular = value.endsWith("oes") ? `${value.slice(0, -3)}ao`
    : value.length > 4 && value.endsWith("s") && !value.endsWith("ss") ? value.slice(0, -1) : value;
  return PT_BR_WORDS.get(singular) || singular;
}

// Artigos e preposicoes nao contam: "controle de infeccoes" equivale a "controlo das infecoes".
const STOPWORDS = new Set(["a", "o", "as", "os", "e", "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos", "of", "the", "and", "in", "for", "to", "on"]);

function tokensOf(folded) {
  return [...folded.matchAll(TOKEN)].filter((match) => !STOPWORDS.has(match[0]))
    .map((match) => ({ raw: match[0], value: tokenKey(match[0]), start: match.index, end: match.index + match[0].length }));
}

// Politica de rotulos: so termos curtos e especificos viram alias. Skills transversais
// ("trabalhar em equipa") e palavras soltas genericas ficam fora para nao inflar requisitos.
export function usableEscoLabel(label, { type = "", reuse = "" } = {}) {
  const tokens = tokensOf(foldText(label)).map((token) => token.raw);
  if (!tokens.length || tokens.length > MAX_LABEL_WORDS || reuse === "T") return false;
  if (tokens.length === 1) return type === "K" && tokens[0].length >= 4 && !GENERIC_SINGLE_WORDS.has(tokens[0]) && !/^\d+$/.test(tokens[0]);
  return tokens.join(" ").length >= 5;
}

let cached = null;
function escoIndex() {
  if (cached) return cached;
  const reserved = reservedAliases(), byFirstToken = new Map(), byAlias = new Map();
  let data = { skills: [] };
  try { data = JSON.parse(readFileSync(dataFile, "utf8")); } catch {}
  const records = new Map((data.skills || []).map((record) => [record[0], record]));
  // O primeiro alias registrado vence: termos de mercado antes dos rotulos oficiais.
  const addAlias = (label, [id, pt, en, type], origin) => {
    const name = slugify(pt || en), tokens = tokensOf(foldText(label)).map((token) => token.value), key = tokens.join(" ");
    if (!name || !tokens.length || reserved.has(key) || byAlias.has(key)) return;
    const entry = { name, alias: key, tokens, escoId: id, label: pt || en, escoType: type === "K" ? "knowledge" : "skill", origin };
    byAlias.set(key, entry);
    if (!byFirstToken.has(tokens[0])) byFirstToken.set(tokens[0], []);
    byFirstToken.get(tokens[0]).push(entry);
  };
  for (const { escoId, terms } of ESCO_MARKET_TERMS) {
    const record = records.get(escoId);
    if (record) for (const term of terms) addAlias(term, record, "market");
  }
  for (const record of records.values()) {
    const [, pt, en, type, reuse] = record;
    for (const label of [pt, en].filter((value) => value && usableEscoLabel(value, { type, reuse }))) addAlias(label, record, "esco");
  }
  for (const entries of byFirstToken.values()) entries.sort((left, right) => right.tokens.length - left.tokens.length);
  cached = { byFirstToken, byAlias, version: data.version || "", size: byAlias.size, missingMarketConcepts: ESCO_MARKET_TERMS.filter(({ escoId }) => !records.has(escoId)).map(({ escoId }) => escoId) };
  return cached;
}

export const escoSkillsEnabled = (env = process.env) => String(env.CAREER_ESCO_SKILLS || "true").toLowerCase() !== "false";

export function escoSkillIndexInfo() {
  const index = escoIndex();
  return { enabled: escoSkillsEnabled(), version: index.version, aliases: index.size, missingMarketConcepts: index.missingMarketConcepts };
}

// Varre o texto ja normalizado por foldText e devolve a primeira ocorrencia de cada skill ESCO,
// preferindo o rotulo mais longo em cada posicao. `index` aponta para o texto normalizado.
export function findEscoSkillMentions(folded) {
  if (!escoSkillsEnabled()) return [];
  const { byFirstToken } = escoIndex(), tokens = tokensOf(folded), seen = new Set(), matches = [];
  for (let position = 0; position < tokens.length; position++) {
    const entry = (byFirstToken.get(tokens[position].value) || []).find((candidate) =>
      candidate.tokens.every((token, offset) => tokens[position + offset]?.value === token));
    if (!entry) continue;
    const last = tokens[position + entry.tokens.length - 1];
    if (!seen.has(entry.name)) {
      seen.add(entry.name);
      matches.push({ name: entry.name, type: "skill", alias: entry.alias, index: tokens[position].start, end: last.end, source: "esco", origin: entry.origin, escoId: entry.escoId, escoType: entry.escoType, label: entry.label });
    }
    position += entry.tokens.length - 1;
  }
  return matches;
}

export function escoSkillName(value) {
  if (!escoSkillsEnabled()) return null;
  return escoIndex().byAlias.get(tokensOf(foldText(value)).map((token) => token.value).join(" "))?.name || null;
}
