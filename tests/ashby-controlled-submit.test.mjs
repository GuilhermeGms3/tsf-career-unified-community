import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,rm,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {AshbyFinalRevalidator} from "../src/application/ashby-final-revalidator.mjs";
import {SubmissionConsentService} from "../src/application/submission-consent-service.mjs";
import {ControlledSubmissionService} from "../src/application/controlled-submission-service.mjs";
import {FinalRevalidatorRouter} from "../src/application/final-revalidator-router.mjs";
import {SubmissionPreflight} from "../src/application/submission-preflight.mjs";
import {AdapterSubmissionTransport} from "../src/application/submission-transport.mjs";
import {AdapterRegistry} from "../src/automation/ats/adapter-registry.mjs";
import {AshbyMetadataClient} from "../src/automation/ats/ashby/ashby-metadata-client.mjs";
import {parseAshbyIdentity,validateAshbySubmissionTarget} from "../src/automation/ats/ashby/ashby-target-policy.mjs";
import {BrowserManager} from "../src/automation/browser/browser-manager.mjs";

const postingId="12345678-abcd-1234-abcd-123456789012";

async function fixture({confirm=true}={}){
  let submitCount=0;
  const server=createServer((req,res)=>{
    if(req.url==="/record"&&req.method==="POST"){submitCount++;res.writeHead(204).end();return;}
    const confirmation=confirm?"history.pushState({},'', '/confirmation');document.body.innerHTML='<main><h1>Thank you for applying</h1></main>';":"";
    res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
    res.end(`<!doctype html><form data-testid="application-form"><label for="name">Full name</label><input id="name" autocomplete="name" required><label for="email">Email</label><input id="email" type="email" autocomplete="email" required><label for="resume">Resume</label><input id="resume" type="file" required><button type="submit">Submit application</button></form><script>document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();await fetch('/record',{method:'POST'});${confirmation}})</script>`);
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"ashby-controlled-")),store=await new UnifiedStateStore({dataDir}).initialize(),now=new Date().toISOString(),jobId="job-ashby",applicationId="application-ashby",resumeId="resume-ashby",versionId="version-ashby",url=`http://127.0.0.1:${server.address().port}/apply`;
  store.jobs.upsert({id:jobId,title:"Support Engineer",company:"Fixture",description:"Support",url,applicationUrl:`https://jobs.ashbyhq.com/acme/${postingId}/application`,canonicalUrl:`https://jobs.ashbyhq.com/acme/${postingId}`,status:"open",lifecycleStatus:"OPEN",createdAt:now,updatedAt:now});
  store.resumes.upsert({id:resumeId,title:"Resume",text:"Support Engineer",createdAt:now,updatedAt:now});
  store.applications.create({id:applicationId,jobId,resumeId,status:"READY_TO_SUBMIT",createdAt:now,updatedAt:now},{},{allowHistorical:true});
  store.resumeVersions.create({id:versionId,resumeId,jobId,applicationId,templateId:"ATS_STRICT",templateVersion:"ats-strict-v1",language:"en",status:"READY",contentHash:"ashby-fixture",resumeSpec:{candidate:{fullName:"Ana Test",email:"ana@example.test"}},source:"USER",approvedAt:now});
  store.applications.updateDetails({...store.applications.findById(applicationId),resumeVersionId:versionId});
  const artifactDir=path.join(dataDir,"resumes",resumeId,"versions",versionId),pdf=Buffer.from("%PDF-1.4 ashby fixture"),pdfPath=path.join(artifactDir,"resume.pdf");await mkdir(artifactDir,{recursive:true});await writeFile(pdfPath,pdf);
  store.resumeArtifacts.create({id:"artifact-ashby",resumeVersionId:versionId,artifactType:"PDF",storagePath:pdfPath,contentHash:createHash("sha256").update(pdf).digest("hex"),sizeBytes:pdf.length,mimeType:"application/pdf",status:"READY"});
  store.applicationPlans.save({applicationId,selectedResumeId:resumeId,selectedResumeVersionId:versionId,atsType:"ashby",decision:"APPLY",matchScore:95,eligibility:"ELIGIBLE",blockingIssues:[],warnings:[],unknownRequirements:[],policySnapshot:{}});
  store.applicationQuestions.sync(applicationId,[{externalKey:"name",semanticKey:"PERSON.FULL_NAME",label:"Full name",type:"text",required:true,answer:"Ana Test",answerStatus:"KNOWN",answerSource:"USER_CONFIRMED",confidence:.99},{externalKey:"email",semanticKey:"CONTACT.EMAIL",label:"Email",type:"email",required:true,answer:"ana@example.test",answerStatus:"KNOWN",answerSource:"USER_CONFIRMED",confidence:.99}]);
  const registry=new AdapterRegistry(),browserManager=new BrowserManager({dataDir,headless:true,timeout:3000}),ashby=new AshbyFinalRevalidator({store,dataDir,registry,browserManager,allowLocalFixtures:true,jobStatusChecker:async()=>({status:"OPEN",checkedAt:new Date().toISOString(),authority:"controlled-local-fixture",reference:"ashby-fixture"})}),revalidator=new FinalRevalidatorRouter({store,browserManager,revalidators:{ashby}}),transport=new AdapterSubmissionTransport({registry,revalidator,allowLocalFixtures:true,confirmationTimeoutMs:200}),preflight=new SubmissionPreflight({store,dataDir,registry,revalidator,policy:{submissionEnabled:true}}),consents=new SubmissionConsentService({store}),service=new ControlledSubmissionService({store,preflight,transport});
  return {store,dataDir,server,applicationId,preflight,consents,service,get submitCount(){return submitCount;},close:async()=>{await new Promise(resolve=>server.close(resolve));store.close();await rm(dataDir,{recursive:true,force:true});}};
}

test("Ashby target policy accepts official identity and rejects host or identity drift",()=>{
  const identity=parseAshbyIdentity(`https://jobs.ashbyhq.com/acme/${postingId}/application`);
  assert.equal(identity.board,"acme");assert.equal(identity.postingId,postingId);
  assert.equal(validateAshbySubmissionTarget(identity.canonicalUrl,{expectedIdentity:identity}).url,identity.applyUrl);
  assert.throws(()=>validateAshbySubmissionTarget("https://example.test/acme/123"),error=>error.code==="ASHBY_TARGET_HOST_NOT_ALLOWED");
  assert.throws(()=>validateAshbySubmissionTarget(`${identity.canonicalUrl}/unexpected`),error=>error.code==="ASHBY_TARGET_IDENTITY_MISSING");
  assert.throws(()=>validateAshbySubmissionTarget(identity.canonicalUrl,{expectedIdentity:{...identity,board:"other"}}),error=>error.code==="ASHBY_TARGET_IDENTITY_MISMATCH");
});

test("Ashby metadata client treats a listed public posting as open and an absent posting as closed",async()=>{
  const identity={board:"acme",postingId};
  const open=new AshbyMetadataClient({fetchImpl:async()=>({ok:true,status:200,json:async()=>({jobs:[{id:postingId,isListed:true}]})})}),closed=new AshbyMetadataClient({fetchImpl:async()=>({ok:true,status:200,json:async()=>({jobs:[]})})});
  assert.equal((await open.checkJob(identity)).status,"OPEN");assert.equal((await closed.checkJob(identity)).status,"CLOSED");
});

test("Controlled Submit Ashby clicks once and records a confirmed receipt",async()=>{
  const f=await fixture();try{const preview=await f.preflight.evaluate(f.applicationId,{fresh:true,mode:"PREVIEW"});assert.equal(preview.readyForConsent,true);const granted=f.consents.grant(f.applicationId,preview),result=await f.service.submit({applicationId:f.applicationId,consentToken:granted.token,idempotencyKey:"ashby-success"});assert.equal(result.attempt.status,"SUBMITTED");assert.equal(f.submitCount,1);assert.match(result.receipt.confirmationText,/thank you/i);}finally{await f.close();}
});

test("Controlled Submit Ashby marks an unconfirmed post-click result as uncertain without retry",async()=>{
  const f=await fixture({confirm:false});try{const preview=await f.preflight.evaluate(f.applicationId,{fresh:true,mode:"PREVIEW"}),granted=f.consents.grant(f.applicationId,preview),first=await f.service.submit({applicationId:f.applicationId,consentToken:granted.token,idempotencyKey:"ashby-uncertain"}),second=await f.service.submit({applicationId:f.applicationId,consentToken:"",idempotencyKey:"ashby-uncertain"});assert.equal(first.uncertain,true);assert.equal(second.reused,true);assert.equal(f.submitCount,1);}finally{await f.close();}
});
