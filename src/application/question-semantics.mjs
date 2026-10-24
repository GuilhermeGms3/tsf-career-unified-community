import { createHash } from "node:crypto";
import { SKILL_DEFINITIONS } from "../matching/constants.mjs";
import { levelOptions, yearOptions, yesNoOptions } from "./it-question-answers.mjs";

export const FIELD_CONFIDENCE = Object.freeze({ AUTO_FILL: 0.85, REVIEW: 0.6 });

export const isCandidateContactQuestion = (question = {}) =>
  /^(IDENTITY|CONTACT|LOCATION)\./.test(question.semanticKey || "");

const normalize = (value) => String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const rules = [
  ["ENGLISH_LEVEL", "PROFESSIONAL.ENGLISH_LEVEL", /english.*level|level.*english|nivel.*ingles|ingles.*nivel/, "FACT"],
  ["VISA_SPONSORSHIP", "WORK_AUTHORIZATION.REQUIRES_SPONSORSHIP", /sponsor|visa|patrocinio/, "FACT"],
  ["WORK_AUTHORIZATION", "WORK_AUTHORIZATION.AUTHORIZED", /authorized.*work|legally.*work|autorizad.*trabalh/, "FACT"],
  ["SALARY_EXPECTATION", "COMPENSATION.EXPECTED_SALARY", /salary|compensation|salario|remuneracao/, "PREFERENCE"],
  ["NOTICE_PERIOD", "APPLICATION.NOTICE_PERIOD", /notice period|availability|disponibilidade|aviso previo/, "FACT"],
  ["RELOCATION", "PREFERENCES.RELOCATION", /relocat|mudanca|realocacao/, "PREFERENCE"],
  ["REMOTE_PREFERENCE", "PREFERENCES.REMOTE", /remote|remoto|home office/, "PREFERENCE"],
  ["SKILL_EXPERIENCE", "PROFESSIONAL.SKILL_EXPERIENCE", /(?:experience|experiencia).*(?:linux|java|python|network|cloud|redes|infraestrutura)|years?.*(?:using|with|in)/, "FACT"],
  ["EXPERIENCE_SUMMARY", "PROFESSIONAL.EXPERIENCE_SUMMARY", /(?:descreva|resuma|describe|summarize).*(?:experiencia profissional|professional experience)/, "FACT"],
  ["YEARS_EXPERIENCE", "PROFESSIONAL.YEARS_EXPERIENCE", /years?.*experience|anos?.*experiencia/, "FACT"],
  ["LINKEDIN", "PROFILE.LINKEDIN", /linkedin/, "FACT"],
  ["GITHUB", "PROFILE.GITHUB", /github/, "FACT"],
  ["PORTFOLIO", "PROFILE.PORTFOLIO", /portfolio|website|site pessoal/, "FACT"],
  ["START_DATE", "APPLICATION.START_DATE", /start date|data.*inicio/, "APPLICATION_SPECIFIC"],
  ["REFERRAL_SOURCE", "APPLICATION.REFERRAL_SOURCE", /hear about|source|indicacao|como.*soube/, "APPLICATION_SPECIFIC"],
  ["MOTIVATION", "APPLICATION.MOTIVATION", /why.*work|why.*company|motivacao|por que/, "FREE_TEXT_CONTEXTUAL"]
];

const sensitivePattern = /disabil|veteran|ethnic|race|\braca\b|gender|sex|medical|saude|deficien|etnia|genero|orientacao sexual|laudo medico|\bcid\b|protected class|preferred pronouns?|pronomes? preferid/;
const consentRules = [["PRIVACY_POLICY",/privacy|privacidade/],["DATA_PROCESSING",/data processing|tratamento de dados/],["DATA_RETENTION",/retention|retencao/],["TERMS",/terms|termos/]];

const SKILL_ALIASES=SKILL_DEFINITIONS.flatMap(skill=>skill.aliases.map(alias=>({name:skill.name,pattern:new RegExp(`(?:^|\\s)${normalize(alias).replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?:$|\\s)`)})));
const skillsIn=text=>[...new Set(SKILL_ALIASES.filter(item=>item.pattern.test(text)).map(item=>item.name))];
const YEARS_TEXT=/(?:years?|anos?|tempo).*(?:experience|experiencia)|(?:experience|experiencia).*(?:years?|anos?|tempo)|ha quanto tempo|how long/;
const HAS_TEXT=/experiencia|experience|trabalhou|trabalha com|atuou|atua com|worked with|work with/;
const KNOWS_TEXT=/conhecimento|conhece|familiaridade|domina|dominio|knowledge|familiar with/;
const LANGUAGE_LEVELS=[["ENGLISH_LEVEL","PROFESSIONAL.ENGLISH_LEVEL",/\bingles\b|\benglish\b/],["SPANISH_LEVEL","PROFESSIONAL.SPANISH_LEVEL",/\bespanhol\b|\bspanish\b/]];
const GENERIC_YEARS_WORDS=new Set("quantos quantas qual seu sua voce tem possui ha anos ano de da do em na no e o a com experiencia profissional total area ti tecnologia informacao mercado trabalho carreira tempo years year of experience professional how many long do you have in the it field overall work".split(" "));
const itFact=(questionClass,semanticKey,signals=[])=>({questionClass,semanticKey,answerCategory:"FACT",sensitive:false,consentType:"",confidence:0.96,signals:[`classification:${questionClass}`,...signals]});
const booleanShaped=field=>(field.type||field.fieldType)==="checkbox"&&!field.options?.length||Boolean(yesNoOptions(field.options||[]));

// Perguntas de TI respondidas pelo conhecimento confirmado (it-question-answers.mjs): anos com uma
// tecnologia (texto ou faixas), "Possui experiencia/conhecimento em X?" (Sim/Nao) e nivel de idioma.
// Uma tecnologia so: "Java ou Python?" fica com voce.
function itQuestion(field,text){
  const subject=normalize([field.label,field.description].filter(Boolean).join(" "))||text,skills=skillsIn(subject),skill=skills.length===1?skills[0]:"",options=field.options||[];
  if(skill&&(YEARS_TEXT.test(subject)||(HAS_TEXT.test(subject)||KNOWS_TEXT.test(subject))&&yearOptions(options)))return itFact("SKILL_YEARS_EXPERIENCE",`PROFESSIONAL.SKILL_YEARS.${skill}`,["source:CAREER_EVIDENCE_GRAPH"]);
  if(skill&&booleanShaped(field)&&KNOWS_TEXT.test(subject))return itFact("SKILL_KNOWLEDGE",`PROFESSIONAL.SKILL_KNOWS.${skill}`,["source:CAREER_EVIDENCE_GRAPH"]);
  if(skill&&booleanShaped(field)&&HAS_TEXT.test(subject))return itFact("SKILL_EXPERIENCE_YES_NO",`PROFESSIONAL.SKILL_HAS.${skill}`,["source:CAREER_EVIDENCE_GRAPH"]);
  for(const [questionClass,semanticKey,language] of LANGUAGE_LEVELS)if(language.test(subject)&&(levelOptions(options)||/nivel|level|proficien|fluencia/.test(subject)))return itFact(questionClass,semanticKey);
  return null;
}
// "Quantos anos de experiencia voce tem?" e o total de carreira; "anos com Rust" ou "em suporte" nao.
const genericYears=text=>normalize(text).split(" ").filter(Boolean).every(word=>GENERIC_YEARS_WORDS.has(word));

export function classifyQuestion(field) {
  const text = normalize([field.label, field.description, field.name, field.id].filter(Boolean).join(" "));
  const consent = consentRules.find(([, pattern]) => pattern.test(text));
  if (consent) return { questionClass:"CONSENT", semanticKey:`CONSENT.${consent[0]}`, answerCategory:"CONSENT", sensitive:false, consentType:consent[0], confidence:0.98, signals:[`consent:${consent[0]}`] };
  if (sensitivePattern.test(text)) return { questionClass:"DEMOGRAPHIC", semanticKey:"DEMOGRAPHIC.SENSITIVE", answerCategory:"APPLICATION_SPECIFIC", sensitive:true, consentType:"", confidence:0.98, signals:["protected-or-sensitive-question"] };
  const it=itQuestion(field,text);if(it)return it;
  for (const [questionClass, semanticKey, pattern, answerCategory] of rules) if (pattern.test(text) && (questionClass !== "YEARS_EXPERIENCE" || genericYears(field.label || text))) return { questionClass, semanticKey, answerCategory, sensitive:false, consentType:"", confidence:0.9, signals:[`classification:${questionClass}`] };
  return { questionClass:"CUSTOM_UNKNOWN", semanticKey:field.semanticKey && field.semanticKey !== "CUSTOM.QUESTION" ? field.semanticKey : "CUSTOM.QUESTION", answerCategory:"APPLICATION_SPECIFIC", sensitive:false, consentType:"", confidence:field.confidence || 0, signals:[] };
}

export function questionFingerprint({ ats="greenhouse", semanticKey, label, fieldType, type, options=[] }) {
  const normalizedOptions = options.map((item) => typeof item === "object" && item !== null ? `${normalize(item.label ?? item.value)}=${normalize(item.value ?? item.label)}` : normalize(item)).filter(Boolean).sort();
  const stableSemantic = semanticKey && !["CUSTOM.QUESTION","DEMOGRAPHIC.SENSITIVE","PROFESSIONAL.SKILL_EXPERIENCE","PROFESSIONAL.EXPERIENCE_SUMMARY","APPLICATION.MOTIVATION","COMPENSATION.EXPECTED_SALARY","APPLICATION.NOTICE_PERIOD"].includes(semanticKey);
  const material = [ats, semanticKey || "CUSTOM.QUESTION", stableSemantic ? "semantic-equivalent" : normalize(label), fieldType || type || "text", normalizedOptions.join("|")].join("::");
  return createHash("sha256").update(material).digest("hex");
}

export { normalize as normalizeQuestionText };
