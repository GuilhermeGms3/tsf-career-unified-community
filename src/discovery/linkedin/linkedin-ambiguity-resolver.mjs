import {createHash} from "node:crypto";
import {detectHiringMessage} from "../community/hiring-message-detector.mjs";

export const LINKEDIN_CLASSIFIER_VERSION="linkedin-job-gate-v1";
const optionalFields=["roleTitle","company","location","workModel","seniority","applicationUrl"];
export const LINKEDIN_CLASSIFIER_SCHEMA={type:"object",additionalProperties:false,required:["isJobOpportunity","confidence","opportunityType",...optionalFields,"signals","uncertaintyReasons"],properties:{isJobOpportunity:{type:"boolean"},confidence:{type:"number",minimum:0,maximum:1},opportunityType:{type:"string",enum:["STRUCTURED_JOB","RECRUITER_JOB_POST","POSSIBLE_JOB_POST","NOT_A_JOB"]},...Object.fromEntries(optionalFields.map(key=>[key,{type:["string","null"],maxLength:500}])),signals:{type:"array",items:{type:"string"},maxItems:12},uncertaintyReasons:{type:"array",items:{type:"string"},maxItems:12}}};
const normalized=text=>String(text||"").replace(/\s+/g," ").trim().slice(0,6000);
export function linkedinGate(candidate){
  const text=normalized(`${candidate.title||""} ${candidate.description||candidate.text||""}`),hiring=detectHiringMessage(text);
  const role=/\b(?:analista|suporte|developer|engineer|devops|sre|backend|desenvolvedor|noc|infraestrutura)\b/i.test(text);
  const context=/\b(?:remot[eo]|h[ií]brid|bras[ií]lia|requisitos|requirements|apply|candidatar|curr[ií]culo|cv|empresa|company|time|team|junior|j[uú]nior)\b/i.test(text);
  const noise=/\b(?:evento|event|webinar|congresso|comecei|started a new job|novo emprego|career advice|dicas de carreira|tutorial)\b/i.test(text);
  const explicit=/\b(?:contratando|hiring|vaga(?:s)? para|posi[cç][aã]o aberta|open roles|buscamos|procuramos)\b/i.test(text);
  const structured=candidate.structured===true&&Boolean(candidate.title&&candidate.company)&&/^https:\/\/(?:www\.)?linkedin\.com\/jobs\/view\//.test(candidate.sourceUrl||candidate.url||"");
  const classification=structured?"CLEAR_JOB":noise&&!explicit?"CLEAR_NON_JOB":hiring.relevant&&role&&context&&explicit?"CLEAR_JOB":(hiring.relevant||explicit)&&(role||context)?"AMBIGUOUS_JOB_LIKE":"CLEAR_NON_JOB";
  return {classification,text,signals:[hiring.relevant&&"HIRING_LANGUAGE",role&&"ROLE",context&&"JOB_CONTEXT",structured&&"STRUCTURED_LISTING"].filter(Boolean)};
}
export const newLinkedInMetrics=()=>Object.fromEntries(["linkedinCandidatesSeen","deterministicJobs","deterministicRejects","ambiguousCandidates","ollamaEligible","ollamaCalls","ollamaCacheHits","ollamaInFlightDedupes","ollamaTimeouts","ollamaInvalidResponses","ollamaBudgetSkipped","ollamaJobsRecovered","ollamaNonJobsConfirmed","ollamaUnavailable"].map(key=>[key,0]));

export function validateLinkedInResult(result,text){
  if(!result||typeof result.isJobOpportunity!=="boolean"||!Number.isFinite(result.confidence)||result.confidence<0||result.confidence>1||!LINKEDIN_CLASSIFIER_SCHEMA.properties.opportunityType.enum.includes(result.opportunityType))throw Error("INVALID_SCHEMA");
  if(Object.keys(result).some(key=>!LINKEDIN_CLASSIFIER_SCHEMA.required.includes(key)))throw Error("INVALID_SCHEMA");
  for(const field of optionalFields){if(result[field]!==null&&(typeof result[field]!=="string"||result[field].length>500))throw Error("INVALID_SCHEMA");if(result[field]&&!text.toLowerCase().includes(result[field].toLowerCase()))throw Error("UNGROUNDED_EXTRACTION");}
  for(const field of ["signals","uncertaintyReasons"])if(!Array.isArray(result[field])||result[field].length>12||result[field].some(value=>typeof value!=="string"||value.length>500))throw Error("INVALID_SCHEMA");
  if(result.isJobOpportunity===(result.opportunityType==="NOT_A_JOB"))throw Error("INVALID_SCHEMA");
  if(result.applicationUrl){const url=new URL(result.applicationUrl);if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw Error("INVALID_URL");}
  return result;
}

export class LinkedInAmbiguityResolver {
  constructor({cache,resolve,modelIdentity=()=>"",maxPerRun=3}){Object.assign(this,{cache,resolve,modelIdentity});this.maxPerRun=Math.min(3,Math.max(0,maxPerRun));this.inFlight=new Map();this.tail=Promise.resolve();this.window={started:0,calls:0};}
  createRun(){return {metrics:newLinkedInMetrics(),reserved:0};}
  async classify(candidate,run=this.createRun()){
    const gate=linkedinGate(candidate),m=run.metrics;m.linkedinCandidatesSeen++;
    if(gate.classification!=="AMBIGUOUS_JOB_LIKE"){m[gate.classification==="CLEAR_JOB"?"deterministicJobs":"deterministicRejects"]++;return {...gate,opportunityType:gate.classification==="CLEAR_JOB"?(candidate.structured?"STRUCTURED_JOB":"RECRUITER_JOB_POST"):"NOT_A_JOB",semantic:null};}
    m.ambiguousCandidates++;m.ollamaEligible++;
    const fallback={...gate,opportunityType:"POSSIBLE_JOB_POST",semantic:null},model=this.modelIdentity();
    if(!model){m.ollamaUnavailable++;return fallback;}
    const key=createHash("sha256").update(JSON.stringify([gate.text,LINKEDIN_CLASSIFIER_VERSION,model,"whitespace-v1"])).digest("hex"),cached=this.cache.get(key);
    if(cached){m.ollamaCacheHits++;return {...fallback,semantic:cached,opportunityType:cached.opportunityType};}
    if(this.inFlight.has(key)){m.ollamaInFlightDedupes++;return this.inFlight.get(key);}
    if(Date.now()-this.window.started>60000)this.window={started:Date.now(),calls:0};
    if(run.reserved>=this.maxPerRun||this.window.calls>=this.maxPerRun){m.ollamaBudgetSkipped++;return fallback;}
    run.reserved++;this.window.calls++;
    const task=this.tail.then(async()=>{
      try{const response=await this.resolve(gate.text,()=>{m.ollamaCalls++;});if(response?.meta?.fallback){const code=response.meta.errorCode||"";if(/TIMEOUT/i.test(code))m.ollamaTimeouts++;else if(/INVALID/.test(code))m.ollamaInvalidResponses++;else m.ollamaUnavailable++;return fallback;}
        const result=validateLinkedInResult(response.result,gate.text);this.cache.put(key,"CLASSIFICATION",result,30*86400000);m[result.isJobOpportunity?"ollamaJobsRecovered":"ollamaNonJobsConfirmed"]++;return {...fallback,opportunityType:result.opportunityType,semantic:result};
      }catch(error){if(/TIMEOUT/i.test(error.code||error.message))m.ollamaTimeouts++;else m.ollamaInvalidResponses++;return fallback;}
    });
    this.inFlight.set(key,task);this.tail=task.catch(()=>{});
    try{return await task;}finally{this.inFlight.delete(key);}
  }
}
