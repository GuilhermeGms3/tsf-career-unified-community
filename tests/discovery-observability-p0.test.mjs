import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {JobSpyProvider} from "../src/discovery/providers/jobspy-provider.mjs";
import {ProviderRegistry} from "../src/discovery/provider-registry.mjs";
import {DiscoveryService} from "../src/discovery/discovery-service.mjs";
import {PROVIDER_CATEGORIES as K,providerDiagnostic} from "../src/discovery/types.mjs";

test("JobSpy normaliza telemetria por portal e completa NOT_ATTEMPTED",async()=>{
  const provider=new JobSpyProvider({searchClient:async()=>({jobs:[],sourceReports:[{source:"indeed",status:"empty",count:0,elapsedMs:12,technicalError:"token=secret"}]})}),result=await provider.search({query:"Suporte",location:"Brasília, DF",sites:["indeed","linkedin"]});
  assert.deepEqual(result.diagnostic.sourceReports.map(item=>item.status),["NO_RESULTS","NOT_ATTEMPTED"]);
  assert.equal("technicalError" in result.diagnostic.sourceReports[0],false);
});

test("logs estruturados removem segredos, filtram run e aplicam contrato de retenção",async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"structured-logs-")),store=await new UnifiedStateStore({dataDir}).initialize();
  try{store.structuredLogs.recordMany([{runId:"run-1",level:"ERROR",category:"DISCOVERY",event:"PORTAL_COMPLETED",message:"Bearer abc.def",provider:"jobspy",metadata:{cookie:"session",nested:{apiKey:"key"}}}]);const [item]=store.structuredLogs.list({runId:"run-1"});assert.equal(item.message,"Bearer [REDACTED]");assert.equal(item.metadata.cookie,"[REDACTED]");assert.equal(item.metadata.nested.apiKey,"[REDACTED]");}finally{store.close();await rm(dataDir,{recursive:true,force:true});}
});

test("dedupe preserva atribuição Indeed, LinkedIn e Greenhouse na vaga canônica",async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"source-attribution-")),store=await new UnifiedStateStore({dataDir}).initialize(),url="https://job-boards.greenhouse.io/acme/jobs/42",base={title:"Backend Junior",company:"Acme",location:"Remoto",applicationUrl:url,canonicalUrl:url,lifecycleStatus:"OPEN"};
  try{
    const health=async()=>providerDiagnostic("HEALTHY"),jobspy={id:"jobspy",category:K.AGGREGATOR,capabilities:[],health,search:async()=>({diagnostic:providerDiagnostic("HEALTHY"),jobs:[{...base,provider:"jobspy",providerCategory:K.AGGREGATOR,providerJobId:"indeed-42",discoveredVia:"indeed",sourceUrl:"https://indeed.test/42"},{...base,provider:"jobspy",providerCategory:K.AGGREGATOR,providerJobId:"linkedin-42",discoveredVia:"linkedin",sourceUrl:"https://linkedin.test/42"}]})},greenhouse={id:"greenhouse",category:K.ATS,capabilities:[],health,listCompanyJobs:async()=>[{...base,provider:"greenhouse",providerCategory:K.ATS,providerJobId:"42",discoveredVia:"greenhouse",sourceUrl:url,companyIdentity:"acme",atsType:"greenhouse"}]},service=new DiscoveryService({registry:new ProviderRegistry([jobspy,greenhouse]),repositories:store.discovery,jobRepository:store.jobs});
    await service.discover({query:"Backend",providers:["jobspy"]});await service.discover({query:"Backend",providers:["greenhouse"],organizationKey:"acme"});const [job]=store.jobs.all(),sources=store.discovery.sourcesForJob(job.id);assert.equal(store.jobs.all().length,1);assert.deepEqual(new Set(sources.map(item=>item.discoveredVia)),new Set(["indeed","linkedin","greenhouse"]));
  }finally{store.close();await rm(dataDir,{recursive:true,force:true});}
});

test("timeout global do JobSpy ainda produz telemetria TIMED_OUT por portal",async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"portal-timeout-")),store=await new UnifiedStateStore({dataDir}).initialize(),provider={id:"jobspy",category:K.AGGREGATOR,capabilities:[],health:async()=>providerDiagnostic("HEALTHY"),search:async()=>{throw Object.assign(new Error("timeout"),{code:"ENGINE_TIMEOUT"});}};
  try{const result=await new DiscoveryService({registry:new ProviderRegistry([provider]),repositories:store.discovery,jobRepository:store.jobs}).discover({query:"Suporte",location:"Brasília, DF",providers:["jobspy"],sites:["indeed","linkedin"]});assert.deepEqual(result.sourceReports[0].sites.map(item=>item.status),["TIMED_OUT","TIMED_OUT"]);assert.deepEqual(result.sourceReports[0].sites.map(item=>item.site),["indeed","linkedin"]);}finally{store.close();await rm(dataDir,{recursive:true,force:true});}
});
