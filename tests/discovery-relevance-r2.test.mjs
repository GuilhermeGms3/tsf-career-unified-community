import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PreMatchPlausibility } from "../src/discovery/relevance/pre-match-plausibility.mjs";
import { SearchIntentService } from "../src/discovery/search-intent/search-intent-service.mjs";
import { JobHuntService } from "../src/automation/job-hunt-service.mjs";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { SourceResolver } from "../src/discovery/source-resolver.mjs";
import { benchmark, fixture, legacyDecision } from "../scripts/discovery-relevance-benchmark.mjs";

const intent=fixture.intent;
const preMatch=new PreMatchPlausibility({now:()=>new Date("2026-08-23T12:00:00Z")});

test("replay R1/R2 classifica casos críticos e preserva bons exemplos",()=>{
  for(const item of fixture.items){
    const result=preMatch.evaluate(item,intent);
    const expected=item.expectedLabel.startsWith("IRRELEVANT_")||item.expectedLabel==="STALE"?"REJECT":item.expectedReason==="PASS_WITH_WARNINGS"?"PASS_WITH_WARNINGS":item.expectedLabel==="NEEDS_REVIEW"||item.expectedLabel==="INSUFFICIENT_INFORMATION"?"REVIEW":item.id==="r1-automation"?"PASS_WITH_WARNINGS":"PASS";
    assert.equal(result.decision,expected,`${item.id}: ${result.reasons.join(",")}`);
    if(item.expectedReason!=="PASS"&&item.expectedReason!=="PASS_WITH_WARNINGS")assert.ok(result.reasons.includes(item.expectedReason),item.id);
  }
});

test("replay melhora precisão e ranking sem reduzir recall",()=>{
  const before=benchmark(fixture.items,legacyDecision),after=benchmark(fixture.items,(job)=>preMatch.evaluate(job,intent));
  assert.equal(before.metrics.precisionAt5,0.4);
  assert.equal(after.metrics.precisionAt5,1);
  assert.ok(after.metrics.ndcgAt10>before.metrics.ndcgAt10);
  assert.ok(after.metrics.recall>=before.metrics.recall);
  assert.equal(after.metrics.falsePositiveRate,0);
});

test("skill overlap não converte profissão incompatível em vaga de tecnologia",()=>{
  const result=preMatch.evaluate({title:"Estágio em Contabilidade",description:"Conciliação contábil; Python automatiza planilhas",location:"Brasília, DF",workModel:"ONSITE",lifecycleStatus:"OPEN"},intent);
  assert.equal(result.decision,"REJECT");
  assert.ok(result.reasons.includes("ROLE_FAMILY_MISMATCH"));
});

test("shadow regressions rejeitam SDR de software e estágio onsite fora da área",()=>{
  const sdr=preMatch.evaluate({title:"Analista Comercial (SDR) - Estágio",company:"Software Ltda",description:"Venda consultiva de plataforma SaaS e contato com clientes",location:"São Paulo, SP, BR",lifecycleStatus:"OPEN"},intent),us=preMatch.evaluate({title:"SQL Database Administrator Intern",description:"Database internship",location:"Chattanooga, TN",workModel:"REMOTE",lifecycleStatus:"OPEN"},intent);
  assert.ok(sdr.reasons.includes("ROLE_FAMILY_MISMATCH"));
  assert.ok(us.reasons.includes("FOREIGN_LOCATION"));
});

test("palavra worldwide fora de contexto remoto não supera restrição US only",()=>{
  const result=preMatch.evaluate({title:"Database Administrator Intern",location:"Chattanooga, TN",workModel:"REMOTE",description:"Payments worldwide. Remote capabilities; candidate must reside in the US.",lifecycleStatus:"OPEN"},intent);
  assert.ok(result.reasons.includes("FOREIGN_LOCATION"));
});

test("localizações US/Canadá compactas e cargo comercial são rejeitados",()=>{
  const us=preMatch.evaluate({title:"Automation Engineer",location:"Remote, US",workModel:"REMOTE",description:"Python APIs Git",lifecycleStatus:"OPEN"},intent),canada=preMatch.evaluate({title:"Client Success Director",location:"Remote, Ontario",workModel:"REMOTE",description:"Technology accounts",lifecycleStatus:"OPEN"},intent);
  assert.ok(us.reasons.includes("FOREIGN_LOCATION"));
  assert.ok(canada.reasons.includes("FOREIGN_LOCATION"));
  assert.ok(canada.reasons.includes("ROLE_FAMILY_MISMATCH"));
});

test("remote-first com deslocamento obrigatório ao hub não passa como remoto nacional",()=>{
  const result=preMatch.evaluate({title:"Junior Backend Engineer",location:"São Paulo, BR",workModel:"REMOTE_FIRST",description:"This is a remote-first role, but candidates must be within commuting distance of our São Paulo hub.",lifecycleStatus:"OPEN"},intent);
  assert.equal(result.workModel,"HYBRID");
  assert.ok(result.reasons.includes("OUTSIDE_ACCEPTED_REGION"));
});

test("queries amplas ficam abaixo das taxonômicas e carregam tier",()=>{
  const result=new SearchIntentService().preview({families:["BACKEND"],customTerms:["analista"],seniorities:["JUNIOR"],locationPolicy:intent.locationPolicy},{maxQueries:30,maxRequests:30});
  assert.equal(result.queries[0].tier,"TIER_1");
  assert.ok(result.queries.some(item=>item.query==="analista"&&item.tier==="TIER_3"));
  assert.ok(result.queries.some(item=>item.query.includes("analista")&&item.tier==="TIER_2"));
});

test("migration 016 é aditiva, cria tier e não contém segredo",async()=>{
  const sql=await readFile(new URL("../db/migrations/016_discovery_relevance_r2.sql",import.meta.url),"utf8");
  assert.match(sql,/ADD COLUMN query_tier/);
  assert.doesNotMatch(sql,/api[_-]?key|password|secret_value|token_value/i);
});

test("REJECT permanece persistido no run e não chama Matcher V2",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"career-r2-")),store=await new UnifiedStateStore({dataDir:dir}).initialize();
  try{
    const createdAt="2026-08-23T12:00:00.000Z",job=store.jobs.upsert({id:"job-vet",externalId:"fixture:vet",source:"fixture",provider:"fixture",providerJobId:"vet",canonicalKey:"fixture:vet",title:"Médico Veterinário Junior",company:"Clínica",description:"Python como diferencial",location:"Brasil - Remoto",workModel:"REMOTE",lifecycleStatus:"OPEN",url:"https://example.test/vet",contentHash:"vet",createdAt,updatedAt:createdAt});
    let matcherCalls=0;
    const service=new JobHuntService({store,discoveryService:{discover:async()=>({run:{id:"discovery-r2"},jobs:[job],discoveredCount:1,newCount:0,duplicateCount:0,closedCount:0,sourceReports:[],ok:true})},matcher:()=>{matcherCalls++;return null;},profileProvider:async()=>({})});
    const profile=service.saveProfile({name:"R2",jobFamilies:["BACKEND"],queries:["backend"],seniorities:["JUNIOR"],providers:["fixture"],workModels:["REMOTE"],locationPolicy:intent.locationPolicy,queryBudget:{maxQueries:1,maxRequests:1}});
    const run=await service.run(profile.id);
    assert.equal(matcherCalls,0);
    assert.equal(store.jobs.findById(job.id).id,job.id);
    assert.equal(run.report.preMatchDecisions[0].decision,"REJECT");
    assert.ok(run.report.preMatchDecisions[0].reasons.includes("ROLE_FAMILY_MISMATCH"));
    assert.equal(run.report.funnel.matchEvaluated,0);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test("ATS estruturado é consultado uma vez por target e preserva query provenance",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"career-r2-routing-")),store=await new UnifiedStateStore({dataDir:dir}).initialize();
  try{
    const createdAt="2026-08-23T12:00:00.000Z",job=store.jobs.upsert({id:"job-ats-vet",externalId:"ashby:vet",source:"ashby",provider:"ashby",providerJobId:"vet",canonicalKey:"ashby:vet",title:"Médico Veterinário Junior",company:"Clínica",description:"Python como diferencial",location:"Brasil - Remoto",workModel:"REMOTE",lifecycleStatus:"OPEN",url:"https://example.test/vet",contentHash:"vet",provenance:{discoveryQuery:{source:"ATS_BOARD_LIST",query:"backend",tier:"TIER_1"}},createdAt,updatedAt:createdAt});
    const calls=[],service=new JobHuntService({store,discoveryService:{discover:async input=>{calls.push(input);return {run:{id:"d"},jobs:[job],discoveredCount:1,newCount:0,duplicateCount:0,closedCount:0,sourceReports:[],ok:true};}},matcher:()=>null,profileProvider:async()=>({})});
    const profile=service.saveProfile({name:"ATS",jobFamilies:["BACKEND"],queries:["backend","java"],seniorities:["JUNIOR"],providers:["ashby"],locations:["Brasil"],queryBudget:{maxQueries:5,maxRequests:10}});
    service.transientProviderTargets.set(profile.id,[{provider:"ashby",organizationKey:"acme"}]);
    const run=await service.run(profile.id);
    assert.equal(calls.length,1);
    assert.ok(calls[0].queryProvenance.tier);
    assert.equal(calls[0].queryProvenance.source,"ATS_BOARD_LIST");
    assert.equal(calls[0].queryProvenance.query,"");
    assert.ok(run.report.expandedQueryDetails.every(item=>item.tier));
    assert.equal(run.report.preMatchDecisions[0].queryProvenance.query,"");
    assert.deepEqual(run.report.queryDiagnostics,[]);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test("funil soma revisão do PreMatch em needsReview",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"career-r2-review-")),store=await new UnifiedStateStore({dataDir:dir}).initialize();
  try{
    const createdAt="2026-08-23T12:00:00.000Z",job=store.jobs.upsert({id:"job-review",externalId:"fixture:review",source:"fixture",provider:"fixture",providerJobId:"review",canonicalKey:"fixture:review",title:"Banco de Talentos Backend Developer Junior",company:"Acme",description:"Banco de talentos para desenvolvimento Node.js e APIs",location:"Brasil - Remoto",workModel:"REMOTE",lifecycleStatus:"OPEN",url:"https://example.test/review",contentHash:"review",createdAt,updatedAt:createdAt});
    const matcher=({job:matchedJob})=>({id:`analysis-${matchedJob.id}`,jobId:matchedJob.id,resumeId:null,score:10,overallScore:10,evidenceCoverage:100,matchConfidence:100,eligibility:"ELIGIBLE",blockingIssues:[],warnings:[],unknownRequirements:[],requirements:[],items:[],candidateEvidence:[],dimensions:{},resumeParseability:{status:"NOT_EVALUATED"},matched:[],missing:[],suggestions:[],algorithmVersion:"test",createdAt,updatedAt:createdAt});
    const service=new JobHuntService({store,discoveryService:{discover:async()=>({run:{id:"d-review"},jobs:[job],discoveredCount:1,newCount:0,duplicateCount:0,closedCount:0,sourceReports:[],ok:true})},matcher,profileProvider:async()=>({})});
    const profile=service.saveProfile({name:"Review",jobFamilies:["BACKEND"],queries:["backend"],seniorities:["JUNIOR"],providers:["fixture"],workModels:["REMOTE"],locationPolicy:intent.locationPolicy,queryBudget:{maxQueries:1,maxRequests:1}});
    const run=await service.run(profile.id);
    assert.equal(run.report.preMatchDecisions[0].decision,"REVIEW");
    assert.equal(run.report.funnel.needsReview,1);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test("Ashby application URL preserva UUID da vaga e não colapsa o board",()=>{
  const resolver=new SourceResolver(),first=resolver.resolve("https://jobs.ashbyhq.com/telus-digital/11111111-1111-4111-8111-111111111111/application"),second=resolver.resolve("https://jobs.ashbyhq.com/telus-digital/22222222-2222-4222-8222-222222222222/application");
  assert.equal(first.providerJobId,"11111111-1111-4111-8111-111111111111");
  assert.notEqual(first.providerJobId,second.providerJobId);
});
