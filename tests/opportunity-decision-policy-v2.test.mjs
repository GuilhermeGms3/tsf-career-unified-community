import assert from "node:assert/strict";
import test from "node:test";
import {PreMatchPlausibility} from "../src/discovery/relevance/pre-match-plausibility.mjs";
import {evaluateOpportunityDecision,classifyFamilyFit,classifyRequirementGap} from "../src/opportunities/opportunity-decision-policy-v2.mjs";
import {DecisionInboxService} from "../src/product/decision-inbox-service.mjs";
import {OpportunityService} from "../src/opportunities/opportunity-service.mjs";
import {extractJobRequirements} from "../src/matching/job-requirement-extractor.mjs";
import {serializePreMatchDecision} from "../src/discovery/relevance/pre-match-snapshot.mjs";
import {CURRENT_MATCHER_VERSION,CURRENT_REQUIREMENT_EXTRACTOR_VERSION,CURRENT_SCORING_MODEL_VERSION} from "../src/matching/analysis-version.mjs";

const now=new Date("2026-08-24T12:00:00Z"),intent={version:7,families:["BACKEND","DEVOPS_SRE","SOFTWARE_INTERNSHIP"],seniorities:["INTERNSHIP","JUNIOR"],locationPolicy:{priorities:[{priority:1,location:"Brasil",workModel:"REMOTE",remoteScope:"Brasil",accepted:true}]}};
const policy=[{id:"p1",enabled:true,jobFamilies:intent.families,considerThreshold:70,prepareResumeThreshold:82}];
const baseJob=(overrides={})=>({id:"job-1",title:"Junior Backend Developer",description:"Python, APIs e Git.",location:"Brasil, remoto",workModel:"REMOTE",lifecycleStatus:"OPEN",datePosted:"2026-08-23",...overrides});
const analysis=(score=68,overrides={})=>({id:"a1",overallScore:score,calibratedMatchScore:score,matcherVersion:CURRENT_MATCHER_VERSION,scoringModelVersion:CURRENT_SCORING_MODEL_VERSION,requirementExtractorVersion:CURRENT_REQUIREMENT_EXTRACTOR_VERSION,matchConfidence:54,evidenceCoverage:54,eligibility:"ELIGIBLE",blockingIssues:[],algorithmVersion:"ats-matcher-v2",...overrides});
const evaluate=(job=baseJob(),extra={})=>{const preMatch=new PreMatchPlausibility({now:()=>now}).evaluate(job,intent);return evaluateOpportunityDecision({job,preMatch,analysis:analysis(),priority:{technicalMatch:68,score:68,components:{confidence:54},algorithmVersion:"opportunity-priority-v2"},policies:policy,intent,items:[],...extra},{now});};

test("classificação de família reutiliza o pre-match já calculado",()=>{
  const preMatch={primaryJobFamily:"BACKEND",secondaryJobFamilies:[],negativeOccupationalEvidence:[]};
  const job=new Proxy({}, {get(){throw new Error("não deve reler a vaga");}});
  assert.equal(classifyFamilyFit({job,preMatch,intent,policies:policy}).level,"EXACT_PRIMARY");
});

test("ranking e decisão reutilizam geografia, senioridade, tipo e frescor do pre-match",()=>{
  const job=baseJob({location:"Toronto, Canada"}),preMatch={
    primaryJobFamily:"BACKEND",secondaryJobFamilies:[],negativeOccupationalEvidence:[],
    seniority:"JUNIOR",opportunityType:"JOB",freshness:{stale:false},
    geography:{accepted:true,unknown:false,geographicMatch:{status:"MATCH",reasonCodes:["REMOTE_BRAZIL_MATCH"]},workModelMatch:{status:"MATCH"}},
  };
  const decision=evaluateOpportunityDecision({job,preMatch,analysis:analysis(80),priority:{technicalMatch:80,components:{confidence:80}},policies:policy,intent,items:[]},{now});
  assert.notEqual(decision.disposition,"BLOCKED");
  assert.equal(decision.hardBlockers.includes("FOREIGN_LOCATION"),false);
});

test("P0: ocupações negativas, geografia estrangeira e anúncio histórico nunca viram recomendação",()=>{
  for(const job of [
    baseJob({title:"Recruitment Assistant",company:"Lima",description:"Recruiting and human resources"}),
    baseJob({title:"Business Development Representative",location:"Ontario, Canada",description:"Sales and business development"}),
    baseJob({title:"Edital 080/2021 - Tecnologia",description:"Edital público 080/2021 para cadastro",firstSeenAt:"2026-08-24"}),
    baseJob({title:"Técnico de Laboratório",description:"Coleta de amostras e análises clínicas"}),
  ]) assert.equal(evaluate(job).visibility.recommended,false);
});

test("P0: automação de software é entendida pelo contexto, não rejeitada pelo título",()=>{
  const decision=evaluate(baseJob({title:"Programador de Automação",description:"Python, APIs, Git, integrações, automação de sistemas e backend."}));
  assert.notEqual(decision.disposition,"BLOCKED");
});

test("P0: scores 68/54/54 e lacunas desejáveis permanecem visíveis para revisão ou stretch",()=>{
  const items=["terraform","kubernetes"].map((name,index)=>({status:"UNKNOWN",requirement:{id:`r${index}`,type:"tool",normalizedName:name,importance:"preferred",required:false}}));
  const decision=evaluate(baseJob({title:"Junior DevOps Engineer",description:"Terraform, Kubernetes, CI/CD e observabilidade."}),{items});
  assert.ok(["REVIEW","STRETCH"].includes(decision.disposition));
  assert.equal(decision.visibility.discovery,true);
  assert.equal(decision.gapSummary.counts.LEARNABLE_GAP,2);
});

test("P0: família secundária BACKEND e estágio de software resgatam alinhamento defensável",()=>{
  const secondary=evaluate(baseJob({title:"Full Stack Developer"}),{preMatch:{primaryJobFamily:"FULLSTACK",secondaryJobFamilies:["BACKEND"],seniority:"JUNIOR",freshness:{stale:false},reasons:[],algorithmVersion:"fixture"}});
  assert.notEqual(secondary.disposition,"BLOCKED");
  assert.equal(secondary.familyFit.level,"EXACT_SECONDARY");
  const internship=evaluate(baseJob({title:"Software Engineer Intern",description:"Backend APIs, Docker and CI/CD."}));
  assert.notEqual(internship.disposition,"BLOCKED");
});

test("P0: Senior SRE com 8+ anos é bloqueado",()=>{
  const decision=evaluate(baseJob({title:"Senior Site Reliability Engineer",description:"Requires 8+ years with Kubernetes and Terraform."}));
  assert.equal(decision.disposition,"BLOCKED");
  assert.ok(decision.hardBlockers.includes("SENIORITY_MISMATCH"));
});

test("P0: catálogo de transferibilidade preserva semântica e não cria equivalência falsa",()=>{
  const gap=(required,evidence)=>classifyRequirementGap({status:"UNKNOWN",requirement:{type:"tool",normalizedName:required,importance:"preferred",required:false},evidence:[{text:evidence}]});
  assert.equal(gap("ci-cd","Usei GitHub Actions em produção").status,"TRANSFERABLE");
  assert.equal(gap("azure","Experiência com AWS").status,"TRANSFERABLE");
  assert.equal(gap("terraform","Experiência com Ansible").status,"LEARNABLE_GAP");
  assert.equal(gap("kubernetes","Experiência com Docker").status,"LEARNABLE_GAP");
});

test("P0: 7 matches, 1 transferível e 2 lacunas desejáveis não causam SKIP",()=>{
  const items=[...Array.from({length:7},(_,index)=>({status:"MATCH",requirement:{type:"tool",normalizedName:`skill-${index}`,required:true}})),{status:"UNKNOWN",requirement:{type:"tool",normalizedName:"ci-cd",required:true},evidence:[{text:"GitHub Actions"}]},{status:"UNKNOWN",requirement:{type:"tool",normalizedName:"terraform",importance:"preferred"}},{status:"UNKNOWN",requirement:{type:"tool",normalizedName:"kubernetes",importance:"preferred"}}];
  const decision=evaluate(baseJob({title:"Junior DevOps Engineer"}),{items});
  assert.notEqual(decision.disposition,"SKIP");
  assert.equal(decision.gapSummary.counts.MATCHED,7);
  assert.equal(decision.gapSummary.counts.TRANSFERABLE,1);
  assert.equal(decision.gapSummary.counts.LEARNABLE_GAP,2);
});

test("P0: INTERESTED torna um SKIP visível para revisão, sem habilitar preparo",()=>{
  const decision=evaluate(baseJob(),{analysis:analysis(20),priority:{technicalMatch:20,score:20,components:{confidence:80}},feedback:{verdict:"INTERESTED"}});
  assert.equal(decision.disposition,"REVIEW");
  assert.equal(decision.visibility.humanReview,true);
  assert.equal(decision.visibility.prepareEligible,false);
});

test("P0 Today: REJECT de localização vence score 95 e confiança 100",async()=>{
  const candidate={job:baseJob(),analysis:analysis(95),priority:{score:95,technicalMatch:95,components:{confidence:100}},decision:{disposition:"BLOCKED",visibility:{today:false},reasons:["LOCATION_MISMATCH"]}};
  const store={decisionDismissals:{keys:()=>new Set()},applications:{all:()=>[]},resumeVersions:{list:()=>[]},jobAlerts:{list:()=>[]},providerHealth:{latestAll:()=>[]},whatsappConnection:{get:()=>null}};
  const inbox=await new DecisionInboxService({store,opportunityService:{list:async()=>[candidate]}}).build();
  assert.equal(inbox.items.some(item=>item.opportunity),false);
});

test("Today usa explicação humana e preserva códigos técnicos da decisão",async()=>{
  const cases=[
    ["prepare","PREPARE_ELIGIBLE","PREPARE_THRESHOLD_MET","Aderência e evidências permitem preparar um currículo para revisão humana."],
    ["stretch","STRETCH","MATERIAL_GAP_PRESENT","Vale considerar, mas há um requisito importante sem evidência suficiente."],
    ["review","REVIEW","LOW_CONFIDENCE","A oportunidade é plausível, mas precisa de revisão."],
    ["blocked","BLOCKED","LOCATION_MISMATCH","Não é compatível com a política atual."],
    ["unknown","REVIEW","SOME_NEW_INTERNAL_REASON",""],
  ];
  const opportunities=cases.map(([id,disposition,reason,summary])=>({job:{...baseJob(),id:`job-${id}`,title:id},analysis:analysis(80),priority:{score:80,technicalMatch:80,components:{confidence:80}},decision:{disposition,visibility:{today:true},reasons:[reason],decisionExplanation:{primaryReasonCode:reason,summary}}}));
  const store={decisionDismissals:{keys:()=>new Set()},applications:{all:()=>[]},resumeVersions:{list:()=>[]},jobAlerts:{list:()=>[]},providerHealth:{latestAll:()=>[]},whatsappConnection:{get:()=>null}};
  const inbox=await new DecisionInboxService({store,opportunityService:{list:async()=>opportunities}}).build();
  for(const [id,disposition,,summary] of cases){const item=inbox.items.find(value=>value.key===`opportunity:job-${id}`);if(disposition==="BLOCKED"){assert.equal(item,undefined);continue;}assert.ok(item);assert.equal(item.why[0],summary||"Abra a oportunidade para revisar os critérios e evidências.");assert.doesNotMatch(item.why[0],/^[A-Z][A-Z0-9_]+$/);}
  assert.deepEqual(opportunities.map(item=>item.decision.reasons[0]),cases.map(item=>item[2]));
});

test("P0 OpportunityService escolhe PreMatch mais recente independentemente da ordem",async()=>{
  const runs=[{id:"new",status:"COMPLETED",completedAt:"2026-08-24",report:{preMatchDecisions:[{jobId:"job-1",decision:"REJECT",reasons:["LOCATION_MISMATCH"]}]}},{id:"old",status:"COMPLETED",completedAt:"2026-08-20",report:{preMatchDecisions:[{jobId:"job-1",decision:"PASS",reasons:[]}]}}];
  const store={analyses:{all:()=>[]},applications:{all:()=>[]},jobFeedback:{all:()=>[]},jobAlerts:{list:()=>[]},jobHuntProfiles:{all:()=>[]},jobHuntRuns:{list:()=>runs},jobs:{all:()=>[baseJob()]},jobRequirements:{forJob:()=>[]},analysisItems:{forAnalysis:()=>[]}};
  const [result]=await new OpportunityService({store,profileProvider:async()=>({})}).list();
  assert.equal(result.preMatch.decision,"REJECT");
  assert.ok(result.decision.hardBlockers.includes("LOCATION_MISMATCH"));
});

test("P0 OpportunityService reutiliza projeção e reconstrói após mutação relevante",async()=>{
  const feedback=[],job={...baseJob(),updatedAt:"2026-08-24T10:00:00Z",createdAt:"2026-08-24T10:00:00Z"},store={analyses:{all:()=>[]},applications:{all:()=>[]},jobFeedback:{all:()=>feedback,forJob:id=>feedback.find(item=>item.jobId===id)||null},jobAlerts:{list:()=>[]},jobHuntProfiles:{all:()=>[]},jobHuntRuns:{list:()=>[]},jobs:{all:()=>[job]},jobRequirements:{forJob:()=>[]},analysisItems:{forAnalysis:()=>[]},candidateFacts:{active:()=>[]}},service=new OpportunityService({store,profileProvider:async()=>({})});
  const first=await service.list(),second=await service.list();
  assert.equal(first,second);
  assert.equal(service.projectionBuildCount,1);
  feedback.push({jobId:job.id,verdict:"INTERESTED",updatedAt:"2026-08-24T11:00:00Z"});
  const third=await service.list();
  assert.notEqual(third,second);
  assert.equal(service.projectionBuildCount,2);
});

test("P0: Ontario sem PreMatch é bloqueada pela geografia canônica",()=>{
  const job=baseJob({title:"Backend Developer",location:"Remote Ontario, Canada",description:"Backend APIs",workModel:"REMOTE"});
  const decision=evaluateOpportunityDecision({job,analysis:analysis(95),priority:{technicalMatch:95,score:95,components:{confidence:100}},policies:policy,intent,items:[]},{now});
  assert.equal(decision.disposition,"BLOCKED");
  assert.ok(decision.hardBlockers.includes("FOREIGN_LOCATION"));
  assert.equal(decision.visibility.today,false);
});

test("P0: recrutamento e laboratório sem PreMatch usam evidência ocupacional negativa",()=>{
  for(const job of [baseJob({title:"Recruitment Assistant",description:"Human resources and recruiting"}),baseJob({title:"Técnico de Laboratório",description:"Coleta de amostras e análises clínicas"})]){
    const decision=evaluateOpportunityDecision({job,analysis:analysis(80),priority:{technicalMatch:80,components:{confidence:80}},policies:policy,intent,items:[]},{now});
    assert.equal(decision.disposition,"BLOCKED");
    assert.ok(decision.hardBlockers.includes("ROLE_FAMILY_MISMATCH"));
    assert.equal(decision.visibility.today,false);
  }
});

test("P0: snapshot PreMatch preserva diagnóstico e proveniência em roundtrip",()=>{
  const roundtripJob=baseJob({title:"Full Stack Developer",description:"Backend, API REST, FastAPI and Spring Boot services."});
  const evaluated=new PreMatchPlausibility({now:()=>now}).evaluate(roundtripJob,intent);
  const snapshot=serializePreMatchDecision(evaluated,{jobId:"job-1",profileId:"profile-backend",searchIntentId:"intent-1",searchIntentVersion:7,jobHuntRunId:"run-1"});
  const reloaded=JSON.parse(JSON.stringify(snapshot));
  assert.ok(reloaded.secondaryJobFamilies.includes("BACKEND"));
  assert.deepEqual(reloaded.negativeOccupationalEvidence,evaluated.negativeOccupationalEvidence);
  assert.equal(reloaded.profileId,"profile-backend");
  const decision=evaluateOpportunityDecision({job:roundtripJob,preMatch:reloaded,analysis:analysis(80),priority:{technicalMatch:80,components:{confidence:80}},policies:policy,intent,items:[]},{now});
  assert.equal(decision.familyFit.level,"EXACT_SECONDARY");
});

test("P0: análise legada BLOCKED não cria ação de atualização no Today",async()=>{
  const candidate={job:baseJob(),analysis:{...analysis(95),algorithmVersion:"legacy-v1"},priority:{score:95},decision:{disposition:"BLOCKED",hardBlockers:["LOCATION_MISMATCH"],visibility:{today:false},reasons:["LOCATION_MISMATCH"]}};
  const store={decisionDismissals:{keys:()=>new Set()},applications:{all:()=>[]},resumeVersions:{list:()=>[]},jobAlerts:{list:()=>[]},providerHealth:{latestAll:()=>[]},whatsappConnection:{get:()=>null}};
  const inbox=await new DecisionInboxService({store,opportunityService:{list:async()=>[candidate]}}).build();
  assert.equal(inbox.items.some(item=>item.key.startsWith("legacy-analysis:")),false);
});

test("P0: anos de experiência respeitam criticidade do requisito",()=>{
  const preferred=extractJobRequirements(baseJob({description:"5 years of experience preferred."})).find(item=>item.type==="experience_years");
  const required=extractJobRequirements(baseJob({description:"5+ years of experience required."})).find(item=>item.type==="experience_years");
  assert.equal(preferred.importance,"preferred");
  assert.equal(classifyRequirementGap({status:"NO_MATCH",requirement:preferred}).status,"NON_MATERIAL_GAP");
  assert.equal(required.importance,"required");
  assert.equal(classifyRequirementGap({status:"NO_MATCH",requirement:required}).status,"BLOCKING_GAP");
  const contextual=evaluate(baseJob({description:"Our team has 5 years of experience building APIs."}));
  assert.equal(contextual.hardBlockers.some(item=>item.includes("YEARS")),false);
});

test("P0: Kubernetes desejável é aprendível e produção obrigatória é material",()=>{
  const preferred=classifyRequirementGap({status:"UNKNOWN",requirement:{type:"platform",normalizedName:"kubernetes",importance:"preferred",required:false,originalText:"Kubernetes is a plus"}});
  const required=classifyRequirementGap({status:"UNKNOWN",requirement:{type:"platform",normalizedName:"kubernetes",importance:"required",required:true,originalText:"Advanced production Kubernetes administration required"}});
  assert.equal(preferred.status,"LEARNABLE_GAP");
  assert.equal(required.status,"MATERIAL_GAP");
});

test("P0: threshold configurado não recua para o default",()=>{
  const strict=[{...policy[0],considerThreshold:85}];
  const decision=evaluateOpportunityDecision({job:baseJob(),preMatch:new PreMatchPlausibility({now:()=>now}).evaluate(baseJob(),intent),analysis:analysis(75,{matchConfidence:80,evidenceCoverage:80}),priority:{technicalMatch:75,components:{confidence:80}},policies:strict,intent,items:[]},{now});
  assert.equal(decision.thresholds.considerThreshold,85);
  assert.equal(decision.disposition,"REVIEW");
  assert.equal(decision.visibility.recommended,false);
});

test("P0: perfil de origem impede contaminação por outra família",async()=>{
  const backend={id:"backend",enabled:true,jobFamilies:["BACKEND"],considerThreshold:70,locationPolicy:intent.locationPolicy},data={id:"data",enabled:true,jobFamilies:["DATA"],considerThreshold:70,locationPolicy:intent.locationPolicy};
  const runs=[{id:"run-backend",profileId:"backend",status:"COMPLETED",completedAt:"2026-08-24",report:{preMatchDecisions:[serializePreMatchDecision({decision:"PASS",reasons:[],primaryJobFamily:"DATA",secondaryJobFamilies:[],negativeOccupationalEvidence:[],freshness:{stale:false},seniority:"JUNIOR",algorithmVersion:"fixture"},{jobId:"job-1",profileId:"backend",searchIntentId:"intent-backend",searchIntentVersion:7,jobHuntRunId:"run-backend"})]}}];
  const store={analyses:{all:()=>[analysis(80)]},applications:{all:()=>[]},jobFeedback:{all:()=>[]},jobAlerts:{list:()=>[]},jobHuntProfiles:{all:()=>[backend,data]},searchIntents:{forProfile:id=>({id:`intent-${id}`,profileId:id,version:7,originalIntent:{jobFamilies:id==="backend"?["BACKEND"]:["DATA"]},locationPolicy:intent.locationPolicy})},jobHuntRuns:{list:()=>runs},jobs:{all:()=>[baseJob({title:"Data Engineer"})]},jobRequirements:{forJob:()=>[]},analysisItems:{forAnalysis:()=>[]}};
  const [result]=await new OpportunityService({store,profileProvider:async()=>({})}).list();
  assert.equal(result.decision.contextProvenance.profileId,"backend");
  assert.equal(result.decision.contextProvenance.usedFallback,false);
  assert.equal(result.decision.familyFit.requested.includes("DATA"),false);
  assert.equal(result.decision.disposition,"BLOCKED");
});
