import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { JobHuntService } from "../src/automation/job-hunt-service.mjs";
import { PreMatchPlausibility } from "../src/discovery/relevance/pre-match-plausibility.mjs";
import { SearchIntentService } from "../src/discovery/search-intent/search-intent-service.mjs";

const locationPolicy={priorities:[
  {priority:1,location:"Brasília, DF",workModel:"ONSITE",remoteScope:"",accepted:true},
  {priority:2,location:"Brasília, DF",workModel:"HYBRID",remoteScope:"",accepted:true},
  {priority:3,location:"Brasil",workModel:"REMOTE",remoteScope:"Brasil",accepted:true},
],allowOnsiteOutsideArea:false};
const families=["SUPPORT","INFRASTRUCTURE","NETWORK_NOC","DEVOPS_SRE","BACKEND"];
const intent={families,seniorities:["INTERNSHIP","JUNIOR"],locationPolicy};
const preMatch=new PreMatchPlausibility({now:()=>new Date("2026-08-23T12:00:00Z")});
const job=(title,description="",extra={})=>({title,description,location:"Brazil - Remote",country:"Brazil",workModel:"REMOTE",provider:"greenhouse",lifecycleStatus:"OPEN",...extra});

test("v7 expande DEVOPS_SRE com termos explícitos e ambíguos auditáveis",()=>{
  const result=new SearchIntentService().preview({families:["DEVOPS_SRE"],seniorities:["JUNIOR"],locationPolicy},{maxQueries:60,maxRequests:60});
  const queries=new Set(result.queries.map(item=>item.query));
  for(const expected of ["DevOps Engineer","SRE","Site Reliability Engineer","Cloud Engineer","Cloud Infrastructure Engineer","Platform Engineer","Platform Operations Engineer","Cloud Operations Engineer","DevSecOps Engineer","Production Engineer","Reliability Engineer"])
    assert.ok(queries.has(expected),expected);
});

test("Junior DevOps explícito é compatível sem alterar quality gates",()=>{
  const result=preMatch.evaluate(job("Junior DevOps Engineer","Terraform, Kubernetes and CI/CD."),intent);
  assert.equal(result.primaryJobFamily,"DEVOPS_SRE");
  assert.equal(result.decision,"PASS");
});

test("Junior Site Reliability Engineer é DEVOPS_SRE",()=>{
  const result=preMatch.evaluate(job("Junior Site Reliability Engineer","Observability and production reliability."),intent);
  assert.equal(result.primaryJobFamily,"DEVOPS_SRE");
  assert.equal(result.decision,"PASS");
});

test("Platform Engineer isolado permanece ambíguo e requer informação",()=>{
  const result=preMatch.evaluate(job("Platform Engineer","Join our engineering team."),intent);
  assert.equal(result.primaryJobFamily,"UNKNOWN");
  assert.equal(result.decision,"REVIEW");
  assert.ok(result.reasons.includes("INSUFFICIENT_INFORMATION"));
});

test("Platform Engineer com sinais operacionais suficientes vira DEVOPS_SRE",()=>{
  const result=preMatch.evaluate(job("Platform Engineer","Own Terraform, Kubernetes, GitOps and observability."),intent);
  assert.equal(result.primaryJobFamily,"DEVOPS_SRE");
  assert.notEqual(result.decision,"REJECT");
});

test("Senior DevOps continua rejeitado por senioridade",()=>{
  const result=preMatch.evaluate(job("Senior DevOps Engineer","5+ years with Kubernetes and Terraform."),intent);
  assert.equal(result.primaryJobFamily,"DEVOPS_SRE");
  assert.equal(result.decision,"REJECT");
  assert.ok(result.reasons.includes("SENIORITY_MISMATCH"));
});

test("senioridade explícita no anúncio protege título neutro",()=>{
  const result=preMatch.evaluate(job("SRE Partner","A empresa está em busca de uma pessoa Senior Site Reliability Engineer para atuar como SRE Partner."),intent);
  assert.equal(result.seniority,"SENIOR");
  assert.equal(result.decision,"REJECT");
  assert.ok(result.reasons.includes("SENIORITY_MISMATCH"));
});

test("remote-first com commute obrigatório continua fora da geografia",()=>{
  const result=preMatch.evaluate(job("Junior DevOps Engineer","Remote-first, but candidates must commute to our São Paulo office.",{location:"São Paulo, BR",workModel:"REMOTE_FIRST"}),intent);
  assert.equal(result.workModel,"HYBRID");
  assert.ok(result.reasons.includes("OUTSIDE_ACCEPTED_REGION"));
});

test("remoto em país latino-americano explícito não vira escopo desconhecido",()=>{
  const result=preMatch.evaluate(job("SRE / Platform Infrastructure Engineer Intern","Terraform and Kubernetes.",{location:"Colombia, Remote",country:"Colombia"}),intent);
  assert.equal(result.remoteScope.value,"CO");
  assert.equal(result.decision,"REJECT");
  assert.ok(result.reasons.includes("FOREIGN_LOCATION"));
});

test("Backend puro não é convertido em DEVOPS_SRE",()=>{
  const result=preMatch.evaluate(job("Junior Backend Java Developer","Spring Boot and REST APIs."),intent);
  assert.equal(result.primaryJobFamily,"BACKEND");
  assert.notEqual(result.decision,"REJECT");
});

test("NETWORK_NOC permanece independente",()=>{
  const result=preMatch.evaluate(job("Junior NOC Analyst","Network monitoring, TCP/IP and Zabbix."),intent);
  assert.equal(result.primaryJobFamily,"NETWORK_NOC");
  assert.notEqual(result.decision,"REJECT");
});

test("INFRASTRUCTURE permanece independente sem contexto DevOps",()=>{
  const result=preMatch.evaluate(job("Junior Infrastructure Analyst","Windows Server and Active Directory administration."),intent);
  assert.equal(result.primaryJobFamily,"INFRASTRUCTURE");
  assert.notEqual(result.decision,"REJECT");
});

test("persistência evolui v6 para v7 e preserva configuração anterior",async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"search-intent-v7-")),store=await new UnifiedStateStore({dataDir}).initialize();
  try{
    const service=new JobHuntService({store,discoveryService:{},matcher:()=>null,profileProvider:async()=>({})});
    const base={name:"Intent compatível",enabled:false,queries:["Service Desk","Suporte N1"],jobFamilies:["SUPPORT","INFRASTRUCTURE","NETWORK_NOC","BACKEND"],seniorities:["INTERNSHIP","JUNIOR"],providers:["ashby"],sourcePreferences:["ashby"],workModels:["ONSITE","HYBRID","REMOTE"],locationPolicy,queryBudget:{maxQueries:2,maxQueriesPerProvider:2,maxRequests:1,concurrency:1,timeoutMs:20000,retries:0,backoffMs:500},considerThreshold:70,prepareResumeThreshold:82,notifyThreshold:90,prepareResume:true,massHunt:true};
    let profile=service.saveProfile(base);
    for(let version=2;version<=6;version++)profile=service.saveProfile(profile,profile.id);
    assert.equal(profile.searchIntentVersion,6);
    const previous={locationPolicy:profile.locationPolicy,seniorities:profile.seniorities,queryBudget:profile.queryBudget,considerThreshold:profile.considerThreshold,prepareResumeThreshold:profile.prepareResumeThreshold,notifyThreshold:profile.notifyThreshold,enabled:profile.enabled};
    profile=service.saveProfile({...profile,jobFamilies:families},profile.id);
    const persisted=store.searchIntents.forProfile(profile.id);
    assert.equal(profile.searchIntentVersion,7);
    assert.equal(persisted.version,7);
    assert.deepEqual(persisted.originalIntent.families,families);
    for(const [key,value] of Object.entries(previous))assert.deepEqual(profile[key],value,key);
  }finally{store.close();await rm(dataDir,{recursive:true,force:true});}
});
