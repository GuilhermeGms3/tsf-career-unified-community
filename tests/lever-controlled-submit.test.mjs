import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,rm,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {SubmissionConsentService} from "../src/application/submission-consent-service.mjs";
import {ControlledSubmissionService} from "../src/application/controlled-submission-service.mjs";
import {FinalRevalidatorRouter} from "../src/application/final-revalidator-router.mjs";
import {LeverFinalRevalidator} from "../src/application/lever-final-revalidator.mjs";
import {SubmissionPreflight} from "../src/application/submission-preflight.mjs";
import {AdapterSubmissionTransport} from "../src/application/submission-transport.mjs";
import {AdapterRegistry} from "../src/automation/ats/adapter-registry.mjs";
import {BrowserManager} from "../src/automation/browser/browser-manager.mjs";
import {LeverMetadataClient} from "../src/automation/ats/lever/lever-metadata-client.mjs";
import {parseLeverIdentity,validateLeverSubmissionTarget} from "../src/automation/ats/lever/lever-target-policy.mjs";

async function fixture({confirm=true,answerSource="USER_CONFIRMED"}={}){
  let submitCount=0;
  const server=createServer((req,res)=>{
    if(req.url==="/record"&&req.method==="POST"){submitCount++;res.writeHead(204).end();return;}
    const confirmation=confirm?"history.pushState({},'', '/confirmation');document.body.innerHTML='<main><h1>Thank you for applying</h1></main>';":"";
    res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
    res.end(`<!doctype html><form data-qa="application-form"><label for="name">Full name</label><input id="name" autocomplete="name" required><label for="email">Email</label><input id="email" type="email" autocomplete="email" required><label for="resume">Resume</label><input id="resume" type="file" required><button type="submit">Submit application</button></form><script>document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();await fetch('/record',{method:'POST'});${confirmation}})</script>`);
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"lever-controlled-")),store=await new UnifiedStateStore({dataDir}).initialize(),now=new Date().toISOString(),jobId="job-lever",applicationId="application-lever",resumeId="resume-lever",versionId="version-lever",url=`http://127.0.0.1:${server.address().port}/apply`;
  store.jobs.upsert({id:jobId,title:"Support Engineer",company:"Fixture",description:"Support",url,applicationUrl:"https://jobs.lever.co/acme/12345678-abcd-1234-abcd-123456789012/apply",canonicalUrl:"https://jobs.lever.co/acme/12345678-abcd-1234-abcd-123456789012",status:"open",lifecycleStatus:"OPEN",createdAt:now,updatedAt:now});
  store.resumes.upsert({id:resumeId,title:"Resume",text:"Support Engineer",createdAt:now,updatedAt:now});
  store.applications.create({id:applicationId,jobId,resumeId,status:"READY_TO_SUBMIT",createdAt:now,updatedAt:now},{},{allowHistorical:true});
  store.resumeVersions.create({id:versionId,resumeId,jobId,applicationId,templateId:"ATS_STRICT",templateVersion:"ats-strict-v1",language:"en",status:"READY",contentHash:"lever-fixture",resumeSpec:{candidate:{fullName:"Ana Test",email:"ana@example.test"}},source:"USER",approvedAt:now});
  store.applications.updateDetails({...store.applications.findById(applicationId),resumeVersionId:versionId});
  const artifactDir=path.join(dataDir,"resumes",resumeId,"versions",versionId),pdf=Buffer.from("%PDF-1.4 lever fixture"),pdfPath=path.join(artifactDir,"resume.pdf");await mkdir(artifactDir,{recursive:true});await writeFile(pdfPath,pdf);
  store.resumeArtifacts.create({id:"artifact-lever",resumeVersionId:versionId,artifactType:"PDF",storagePath:pdfPath,contentHash:createHash("sha256").update(pdf).digest("hex"),sizeBytes:pdf.length,mimeType:"application/pdf",status:"READY"});
  store.applicationPlans.save({applicationId,selectedResumeId:resumeId,selectedResumeVersionId:versionId,atsType:"lever",decision:"APPLY",matchScore:95,eligibility:"ELIGIBLE",blockingIssues:[],warnings:[],unknownRequirements:[],policySnapshot:{}});
  store.applicationQuestions.sync(applicationId,[{externalKey:"name",semanticKey:"PERSON.FULL_NAME",label:"Full name",type:"text",required:true,answer:"Ana Test",answerStatus:"KNOWN",answerSource,confidence:.99},{externalKey:"email",semanticKey:"CONTACT.EMAIL",label:"Email",type:"email",required:true,answer:"ana@example.test",answerStatus:"KNOWN",answerSource,confidence:.99}]);
  const registry=new AdapterRegistry(),browserManager=new BrowserManager({allowLocalFixtures:true,dataDir,headless:true,timeout:3000}),lever=new LeverFinalRevalidator({store,dataDir,registry,browserManager,allowLocalFixtures:true,jobStatusChecker:async()=>({status:"OPEN",checkedAt:new Date().toISOString(),authority:"controlled-local-fixture",reference:"lever-fixture"})}),revalidator=new FinalRevalidatorRouter({store,browserManager,revalidators:{lever}}),transport=new AdapterSubmissionTransport({registry,revalidator,allowLocalFixtures:true,confirmationTimeoutMs:200}),preflight=new SubmissionPreflight({store,dataDir,registry,revalidator,policy:{submissionEnabled:true}}),consents=new SubmissionConsentService({store}),service=new ControlledSubmissionService({store,preflight,transport});
  return {store,dataDir,server,applicationId,preflight,consents,service,get submitCount(){return submitCount;},close:async()=>{await new Promise(resolve=>server.close(resolve));store.close();await rm(dataDir,{recursive:true,force:true});}};
}

test("Lever target policy accepts official identity and rejects host or identity drift",()=>{
  const identity=parseLeverIdentity("https://jobs.lever.co/acme/12345678-abcd-1234-abcd-123456789012/apply");
  assert.equal(identity.site,"acme");assert.equal(identity.postingId,"12345678-abcd-1234-abcd-123456789012");
  assert.equal(validateLeverSubmissionTarget(identity.canonicalUrl,{expectedIdentity:identity}).url,identity.applyUrl);
  assert.throws(()=>validateLeverSubmissionTarget("https://example.test/acme/123"),error=>error.code==="LEVER_TARGET_HOST_NOT_ALLOWED");
  assert.throws(()=>validateLeverSubmissionTarget(`${identity.canonicalUrl}/unexpected`),error=>error.code==="LEVER_TARGET_IDENTITY_MISSING");
  assert.throws(()=>validateLeverSubmissionTarget(identity.canonicalUrl,{expectedIdentity:{...identity,site:"other"}}),error=>error.code==="LEVER_TARGET_IDENTITY_MISMATCH");
});

test("Lever metadata client treats a matching public posting as open and 404 as closed",async()=>{
  const identity={site:"acme",postingId:"posting-1",region:"global"};
  const open=new LeverMetadataClient({fetchImpl:async()=>({ok:true,status:200,json:async()=>({id:"posting-1"})})}),closed=new LeverMetadataClient({fetchImpl:async()=>({ok:false,status:404})});
  assert.equal((await open.checkJob(identity)).status,"OPEN");assert.equal((await closed.checkJob(identity)).status,"CLOSED");
});

test("Controlled Submit Lever clicks once and records a confirmed receipt",async()=>{
  const f=await fixture();try{const preview=await f.preflight.evaluate(f.applicationId,{fresh:true,mode:"PREVIEW"});assert.equal(preview.readyForConsent,true);const granted=f.consents.grant(f.applicationId,preview),result=await f.service.submit({applicationId:f.applicationId,consentToken:granted.token,idempotencyKey:"lever-success"});assert.equal(result.attempt.status,"SUBMITTED");assert.equal(f.submitCount,1);assert.match(result.receipt.confirmationText,/thank you/i);assert.match(result.receipt.metadata.screenshotSha256,/^[a-f0-9]{64}$/);assert.equal(result.receipt.metadata.verificationMethod,"POST_ACTION_DOM_V1");}finally{await f.close();}
});

test("Controlled Submit Lever reusa identidade KNOWN do perfil persistido",async()=>{
  const f=await fixture({answerSource:"CANDIDATE_PROFILE"});try{const preview=await f.preflight.evaluate(f.applicationId,{fresh:true,mode:"PREVIEW"});assert.equal(preview.readyForConsent,true);const granted=f.consents.grant(f.applicationId,preview),result=await f.service.submit({applicationId:f.applicationId,consentToken:granted.token,idempotencyKey:"lever-profile-known"});assert.equal(result.attempt.status,"SUBMITTED");assert.equal(f.submitCount,1);}finally{await f.close();}
});

test("Controlled Submit Lever marks an unconfirmed post-click result as uncertain without retry",async()=>{
  const f=await fixture({confirm:false});try{const preview=await f.preflight.evaluate(f.applicationId,{fresh:true,mode:"PREVIEW"}),granted=f.consents.grant(f.applicationId,preview),first=await f.service.submit({applicationId:f.applicationId,consentToken:granted.token,idempotencyKey:"lever-uncertain"}),second=await f.service.submit({applicationId:f.applicationId,consentToken:"",idempotencyKey:"lever-uncertain"});assert.equal(first.uncertain,true);assert.equal(second.reused,true);assert.equal(f.submitCount,1);}finally{await f.close();}
});
