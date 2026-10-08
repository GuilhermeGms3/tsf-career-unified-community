import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {CandidateKnowledgeBase} from "../src/application/candidate-knowledge-base.mjs";
import {GenericAdapter} from "../src/automation/ats/generic/generic-adapter.mjs";
import {canReuseKnowledge} from "../src/candidate-knowledge/candidate-knowledge-policy.mjs";
import {GitHubEvidenceProjector} from "../src/evidence/github/github-evidence-projector.mjs";

const fact=(verificationStatus,extra={})=>({key:"CONTACT.EMAIL",value:"candidate@example.test",verificationStatus,verified:verificationStatus!=="SYSTEM_EXTRACTED",reusePolicy:"REUSABLE",lifecycleStatus:"ACTIVE",source:"RESUME_IMPORT",sourceType:"RESUME_IMPORT",unitType:"CONTACT",...extra});
async function fixture(fn){const dataDir=await mkdtemp(path.join(os.tmpdir(),"authority-hardening-"));let store=await new UnifiedStateStore({dataDir}).initialize();try{await fn({get store(){return store;},restart:async()=>{store.close();store=await new UnifiedStateStore({dataDir}).initialize();}});}finally{store.close();await rm(dataDir,{recursive:true,force:true});}}
function form(){const writes=[],locator={count:async()=>1,first(){return this;},fill:async value=>writes.push(value)},frame={url:()=>"about:blank",getByLabel:()=>locator,locator:()=>locator};return {writes,page:{frames:()=>[frame],mainFrame:()=>frame}};}
const email={semanticKey:"CONTACT.EMAIL",externalKey:"email",type:"email",label:"Email",required:true,confidence:1,frameUrl:"about:blank"};

for(const [authority,written] of [["SYSTEM_EXTRACTED",false],["USER_CONFIRMED",true],["IMPORTED_CONFIRMED",true]])test(`autofill authority: ${authority}`,async()=>{
  const item=fact(authority),adapter=new GenericAdapter(),f=form();assert.equal(canReuseKnowledge(item),true);
  const mapped=adapter.mapFields({fields:[email]},CandidateKnowledgeBase.fromFacts([item]));
  const audit=await adapter.fill(f.page,mapped);assert.equal(f.writes.length,written?1:0);assert.equal(audit[0].status,written?"FILLED":"USER_REQUIRED");
});
test("confirmed sensitive/explicit-only fields require per-application confirmation",async()=>{
  const adapter=new GenericAdapter();for(const flags of [{sensitive:true},{explicitOnly:true},{consentType:"TERMS"}]){const f=form(),mapped=adapter.mapFields({fields:[{...email,...flags}]},new CandidateKnowledgeBase([fact("USER_CONFIRMED")]));await adapter.fill(f.page,mapped);assert.equal(f.writes.length,0);}
});
test("final write gate rejects forged eligibility and DERIVED/unverified answers",async()=>{
  const f=form();const audit=await new GenericAdapter().fill(f.page,[{...email,answer:"derived@example.test",answerStatus:"DERIVED",verified:false,autofillEligible:true,autofillAuthority:fact("SYSTEM_EXTRACTED")}]);assert.equal(f.writes.length,0);assert.equal(audit[0].code,"AUTOFILL_AUTHORITY_REQUIRED");
});
test("persisted KNOWN without human authority cannot bypass resolver",async()=>{
  const f=form(),adapter=new GenericAdapter(),mapped=adapter.mapFields({fields:[email]},new CandidateKnowledgeBase(),[{externalKey:"email",answerStatus:"KNOWN",answerValue:"derived@example.test",answerSource:"SYSTEM_EXTRACTED"}]);await adapter.fill(f.page,mapped);assert.equal(f.writes.length,0);
});
const repo=id=>({id,providerRepositoryId:id});
const evidence=technology=>[{id:`e-${technology}`,technology,artifactType:"DEPENDENCY",strength:"STRONG",confidence:.9,path:"package.json",snapshotSha:"fixture-sha"}];
for(const authority of ["USER_CONFIRMED","IMPORTED_CONFIRMED"])test(`${authority} survives GitHub support/removal and repository downgrade attempts`,()=>fixture(async f=>{
  const facts=f.store.candidateFacts;facts.save(fact(authority,{key:"skill.kubernetes",value:"Kubernetes",unitType:"SKILL"}));
  const projector=new GitHubEvidenceProjector({facts,evidence:f.store.careerEvidence});projector.project(repo("a"),evidence("kubernetes"));
  assert.equal(facts.find("skill.kubernetes").verificationStatus,authority);assert.equal(facts.find("skill.kubernetes").source,"RESUME_IMPORT");assert.equal(f.store.careerEvidence.evidence({factKey:"skill.kubernetes"}).length,1);
  facts.save({key:"skill.kubernetes",value:"conflicting",verificationStatus:"SYSTEM_EXTRACTED",source:"GITHUB"});assert.equal(facts.find("skill.kubernetes").value,"Kubernetes");assert.equal(facts.conflicts().length,1);
  projector.project(repo("a"),[]);assert.equal(facts.find("skill.kubernetes").verificationStatus,authority);
}));
test("GitHub multi-repository support reconciles only last orphan and retains history",()=>fixture(async f=>{
  const facts=f.store.candidateFacts,graph=f.store.careerEvidence,projector=new GitHubEvidenceProjector({facts,evidence:graph});
  projector.project(repo("a"),evidence("docker"));projector.project(repo("b"),evidence("docker"));projector.project(repo("a"),[]);assert.equal(facts.find("skill.docker").lifecycleStatus,"ACTIVE");assert.equal(graph.evidence({factKey:"skill.docker"}).length,1);
  projector.project(repo("b"),[]);assert.equal(facts.find("skill.docker"),null);assert.equal(facts.find("skill.docker",{includeInactive:true}).lifecycleStatus,"ARCHIVED");assert.equal(graph.evidence({factKey:"skill.docker",active:false}).length,2);
  projector.project(repo("b"),evidence("docker"));assert.equal(facts.find("skill.docker").lifecycleStatus,"ACTIVE");
}));
test("PROFILE_RECONCILIATION archive restores after restart, USER rejection does not",()=>fixture(async f=>{
  const profile=()=>CandidateKnowledgeBase.fromProfile({career:{skills:["Docker"]}}).all();
  f.store.candidateFacts.syncProfile(profile());assert.equal(f.store.candidateFacts.find("skill.docker").lifecycleStatus,"ACTIVE");
  f.store.candidateFacts.syncProfile([]);assert.equal(f.store.candidateFacts.find("skill.docker",{includeInactive:true}).lifecycleStatus,"ARCHIVED");await f.restart();
  f.store.candidateFacts.syncProfile(profile());assert.equal(f.store.candidateFacts.find("skill.docker").lifecycleStatus,"ACTIVE");
  f.store.candidateFacts.changeStatus("skill.docker","REJECTED",{actor:"USER"});f.store.candidateFacts.syncProfile(profile());assert.equal(f.store.candidateFacts.find("skill.docker",{includeInactive:true}).lifecycleStatus,"REJECTED");
}));
test("PROFILE_SYNC idempotente não regrava fato nem histórico",()=>fixture(async f=>{
  const profile=CandidateKnowledgeBase.fromProfile({career:{skills:["Docker"]}}).all();
  f.store.candidateFacts.syncProfile(profile);
  const before=f.store.candidateFacts.find("skill.docker"),historyBefore=f.store.database.connection.prepare("SELECT COUNT(*) total FROM candidate_fact_history WHERE fact_key=?").get("skill.docker").total;
  f.store.candidateFacts.syncProfile(profile);
  const after=f.store.candidateFacts.find("skill.docker"),historyAfter=f.store.database.connection.prepare("SELECT COUNT(*) total FROM candidate_fact_history WHERE fact_key=?").get("skill.docker").total;
  assert.equal(after.updatedAt,before.updatedAt);assert.equal(historyAfter,historyBefore);
}));
test("user/unknown archives and legacy facts are not restored automatically",()=>fixture(async f=>{
  const profile=CandidateKnowledgeBase.fromProfile({career:{skills:["Docker"]}}).all();
  for(const state of ["ARCHIVED","LEGACY_READ_ONLY"]){f.store.candidateFacts.save({...profile[0],lifecycleStatus:state});f.store.candidateFacts.syncProfile(profile);assert.equal(f.store.candidateFacts.find(profile[0].key,{includeInactive:true}).lifecycleStatus,state);}
}));
