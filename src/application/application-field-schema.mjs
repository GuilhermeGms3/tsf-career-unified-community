import {createHash} from "node:crypto";
import {canAutofillApplicationField} from "../candidate-knowledge/candidate-knowledge-policy.mjs";
import {reusableApplicationLibraryAnswer,requiresApplicationConfirmation} from "./answer-reuse-policy.mjs";

export const APPLICATION_FIELD_CATEGORIES=Object.freeze(["IDENTITY","CONTACT","LOCATION","EDUCATION","EXPERIENCE","SKILLS","LANGUAGE","SALARY_EXPECTATION","AVAILABILITY","WORK_AUTHORIZATION","CUSTOM_QUESTION","CONSENT","RESUME_UPLOAD","OTHER"]);
export const ANSWER_STATES=Object.freeze(["ANSWERED_CONFIDENT","ANSWERED_USER_SAVED","ANSWERED_DERIVED","NEEDS_REVIEW","WAITING_USER","UNSUPPORTED","BLOCKED"]);
export const fingerprint=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalize=value=>String(value||"").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/\s+/g," ").trim();
export function normalizeApplicationField(raw){
  const label=String(raw.label||"").slice(0,1000),text=normalize(label);
  let semantic=raw.semanticKey||"CUSTOM.QUESTION";
  // Only synonymous expected-salary questions merge, never current salary or benefits.
  if(/^(?:qual (?:e )?(?:a )?sua |informe (?:a )?sua )?(?:pretensao salarial|expectativa salarial)\??$/.test(text))semantic="COMPENSATION.EXPECTED_SALARY";
  if(/^(?:qual (?:e )?(?:a )?sua )?disponibilidade (?:para|de) inicio\??$/.test(text))semantic="APPLICATION.START_AVAILABILITY";
  let category=semantic.split(".")[0];
  if(/SALARY/.test(semantic))category="SALARY_EXPECTATION";
  else if(/NOTICE_PERIOD|AVAILABILITY|RELOCATION|TRAVEL/.test(semantic))category="AVAILABILITY";
  else if(raw.consentType)category="CONSENT";
  else if(semantic==="RESUME.FILE")category="RESUME_UPLOAD";
  else if(/EDUCATION/.test(semantic))category="EDUCATION";
  else if(/EXPERIENCE|PROFESSIONAL/.test(semantic))category="EXPERIENCE";
  else if(/SKILL/.test(semantic))category="SKILLS";
  else if(/LANGUAGE/.test(semantic))category="LANGUAGE";
  else if(!APPLICATION_FIELD_CATEGORIES.includes(category))category="CUSTOM_QUESTION";
  const options=(raw.options||[]).map(o=>({value:String(o.value),label:String(o.label)}));
  const identity=category==="SALARY_EXPECTATION"&&semantic==="COMPENSATION.EXPECTED_SALARY"?semantic:[semantic,text];
  return {fieldId:String(raw.externalKey),label,type:raw.type,required:Boolean(raw.required),options,normalizedSemanticType:semantic,category,source:raw.source||"DOM",confidence:semantic!==raw.semanticKey?1:Number(raw.confidence||0),answerState:"WAITING_USER",sensitive:Boolean(raw.sensitive),explicitOnly:Boolean(raw.sensitive||raw.consentType||requiresApplicationConfirmation({semanticKey:semantic})||["SALARY_EXPECTATION","AVAILABILITY","WORK_AUTHORIZATION"].includes(category)),hidden:Boolean(raw.hidden),questionIdentity:fingerprint([identity,raw.type,options]),binding:{selector:raw.selector,frameUrl:raw.frameUrl,frameIndex:raw.frameIndex,externalKey:raw.externalKey}};
}
export function validateAnswer(field,value){
  if(typeof value!=="string"&&typeof value!=="boolean"&&typeof value!=="number"&&!Array.isArray(value))return false;
  if(JSON.stringify(value).length>4000||value===""||value===null)return false;
  if(Array.isArray(value)&&(!value.length||value.some(v=>typeof v!=="string")))return false;
  if(field.type==="checkbox"&&typeof value!=="boolean")return false;
  if(field.options.length){const allowed=field.options.flatMap(o=>[o.value,o.label]);if((Array.isArray(value)?value:[String(value)]).some(v=>!allowed.includes(v)))return false;}
  return true;
}
export function resolveApplicationFields(fields,{answers={},library,profile,knowledge,resumeVersion}={}){
  const candidate=resumeVersion?.approvedAt?resumeVersion.resumeSpec?.candidate||{}:{};
  const resumeFacts={"IDENTITY.FULL_NAME":candidate.fullName,"CONTACT.EMAIL":candidate.email,"CONTACT.PHONE":candidate.phone,"PROFESSIONAL.CURRENT_TITLE":candidate.headline};
  return fields.map(field=>{
    if(field.hidden||field.type==="password"||field.type==="file"&&field.category!=="RESUME_UPLOAD")return {...field,answerState:"UNSUPPORTED"};
    if(field.category==="RESUME_UPLOAD")return resumeVersion?{...field,answer:resumeVersion.id,answerState:"ANSWERED_CONFIDENT",answerProvenance:{source:"APPROVED_JOB_SPECIFIC_VERSION",versionId:resumeVersion.id}}:field;
    const explicit=answers[field.questionIdentity],saved=library?.find(field.questionIdentity),resumeValue=resumeFacts[field.normalizedSemanticType],fact=profile?.get(field.normalizedSemanticType)||knowledge?.get(field.normalizedSemanticType)||(resumeValue?{value:resumeValue,verified:true,verificationStatus:"IMPORTED_CONFIRMED",reusePolicy:"REUSABLE",source:"APPROVED_RESUME_VERSION"}:null);
    let value,source,state;
    const extractive=explicit?.source==="LLM_EXTRACTIVE";
    if(explicit&&!extractive){value=explicit.value;source="USER_CONFIRMED";state="ANSWERED_CONFIDENT";}
    else if(extractive&&!field.explicitOnly&&!field.sensitive&&["text","textarea"].includes(field.type)&&["PROFESSIONAL.SKILL_EXPERIENCE","PROFESSIONAL.EXPERIENCE_SUMMARY"].includes(field.normalizedSemanticType)){value=explicit.value;source="LLM_EXTRACTIVE";state="ANSWERED_CONFIDENT";}
    else if(reusableApplicationLibraryAnswer(field,saved)){value=saved.value;source="USER_CONFIRMED";state="ANSWERED_USER_SAVED";}
    else if(!field.explicitOnly&&field.confidence>=.85&&canAutofillApplicationField(fact,field)){value=fact.value;source=fact.source;state=source==="DERIVED_SAFE"?"ANSWERED_DERIVED":"ANSWERED_CONFIDENT";}
    if(value===undefined)return field;
    if(!validateAnswer(field,value))return {...field,answerState:"NEEDS_REVIEW"};
    const explicitConfirmation=source==="USER_CONFIRMED"&&(Boolean(explicit)||Boolean(saved));
    const autofillAuthority=explicitConfirmation?{verificationStatus:"USER_CONFIRMED",verified:true}:source==="LLM_EXTRACTIVE"?{verificationStatus:"IMPORTED_CONFIRMED",verified:true,classification:"FACT",reusePolicy:"REUSABLE"}:fact;
    return {...field,answer:value,answerState:state,autofillAuthority,explicitConfirmation,answerProvenance:{source,semantic:field.normalizedSemanticType}};
  });
}
export const isResolved=field=>field.answerState.startsWith("ANSWERED_");
export const schemaSignature=fields=>fingerprint(fields.filter(f=>!f.hidden).map(f=>[f.fieldId,f.label,f.type,f.required,f.options,f.normalizedSemanticType,f.binding]).sort((a,b)=>a[0].localeCompare(b[0])));
