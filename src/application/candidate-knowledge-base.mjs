import {knowledgeUnitsFromAggregate} from "../candidate-knowledge/candidate-knowledge-normalizer.mjs";
import {canReuseKnowledge} from "../candidate-knowledge/candidate-knowledge-policy.mjs";
import {languageLevel} from "../matching/normalization.mjs";

const fact=(key,value,{source="CANDIDATE_PROFILE",sourceType="CANDIDATE_PROFILE",verificationStatus="USER_CONFIRMED",confidence=1,unitType="APPLICATION_FACT",sensitive=false,reusePolicy=null}={})=>value===undefined||value===null||value===""?null:{key,value,source,sourceType,verificationStatus,verified:["USER_CONFIRMED","IMPORTED_CONFIRMED"].includes(verificationStatus),confidence,unitType,sensitive,reusePolicy:reusePolicy||(sensitive?"SENSITIVE_CONFIRM_EACH_TIME":"REUSABLE"),classification:sensitive?"SENSITIVE":unitType.includes("PREFERENCE")?"PREFERENCE":"FACT",rawText:typeof value==="string"?value:"",provenance:{profilePath:key}};
const list=value=>Array.isArray(value)?value:value===undefined||value===null||value===""?[]:[value];
// Idioma confirmado com nivel ("Ingles avancado", "B2") responde "Qual seu nivel de ingles?"; o adapter
// escolhe a opcao do formulario sem exagerar o nivel (it-question-answers.mjs).
const LANGUAGE_LEVEL_KEYS={english:"PROFESSIONAL.ENGLISH_LEVEL",spanish:"PROFESSIONAL.SPANISH_LEVEL"},LEVEL_LABELS={1:"Básico",2:"Intermediário",3:"Avançado",4:"Fluente",5:"Nativo"};
const languageLevelFacts=facts=>facts.flatMap(item=>{const key=item.unitType==="LANGUAGE"&&LANGUAGE_LEVEL_KEYS[String(item.key||"").replace(/^language\./,"")];if(!key)return [];const level=languageLevel(item.value&&typeof item.value==="object"?[item.value.level,item.value.proficiency,item.rawText].filter(Boolean).join(" "):String(item.value??item.rawText??""));return level?[{...item,key,value:LEVEL_LABELS[level],provenance:{...(item.provenance||{}),languageKey:item.key}}]:[];});

export class CandidateKnowledgeBase {
  constructor(facts=[]){this.facts=new Map(facts.filter(Boolean).map(item=>[item.key,item]));this.confirmedAnswers=[];}
  get(key){return this.facts.get(key)||null;}
  all(){return [...this.facts.values()];}
  // Form answers retain their fingerprint/scope; they must not become global profile facts.
  withConfirmedAnswers(answers=[]){this.confirmedAnswers=answers.filter(answer=>answer.verified&&answer.reusable&&!answer.sensitive);return this;}

  static fromFacts(facts=[],answers=[]){
    const reusable=facts.filter(item=>!item.sensitive&&(canReuseKnowledge(item)||(!item.lifecycleStatus&&item.reusePolicy==="REUSABLE"&&["USER_CONFIRMED","IMPORTED_CONFIRMED"].includes(item.verificationStatus))));
    return new CandidateKnowledgeBase([...languageLevelFacts(reusable),...reusable]).withConfirmedAnswers(answers);
  }

  static fromProfile(profile={}){
    const personal=profile.personal||{},career=profile.career||{},preferences=profile.preferences||{},parts=String(personal.fullName||"").trim().split(/\s+/).filter(Boolean),structured=profile.resumeData||{};
    const facts=[
      fact("IDENTITY.FULL_NAME",personal.fullName,{unitType:"IDENTITY"}),
      parts.length?fact("IDENTITY.FIRST_NAME",parts[0],{source:"DERIVED_SAFE",verificationStatus:"IMPORTED_CONFIRMED",confidence:.9,unitType:"IDENTITY",reusePolicy:"REUSABLE"}):null,
      parts.length>1?fact("IDENTITY.LAST_NAME",parts.slice(1).join(" "),{source:"DERIVED_SAFE",verificationStatus:"IMPORTED_CONFIRMED",confidence:.9,unitType:"IDENTITY",reusePolicy:"REUSABLE"}):null,
      fact("CONTACT.EMAIL",personal.email,{unitType:"CONTACT"}),fact("CONTACT.PHONE",personal.phone,{unitType:"CONTACT",sensitive:true}),
      fact("LOCATION.CITY",personal.city,{unitType:"LOCATION"}),fact("LOCATION.STATE",personal.state,{unitType:"LOCATION"}),fact("LOCATION.COUNTRY",personal.country,{unitType:"LOCATION"}),
      fact("PROFESSIONAL.CURRENT_COMPANY",career.currentCompany,{unitType:"WORK_EXPERIENCE"}),fact("PROFESSIONAL.CURRENT_TITLE",career.headline,{unitType:"WORK_EXPERIENCE"}),fact("PROFESSIONAL.YEARS_EXPERIENCE",career.yearsExperience,{unitType:"WORK_EXPERIENCE"}),
      fact("WORK_AUTHORIZATION.AUTHORIZED",career.workAuthorized,{unitType:"APPLICATION_FACT",sensitive:true}),fact("WORK_AUTHORIZATION.REQUIRES_SPONSORSHIP",career.requiresSponsorship,{unitType:"APPLICATION_FACT",sensitive:true}),
      fact("PREFERENCES.REMOTE",preferences.remote,{unitType:"JOB_PREFERENCE"}),fact("PREFERENCES.RELOCATION",preferences.relocation,{unitType:"JOB_PREFERENCE"}),
      fact("PREFERENCES.SALARY_EXPECTATION",career.salaryExpectation,{unitType:"SENSITIVE",sensitive:true}),fact("COMPENSATION.EXPECTED_SALARY",career.salaryExpectation,{unitType:"SENSITIVE",sensitive:true}),
      fact("PROFILE.LINKEDIN",personal.linkedin,{unitType:"CONTACT"}),fact("PROFILE.GITHUB",personal.github,{unitType:"CONTACT"}),fact("PROFILE.PORTFOLIO",personal.portfolio,{unitType:"CONTACT"}),
      fact("APPLICATION.NOTICE_PERIOD",career.availability,{unitType:"APPLICATION_FACT"})
    ];
    const collections=[
      ["PROFILE.SKILLS",structured.skills?.length?structured.skills:career.skills],["PROFILE.LANGUAGES",structured.languages?.length?structured.languages:career.languages||career.englishLevel],
      ["PROFILE.CERTIFICATIONS",structured.certifications?.length?structured.certifications:profile.certifications],["PROFILE.PROJECTS",structured.projects?.length?structured.projects:profile.projects],
      ["PROFILE.EXPERIENCE",structured.experience?.length?structured.experience:profile.experience],["PROFILE.EDUCATION",structured.education?.length?structured.education:profile.education]
    ];
    for(const [key,values] of collections){const aggregate={key,value:list(values),source:"CANDIDATE_PROFILE",sourceType:"CANDIDATE_PROFILE",confidence:1,verified:true,verificationStatus:"USER_CONFIRMED",reusePolicy:"REUSABLE",classification:"FACT"};for(const sourceUnit of knowledgeUnitsFromAggregate(aggregate)){const {legacyKey:_legacy,provenance:_provenance,...unit}=sourceUnit;facts.push({...unit,source:"CANDIDATE_PROFILE",sourceType:"CANDIDATE_PROFILE",provenance:{profilePath:key}});}}
    return new CandidateKnowledgeBase(facts);
  }
}
