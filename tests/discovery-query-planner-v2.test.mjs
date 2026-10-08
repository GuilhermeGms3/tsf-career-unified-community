import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {DiscoveryQueryPlanner} from "../src/discovery/search-intent/discovery-query-planner.mjs";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {JobHuntService} from "../src/automation/job-hunt-service.mjs";

const families=["SUPPORT","INFRASTRUCTURE","NETWORK_NOC","DEVOPS_SRE","BACKEND"];
const candidates=families.flatMap((familyId,index)=>[
  {query:`${familyId} principal`,familyId,tier:"TIER_1",reason:`Família ${familyId}`,source:"TAXONOMY"},
  {query:`${familyId} alternativa ${index}`,familyId,tier:"TIER_2",reason:`Alias ${familyId}`,source:"ALIAS"},
]);
const planner=new DiscoveryQueryPlanner();
const makePlan=(maxQueries,state=null,extra={})=>planner.plan({intent:{families},candidates,budget:{maxQueries,maxRequests:extra.maxRequests??60},state,intentVersion:extra.intentVersion??7});

test("planner usa exclusivamente as famílias da Search Intent persistida",()=>{
  const plan=planner.plan({intent:{families:["DEVOPS_SRE"]},candidates,budget:{maxQueries:5,maxRequests:5},intentVersion:7});
  assert.deepEqual(plan.familyOrder,["DEVOPS_SRE"]);
  assert.ok(plan.selected.every(item=>item.familyId==="DEVOPS_SRE"));
});

test("planner normaliza e remove queries duplicadas com caixa e diacríticos",()=>{
  const plan=planner.plan({intent:{families:["SUPPORT"]},candidates:[{query:"Suporte Técnico",familyId:"SUPPORT"},{query:" suporte tecnico ",familyId:"SUPPORT"}],budget:{maxQueries:5,maxRequests:5}});
  assert.equal(plan.selected.length,1);
});

test("budget 1 seleciona uma família",()=>assert.deepEqual(makePlan(1).selected.map(item=>item.familyId),["SUPPORT"]));
test("budget 2 seleciona duas famílias distintas",()=>assert.deepEqual(makePlan(2).selected.map(item=>item.familyId),["SUPPORT","INFRASTRUCTURE"]));
test("budget 3 seleciona três famílias distintas",()=>assert.deepEqual(makePlan(3).selected.map(item=>item.familyId),["SUPPORT","INFRASTRUCTURE","NETWORK_NOC"]));
test("budget 5 cobre todas as famílias em uma rodada",()=>assert.deepEqual(makePlan(5).selected.map(item=>item.familyId),families));

test("budget maior que famílias distribui capacidade entre aliases",()=>{
  const plan=makePlan(7);
  assert.equal(plan.selected.length,7);
  assert.deepEqual([...new Set(plan.selected.slice(0,5).map(item=>item.familyId))],families);
});

test("budget 2 cobre cinco famílias em no máximo três rodadas",()=>{
  let state=null;const covered=new Set();
  for(let round=0;round<3;round++){const plan=makePlan(2,state);plan.selected.forEach(item=>covered.add(item.familyId));state=plan.nextState;}
  assert.deepEqual([...covered].sort(),[...families].sort());
});

test("mesma entrada e mesmo estado produzem plano determinístico",()=>{
  const state=makePlan(2).nextState;
  assert.deepEqual(makePlan(2,state).selected,makePlan(2,state).selected);
});

test("estado serializado e recarregado preserva a rotação",()=>{
  const first=makePlan(2),state=JSON.parse(JSON.stringify(first.nextState)),second=makePlan(2,state);
  assert.deepEqual(second.selected.map(item=>item.familyId),["NETWORK_NOC","DEVOPS_SRE"]);
});

test("nova versão da Search Intent reinicia estado antigo",()=>{
  const old=makePlan(2).nextState,next=makePlan(2,old,{intentVersion:8});
  assert.deepEqual(next.selected.map(item=>item.familyId),["SUPPORT","INFRASTRUCTURE"]);
  assert.equal(next.round,1);
});

test("termo customizado só usa capacidade após a primeira cobertura familiar",()=>{
  const plan=planner.plan({intent:{families},candidates:[...candidates,{query:"observabilidade junior",familyId:"",tier:"TIER_2"}],budget:{maxQueries:6,maxRequests:6}});
  assert.deepEqual(plan.selected.slice(0,5).map(item=>item.familyId),families);
  assert.equal(plan.selected[5].query,"observabilidade junior");
});

test("maxRequests reduz orçamento efetivo sem alterar maxQueries configurado",()=>{
  const plan=makePlan(5,null,{maxRequests:2});
  assert.equal(plan.configuredQueryBudget,5);
  assert.equal(plan.effectiveQueryBudget,2);
  assert.equal(plan.selected.length,2);
});

test("planejador cobre família × Brasília e remoto Brasil com diagnóstico de budget",()=>{
  const plan=planner.plan({intent:{families:["SUPPORT","BACKEND"],locationPolicy:{priorities:[{location:"Brasília, DF",workModel:"HYBRID"},{location:"Brasil",workModel:"REMOTE",remoteScope:"Brasil"}]}},candidates,budget:{maxQueries:3,maxRequests:3},intentVersion:8});
  assert.deepEqual(plan.geographySurfaces,["LOCAL_DF","REMOTE_BRAZIL"]);
  assert.deepEqual(plan.selected.map(item=>`${item.familyId}:${item.geographySurface}`),["SUPPORT:LOCAL_DF","BACKEND:LOCAL_DF","SUPPORT:REMOTE_BRAZIL"]);
  assert.equal(plan.diagnostics[0].code,"LOW_DISCOVERY_BUDGET");
});

test("runtime manual persiste rotação, alcança DEVOPS_SRE e agenda desativada não executa",async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"query-planner-v2-")),store=await new UnifiedStateStore({dataDir}).initialize(),calls=[];
  try{
    const service=new JobHuntService({store,discoveryService:{discover:async input=>{calls.push(input);return {run:{id:`discovery-${calls.length}`},jobs:[],discoveredCount:0,newCount:0,duplicateCount:0,closedCount:0,sourceReports:[{provider:"fixture",status:"HEALTHY"}],ok:true};}},matcher:()=>null,profileProvider:async()=>({})});
    const profile=service.saveProfile({name:"Planner E2E",enabled:false,jobFamilies:families,queries:[],seniorities:["JUNIOR"],providers:["fixture"],locations:["Brasil"],queryBudget:{maxQueries:2,maxRequests:2,concurrency:1,retries:0}});
    const first=await service.run(profile.id),second=await service.run(profile.id),scheduled=await service.run(profile.id,{triggerType:"SCHEDULED"});
    assert.equal(profile.enabled,false);
    assert.deepEqual(first.report.expandedQueryDetails.map(item=>item.familyId),["SUPPORT","INFRASTRUCTURE"]);
    assert.deepEqual(second.report.expandedQueryDetails.map(item=>item.familyId),["NETWORK_NOC","DEVOPS_SRE"]);
    assert.ok(calls.some(call=>call.queryProvenance.familyId==="DEVOPS_SRE"));
    assert.equal(store.discoveryQueryPlannerState.get(profile.id).round,2);
    assert.deepEqual(scheduled,{status:"SKIPPED",reason:"PROFILE_DISABLED"});
    assert.equal(calls.length,4);
  }finally{store.close();await rm(dataDir,{recursive:true,force:true});}
});

test("runtime completa famílias ausentes quando expanded_queries persistidas estão obsoletas",async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"query-planner-v2-stale-")),store=await new UnifiedStateStore({dataDir}).initialize(),calls=[];
  try{
    const service=new JobHuntService({store,discoveryService:{discover:async input=>{calls.push(input);return {run:{id:`stale-${calls.length}`},jobs:[],discoveredCount:0,newCount:0,duplicateCount:0,closedCount:0,sourceReports:[{provider:"fixture",status:"HEALTHY"}],ok:true};}},matcher:()=>null,profileProvider:async()=>({})});
    const profile=service.saveProfile({name:"Planner stale candidates",enabled:false,jobFamilies:families,queries:[],seniorities:["JUNIOR"],providers:["fixture"],locations:["Brasil"],queryBudget:{maxQueries:2,maxRequests:1,concurrency:1,retries:0}});
    const intent=store.searchIntents.forProfile(profile.id);
    store.expandedQueries.replace(intent.id,intent.version,[{query:"Service Desk",familyId:"SUPPORT",tier:"TIER_1",reason:"persistida",source:"FIXTURE"}]);
    const first=await service.run(profile.id),second=await service.run(profile.id);
    assert.equal(first.requestCount,1);
    assert.equal(second.requestCount,1);
    assert.deepEqual(calls.map(call=>call.queryProvenance.familyId),["SUPPORT","INFRASTRUCTURE"]);
    assert.deepEqual(first.report.queryPlanner.missingFamilies,[]);
    assert.equal(store.discoveryQueryPlannerState.get(profile.id).round,2);
  }finally{store.close();await rm(dataDir,{recursive:true,force:true});}
});

test("mudança apenas de provider reutiliza Search Intent sem criar versão artificial",async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"query-planner-v2-intent-version-")),store=await new UnifiedStateStore({dataDir}).initialize();
  try{
    const service=new JobHuntService({store,discoveryService:{discover:async()=>({run:{id:"provider-change"},jobs:[],discoveredCount:0,newCount:0,duplicateCount:0,closedCount:0,sourceReports:[{provider:"greenhouse",status:"HEALTHY"}],ok:true})},matcher:()=>null,profileProvider:async()=>({})});
    const profile=service.saveProfile({name:"Intent estável",enabled:false,jobFamilies:families,queries:["Service Desk"],seniorities:["JUNIOR"],providers:["ashby"],locations:["Brasil"],queryBudget:{maxQueries:2,maxRequests:1,concurrency:1,retries:0}}),before=store.searchIntents.forProfile(profile.id);
    const run=await service.runManual({...profile,providers:["greenhouse"],sourcePreferences:["greenhouse"],providerTargets:[{provider:"greenhouse",organizationKey:"fixture"}]},{profileId:profile.id});
    const after=store.searchIntents.forProfile(profile.id);
    assert.equal(run.report.intentVersion,before.version);
    assert.equal(after.version,before.version);
    assert.equal(store.jobHuntProfiles.findById(profile.id).searchIntentVersion,before.version);
  }finally{store.close();await rm(dataDir,{recursive:true,force:true});}
});
