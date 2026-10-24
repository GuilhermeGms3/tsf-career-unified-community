import {candidateKnowledgeKey,displayNameForUnit,languageMetadata} from "./candidate-knowledge-normalizer.mjs";
import {applyKnowledgePolicy,KNOWLEDGE_TYPES,maskKnowledgeValue,REUSE_POLICIES} from "./candidate-knowledge-policy.mjs";
import {CAREER_ENTITY_TYPES,DEPTH_SCORE,EVIDENCE_CONTEXTS,EVIDENCE_DEPTHS,GAP_ANSWERS,boundedText,clampDepth,deterministicEnrichment,enumValue,gapAnswerModel,unionYears} from "./career-evidence-model.mjs";

const SECTION_BY_TYPE=Object.freeze({IDENTITY:"identity",CONTACT:"identity",LOCATION:"identity",APPLICATION_FACT:"application",SENSITIVE:"application",WORK_EXPERIENCE:"experience",WORK_RESPONSIBILITY:"experience",WORK_ACHIEVEMENT:"experience",EDUCATION:"education",SKILL:"skills",TOOL:"skills",TECHNOLOGY:"skills",CERTIFICATION:"certifications",LANGUAGE:"languages",PROJECT:"projects",PROJECT_TECHNOLOGY:"projects",PREFERENCE:"preferences",JOB_PREFERENCE:"preferences",APPLICATION_ANSWER:"answers"});
const SECTION_LABELS=Object.freeze({identity:"Identidade e contato",application:"Disponibilidade e candidatura",experience:"Experiência profissional",education:"Formação",skills:"Competências",certifications:"Certificações",languages:"Idiomas",projects:"Projetos",preferences:"Preferências",answers:"Respostas para candidaturas"});
const ORDER=Object.freeze(Object.keys(SECTION_LABELS));
const humanize=value=>String(value||"").replace(/[._-]+/g," ").replace(/\b\w/g,c=>c.toUpperCase());

function publicItem(fact,{detail=false}={}){
  const value=maskKnowledgeValue(fact),base={key:fact.key,unitType:fact.unitType,label:fact.sensitive?"Informação protegida":displayNameForUnit(fact),verificationStatus:fact.verificationStatus,reusePolicy:fact.reusePolicy,sensitive:fact.sensitive,lastUsedAt:fact.lastUsedAt,updatedAt:fact.updatedAt};
  if(fact.unitType==="LANGUAGE"&&!fact.sensitive)base.language=languageMetadata(fact.value);
  if(["WORK_EXPERIENCE","EDUCATION","PROJECT"].includes(fact.unitType)&&!fact.sensitive)base.value=publicStructuredValue(fact.value,fact.unitType);
  if(detail)Object.assign(base,{value,rawText:fact.sensitive?"":fact.rawText,source:{type:fact.sourceType,label:sourceLabel(fact.sourceType),id:fact.sourceId||"",versionId:fact.sourceVersionId||""},extractionConfidence:fact.confidence,confirmedAt:fact.confirmedAt,createdAt:fact.createdAt,provenance:fact.provenance,lifecycleStatus:fact.lifecycleStatus,legacyKey:fact.legacyKey});
  return base;
}

function sourceLabel(sourceType){return ({CANDIDATE_PROFILE:"Perfil do candidato",RESUME_IMPORT:"Currículo importado",RESUME_SPEC:"ResumeSpec",APPLICATION_ANSWER:"Resposta em candidatura",USER_INPUT:"Informado pelo usuário",LEGACY:"Migração legada",SYSTEM:"Sistema"})[sourceType]||humanize(sourceType||"Origem não registrada");}

function publicStructuredValue(value,unitType){const fields={WORK_EXPERIENCE:["company","role","title","startDate","endDate","employmentType","responsibilities","achievements","technologies","bullets"],EDUCATION:["institution","course","degree","field","status","startDate","endDate","expectedGraduation"],PROJECT:["name","description","technologies","evidence","links"]}[unitType]||[];return Object.fromEntries(fields.filter(field=>Object.hasOwn(value||{},field)).map(field=>[field,value[field]]));}

export class CandidateKnowledgeService {
  constructor({facts,answers,evidence=null}){this.facts=facts;this.answers=answers;this.evidence=evidence;}

  summary(){
    const allActive=this.facts.active(),hasStructuredExperience=allActive.some(fact=>fact.unitType==="WORK_EXPERIENCE"&&fact.value&&typeof fact.value==="object"),active=allActive.filter(fact=>!(hasStructuredExperience&&["PROFESSIONAL.CURRENT_COMPANY","PROFESSIONAL.CURRENT_TITLE","PROFESSIONAL.YEARS_EXPERIENCE"].includes(fact.key))),sections=Object.fromEntries(ORDER.map(id=>[id,[]]));
    for(const fact of active){const section=SECTION_BY_TYPE[fact.unitType]||"application";sections[section].push(publicItem(fact));}
    const answerItems=this.answers.all().map(answer=>({key:answer.fingerprint,unitType:"APPLICATION_ANSWER",label:answer.normalizedQuestion||humanize(answer.semanticKey),verificationStatus:answer.verified?"USER_CONFIRMED":"REVIEW_REQUIRED",reusePolicy:answer.sensitive?"SENSITIVE_CONFIRM_EACH_TIME":answer.reusable?"REUSABLE":answer.scope?.applicationId?"APPLICATION_SPECIFIC":"NEVER_AUTO_REUSE",reusable:answer.reusable,sensitive:answer.sensitive,lastUsedAt:answer.lastUsedAt,answerCategory:answer.answerCategory}));
    sections.answers.push(...answerItems);
    const conflicts=this.facts.conflicts(),gaps=[...active.filter(item=>item.verificationStatus==="REVIEW_REQUIRED"||(!item.verified&&item.confidence<0.7)).map(item=>({kind:item.verificationStatus==="REVIEW_REQUIRED"?"REVIEW_REQUIRED":"LOW_CONFIDENCE",key:item.key,label:displayNameForUnit(item)})),...conflicts.map(item=>({kind:"CONFLICT",key:item.canonicalKey,label:"Fontes divergentes precisam de revisão"}))];
    return {summary:{activeFacts:active.length,confirmedFacts:active.filter(item=>item.verificationStatus==="USER_CONFIRMED").length,reviewRequired:gaps.length,confirmedAnswers:answerItems.filter(item=>item.verificationStatus==="USER_CONFIRMED").length},sections:ORDER.map(id=>({id,label:SECTION_LABELS[id],items:sections[id]})),gaps};
  }

  detail(key){const fact=this.facts.find(key,{includeInactive:true});if(!fact)throw Object.assign(new Error("Informação não encontrada."),{status:404,code:"CANDIDATE_FACT_NOT_FOUND"});return {...publicItem(fact,{detail:true}),usages:this.facts.usages(key)};}

  save(input,{key=null}={}){
    const unitType=String(input.unitType||"").toUpperCase();if(!KNOWLEDGE_TYPES.includes(unitType))throw Object.assign(new Error("Escolha um tipo de informação válido."),{code:"CANDIDATE_FACT_TYPE_INVALID"});
    const value=normalizeInputValue(input.value,unitType);if(value===null||value==="")throw Object.assign(new Error("Informe um valor."),{code:"CANDIDATE_FACT_VALUE_REQUIRED"});
    const stableKey=key||candidateKnowledgeKey(unitType,value);if(!stableKey)throw Object.assign(new Error("Não foi possível gerar a chave desta informação."),{code:"CANDIDATE_FACT_KEY_REQUIRED"});
    const policy=applyKnowledgePolicy({unitType,verificationStatus:"USER_CONFIRMED",reusePolicy:input.reusePolicy||"REUSABLE",sensitive:Boolean(input.sensitive)||unitType==="SENSITIVE",classification:["PREFERENCE","JOB_PREFERENCE"].includes(unitType)?"PREFERENCE":"FACT"});
    return this.facts.save({...policy,key:stableKey,value,rawText:typeof value==="string"?value:"",source:"USER_CONFIRMED",sourceType:"USER_INPUT",confidence:1,provenance:{enteredBy:"USER"}},{actor:"USER"});
  }

  update(key,input){
    const current=this.facts.find(key,{includeInactive:true});if(!current)throw Object.assign(new Error("Informação não encontrada."),{status:404,code:"CANDIDATE_FACT_NOT_FOUND"});
    const value=Object.hasOwn(input,"value")?normalizeInputValue(input.value,current.unitType):current.value;
    const reusePolicy=input.reusePolicy||current.reusePolicy;if(!REUSE_POLICIES.includes(reusePolicy))throw Object.assign(new Error("Política de reutilização inválida."),{code:"CANDIDATE_FACT_POLICY_INVALID"});
    return this.facts.save({...current,value,reusePolicy,verificationStatus:"USER_CONFIRMED",source:"USER_CONFIRMED",sourceType:"USER_INPUT",confidence:current.confidence,confirmedAt:new Date().toISOString()},{actor:"USER"});
  }

  inventory(){
    if(!this.evidence)return {...this.summary(),experiences:[],projects:[],skills:[],pendingReviews:[],evidenceGaps:[]};
    const entities=this.evidence.entities(),allEvidence=this.evidence.evidence(),byFact=new Map(),byEntity=new Map();
    for(const item of allEvidence){if(!byFact.has(item.factKey))byFact.set(item.factKey,[]);byFact.get(item.factKey).push(item);if(item.entityId){if(!byEntity.has(item.entityId))byEntity.set(item.entityId,[]);byEntity.get(item.entityId).push(item);}}
    const facts=this.facts.active(),skills=facts.filter(f=>["SKILL","TOOL","TECHNOLOGY"].includes(f.unitType)).map(f=>this.skillDto(f,byFact.get(f.key)||[]));
    const entityDto=entity=>({...entity,evidenceCount:(byEntity.get(entity.id)||[]).length,knowledgeSummary:(byEntity.get(entity.id)||[]).slice(0,8),pendingReviewCount:(byEntity.get(entity.id)||[]).filter(x=>x.verificationStatus==="REVIEW_REQUIRED").length});
    const proposals=this.evidence.proposals("REVIEW_REQUIRED"),gaps=this.evidence.gaps();
    return {overview:{confirmedSkills:skills.filter(x=>x.verification==="USER_CONFIRMED"&&x.highestConfirmedDepth!=="UNKNOWN").length,professionalEvidence:allEvidence.filter(x=>x.contextType==="PROFESSIONAL"&&x.verificationStatus==="USER_CONFIRMED"&&!x.negative).length,projects:entities.filter(x=>x.entityType==="PROJECT").length,pendingReviews:proposals.length+allEvidence.filter(x=>x.verificationStatus==="REVIEW_REQUIRED").length,openEvidenceGaps:gaps.filter(x=>x.status==="OPEN").length,skillsWithoutContext:skills.filter(x=>x.highestConfirmedDepth==="UNKNOWN").length},experiences:entities.filter(x=>x.entityType==="EXPERIENCE").map(entityDto),projects:entities.filter(x=>x.entityType==="PROJECT").map(entityDto),education:entities.filter(x=>["EDUCATION","COURSE","CERTIFICATION","LAB"].includes(x.entityType)).map(entityDto),skills,pendingReviews:proposals,evidenceGaps:gaps};
  }

  skillDetail(key){const fact=this.facts.find(key,{includeInactive:true});if(!fact)throw apiError("Competência não encontrada.","CANDIDATE_FACT_NOT_FOUND",404);const evidence=this.evidence?.evidence({factKey:key})||[];return {...this.skillDto(fact,evidence),evidence:evidence.map(item=>({...item,claims:this.evidence.claims(item.id)})),years:unionYears(evidence.filter(x=>!x.negative&&["PROFESSIONAL","FREELANCE"].includes(x.contextType)))};}
  skillDto(fact,evidence){const confirmed=evidence.filter(x=>x.verificationStatus==="USER_CONFIRMED"&&!x.negative),best=[...confirmed].sort((a,b)=>(DEPTH_SCORE[b.depth]||0)-(DEPTH_SCORE[a.depth]||0))[0];return {key:fact.key,canonicalSkill:String(fact.key).replace(/^skill\./,""),label:displayNameForUnit(fact),highestConfirmedDepth:best?.depth||"UNKNOWN",bestEvidence:best||null,contexts:[...new Set(confirmed.map(x=>x.contextType))],evidenceCount:evidence.length,lastUsed:[...evidence].sort((a,b)=>String(b.lastUsedAt||b.endDate).localeCompare(String(a.lastUsedAt||a.endDate)))[0]?.lastUsedAt||"",verification:fact.verificationStatus,pending:evidence.some(x=>x.verificationStatus==="REVIEW_REQUIRED"),reusePolicy:fact.reusePolicy};}

  // Fatos de candidatura das evidencias confirmadas: anos por tecnologia (profissional/freelance), "tem
  // experiencia" (uso profissional/freelance), "tem conhecimento" (uso real em qualquer contexto, nao so
  // leitura) e "nunca usei" confirmado, que responde Nao as duas perguntas.
  applicationFacts(){
    if(!this.evidence)return [];
    const grouped=new Map();
    for(const item of this.evidence.evidence()){
      if(item.verificationStatus!=="USER_CONFIRMED"||item.reusePolicy!=="REUSABLE")continue;
      if(!grouped.has(item.factKey))grouped.set(item.factKey,[]);
      grouped.get(item.factKey).push(item);
    }
    const fact=(key,value,items)=>({key,value,source:"CAREER_EVIDENCE_GRAPH",sourceType:"CAREER_EVIDENCE_GRAPH",verificationStatus:"USER_CONFIRMED",verified:true,confidence:1,unitType:"APPLICATION_FACT",sensitive:false,reusePolicy:"REUSABLE",classification:"FACT",provenance:{evidenceIds:items.map(item=>item.id)}});
    const used=item=>(DEPTH_SCORE[item.depth]||0)>=DEPTH_SCORE.USED;
    return [...grouped.entries()].flatMap(([factKey,items])=>{
      const canonical=String(factKey).replace(/^(?:skill|tool|technology)\./,""),positive=items.filter(item=>!item.negative),never=!positive.length;
      const professional=positive.filter(item=>["PROFESSIONAL","FREELANCE"].includes(item.contextType)),worked=professional.filter(used),practiced=positive.filter(used);
      const years=professional.length?unionYears(professional):null,facts=[];
      if(years!==null)facts.push(fact(`PROFESSIONAL.SKILL_YEARS.${canonical}`,years,professional));
      if(worked.length||never)facts.push(fact(`PROFESSIONAL.SKILL_HAS.${canonical}`,worked.length>0,worked.length?worked:items));
      if(practiced.length||never)facts.push(fact(`PROFESSIONAL.SKILL_KNOWS.${canonical}`,practiced.length>0,practiced.length?practiced:items));
      return facts;
    });
  }

  saveEntity(input){if(!this.evidence)throw apiError("Evidence Graph indisponível.","EVIDENCE_GRAPH_UNAVAILABLE",503);const entityType=enumValue(input.entityType,CAREER_ENTITY_TYPES,"");if(!entityType)throw apiError("Tipo de experiência inválido.","CAREER_ENTITY_TYPE_INVALID");const title=boundedText(input.title||input.role||input.organization,160);if(!title)throw apiError("Informe um título, cargo ou organização.","CAREER_ENTITY_TITLE_REQUIRED");return this.evidence.saveEntity({id:boundedText(input.id,220)||undefined,entityType,title,organization:boundedText(input.organization,160),role:boundedText(input.role,160),startDate:dateValue(input.startDate),endDate:dateValue(input.endDate),current:Boolean(input.current),location:boundedText(input.location,200),summary:boundedText(input.summary,4000),details:{responsibilities:stringList(input.responsibilities),achievements:stringList(input.achievements),technologies:stringList(input.technologies),domains:stringList(input.domains),deliverables:stringList(input.deliverables),outcomes:stringList(input.outcomes),links:stringList(input.links)},verificationStatus:"USER_CONFIRMED"});}
  entityDetail(id){const entity=this.evidence?.findEntity(id);if(!entity)throw apiError("Experiência ou projeto não encontrado.","CAREER_ENTITY_NOT_FOUND",404);return {...entity,evidence:this.evidence.evidence({entityId:id})};}

  proposeEnrichment(input){const entityId=boundedText(input.entityId,220),entity=entityId?this.evidence?.findEntity(entityId):null;if(entityId&&!entity)throw apiError("Experiência não encontrada.","CAREER_ENTITY_NOT_FOUND",404);const narrative=boundedText(input.narrative,8000);if(narrative.length<12)throw apiError("Conte um pouco mais sobre o que você fez.","ENRICHMENT_NARRATIVE_TOO_SHORT");const contextType=enumValue(input.contextType,EVIDENCE_CONTEXTS,entity?.entityType==="PROJECT"?"PERSONAL_PROJECT":"PROFESSIONAL"),items=deterministicEnrichment(narrative,{contextType});return this.evidence.saveProposal({entityId,contextType,narrative,items,sourceType:"USER_ENTERED"});}
  reviewProposal(id,input){const proposal=this.evidence?.findProposal(id);if(!proposal)throw apiError("Proposta não encontrada.","ENRICHMENT_PROPOSAL_NOT_FOUND",404);if(proposal.status!=="REVIEW_REQUIRED")throw apiError("Esta proposta já foi revisada.","ENRICHMENT_PROPOSAL_ALREADY_REVIEWED");if(input.action==="REJECT")return this.evidence.updateProposal(id,{items:proposal.items,status:"REJECTED"});const selected=Array.isArray(input.items)?input.items.filter(x=>x.selected!==false):[];if(!selected.length)throw apiError("Selecione ao menos uma evidência para confirmar.","ENRICHMENT_SELECTION_REQUIRED");const confirmed=this.evidence.transaction(()=>selected.map(item=>this.confirmEvidenceItem({...item,entityId:proposal.entityId,contextType:item.contextType||proposal.contextType,sourceId:proposal.id})));this.evidence.updateProposal(id,{items:selected,status:"CONFIRMED"});this.evidence.event("EXPERIENCE_ENRICHED","CAREER_ENTITY",proposal.entityId||id,{proposalId:id,evidenceCount:confirmed.length});return {proposal:this.evidence.findProposal(id),evidence:confirmed};}
  confirmEvidenceItem(input){const label=boundedText(input.label||input.canonicalSkill,160);if(!label)throw apiError("Competência inválida.","EVIDENCE_SKILL_REQUIRED");const key=candidateKnowledgeKey("SKILL",label),contextType=enumValue(input.contextType,EVIDENCE_CONTEXTS,"OTHER"),depth=clampDepth(contextType,input.depth||"USED"),reusePolicy=REUSE_POLICIES.includes(input.reusePolicy)?input.reusePolicy:"REUSABLE";this.facts.save({key,value:label,rawText:label,unitType:"SKILL",source:"USER_CONFIRMED",sourceType:"USER_INPUT",verificationStatus:"USER_CONFIRMED",reusePolicy,confidence:1,provenance:{evidenceGraph:true}},{actor:"USER"});return this.evidence.saveEvidence({factKey:key,entityId:input.entityId||null,contextType,usageDescription:boundedText(input.usageDescription,1200),activities:stringList(input.activities),depth,verificationStatus:"USER_CONFIRMED",confidence:1,reusePolicy,sourceType:"USER_CONFIRMED",sourceId:input.sourceId||null,startDate:dateValue(input.startDate),endDate:dateValue(input.endDate),lastUsedAt:dateValue(input.lastUsedAt),negative:Boolean(input.negative)});}

  syncGapsFromAnalysis({jobId,analysisId,items}){return this.evidence?.syncGaps({jobId,analysisId,items})||[];}
  gaps(jobId){return this.evidence?.gaps({jobId})||[];}
  resolveGap(id,input){const gap=this.evidence?.findGap(id);if(!gap)throw apiError("Lacuna não encontrada.","EVIDENCE_GAP_NOT_FOUND",404);if(!["OPEN","PROPOSAL_REVIEW"].includes(gap.status))throw apiError("Esta lacuna já foi resolvida.","EVIDENCE_GAP_ALREADY_RESOLVED");const answerType=enumValue(input.answerType,GAP_ANSWERS,"");if(!answerType)throw apiError("Escolha como você utilizou esta competência.","EVIDENCE_GAP_ANSWER_INVALID");const model=gapAnswerModel(answerType),factKey=candidateKnowledgeKey("SKILL",gap.canonicalSkill);this.facts.save({key:factKey,value:gap.requirementLabel,unitType:"SKILL",source:"USER_CONFIRMED",sourceType:"USER_INPUT",verificationStatus:"USER_CONFIRMED",reusePolicy:"REUSABLE",confidence:1,provenance:{gapId:id}},{actor:"USER"});const evidence=this.evidence.saveEvidence({factKey,entityId:boundedText(input.entityId,220)||null,contextType:model.context,usageDescription:boundedText(input.description,1200),depth:model.depth,verificationStatus:"USER_CONFIRMED",confidence:1,reusePolicy:"REUSABLE",sourceType:"USER_CONFIRMED",sourceId:id,negative:Boolean(model.negative),startDate:dateValue(input.startDate),endDate:dateValue(input.endDate)}),status=model.negative?"SKILL_GAP":"RESOLVED";return {gap:this.evidence.resolveGap(id,{status,answerType,description:input.description,evidenceId:evidence.id}),evidence,analysisStale:true};}
  validateClaim(input){const evidence=this.evidence?.findEvidence(input.evidenceId);if(!evidence)throw apiError("Evidência não encontrada.","KNOWLEDGE_EVIDENCE_NOT_FOUND",404);const requested=enumValue(input.requestedDepth,EVIDENCE_DEPTHS,"UNKNOWN"),overstated=DEPTH_SCORE[requested]>DEPTH_SCORE[evidence.depth]||(/especialista|lider(?:ei|ança)|owned|respons[aá]vel/i.test(input.claimText||"")&&DEPTH_SCORE[evidence.depth]<DEPTH_SCORE.OWNED),status=evidence.negative?"UNSUPPORTED":overstated?"OVERSTATED":evidence.verificationStatus==="USER_CONFIRMED"?"SUPPORTED":"REVIEW_REQUIRED",reason=evidence.negative?"O candidato confirmou que não utilizou esta competência.":overstated?`A formulação exige ${requested}, acima da evidência ${evidence.depth}.`:status==="SUPPORTED"?"Contexto, profundidade e verificação sustentam a formulação.":"A evidência ainda requer revisão.";return this.evidence.saveClaim({evidenceId:evidence.id,claimText:boundedText(input.claimText,1000),requestedDepth:requested,status,reason});}
}

function normalizeInputValue(value,unitType){
  if(typeof value==="string"){const clean=value.trim().slice(0,4000);return clean;}
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    const allowed={
      WORK_EXPERIENCE:["company","role","title","startDate","endDate","employmentType","responsibilities","achievements","technologies","rawText"],
      EDUCATION:["institution","course","degree","field","status","startDate","endDate","expectedGraduation","rawText"],
      LANGUAGE:["name","language","level","framework","evidence","rawText"],
      PROJECT:["name","description","technologies","evidence","links","rawText"]
    }[unitType];
    if(!allowed)return null;return Object.fromEntries(allowed.filter(field=>Object.hasOwn(value,field)).map(field=>[field,cleanStructuredField(value[field])]));
  }
  return typeof value==="boolean"||typeof value==="number"?value:null;
}

function cleanStructuredField(value){if(Array.isArray(value))return value.slice(0,100).map(item=>String(item??"").trim().slice(0,1000)).filter(Boolean);if(typeof value==="string")return value.trim().slice(0,4000);return value===null||value===undefined?"":String(value).slice(0,500);}
function stringList(value){if(Array.isArray(value))return value.slice(0,50).map(x=>boundedText(x,1000)).filter(Boolean);return String(value||"").split(/\r?\n|;/).map(x=>boundedText(x,1000)).filter(Boolean).slice(0,50);}
function dateValue(value){if(!value)return null;const text=String(value).trim();return /^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(text)?text:null;}
function apiError(message,code,status=400){return Object.assign(new Error(message),{code,status});}

export {SECTION_BY_TYPE};
