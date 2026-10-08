import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {calculateOpportunityPriority} from "../src/opportunities/opportunity-priority.mjs";
import {DecisionInboxService} from "../src/product/decision-inbox-service.mjs";
import {CURRENT_MATCHER_VERSION,CURRENT_REQUIREMENT_EXTRACTOR_VERSION,CURRENT_SCORING_MODEL_VERSION} from "../src/matching/analysis-version.mjs";

async function fixture(){const dataDir=await mkdtemp(path.join(os.tmpdir(),"career-product-")),store=await new UnifiedStateStore({dataDir}).initialize();return {store,async close(){store.close();await rm(dataDir,{recursive:true,force:true});}};}
function date(days=0){return new Date(Date.now()-days*86400000).toISOString();}
function job(id="job-1",overrides={}){const now=date();return {id,title:"DevOps",company:"Acme",description:"Linux Docker CI/CD e observabilidade em ambiente de produção. ".repeat(12),location:"São Paulo, Brasil",workModel:"Remoto",url:`https://example.test/jobs/${id}`,applicationUrl:`https://jobs.lever.co/acme/${id}`,atsType:"lever",datePosted:now,lifecycleStatus:"OPEN",status:"open",createdAt:now,updatedAt:now,...overrides};}
function analysis(score=88,overrides={}){return {overallScore:score,calibratedMatchScore:score,matcherVersion:CURRENT_MATCHER_VERSION,scoringModelVersion:CURRENT_SCORING_MODEL_VERSION,requirementExtractorVersion:CURRENT_REQUIREMENT_EXTRACTOR_VERSION,algorithmVersion:"ats-matcher-v2",unknownRequirements:[],matched:["Linux","Docker"],missing:["Kubernetes"],...overrides};}
const requirements=[{id:"r1",normalizedName:"Linux"},{id:"r2",normalizedName:"Docker"},{id:"r3",normalizedName:"Kubernetes"}];
const items=[{status:"MATCH"},{status:"MATCH"},{status:"NO_MATCH"}];

test("repositório não transforma overallScore legado em score calibrado",async()=>{
  const f=await fixture();try{
    f.store.jobs.upsert(job());
    const timestamp=date();
    f.store.analyses.upsert({id:"legacy-analysis",jobId:"job-1",resumeId:null,score:95,overallScore:95,algorithmVersion:"ats-matcher-v2",dimensions:{evidenceQuality:{knownEvidenceMatch:95,calibratedMatchScore:95}},createdAt:timestamp,updatedAt:timestamp});
    const persisted=f.store.analyses.findById("legacy-analysis");
    assert.equal(persisted.analysisStatus,"LEGACY");assert.equal(persisted.calibratedMatchScore,null);assert.equal(persisted.knownEvidenceMatch,null);assert.equal(persisted.historicalOverallScore,95);
  }finally{await f.close();}
});

test("Opportunity Priority V2 mantém match técnico separado e versão explícita",()=>{
  const priority=calculateOpportunityPriority({job:job(),analysis:analysis(),requirements,items});
  assert.equal(priority.technicalMatch,88);assert.equal(priority.algorithmVersion,"opportunity-priority-v2.2");assert.equal(priority.components.listingQuality,priority.components.quality);assert.ok(priority.components.confidence>50);
});

test("vaga recente supera vaga antiga equivalente",()=>{
  const recent=calculateOpportunityPriority({job:job(),analysis:analysis(),requirements,items}),old=calculateOpportunityPriority({job:job("old",{datePosted:date(45)}),analysis:analysis(),requirements,items});
  assert.ok(recent.components.freshness>old.components.freshness);assert.ok(recent.score>old.score);
});

test("feedback altera preferência de modo determinístico sem alterar match",()=>{
  const input={job:job(),analysis:analysis(),requirements,items},neutral=calculateOpportunityPriority(input),interested=calculateOpportunityPriority({...input,feedback:{verdict:"INTERESTED"}}),rejected=calculateOpportunityPriority({...input,feedback:{verdict:"NOT_FOR_ME",reasons:["STACK"]}});
  assert.equal(neutral.components.preferenceFit,50);assert.equal(interested.technicalMatch,rejected.technicalMatch);assert.ok(interested.score>neutral.score);assert.ok(rejected.score<neutral.score);assert.match(rejected.reasons.join(" "),/stack/i);
});

test("modelo de trabalho presente não cria preferência positiva sem declaração",()=>{
  const priority=calculateOpportunityPriority({job:job(),analysis:analysis(),requirements,items,profile:{}});
  assert.equal(priority.components.preferenceFit,50);assert.match(priority.reasons.join(" "),/insuficientes/i);
});

test("candidatura, notificação, qualidade e desconhecidos afetam componentes esperados",()=>{
  const base={job:job(),analysis:analysis(),requirements,items},clean=calculateOpportunityPriority(base),penalized=calculateOpportunityPriority({...base,application:{id:"app-1"},notified:true}),weak=calculateOpportunityPriority({job:job("weak",{description:"Curta",company:""}),analysis:analysis(88,{unknownRequirements:[{id:"u1"},{id:"u2"}]}),requirements:[],items:[{status:"UNKNOWN"}]});
  assert.ok(penalized.components.penalties>clean.components.penalties);assert.ok(penalized.score<clean.score);assert.ok(clean.components.listingQuality>weak.components.listingQuality);assert.ok(clean.components.confidence>weak.components.confidence);
});

test("Decision Inbox limita oportunidades, não expõe prioridade interna e respeita dispensa",async()=>{
  const f=await fixture();try{
    const opportunities=Array.from({length:7},(_,index)=>({job:job(`job-${index}`),analysis:analysis(),feedback:null,priority:{score:90-index,technicalMatch:88,components:{confidence:80},reasons:["Publicada hoje."]},decision:{disposition:"RECOMMENDED",visibility:{today:true},reasons:["Aderência suficiente."]}}));
    const service=new DecisionInboxService({store:f.store,opportunityService:{list:async()=>opportunities}}),first=await service.build();
    const opportunityItems=first.items.filter(item=>item.category==="OPPORTUNITIES");assert.equal(opportunityItems.length,5);assert.equal(first.hasMoreOpportunities,true);assert.ok(opportunityItems.every(item=>!Object.hasOwn(item,"priority")&&Object.hasOwn(item,"inboxPriority")));
    f.store.decisionDismissals.dismiss(opportunityItems[0].key,"USER_DISMISSED_FROM_INBOX");assert.equal((await service.build()).items.some(item=>item.key===opportunityItems[0].key),false);
  }finally{await f.close();}
});

test("dispensa da triagem vale somente para o dia em que foi registrada",async()=>{
  const f=await fixture();try{
    f.store.decisionDismissals.dismiss("daily:item","USER_DISMISSED_FROM_INBOX");
    const today=new Date();today.setHours(0,0,0,0);
    assert.equal(f.store.decisionDismissals.keys({since:today.toISOString()}).has("daily:item"),true);
    f.store.database.connection.prepare("UPDATE decision_inbox_dismissals SET dismissed_at=? WHERE item_key=?").run(date(2),"daily:item");
    assert.equal(f.store.decisionDismissals.keys({since:today.toISOString()}).has("daily:item"),false);
    assert.equal(f.store.decisionDismissals.keys().has("daily:item"),true);
  }finally{await f.close();}
});

test("Decision Inbox exclui vaga antiga comum e NOT_FOR_ME, mas mantém interesse explícito",async()=>{
  const f=await fixture();try{
    const make=(id,days,feedback=null,score=75)=>({job:job(id,{datePosted:date(days)}),analysis:analysis(),feedback,priority:{score,technicalMatch:80,components:{confidence:75},reasons:[`Publicada há ${days} dia(s).`]},decision:{disposition:id==="yes"?"REVIEW":"SKIP",visibility:{today:id==="yes"},reasons:[id==="yes"?"Interesse explícito para revisão.":"Fora da caixa de hoje."]}});
    const service=new DecisionInboxService({store:f.store,opportunityService:{list:async()=>[make("old",60),make("no",1,{verdict:"NOT_FOR_ME"},95),make("yes",60,{verdict:"INTERESTED"},80)]}}),ids=(await service.build()).items.filter(item=>item.opportunity).map(item=>item.opportunity.job.id);
    assert.deepEqual(ids,["yes"]);
  }finally{await f.close();}
});

test("UTF-8 faz roundtrip em fatos e feedback sem alterar bytes lógicos",async()=>{
  const f=await fixture();try{f.store.jobs.upsert(job());const phrase="currículo com aderência, atenção, publicação, ç e ã";f.store.candidateFacts.save({key:"PREFERENCE.UTF8",value:phrase,classification:"PREFERENCE"});f.store.jobFeedback.save("job-1",{verdict:"INTERESTED",note:phrase});assert.equal(f.store.candidateFacts.find("PREFERENCE.UTF8").value,phrase);assert.equal(f.store.jobFeedback.forJob("job-1").note,phrase);}finally{await f.close();}
});

test("fato e resposta sensíveis nunca se tornam reutilizáveis",async()=>{
  const f=await fixture();try{const fact=f.store.candidateFacts.save({key:"PERSONAL.DOCUMENT",value:"123",classification:"SENSITIVE",reusable:true});assert.equal(fact.reusable,false);const question={fingerprint:"sensitive-answer",semanticKey:"PERSONAL.DOCUMENT",normalizedQuestion:"Documento",fieldType:"text",answerCategory:"FACT",sensitive:true};f.store.candidateAnswers.saveConfirmed(question,"123",{reusable:true});assert.equal(f.store.candidateAnswers.updateConfirmed(question.fingerprint,{value:"456",reusable:true}).reusable,false);}finally{await f.close();}
});
