import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { JobHuntService, fairRequestSchedule } from "../src/automation/job-hunt-service.mjs";
import { effectiveJobHuntThresholds, normalizeJobHuntProfile } from "../src/automation/job-hunt-policy.mjs";
import { SafeHttpClient } from "../src/discovery/safe-http-client.mjs";
import { DiscoveryService } from "../src/discovery/discovery-service.mjs";
import { ProviderRegistry } from "../src/discovery/provider-registry.mjs";

async function fixture(work) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"tsf-reliability-"));
  const store=await new UnifiedStateStore({dataDir}).initialize();
  try { await work(store); }
  finally { store.close(); await rm(dataDir,{recursive:true,force:true}); }
}

test("política global não é bloqueada pelos limiares 70/82/90",()=>{
  const profile=normalizeJobHuntProfile({queries:["Infra"]});
  assert.deepEqual(effectiveJobHuntThresholds(profile,{enabled:true,minimumAtsScore:80,whatsappMinimumAtsScore:60}),{consider:60,prepareResume:60,notify:60,authority:"AUTO_APPLY_POLICY"});
  assert.equal(effectiveJobHuntThresholds(profile,{enabled:false}).prepareResume,82);
  const updated=normalizeJobHuntProfile({name:"Renomeado"},{...profile,enabled:true,prepareResume:true,schedule:{mode:"INTERVAL",everyHours:12},notificationPolicy:{delivery:[],quietHours:{enabled:true,start:"21:00",end:"07:00"}}});
  assert.equal(updated.enabled,true);
  assert.equal(updated.prepareResume,true);
  assert.equal(updated.schedule.everyHours,12);
  assert.deepEqual(updated.notificationPolicy.delivery,[]);
  assert.equal(updated.notificationPolicy.quietHours.start,"21:00");
  const legacyUpdate=normalizeJobHuntProfile({minimumMatchScore:50,providers:["nerdin"]},profile);
  assert.equal(legacyUpdate.considerThreshold,50);
  assert.equal(legacyUpdate.prepareResumeThreshold,50);
  assert.deepEqual(legacyUpdate.providers,["nerdin"]);
});

test("catálogo com muitos boards não monopoliza o orçamento das outras fontes",()=>{
  const schedule=fairRequestSchedule([[...Array.from({length:10},(_,index)=>({providers:["gupy"],organizationKey:String(index)})),{providers:["nerdin"]},{providers:["remotar"]}]]);
  assert.deepEqual(schedule.slice(0,3).map(item=>item.providers[0]),["gupy","nerdin","remotar"]);
});

test("80+ roteia mesmo com zero alertas e 60-79 respeita o canal de revisão",()=>fixture(async store=>{
  const timestamp=new Date().toISOString(),prepared=[],routed=[];
  store.autoApplyPolicy.save({enabled:true});
  store.resumes.upsert({id:"base",title:"BASE 01",resumeKind:"BASE",text:"Linux",createdAt:timestamp,updatedAt:timestamp});
  store.database.setMetadata("default_resume_id","base");
  const jobs=[59,60,79,80,95].map(score=>store.jobs.upsert({id:`job-${score}`,title:"Analista de Suporte Junior",company:"Acme",description:"Linux suporte",url:`https://example.test/${score}`,applicationUrl:`https://example.test/${score}`,lifecycleStatus:"OPEN",contentHash:String(score),createdAt:timestamp,updatedAt:timestamp}));
  const service=new JobHuntService({store,profileProvider:async()=>({}),discoveryService:{discover:async()=>({run:{id:"d"},jobs,discoveredCount:jobs.length,ok:true})},matcher:({job,resume})=>({id:`analysis-${job.id}`,jobId:job.id,resumeId:resume.id,overallScore:Number(job.contentHash),score:Number(job.contentHash),calibratedMatchScore:Number(job.contentHash),evidenceCoverage:100,matchConfidence:100,eligibility:"ELIGIBLE",blockingIssues:[],warnings:[],unknownRequirements:[],requirements:[],items:[],candidateEvidence:[],matched:[],missing:[],suggestions:[],dimensions:{},resumeParseability:{},createdAt:timestamp,updatedAt:timestamp}),prepareResume:async item=>{prepared.push(item.technicalMatch??item.analysis.overallScore);return {status:"READY",resumeVersionId:`version-${item.job.id}`};},requestApproval:async item=>{routed.push(item);return {handled:item.technicalMatch>=80 || item.allowWhatsApp!==false,sent:item.allowWhatsApp!==false};}});
  const profile=service.saveProfile({queries:["Suporte"],sourcePreferences:["nerdin"],prepareResume:true,notificationPolicy:{maxInstantAlerts:0,digestEnabled:false}});
  const run=await service.run(profile.id);
  assert.equal(run.status,"COMPLETED");
  assert.deepEqual(prepared,[60,79,80,95]);
  assert.equal(run.report.autoApplyRoutedCount,2);
  assert.equal(routed.filter(item=>item.allowWhatsApp!==false).length,0);
  const second=service.saveProfile({...profile,id:undefined,notificationPolicy:{maxInstantAlerts:10}});
  await service.run(second.id);
  assert.deepEqual(routed.filter(item=>item.allowWhatsApp!==false).map(item=>item.technicalMatch),[60,79]);
  const alerts=store.jobAlerts.list({profileId:second.id});
  assert.equal(alerts.length,2);
  store.jobAlerts.mark(alerts[0].id,"FAILED");
  store.jobAlerts.mark(alerts[1].id,"QUEUED");
  store.jobAlerts.retryDelivery(alerts[1].id);
  await service.run(second.id);
  assert.equal(routed.filter(item=>item.allowWhatsApp!==false).length,2);
}));

test("targets persistem e scheduler usa o mesmo Mass Hunt",()=>fixture(async store=>{
  const calls=[];
  const service=new JobHuntService({store,discoveryService:{discover:async input=>{calls.push(input);return {run:{id:"d"},jobs:[],discoveredCount:0,ok:true};}},matcher:()=>null,profileProvider:async()=>({})});
  const profile=service.saveProfile({queries:["Infra"],sourcePreferences:["gupy"],providerTargets:[{provider:"gupy",organizationKey:"acme"}],enabled:true,schedule:{mode:"INTERVAL",everyHours:6},queryBudget:{maxQueries:1,maxRequests:1}});
  store.jobHuntProfiles.markRun(profile.id,{nextRunAt:new Date(Date.now()-1000).toISOString()});
  assert.equal(store.jobHuntProfiles.findById(profile.id).providerTargets[0].organizationKey,"acme");
  const results=await service.runDue();
  assert.equal(results[0].triggerType,"SCHEDULED");
  assert.equal(calls[0].organizationKey,"acme");
  assert.ok(Date.parse(store.jobHuntProfiles.findById(profile.id).nextRunAt)>Date.now());
  const run=store.jobHuntRuns.list("",{summary:true,limit:1})[0];
  assert.deepEqual(run.report,{});
  assert.equal(store.jobHuntRuns.findById(run.id).report.effectiveThresholds.authority,"SEARCH_PROFILE");
}));

test("timeout ou rate limit não é marcado como descoberta concluída",()=>fixture(async store=>{
  const service=new DiscoveryService({registry:new ProviderRegistry([{id:"offline",category:"ATS",capabilities:[],health:async()=>({status:"OFFLINE"}),search:async()=>{throw Object.assign(new Error("timeout"),{name:"TimeoutError"});}}]),repositories:store.discovery,jobRepository:store.jobs});
  const result=await service.discover({query:"Infra",providers:["offline"]});
  assert.equal(result.ok,false);
  assert.equal(result.run.status,"FAILED");
  assert.equal(result.sourceReports[0].status,"TIMED_OUT");
}));

test("agenda sem targets explícitos consulta somente boards e watchlists ativos",()=>fixture(async store=>{
  const service=new JobHuntService({store});
  for(const [id,active] of [["active",true],["inactive",false]])store.watchlists.save({id,name:id,careerUrl:`https://${id}.example.test`,active});
  for(const [organizationKey,watchlistId,enabled] of [["yes","active",true],["disabled","active",false],["inactive","inactive",true]])store.watchlists.saveBoard({provider:"gupy",organizationKey,watchlistId,enabled});
  assert.deepEqual(service.providerTargets({}).map(item=>item.organizationKey),["yes"]);
  assert.deepEqual(service.providerTargets({companyWatchlistIds:["inactive"]}),[]);
}));

test("HTTP mantém deadline durante download e cancela o stream",async()=>{
  let cancelled=false;
  const client=new SafeHttpClient({timeoutMs:30,retries:0,fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode("partial"));},cancel(){cancelled=true;}}))});
  await assert.rejects(client.getText("https://1.1.1.1/slow"),error=>error.code==="ENGINE_TIMEOUT");
  assert.equal(cancelled,true);
});

test("HTTP limita JSON sem content-length e só repete falhas transitórias",async()=>{
  const large=new SafeHttpClient({retries:0,fetchImpl:async()=>new Response("x".repeat(2_000_001))});
  await assert.rejects(large.getJson("https://1.1.1.1/large"),error=>error.code==="DISCOVERY_RESPONSE_TOO_LARGE");
  let calls=0;
  const retry=new SafeHttpClient({retries:1,fetchImpl:async()=>++calls===1?new Response("error",{status:503,headers:{"retry-after":"0"}}):new Response("ok")});
  assert.equal((await retry.getText("https://1.1.1.1/retry")).data,"ok");
  assert.equal(calls,2);
  calls=0;
  retry.fetchImpl=async()=>{calls++;return new Response("blocked",{status:403});};
  await assert.rejects(retry.getText("https://1.1.1.1/blocked"),error=>error.code==="HTTP_403");
  assert.equal(calls,1);
});

test("cache HTTP permanece limitado após consultar muitos boards",async()=>{
  const client=new SafeHttpClient({cacheMaxEntries:2,fetchImpl:async()=>new Response("ok")});
  for(let index=0;index<5;index++)await client.getText(`https://1.1.1.1/${index}`);
  assert.equal(client.cache.size,2);
});

test("alerta adiado libera após quiet hours e erro de entrega tem limite persistente",()=>fixture(async store=>{
  const service=new JobHuntService({store,profileProvider:async()=>({}),requestApproval:async()=>({handled:true})});
  const profile=service.saveProfile({queries:["Infra"],sourcePreferences:["nerdin"],notificationPolicy:{quietHours:{enabled:true,start:"22:00",end:"08:00"}}});
  const timestamp=new Date().toISOString();
  const job=store.jobs.upsert({id:"job-quiet",title:"Infra",company:"Acme",url:"https://example.test/job",createdAt:timestamp,updatedAt:timestamp,lifecycleStatus:"OPEN"});
  const run=store.jobHuntRuns.start(profile.id,"MANUAL");
  const alert=store.jobAlerts.create({profileId:profile.id,runId:run.id,jobId:job.id,notificationFingerprint:"quiet",status:"QUIET_HOURS",payload:{resumeStatus:"READY",resumeVersionId:"v1"}});
  const quiet=new Date();quiet.setHours(23,0,0,0);
  await service.flushDeferredAlerts(quiet);
  assert.equal(store.jobAlerts.findById(alert.id).status,"QUIET_HOURS");
  quiet.setHours(10);
  await service.flushDeferredAlerts(quiet);
  assert.equal(store.jobAlerts.findById(alert.id).status,"SENT");
  const failed=store.jobAlerts.create({profileId:profile.id,runId:run.id,jobId:job.id,notificationFingerprint:"retry",status:"QUEUED",payload:{resumeStatus:"READY",resumeVersionId:"v2"}});
  for(let index=0;index<5;index++)store.jobAlerts.retryDelivery(failed.id);
  assert.equal(store.jobAlerts.findById(failed.id).status,"FAILED");
  store.jobAlerts.retryDelivery(failed.id);
  assert.equal(store.jobAlerts.findById(failed.id).deliveryAttempts,5);
}));
