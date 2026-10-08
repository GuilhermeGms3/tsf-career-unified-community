import {createHash} from "node:crypto";
import {findCertificationMentions,findLanguageMentions,foldText,languageLevel,normalizeSkillName,slugify} from "../matching/normalization.mjs";

const AGGREGATES = Object.freeze({
  "PROFILE.SKILLS":"SKILL","PROFILE.LANGUAGES":"LANGUAGE","PROFILE.CERTIFICATIONS":"CERTIFICATION",
  "PROFILE.PROJECTS":"PROJECT","PROFILE.EXPERIENCE":"WORK_EXPERIENCE","PROFILE.EDUCATION":"EDUCATION"
});
const PREFIX = Object.freeze({SKILL:"skill",LANGUAGE:"language",CERTIFICATION:"certification",PROJECT:"project",WORK_EXPERIENCE:"work-experience",EDUCATION:"education"});

export const AGGREGATE_KNOWLEDGE_KEYS = Object.freeze(Object.keys(AGGREGATES));

const hash = value => createHash("sha256").update(String(value)).digest("hex").slice(0,16);
const compact = value => String(value ?? "").replace(/\s+/g," ").trim();
const displayText = value => {
  if (typeof value === "string") return compact(value);
  if (!value || typeof value !== "object") return compact(value);
  return compact(value.name || value.title || value.language || value.course || value.degree || value.institution || value.company || value.role || value.rawText || value.description || "");
};
const itemId = (type, item, legacyKey, index) => {
  const supplied = typeof item === "object" && item ? slugify(item.id) : "";
  return supplied || hash(`${legacyKey}:${index}:${JSON.stringify(item)}`);
};
const confidence = (item, fallback) => Math.max(0,Math.min(1,Number(typeof item === "object" && item ? item.normalizationConfidence ?? fallback : fallback)));

export function canonicalSkill(value, context = "") {
  const rawText = displayText(value);
  return {canonical:normalizeSkillName(rawText,context),rawText};
}

export function candidateKnowledgeKey(unitType,value) {
  const prefix=PREFIX[unitType]||({IDENTITY:"identity",CONTACT:"contact",LOCATION:"location",PREFERENCE:"preference",JOB_PREFERENCE:"preference",APPLICATION_FACT:"application",SENSITIVE:"sensitive"})[unitType]||"fact";
  if(unitType==="SENSITIVE"||["WORK_EXPERIENCE","EDUCATION","PROJECT"].includes(unitType))return `${prefix}.${hash(`${unitType}:${JSON.stringify(value)}`)}`;
  const raw=displayText(value),canonical=unitType==="SKILL"?canonicalSkill(value,raw).canonical:slugify(raw);
  return `${prefix}.${canonical||hash(`${unitType}:${JSON.stringify(value)}`)}`.slice(0,160);
}

export function classifyLegacyItem(legacyKey, item) {
  const expected = AGGREGATES[legacyKey] || "APPLICATION_FACT";
  const rawText = displayText(item);
  if (expected === "CERTIFICATION" && rawText) {
    const languages = findLanguageMentions(rawText);
    const certifications = findCertificationMentions(rawText);
    if (languages.length === 1 && certifications.length === 0) return {unitType:"LANGUAGE",canonical:languages[0].name,reviewRequired:true};
  }
  if (expected === "SKILL") return {unitType:"SKILL",canonical:canonicalSkill(item,rawText).canonical};
  if (expected === "LANGUAGE") {
    const found=findLanguageMentions(rawText);
    return {unitType:"LANGUAGE",canonical:found.length===1?found[0].name:slugify(rawText),reviewRequired:found.length!==1};
  }
  if (expected === "CERTIFICATION") {
    const found=findCertificationMentions(rawText);
    return {unitType:"CERTIFICATION",canonical:found.length===1?found[0].name:slugify(rawText),reviewRequired:found.length===0};
  }
  return {unitType:expected,canonical:itemId(expected,item,legacyKey,0)};
}

export function knowledgeUnitsFromAggregate(fact) {
  if (!AGGREGATES[fact?.key]) return [];
  const items = Array.isArray(fact.value) ? fact.value : fact.value === null || fact.value === undefined || fact.value === "" ? [] : [fact.value];
  return items.map((item,index)=>{
    const classified=classifyLegacyItem(fact.key,item),rawText=compact(typeof item==="object"&&item?.rawText?item.rawText:displayText(item));
    const canonical=classified.canonical || itemId(classified.unitType,item,fact.key,index);
    const stableId=["PROJECT","WORK_EXPERIENCE","EDUCATION"].includes(classified.unitType)?itemId(classified.unitType,item,fact.key,index):canonical;
    const key=`${PREFIX[classified.unitType]||"fact"}.${stableId}`.slice(0,160);
    const inheritedVerified=fact.verificationStatus === "USER_CONFIRMED" || fact.source === "USER_CONFIRMED" || fact.verified;
    return {
      key,value:item,rawText,unitType:classified.unitType,legacyKey:fact.key,
      source:fact.source,sourceType:fact.sourceType || "LEGACY",sourceId:fact.sourceId || null,sourceVersionId:fact.sourceVersionId || null,
      confidence:confidence(item,fact.confidence ?? 1),verificationStatus:classified.reviewRequired?"REVIEW_REQUIRED":inheritedVerified?"USER_CONFIRMED":"SYSTEM_EXTRACTED",
      reusePolicy:fact.sensitive?"SENSITIVE_CONFIRM_EACH_TIME":classified.reviewRequired?"REUSABLE_WITH_CONFIRMATION":fact.reusePolicy || (fact.reusable===false?"NEVER_AUTO_REUSE":"REUSABLE"),
      sensitive:Boolean(fact.sensitive),classification:fact.classification || "FACT",lifecycleStatus:"ACTIVE",
      provenance:{legacyKey:fact.key,legacyIndex:index,migratedFrom:"candidate_facts.value_json"},
      confirmedAt:inheritedVerified?fact.confirmedAt || fact.updatedAt || null:null
    };
  });
}

export function displayNameForUnit(fact) {
  const value=fact?.value;
  if (typeof value === "object" && value) return displayText(value) || fact.key;
  return displayText(value) || fact?.rawText || fact?.key || "Informação";
}

export function languageMetadata(value) {
  const raw=displayText(value),numeric=languageLevel(raw);
  const framework=raw.match(/\b(A1|A2|B1|B2|C1|C2)\b/i)?.[1]?.toUpperCase() || "";
  return {level:framework || ({1:"Básico",2:"Intermediário",3:"Avançado",4:"Fluente",5:"Nativo"}[numeric]||""),evidence:raw.match(/(?:-|—)\s*([^,;]+)$/)?.[1]?.trim()||""};
}
