import { EVIDENCE_STRENGTH } from "./constants.mjs";
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
  slugify,
  textSnippet,
  uniqueStrings
} from "./normalization.mjs";
import {evidenceStrength} from "../candidate-knowledge/career-evidence-model.mjs";

const semanticSkillTypes=new Set(["skill","tool","framework","platform","cloud","operating_system","methodology"]);

function values(value) {
  if (Array.isArray(value)) return value.map((item)=>typeof item==="string"?item:item?.name||item?.text||Object.values(item||{}).filter(x=>typeof x==="string").join(" ")).filter(Boolean);
  return String(value || "").split(/[\n,;|]/).map((item) => item.trim()).filter(Boolean);
}
function sectionText(value) {
  return Array.isArray(value) ? value.map(item=>typeof item==="string"?item:Object.values(item||{}).flat().filter(x=>typeof x==="string").join(" ")).join("\n") : typeof value==="object"&&value?Object.values(value).filter(x=>typeof x==="string").join(" "):String(value || "");
}
function knowledgeText(value){return typeof value==="string"?value:value&&typeof value==="object"?Object.values(value).flatMap(item=>Array.isArray(item)?item:Object.values(item&&typeof item==="object"?item:{value:item})).filter(item=>typeof item==="string"||typeof item==="number").join(" "):String(value||"");}

function addEvidence(collection, input) {
  if (!input.normalizedName || !input.text) return;
  const key = `${input.type}|${input.normalizedName}|${input.source}|${input.sourceSection}|${input.metadata?.knowledgeEvidenceId||""}|${foldText(input.text)}`;
  if (collection.some((item) => item.key === key || (!item.metadata?.knowledgeEvidenceId&&!input.metadata?.knowledgeEvidenceId&&(item.type===input.type||(semanticSkillTypes.has(item.type)&&semanticSkillTypes.has(input.type)))&&item.normalizedName===input.normalizedName&&foldText(item.text)===foldText(input.text)))) return;
  collection.push({
    id: `evidence-${createHash("sha256").update(key).digest("hex").slice(0,16)}`,
    key,
    type: input.type,
    normalizedName: input.normalizedName,
    source: input.source,
    sourceSection: input.sourceSection || "",
    text: String(input.text).trim().slice(0, 700),
    strength: input.strength.name,
    strengthScore: input.strength.score,
    value: input.value ?? null,
    metadata: input.metadata || {}
  });
}

function extractSkills(collection, text, context) {
  for (const match of findSkillMentions(text)) {
    addEvidence(collection, {
      type: match.type || "skill", normalizedName: match.name,
      source: context.source, sourceSection: context.section,
      text: context.preserveWhole ? text : textSnippet(text, match.index), strength: context.strength,
      metadata: { alias: match.alias, ...(context.metadata||{}) }
    });
  }
}

function extractCertifications(collection, text, context) {
  for (const match of findCertificationMentions(text)) {
    addEvidence(collection, { type: "certification", normalizedName: match.name, source: context.source, sourceSection: context.section, text: textSnippet(text, match.index), strength: EVIDENCE_STRENGTH.CERTIFIED, metadata: { alias: match.alias, ...(context.metadata||{}) } });
  }
}

function extractLanguages(collection, text, context) {
  for (const match of findLanguageMentions(text)) {
    addEvidence(collection, { type: "language", normalizedName: match.name, source: context.source, sourceSection: context.section, text: textSnippet(text, match.index), strength: context.strength, value: languageLevel(text), metadata: { level: languageLevel(text), alias: match.alias, ...(context.metadata||{}) } });
  }
}

function addBooleanEvidence(collection, text, { pattern, negativePattern, type, name, source, section }) {
  const normalized = foldText(text);
  if (!pattern.test(normalized) && !negativePattern?.test(normalized)) return;
  const negative = Boolean(negativePattern?.test(normalized));
  addEvidence(collection, { type, normalizedName: name, source, sourceSection: section, text, strength: EVIDENCE_STRENGTH.CONTEXTUAL, value: !negative, metadata: { explicit: true } });
}

export function extractCandidateEvidence(profile = {}, resume = {}, knowledgeFacts = []) {
  const evidence = [];
  const resumeSections = resume.sections && typeof resume.sections === "object" ? resume.sections : {};
  const structured=profile.resumeData||{};
  for(const skill of values(structured.skills)){addEvidence(evidence,{type:"skill",normalizedName:normalizeSkillName(skill,skill),source:"profile",sourceSection:"resumeData.skills",text:skill,strength:EVIDENCE_STRENGTH.MENTION,metadata:{origin:"USER_CONFIRMED"}});extractSkills(evidence,skill,{source:"profile",section:"resumeData.skills",strength:EVIDENCE_STRENGTH.MENTION,preserveWhole:true});}
  for(const item of values(structured.experience))extractSkills(evidence,item,{source:"profile",section:"resumeData.experience",strength:EVIDENCE_STRENGTH.PROFESSIONAL_EXPERIENCE});
  for(const item of values(structured.certifications))extractCertifications(evidence,item,{source:"profile",section:"resumeData.certifications"});
  for(const item of values(structured.languages))extractLanguages(evidence,item,{source:"profile",section:"resumeData.languages",strength:EVIDENCE_STRENGTH.CONTEXTUAL});

  for (const skill of values(profile.career?.skills)) {
    const normalizedName = normalizeSkillName(skill, profile.career?.skills);
    addEvidence(evidence, { type: "skill", normalizedName, source: "profile", sourceSection: "career.skills", text: skill, strength: EVIDENCE_STRENGTH.MENTION });
    extractSkills(evidence, skill, { source: "profile", section: "career.skills", strength: EVIDENCE_STRENGTH.MENTION, preserveWhole: true });
  }
  extractSkills(evidence, profile.experience, { source: "profile", section: "experience", strength: EVIDENCE_STRENGTH.PROFESSIONAL_EXPERIENCE });
  if (profile.experience) addEvidence(evidence, { type: "specific_experience", normalizedName: "professional-context", source: "profile", sourceSection: "experience", text: profile.experience, strength: EVIDENCE_STRENGTH.PROFESSIONAL_EXPERIENCE });
  extractSkills(evidence, profile.education, { source: "profile", section: "education", strength: EVIDENCE_STRENGTH.EDUCATION });
  extractSkills(evidence, profile.certifications, { source: "profile", section: "certifications", strength: EVIDENCE_STRENGTH.CERTIFIED });
  extractCertifications(evidence, profile.certifications, { source: "profile", section: "certifications" });
  extractLanguages(evidence, `${profile.career?.englishLevel || ""}`, { source: "profile", section: "career.englishLevel", strength: EVIDENCE_STRENGTH.CONTEXTUAL });
  if (profile.career?.englishLevel) {
    addEvidence(evidence, { type: "language", normalizedName: "english", source: "profile", sourceSection: "career.englishLevel", text: `Ingles: ${profile.career.englishLevel}`, strength: EVIDENCE_STRENGTH.CONTEXTUAL, value: languageLevel(profile.career.englishLevel), metadata: { level: languageLevel(profile.career.englishLevel) } });
  }

  const resumeSectionStrength = {
    skills: EVIDENCE_STRENGTH.MENTION,
    experience: EVIDENCE_STRENGTH.PROFESSIONAL_EXPERIENCE,
    projects: EVIDENCE_STRENGTH.CONTEXTUAL,
    education: EVIDENCE_STRENGTH.EDUCATION,
    certifications: EVIDENCE_STRENGTH.CERTIFIED,
    languages: EVIDENCE_STRENGTH.CONTEXTUAL,
    summary: EVIDENCE_STRENGTH.CONTEXTUAL,
    header: EVIDENCE_STRENGTH.MENTION
  };
  for (const [section, raw] of Object.entries(resumeSections)) {
    const text = sectionText(raw);
    const strength = resumeSectionStrength[section] || EVIDENCE_STRENGTH.CONTEXTUAL;
    extractSkills(evidence, text, { source: "resume", section, strength });
    if (section === "experience" && text) addEvidence(evidence, { type: "specific_experience", normalizedName: "professional-context", source: "resume", sourceSection: section, text, strength: EVIDENCE_STRENGTH.PROFESSIONAL_EXPERIENCE });
    if (section === "certifications") extractCertifications(evidence, text, { source: "resume", section });
    if (section === "languages") extractLanguages(evidence, text, { source: "resume", section, strength });
  }
  extractSkills(evidence, resume.text, { source: "resume", section: "document", strength: EVIDENCE_STRENGTH.CONTEXTUAL });
  extractCertifications(evidence, resume.text, { source: "resume", section: "document" });
  extractLanguages(evidence, resume.text, { source: "resume", section: "document", strength: EVIDENCE_STRENGTH.CONTEXTUAL });

  if (profile.career && Object.hasOwn(profile.career, "yearsExperience")) {
    const years = Number(profile.career.yearsExperience);
    if (Number.isFinite(years) && years >= 0) addEvidence(evidence, { type: "experience_years", normalizedName: "professional-experience", source: "profile", sourceSection: "career.yearsExperience", text: `${years} ano(s) de experiencia informado(s)`, strength: EVIDENCE_STRENGTH.PROFESSIONAL_EXPERIENCE, value: years });
  }

  const roleValues = uniqueStrings([profile.career?.headline, ...values(profile.career?.targetRoles), resume.focus]);
  for (const role of roleValues) {
    addEvidence(evidence, { type: "role", normalizedName: slugify(role), source: role === resume.focus ? "resume" : "profile", sourceSection: role === resume.focus ? "focus" : "career", text: role, strength: EVIDENCE_STRENGTH.CONTEXTUAL });
    const level = seniorityLevel(role);
    if (level !== null) addEvidence(evidence, { type: "seniority", normalizedName: String(level), source: "profile", sourceSection: "career.headline", text: role, strength: EVIDENCE_STRENGTH.CONTEXTUAL, value: level });
  }

  const educationText = `${profile.education || ""}\n${sectionText(resumeSections.education)}`.trim();
  const candidateEducation = educationLevel(educationText);
  if (candidateEducation !== null) addEvidence(evidence, { type: "education", normalizedName: String(candidateEducation), source: profile.education ? "profile" : "resume", sourceSection: "education", text: educationText, strength: EVIDENCE_STRENGTH.EDUCATION, value: candidateEducation });

  const location = [profile.personal?.city, profile.personal?.state, profile.personal?.country].filter(Boolean).join(", ");
  if (location) addEvidence(evidence, { type: "location", normalizedName: slugify(location), source: "profile", sourceSection: "personal", text: location, strength: EVIDENCE_STRENGTH.CONTEXTUAL, metadata: { city: profile.personal?.city || "", state: profile.personal?.state || "", country: profile.personal?.country || "" } });
  if (profile.career?.locationRule) addEvidence(evidence, { type: "location_rule", normalizedName: slugify(profile.career.locationRule), source: "profile", sourceSection: "career.locationRule", text: profile.career.locationRule, strength: EVIDENCE_STRENGTH.CONTEXTUAL });

  const workModels = foldText(profile.career?.workModels);
  for (const [name, pattern] of [["remote", /remoto|remote|home.office/], ["hybrid", /hibrido|hybrid/], ["onsite", /presencial|on.site|onsite/]]) {
    if (pattern.test(workModels)) addEvidence(evidence, { type: "work_model", normalizedName: name, source: "profile", sourceSection: "career.workModels", text: profile.career.workModels, strength: EVIDENCE_STRENGTH.CONTEXTUAL, value: true });
  }
  if (profile.career?.availability) addEvidence(evidence, { type: "availability", normalizedName: slugify(profile.career.availability), source: "profile", sourceSection: "career.availability", text: profile.career.availability, strength: EVIDENCE_STRENGTH.CONTEXTUAL });
  if (profile.career?.salaryExpectation) addEvidence(evidence, { type: "salary", normalizedName: slugify(profile.career.salaryExpectation), source: "profile", sourceSection: "career.salaryExpectation", text: profile.career.salaryExpectation, strength: EVIDENCE_STRENGTH.CONTEXTUAL });

  const factualText = `${profile.experience || ""}\n${profile.career?.availability || ""}\n${resume.text || ""}`;
  addBooleanEvidence(evidence, factualText, { pattern: /authorized to work|autorizado a trabalhar|possuo autorizacao de trabalho|work permit/, negativePattern: /not authorized to work|nao possuo autorizacao|sem autorizacao de trabalho/, type: "work_authorization", name: "work-authorization", source: "candidate", section: "declared" });
  addBooleanEvidence(evidence, factualText, { pattern: /disponibilidade para viajar|willing to travel|available to travel/, negativePattern: /sem disponibilidade para viajar|not willing to travel/, type: "travel", name: "travel", source: "candidate", section: "declared" });
  addBooleanEvidence(evidence, factualText, { pattern: /disponibilidade para mudanca|willing to relocate|available to relocate/, negativePattern: /sem disponibilidade para mudanca|not willing to relocate/, type: "relocation", name: "relocation", source: "candidate", section: "declared" });

  for(const fact of knowledgeFacts){
    if(fact.lifecycleStatus!=="ACTIVE"||fact.verificationStatus==="REJECTED"||fact.sensitive)continue;
    const text=typeof fact.value==="string"?fact.value:fact.rawText||knowledgeText(fact.value),graphEvidence=(fact.evidences||[]).filter(item=>item.lifecycleStatus==="ACTIVE"&&item.verificationStatus!=="REJECTED");
    if(!text)continue;
    if(["SKILL","TOOL","TECHNOLOGY","PROJECT_TECHNOLOGY"].includes(fact.unitType)&&graphEvidence.length){
      const normalizedName=fact.key.startsWith("skill.")?fact.key.slice(6):normalizeSkillName(text,text);
      for(const item of graphEvidence){const strength=evidenceStrength(item);addEvidence(evidence,{type:"skill",normalizedName,source:"candidate_knowledge",sourceSection:fact.key,text:item.usageDescription||text,strength,value:item.negative?false:true,metadata:{knowledgeFactKey:fact.key,knowledgeEvidenceId:item.id,contextType:item.contextType,depth:item.depth,verificationStatus:item.verificationStatus,linkedEntity:item.linkedEntity,explicitNegative:item.negative,reusePolicy:item.reusePolicy}});}
      continue;
    }
    if(fact.sourceType==="GITHUB"||fact.source==="GITHUB")continue;
    if(["SKILL","TOOL","TECHNOLOGY","PROJECT_TECHNOLOGY"].includes(fact.unitType)){
      const normalizedName=fact.key.startsWith("skill.")?fact.key.slice(6):normalizeSkillName(text,text);if(normalizedName)addEvidence(evidence,{type:"skill",normalizedName,source:"candidate_knowledge",sourceSection:fact.key,text,strength:EVIDENCE_STRENGTH.MENTION,metadata:{knowledgeFactKey:fact.key}});
    }else if(fact.unitType==="LANGUAGE")extractLanguages(evidence,text,{source:"candidate_knowledge",section:fact.key,strength:EVIDENCE_STRENGTH.CONTEXTUAL,metadata:{knowledgeFactKey:fact.key}});
    else if(fact.unitType==="CERTIFICATION")extractCertifications(evidence,text,{source:"candidate_knowledge",section:fact.key,metadata:{knowledgeFactKey:fact.key}});
    else if(fact.unitType==="WORK_EXPERIENCE")extractSkills(evidence,text,{source:"candidate_knowledge",section:fact.key,strength:EVIDENCE_STRENGTH.PROFESSIONAL_EXPERIENCE,metadata:{knowledgeFactKey:fact.key}});
    else if(fact.unitType==="PROJECT")extractSkills(evidence,text,{source:"candidate_knowledge",section:fact.key,strength:EVIDENCE_STRENGTH.CONTEXTUAL,metadata:{knowledgeFactKey:fact.key}});
  }

  return evidence.map(({ key, ...item }) => item);
}
