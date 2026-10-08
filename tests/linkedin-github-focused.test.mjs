import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {GitHubEvidenceProvider} from "../src/evidence/github/github-evidence-provider.mjs";
import {GitHubEvidenceProjector} from "../src/evidence/github/github-evidence-projector.mjs";
import {GitHubApiClient} from "../src/evidence/github/github-api-client.mjs";
import {runAtsMatcherV2} from "../src/matching/ats-matcher-v2.mjs";
import {LinkedInAmbiguityResolver,linkedinGate,validateLinkedInResult} from "../src/discovery/linkedin/linkedin-ambiguity-resolver.mjs";
import {LinkedInContentCache} from "../src/discovery/linkedin/linkedin-content-cache.mjs";
import {LinkedInEnrichmentService} from "../src/discovery/linkedin/linkedin-enrichment-service.mjs";
import {applicationProvider} from "../src/discovery/source-attribution.mjs";
import {normalizeDiscoveryJob} from "../src/discovery/types.mjs";
import {mergeJobFields} from "../src/discovery/field-merge.mjs";
import {JobSpyProvider} from "../src/discovery/providers/jobspy-provider.mjs";
import {GitHubRecalibrationService} from "../src/evidence/github/github-recalibration-service.mjs";
import {OpportunityService} from "../src/opportunities/opportunity-service.mjs";

async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),"linkedin-github-"));let store=await new UnifiedStateStore({dataDir:dir}).initialize();try{await fn({get store(){return store;},restart:async()=>{store.close();store=await new UnifiedStateStore({dataDir:dir}).initialize();}});}finally{store.close();await rm(dir,{recursive:true,force:true});}}
const semantic=(isJobOpportunity=true)=>({isJobOpportunity,confidence:.8,opportunityType:isJobOpportunity?"POSSIBLE_JOB_POST":"NOT_A_JOB",roleTitle:null,company:null,location:null,workModel:null,seniority:null,applicationUrl:null,signals:["HIRING_LANGUAGE"],uncertaintyReasons:["Incomplete source"]});
const memoryCache=()=>{const entries=new Map();return {get:key=>entries.get(key),put:(key,_kind,value)=>entries.set(key,value)};};

test("explicit GitHub sync persists snapshot, survives restart and repeated matching has zero API calls",()=>fixture(async f=>{
  let calls=0,sha="a";const client={viewer:async()=>{calls++;return {id:7,login:"candidate"};},listRepositories:async()=>{calls++;return [{id:42,name:"repo",full_name:"candidate/repo",owner:{login:"candidate"},default_branch:"main"}];},repositoryHead:async()=>{calls++;return {sha};},tree:async()=>{calls++;return {files:[{path:"Dockerfile",size:12}]};},file:async()=>{calls++;return {path:"Dockerfile",content:"FROM node:22",size:12};},changedPaths:async()=>{calls++;return ["Dockerfile"];}};
  const make=()=>new GitHubEvidenceProvider({client,repository:f.store.githubEvidence,projector:new GitHubEvidenceProjector({facts:f.store.candidateFacts,evidence:f.store.careerEvidence})});
  let provider=make();const first=await provider.sync();assert.equal(first.status,"READY");assert.ok(f.store.candidateFacts.find("skill.docker"));
  await f.restart();provider=make();const atSync=calls;
  for(let i=0;i<5;i++){const analysis=runAtsMatcherV2({job:{id:`job-${i}`,title:"DevOps",description:"Docker obrigatório"},evidenceProviders:[provider]});assert.equal(analysis.items.find(item=>item.requirement.normalizedName==="docker").status,"MATCH");}
  assert.equal(calls,atSync);assert.equal(provider.evidence().details.snapshot.syncId,first.syncId);
  sha="b";const second=await provider.sync();assert.notEqual(second.syncId,first.syncId);assert.equal(f.store.database.connection.prepare("SELECT count(*) n FROM github_evidence_snapshots").get().n,2);
}));

test("GitHub credential validation does not temporarily replace concurrent sync credential",async()=>{
  const seen=[],client=new GitHubApiClient({tokenProvider:()=>"stored-fixture",fetchImpl:async(_url,options)=>{seen.push(options.headers.Authorization);assert.equal(options.redirect,"error");assert.ok(options.signal);return {ok:true,headers:{get:()=>null},json:async()=>({id:1})};}});
  await Promise.all([client.validateCredential("new-fixture"),client.viewer()]);assert.deepEqual(seen.sort(),["Bearer new-fixture","Bearer stored-fixture"]);
});
test("GitHub network errors cannot leak credential in error",async()=>{const client=new GitHubApiClient({tokenProvider:()=>"private-fixture",fetchImpl:async()=>{throw Error("private-fixture");}});await assert.rejects(client.viewer(),error=>!error.message.includes("private-fixture")&&error.code==="GITHUB_TIMEOUT");});
test("local recalibration measures same jobs without external provider or threshold changes",()=>fixture(async({store})=>{
  const timestamp=new Date().toISOString();store.jobs.upsert({id:"local-job",title:"Backend Junior",company:"Fixture",description:"Docker obrigatório",location:"Brasília, DF",createdAt:timestamp,updatedAt:timestamp});
  const opportunities=new OpportunityService({store,profileProvider:async()=>({})}),service=new GitHubRecalibrationService({store,matcher:runAtsMatcherV2,profileProvider:async()=>({}),opportunities});
  const result=await service.run();assert.equal(result.jobs,1);assert.equal(result.externalRequests,0);assert.equal(result.thresholdsChanged,false);assert.ok(Number.isInteger(result.after.notIndexed));assert.ok(!("UNKNOWN" in result.after.decisions));
}));

export const gateFixtures=[
  {name:"normal listing",title:"Backend Developer",company:"Fixture",sourceUrl:"https://www.linkedin.com/jobs/view/123",structured:true,expected:"CLEAR_JOB"},
  {name:"recruiter vacancy",text:"Estamos contratando analista de suporte remoto. Envie currículo.",expected:"CLEAR_JOB"},
  {name:"informal hiring",text:"We're hiring backend developer for our team, apply now",expected:"CLEAR_JOB"},
  {name:"technical post",text:"Kubernetes deployment tutorial and architecture",expected:"CLEAR_NON_JOB"},
  {name:"recruiter event",text:"Oportunidade de participar do evento da empresa de recrutamento",expected:"CLEAR_NON_JOB"},
  {name:"new job",text:"Comecei um novo emprego como backend developer na empresa",expected:"CLEAR_NON_JOB"},
  {name:"career advice",text:"Dicas de carreira para analista de suporte",expected:"CLEAR_NON_JOB"},
  {name:"vague opportunity",text:"Oportunidade no nosso time backend remoto. Novidades em breve",expected:"AMBIGUOUS_JOB_LIKE"},
  {name:"multiple roles",text:"Vagas para backend e DevOps junior remoto, envie CV",expected:"CLEAR_JOB"},
  {name:"duplicate",text:"Oportunidade no nosso time backend remoto. Novidades em breve",expected:"AMBIGUOUS_JOB_LIKE"},
];
for(const fixture of gateFixtures)test(`LinkedIn gate: ${fixture.name}`,()=>assert.equal(linkedinGate(fixture).classification,fixture.expected));
test("LinkedIn calibration, persistent cache, in-flight dedupe and bounded single model request",()=>fixture(async({store})=>{
  let calls=0,active=0,peak=0;const resolver=new LinkedInAmbiguityResolver({cache:new LinkedInContentCache(store.database.connection),modelIdentity:()=>"fixture-model",resolve:async(_text,onCall)=>{onCall();calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {result:semantic()};}}),run=resolver.createRun();
  await Promise.all(gateFixtures.map(item=>resolver.classify(item,run)));assert.equal(calls,1);assert.equal(peak,1);assert.equal(run.metrics.deterministicJobs,4);assert.equal(run.metrics.deterministicRejects,4);assert.equal(run.metrics.ollamaInFlightDedupes,1);
  await resolver.classify(gateFixtures[7],run);assert.equal(run.metrics.ollamaCacheHits,1);assert.equal(calls,1);
  console.log("LINKEDIN_CALIBRATION",JSON.stringify(run.metrics));
}));
test("LinkedIn budget exhaustion and invalid response preserve ambiguous candidates",async()=>{
  const resolver=new LinkedInAmbiguityResolver({cache:memoryCache(),modelIdentity:()=>"fixture",maxPerRun:1,resolve:async(_text,onCall)=>{onCall();return {result:{bad:true}};}}),run=resolver.createRun();
  const first=await resolver.classify(gateFixtures[7],run),second=await resolver.classify({...gateFixtures[7],text:gateFixtures[7].text+" tomorrow"},run);assert.equal(first.opportunityType,"POSSIBLE_JOB_POST");assert.equal(second.opportunityType,"POSSIBLE_JOB_POST");assert.equal(run.metrics.ollamaInvalidResponses,1);assert.equal(run.metrics.ollamaBudgetSkipped,1);
});
test("LinkedIn unavailable model does not fail or call model",async()=>{const resolver=new LinkedInAmbiguityResolver({cache:memoryCache(),resolve:()=>assert.fail("model not configured")}),run=resolver.createRun();assert.equal((await resolver.classify(gateFixtures[7],run)).opportunityType,"POSSIBLE_JOB_POST");assert.equal(run.metrics.ollamaCalls,0);});
test("LinkedIn extraction rejects fabricated company or application URL",()=>{assert.throws(()=>validateLinkedInResult({...semantic(),company:"Invented Company"},"Vaga backend"));assert.throws(()=>validateLinkedInResult({...semantic(),applicationUrl:"https://invented.test/apply"},"Vaga backend"));});
test("LinkedIn enrichment preserves failed jobs, caches success and skips unpromising titles",async()=>{
  let calls=0;const cache=memoryCache(),service=new LinkedInEnrichmentService({cache,client:async id=>{calls++;return id==="1"?{status:"ENRICHED",description:"Docker",applicationUrl:"https://company.gupy.io/jobs/123"}:{status:"ENRICHMENT_TIMED_OUT"};}});
  const job=id=>({source:"linkedin",title:"Backend Developer",url:`https://www.linkedin.com/jobs/view/${id}`});
  const result=await service.enrich([job("1"),job("2"),{...job("3"),title:"Veterinário"}],{budgetMs:30000});assert.equal(result.jobs.length,3);assert.equal(result.metrics.timeouts,1);assert.equal(calls,2);
  await service.enrich([job("1")]);assert.equal(calls,2);assert.equal(cache.get("linkedin-description-v1:1").description,"Docker");
});
test("LinkedIn portal timeout preserves successful Indeed results and source report",async()=>{const provider=new JobSpyProvider({searchClient:async()=>({jobs:[{source:"indeed",title:"Backend",company:"Fixture",url:"https://company.gupy.io/jobs/123"}],sourceReports:[{site:"linkedin",status:"TIMED_OUT"},{site:"indeed",status:"SUCCESS",count:1}]})});const result=await provider.search({sites:["linkedin","indeed"]});assert.equal(result.jobs.length,1);assert.equal(result.diagnostic.status,"DEGRADED");assert.equal(result.jobs[0].provenance.sourceAttribution.applicationProvider,"GUPY");});
test("source attribution uses exact hosts and preserves cross-source provenance",()=>{for(const [host,expected] of [["company.gupy.io","GUPY"],["job-boards.greenhouse.io","GREENHOUSE"],["jobs.lever.co","LEVER"],["jobs.ashbyhq.com","ASHBY"],["a.myworkdayjobs.com","WORKDAY"],["gupy.io.evil.test","UNKNOWN"],["evil.test/gupy.io","UNKNOWN"]])assert.equal(applicationProvider(`https://${host}/jobs/1`),expected);
  const a=normalizeDiscoveryJob({provider:"jobspy",discoveredVia:"linkedin",applicationUrl:"https://company.gupy.io/jobs/1"}),b=normalizeDiscoveryJob({provider:"jobspy",discoveredVia:"indeed",applicationUrl:a.applicationUrl});assert.deepEqual(mergeJobFields(a,b).provenance.sources,["linkedin","indeed"]);assert.equal(a.provenance.sourceAttribution.discoveredVia,"LINKEDIN");
});
