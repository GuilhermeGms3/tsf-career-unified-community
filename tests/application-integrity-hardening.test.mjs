import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,mkdir,readdir,copyFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {HubDatabase} from "../db/database.mjs";
import {ApplicationBatchRepository} from "../repositories/application-batch-repository.mjs";
import {ApplicationBatchService} from "../src/application/application-batch-service.mjs";
import {fingerprint} from "../src/application/application-field-schema.mjs";
import {ResumeService} from "../src/resume/resume-service.mjs";
import {requireLocalJsonMutation} from "../server/local-mutation-guard.mjs";
import {createApplicationV2Routes} from "../server/routes/application-v2-routes.mjs";
import {createApplicationBatchRoutes} from "../server/routes/application-batch-routes.mjs";
import {safeSegment,BatchExportService} from "../src/resume/export/batch-export-service.mjs";
import {zipStored} from "../src/resume/export/document-export-service.mjs";
import {GUPY_CAPABILITY_TRUTH,gupyCatalogStatus} from "../src/application/gupy-capability-truth.mjs";
import {connectionCapabilities} from "../src/source-connections/provider-readiness.mjs";
import {APPLICATION_ADAPTER_CAPABILITIES} from "../src/automation/ats/adapter-registry.mjs";
import {capabilitiesFor} from "../src/discovery/source-capability-catalog.mjs";

const input={jobId:"job",applicationProvider:"gupy",applicationUrl:"https://fixture.gupy.io/jobs/1",canonicalIdentity:"https://fixture.gupy.io/jobs/1",adapterVersion:"fixture-v2",status:"PREPARING",mode:"DRY_RUN"};
async function fixture(fn){const dataDir=await mkdtemp(path.join(os.tmpdir(),"integrity-hardening-")),store=await new UnifiedStateStore({dataDir}).initialize();try{store.jobs.upsert({id:"job",title:"Fixture",company:"Fixture",description:"Fixture",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});await fn({store,dataDir,repo:store.applicationBatches});}finally{store.close();await rm(dataDir,{recursive:true,force:true});}}
const ready=(repo,id)=>{for(const status of ["FILLING","FILLED","VALIDATING","READY_TO_SUBMIT"])repo.transitionItem(id,status);};
test("active operation idempotency; CANCELLED creates numbered attempt without resurrecting history",()=>fixture(async({repo})=>{
  const a=repo.createDraft(input);assert.equal(repo.createDraft(input).id,a.id);repo.transitionItem(a.id,"READY_TO_FILL");repo.transitionItem(a.id,"CANCELLED");const cancelled=repo.findItem(a.id),b=repo.createDraft(input);assert.notEqual(a.id,b.id);assert.equal(b.attemptNo,2);assert.equal(b.canonicalIdentityKey,a.canonicalIdentityKey);assert.deepEqual(repo.findItem(a.id),cancelled);assert.equal(repo.createDraft(input).id,b.id);assert.throws(()=>repo.transitionItem(a.id,"PREPARING"),{code:"DRAFT_TRANSITION_INVALID"});
}));
for(const status of ["SUBMITTED","SUBMISSION_UNCERTAIN"])test(`${status} blocks fresh attempt and every ordinary transition`,()=>fixture(async({repo})=>{
  const d=repo.createDraft(input);ready(repo,d.id);repo.transitionItem(d.id,"SUBMITTING");repo.transitionItem(d.id,status);assert.equal(repo.createDraft({...input,adapterVersion:"new-adapter"}).id,d.id);
  for(const next of ["PREPARING","READY_TO_FILL","FILLING","VALIDATING","READY_TO_SUBMIT","SUBMITTING","CANCELLED",status])assert.throws(()=>repo.transitionItem(d.id,next),{code:"DRAFT_TRANSITION_INVALID"});
  repo.recover();assert.equal(repo.findItem(d.id).status,status);
}));
test("repository rejects impossible transitions and stale CAS including same-status ABA",()=>fixture(async({repo})=>{
  const d=repo.createDraft(input);assert.throws(()=>repo.transitionItem(d.id,"SUBMITTED"),{code:"DRAFT_TRANSITION_INVALID"});
  const expected={expectedStatus:d.status,expectedRevision:d.stateRevision};repo.transitionItem(d.id,"WAITING_USER");assert.throws(()=>repo.transitionItem(d.id,"READY_TO_FILL",{},expected),{code:"DRAFT_STATE_CONFLICT"});repo.transitionItem(d.id,"PREPARING");assert.throws(()=>repo.transitionItem(d.id,"READY_TO_FILL",{},expected),{code:"DRAFT_STATE_CONFLICT"});assert.equal(repo.findItem(d.id).status,"PREPARING");
}));
test("recovery releases old claim but cannot regress a terminal draft",()=>fixture(async({repo,store})=>{
  const d=repo.createDraft(input),claim=repo.claim("PREPARING","old-worker");repo.recover();const newer=repo.claim("PREPARING","new-worker");assert.ok(newer.stateRevision>claim.stateRevision);repo.release(d.id,"old-worker");assert.equal(repo.findItem(d.id).lockedBy,"new-worker");
  ready(repo,d.id);repo.transitionItem(d.id,"SUBMITTING");repo.transitionItem(d.id,"SUBMITTED");repo.recover();assert.equal(repo.findItem(d.id).status,"SUBMITTED");assert.equal(store.database.connection.prepare("PRAGMA foreign_key_check").all().length,0);
}));
test("delayed preparation worker cannot overwrite a newer user decision",()=>fixture(async({repo,store,dataDir})=>{
  const d=repo.createDraft(input),service=new ApplicationBatchService({store,dataDir,browserManager:{},profileProvider:async()=>({})});service.duplicate=()=>false;service.validateContext=async()=>{repo.transitionItem(d.id,"WAITING_USER",{reason:"NEWER_USER_DECISION"});};service.selected=async()=>({});service.open=async()=>({});service.inspectAndResolve=async()=>({fields:[]});service.assess=()=>"";service.closeSession=async()=>{};
  await assert.rejects(service.prepare(d),{code:"DRAFT_STATE_CONFLICT"});assert.equal(repo.findItem(d.id).reason,"NEWER_USER_DECISION");assert.equal(repo.findItem(d.id).status,"WAITING_USER");
}));

for(const failure of ["workspace","write","compile","import"])test(`render ${failure} infrastructure failure finalizes immediately and permits retry`,()=>fixture(async({store,dataDir})=>{
  const t=new Date().toISOString();store.resumes.upsert({id:"base",title:"Fixture",text:"Fixture",createdAt:t,updatedAt:t});const version=store.resumeVersions.create({resumeId:"base",templateId:"ATS_CLEAN",templateVersion:"ats-clean-v1",contentHash:"fixture",resumeSpec:{candidate:{}},status:"APPROVED",approvedAt:t});
  const service=new ResumeService({store,dataDir,compiler:{health:async()=>({version:"fixture"}),compile:async()=>({ok:false,status:"UNAVAILABLE",errorCode:"PDF_COMPILER_NOT_AVAILABLE"})}});service.renderer.render=()=>({source:"fixture latex"});
  const explode=async()=>{throw Object.assign(new Error("injected IO failure"),{code:"EACCES"});};let restore;
  if(failure==="workspace"){const original=service.artifactService.createRenderWorkDir;service.artifactService.createRenderWorkDir=explode;restore=()=>service.artifactService.createRenderWorkDir=original;}
  else if(failure==="write"){const original=service.writeSource;service.writeSource=explode;restore=()=>service.writeSource=original;}
  else if(failure==="compile"){const original=service.compiler.compile;service.compiler.compile=explode;restore=()=>service.compiler.compile=original;}
  else {const original=service.artifactService.writeManifest;service.artifactService.writeManifest=explode;restore=()=>service.artifactService.writeManifest=original;}
  await assert.rejects(service.render(version.id),{code:"EACCES"});assert.equal(store.resumeVersions.findById(version.id).status,"FAILED");assert.ok(store.resumeRenderRuns.forVersion(version.id).every(r=>r.status!=="RUNNING"));assert.equal(service.renderSlots,0);assert.equal(service.rendering.size,0);restore();const retry=await service.render(version.id);assert.equal(retry.errorCode,"PDF_COMPILER_NOT_AVAILABLE");assert.equal(store.resumeRenderRuns.forVersion(version.id).length,2);
}));
test("failure finalizer cannot overwrite READY or a newer render execution",()=>fixture(async({store})=>{
  const t=new Date().toISOString();store.resumes.upsert({id:"base",title:"Fixture",text:"Fixture",createdAt:t,updatedAt:t});const v=store.resumeVersions.create({resumeId:"base",templateId:"ATS_CLEAN",templateVersion:"ats-clean-v1",contentHash:"fixture",resumeSpec:{},status:"READY"});
  const old=store.resumeRenderRuns.start({resumeVersionId:v.id});store.resumeRenderRuns.failExecution(old.id,{errorCode:"EACCES"});assert.equal(store.resumeVersions.findById(v.id).status,"READY");
  const stale=store.resumeRenderRuns.start({resumeVersionId:v.id}),fresh=store.resumeRenderRuns.start({resumeVersionId:v.id});store.resumeVersions.transition(v.id,"RENDERING");store.resumeRenderRuns.failExecution(stale.id,{errorCode:"EACCES"});assert.equal(store.resumeVersions.findById(v.id).status,"RENDERING");assert.equal(store.resumeRenderRuns.findById(fresh.id).status,"RUNNING");
}));

const url=new URL("http://127.0.0.1:7123/api/applications/fixture/submission/consent");
const request=(headers={})=>({method:"POST",headers:{host:url.host,origin:url.origin,"content-type":"application/json; charset=utf-8","sec-fetch-site":"same-origin",...headers},socket:{localPort:7123}});
for(const [name,headers] of [["malicious Origin",{origin:"https://evil.example"}],["unexpected Host",{host:"evil.example:7123"}],["cross-site",{"sec-fetch-site":"cross-site"}],["wrong port",{host:"127.0.0.1:9999"}],["unsafe content type",{"content-type":"text/plain"}],["null Origin",{origin:"null"}]])test(`local mutation rejects ${name}`,()=>assert.throws(()=>requireLocalJsonMutation(request(headers),url),error=>error.status===403));
test("valid local JSON browser/internal requests pass; GET unaffected",()=>{
  requireLocalJsonMutation(request(),url);requireLocalJsonMutation(request({origin:undefined,"sec-fetch-site":undefined}),url);requireLocalJsonMutation({...request({host:"evil.example"}),method:"GET"},url);
});
test("both submission route families enforce guard before reading body or invoking mutation",async()=>{
  let calls=0;const options={readJson:async()=>{calls++;return {};},json:()=>{calls++;},sendError:(res,error)=>{res.code=error.code;res.status=error.status;},store:{},service:{},submissionPreflight:{},consentService:{},controlledSubmission:{},reconciliation:{}};
  for(const [route,paths] of [[createApplicationV2Routes(options),["preflight","review","retry","consent","submit","verify","reconcile"].map(a=>`/api/applications/fixture/submission/${a}`)],[createApplicationBatchRoutes(options),["/api/application-batches","/api/application-drafts/fixture/submit","/api/application-drafts/fixture/cancel"]]])for(const pathname of paths){const res={};assert.equal(await route(request({origin:"https://evil.example"}),res,new URL(pathname,url)),true);assert.equal(res.status,403);}assert.equal(calls,0);
  const route=createApplicationV2Routes({...options,store:{applications:{recordEvent:()=>{}}},submissionPreflight:{evaluate:async()=>({readyForPreview:false})}});await route(request(),{},new URL("/api/applications/fixture/submission/preflight",url));assert.equal(calls,1);
});
test("pre-action failure requires explicit retry and a fresh preflight",async()=>{
  const statuses=[],application={id:"fixture",status:"FAILED"},events=[];let response;
  const store={applications:{findById:()=>application,recordEvent:(_id,type,metadata)=>events.push({type,metadata})},submissionAttempts:{latest:()=>({id:"attempt-failed",status:"FAILED",phase:"PRE_ACTION"})},submissionReceipts:{latest:()=>null},applicationService:{transitionApplication:(_id,status)=>{statuses.push(status);application.status=status;return application;}}},route=createApplicationV2Routes({store,submissionPreflight:{evaluate:async()=>({id:"fresh",readyForConsent:true})},readJson:async()=>({confirmed:true}),json:(_res,body)=>{response=body;},sendError:(_res,error)=>{throw error;}});
  assert.equal(await route(request(),{},new URL("http://127.0.0.1:7123/api/applications/fixture/submission/retry")),true);assert.deepEqual(statuses,["RETRYABLE","QUEUED","WAITING_USER","READY_TO_SUBMIT"]);assert.equal(response.preflight.id,"fresh");assert.equal(events.some(event=>event.type==="SUBMISSION_RETRY_REQUESTED"),true);
});
test("Gupy generations and all capability projections agree without enabling submit",()=>{
  assert.equal(APPLICATION_ADAPTER_CAPABILITIES.gupy,GUPY_CAPABILITY_TRUTH.legacy);assert.equal(APPLICATION_ADAPTER_CAPABILITIES.gupy.canSubmit,false);const c=connectionCapabilities().find(c=>c.providerId==="gupy");assert.equal(c.capabilities.CONTROLLED_SUBMIT,"SUPPORTED_LIMITED");for(const [catalogKey,key] of [["APPLICATION_SCHEMA","APPLICATION_PARSE"],["FORM_FILL","APPLICATION_FILL"],["RESUME_UPLOAD","RESUME_UPLOAD"],["CONTROLLED_SUBMIT","CONTROLLED_SUBMIT"]])assert.equal(capabilitiesFor("gupy").find(c=>c.capability===catalogKey).status,gupyCatalogStatus(key));
});
test("Windows reserved basenames, trailing dots/spaces, traversal and length sanitize",()=>{
  for(const value of ["CON","con.txt","PRN","AUX","NUL","COM1","COM9","LPT1","lpt9"])assert.match(safeSegment(value),/^_/);
  for(const value of ["Company.","Company ","../../test","Backend <Junior>","x".repeat(81)+"."]){const result=safeSegment(value);assert.doesNotMatch(result,/[\\/:<>]|[. ]$/);assert.ok(result.length<=80);}
  for(const name of ["../bad","/absolute","C:/bad","a/../../bad","a\\..\\bad"])assert.throws(()=>zipStored([{name,data:"x"}]),{code:"ZIP_ENTRY_INVALID"});assert.throws(()=>zipStored([{name:"a",data:"x"},{name:"A",data:"y"}]),{code:"ZIP_ENTRY_INVALID"});
});
test("same company/title exports retain deterministic unique item suffixes",async()=>{
  const store={resumeBatches:{findById:()=>({id:"batch",items:[{id:"a",jobId:"a",resumeVersionId:"v-a"},{id:"b",jobId:"b",resumeVersionId:"v-b"}],requestedOutputs:{pdf:true}})},jobs:{findById:()=>({company:"CON",title:"Backend <Junior>"})},resumeVersions:{findById:id=>({id,jobId:id.slice(2),resumeId:"base",status:"READY"})},resumeArtifacts:{latest:(id,type)=>type==="PDF"?{id,artifactType:type,status:"READY"}:null},resumeArtifactService:{readAllowed:async()=>Buffer.from("fixture")}};
  const result=await new BatchExportService({store}).build("batch"),names=result.manifest.items.map(i=>i.files[0].name);assert.notEqual(names[0],names[1]);assert.ok(names.every(n=>n.startsWith("_CON/")));
});
test("fresh and 27-to-29 upgrade preserve history, FK links, uniqueness and submitted protection",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"draft-upgrade-")),migrationsDir=path.join(dir,"migrations");await mkdir(migrationsDir);let database;
  try{
    for(const file of await readdir("db/migrations"))if(/^\d+_.*\.sql$/.test(file)&&Number(file.split("_")[0])<28)await copyFile(path.join("db/migrations",file),path.join(migrationsDir,file));
    const dbPath=path.join(dir,"fixture.sqlite");database=await new HubDatabase(dbPath,{migrationsDir}).initialize();database.connection.prepare("INSERT INTO jobs(id,title,company,description,created_at,updated_at) VALUES('job','Fixture','Fixture','Fixture','t','t')").run();
    const historicalKey=fingerprint([input.jobId,input.applicationProvider,input.canonicalIdentity,"",input.adapterVersion]);
    database.connection.prepare("INSERT INTO application_drafts(id,job_id,provider,application_url,canonical_identity,adapter_version,identity_key,status,mode,created_at,updated_at) VALUES('old','job','gupy',? ,?,'fixture-v2',?,'CANCELLED','DRY_RUN','t','t')").run(input.applicationUrl,input.canonicalIdentity,historicalKey);
    database.connection.prepare("INSERT INTO application_batch_runs VALUES('batch','batch-key','OFF','t')").run();database.connection.prepare("INSERT INTO application_batch_items VALUES('item','batch','old')").run();database.close();
    database=await new HubDatabase(dbPath).initialize();const repo=new ApplicationBatchRepository(database.connection,database);assert.equal(repo.findItem("old").attemptNo,1);assert.equal(repo.findItem("old").canonicalIdentityKey,historicalKey);assert.equal(repo.getBatch("batch").items[0].status,"CANCELLED");assert.equal(repo.createDraft(input).attemptNo,2);
    const d=repo.createDraft(input);assert.equal(repo.createDraft(input).id,d.id);ready(repo,d.id);repo.transitionItem(d.id,"SUBMITTING");repo.transitionItem(d.id,"SUBMITTED");assert.equal(repo.createDraft(input).id,d.id);assert.equal(database.connection.prepare("PRAGMA integrity_check").get().integrity_check,"ok");assert.equal(database.connection.prepare("PRAGMA foreign_key_check").all().length,0);
    assert.equal(database.connection.prepare("SELECT MAX(version) version FROM schema_migrations").get().version,59);
    const fresh=await new HubDatabase(":memory:").initialize();try{assert.equal(fresh.connection.prepare("PRAGMA integrity_check").get().integrity_check,"ok");assert.equal(fresh.connection.prepare("PRAGMA foreign_key_check").all().length,0);}finally{fresh.close();}
  }finally{database?.close();await rm(dir,{recursive:true,force:true});}
});
