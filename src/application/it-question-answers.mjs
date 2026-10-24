import { languageLevel } from "../matching/normalization.mjs";

// Respostas de questionarios de TI a partir do conhecimento confirmado: "Possui experiencia com Linux?"
// (Sim/Nao), anos com uma tecnologia (numero ou faixa "1 a 3 anos") e nivel de idioma. A conversao para a
// opcao do formulario e deterministica e nunca exagera: sem opcao unica compativel a pergunta fica com voce.
const fold = (value) => String(value ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9+<>.,-]+/g, " ").replace(/\s+/g, " ").trim();

const YES = new Set(["sim", "yes", "s", "y", "true", "possuo", "tenho", "sim possuo", "sim tenho"]);
const NO = new Set(["nao", "no", "n", "false", "nao possuo", "nao tenho"]);
const polarity = (option) => {
  for (const raw of [option?.label, option?.value]) {
    const text = fold(raw).replace(/[.,]/g, "").trim();
    if (YES.has(text)) return true;
    if (NO.has(text)) return false;
  }
  return null;
};

// Exatamente duas opcoes, uma "Sim" e uma "Nao".
export function yesNoOptions(options = []) {
  if (options.length !== 2) return null;
  const yes = options.find((option) => polarity(option) === true), no = options.find((option) => polarity(option) === false);
  return yes && no ? { yes, no } : null;
}

const NUMBER = "(\\d+(?:[.,]\\d+)?)\\s*(anos?|years?|mes(?:es)?|months?)?";
const toYears = (number, unit = "") => Number(String(number).replace(",", ".")) / (/^m/.test(unit) ? 12 : 1);
const RANGE_PATTERNS = [
  [new RegExp(`^(?:nenhum|nenhuma|sem experiencia|nao (?:tenho|possuo)(?: experiencia)?|none|no experience|0 anos?)$`), () => ({ min: 0, max: 0 })],
  [new RegExp(`^(?:menos de|abaixo de|inferior a|less than|under|<)\\s*${NUMBER}$`), (m) => ({ min: 0, max: toYears(m[1], m[2]), maxOpen: true })],
  [new RegExp(`^(?:ate|up to)\\s*${NUMBER}$`), (m) => ({ min: 0, max: toYears(m[1], m[2]) })],
  [new RegExp(`^(?:de|entre|from|between)?\\s*${NUMBER}\\s*(?:a|e|-|to|and|ate)\\s*${NUMBER}$`), (m) => ({ min: toYears(m[1], m[2] || m[4]), max: toYears(m[3], m[4]) })],
  [new RegExp(`^(?:mais de|acima de|superior a|more than|over|>)\\s*${NUMBER}$`), (m) => ({ min: toYears(m[1], m[2]), max: Infinity, minOpen: true })],
  [new RegExp(`^\\+\\s*${NUMBER}$|^(\\d+)\\s*\\+\\s*(anos?|years?)?$`), (m) => ({ min: toYears(m[1] || m[3], m[2] || m[4]), max: Infinity })],
  [new RegExp(`^${NUMBER}\\s*(?:ou mais|or more)$`), (m) => ({ min: toYears(m[1], m[2]), max: Infinity })],
  [new RegExp(`^(\\d+)\\s*(anos?|years?|mes(?:es)?|months?)$`), (m) => ({ min: toYears(m[1], m[2]), max: toYears(Number(m[1]) + 1, m[2]), maxOpen: true })],
];

// Faixa de anos de uma opcao ("Menos de 1 ano", "1 a 3 anos", "Mais de 5 anos", "5+ anos", "Nenhuma").
export function yearRange(label) {
  const text = fold(label).replace(/[.,;:!]+$/, "");
  for (const [pattern, build] of RANGE_PATTERNS) { const match = text.match(pattern); if (match) return build(match); }
  return null;
}

const inRange = (years, range) => (range.minOpen ? years > range.min : years >= range.min) && (range.maxOpen ? years < range.max : years <= range.max);

// Todas as opcoes (ignorando o placeholder "Selecione") sao faixas de anos.
export function yearOptions(options = []) {
  const ranged = options.filter((option) => !/^(?:selecione|escolha|select|choose)/.test(fold(option.label)));
  return ranged.length >= 2 && ranged.every((option) => yearRange(option.label)) ? ranged : null;
}

// Opcao unica cuja faixa contem os anos; nas fronteiras ("1 a 3" e "3 a 5" com 3 anos) vale a faixa que
// comeca nos anos completos. Sem opcao unica, nada e escolhido.
export function optionForYears(options, years) {
  const ranged = yearOptions(options);
  if (!ranged) return null;
  for (const value of [years, Math.floor(years)]) {
    const matches = ranged.filter((option) => inRange(value, yearRange(option.label)));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) { const exact = matches.filter((option) => yearRange(option.label).min === Math.floor(years)); return exact.length === 1 ? exact[0] : null; }
  }
  return null;
}

const NO_LANGUAGE = /^(?:nenhum|nenhuma|nao falo|nao tenho|none|no)$/;
const optionLevel = (option) => NO_LANGUAGE.test(fold(option.label)) ? 0 : languageLevel(option.label);

// Opcoes de nivel de idioma (Basico/Intermediario/Avancado/Fluente/Nativo ou A1..C2).
export function levelOptions(options = []) {
  const ranged = options.filter((option) => !/^(?:selecione|escolha|select|choose)/.test(fold(option.label)));
  return ranged.length >= 2 && ranged.every((option) => optionLevel(option) !== null) ? ranged : null;
}

// Nivel exato; se o seu nivel passa do maior oferecido, o maior. Nunca um nivel acima do seu.
export function optionForLevel(options, level) {
  const ranged = levelOptions(options);
  if (!ranged || !level) return null;
  const exact = ranged.filter((option) => optionLevel(option) === level);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const top = Math.max(...ranged.map(optionLevel)), highest = ranged.filter((option) => optionLevel(option) === top);
  return level > top && highest.length === 1 ? highest[0] : null;
}

export const isItAnswerKey = (key = "") => /^PROFESSIONAL\.(?:SKILL_(?:HAS|KNOWS|YEARS)\.|YEARS_EXPERIENCE$|(?:ENGLISH|SPANISH)_LEVEL$)/.test(key);

// Converte o valor confirmado (booleano, anos ou nivel) para o formato do campo. null: sem conversao segura.
export function itAnswerForField(field, value) {
  const key = field.semanticKey || "", type = field.fieldType || field.type || "", options = field.options || [];
  if (!isItAnswerKey(key)) return null;
  if (/^PROFESSIONAL\.SKILL_(?:HAS|KNOWS)\./.test(key)) {
    if (typeof value !== "boolean") return null;
    if (type === "checkbox") return { valid: true, value };
    const pair = yesNoOptions(options);
    return pair ? { valid: true, value: (value ? pair.yes : pair.no).value } : null;
  }
  if (/_LEVEL$/.test(key)) {
    const level = languageLevel(value);
    if (!options.length) return ["text", "textarea"].includes(type) && level ? { valid: true, value: String(value) } : null;
    const option = optionForLevel(options, level);
    return option ? { valid: true, value: option.value } : null;
  }
  const years = typeof value === "number" ? value : /^s*d+(?:[.,]d+)?s*$/.test(String(value)) ? Number(String(value).replace(",", ".")) : NaN;
  // Total de anos digitado no perfil como texto ("5 anos") so vai para campo de texto, como antes.
  if (!Number.isFinite(years)) return !options.length && ["text", "textarea"].includes(type) && String(value).trim() ? { valid: true, value: String(value).trim() } : null;
  if (years < 0) return null;
  if (options.length) { const option = optionForYears(options, years); return option ? { valid: true, value: option.value } : null; }
  // Anos completos; menos de um ano fica com voce (responder "0" diria que nao ha experiencia).
  return ["number", "text"].includes(type) && years >= 1 ? { valid: true, value: String(Math.floor(years)) } : null;
}
