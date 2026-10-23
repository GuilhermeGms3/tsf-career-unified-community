import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { MobileIdempotencyStore } from "../server/mobile/mobile-idempotency.mjs";

async function setup(t) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"decisions-"));let store=await new UnifiedStateStore({dataDir}).initialize();
  t.after(async()=>{store.close();await rm(dataDir,{recursive:true,force:true});});
  const at=new Date().toISOString();
  store.jobs.upsert({id:"job",title:"Synthetic",company:"Fixture",url:"https://example.test/jobs/1",createdAt:at,updatedAt:at});
  store.resumes.upsert({id:"base",title:"BASE 01",resumeKind:"BASE",text:"Synthetic",createdAt:at,updatedAt:at});
  store.database.setMetadata("default_resume_id","base");
  store.applications.create({id:"app",jobId:"job",resumeId:"base",status:"PLANNED",createdAt:at,updatedAt:at});
  store.resumeVersions.create({id:"version",resumeId:"base",jobId:"job",applicationId:"app",templateId:"ATS_STRICT",templateVersion:"ats-strict-v1",language:"en",status:"READY",contentHash:"version-hash",resumeSpec:{},source:"USER",approvedAt:at});
  store.resumeArtifacts.create({id:"pdf",resumeVersionId:"version",artifactType:"PDF",storagePath:path.join(dataDir,"synthetic.pdf"),contentHash:"a".repeat(64),sizeBytes:20,mimeType:"application/pdf",status:"READY"});
  store.applications.updateDetails({...store.applications.findById("app"),resumeVersionId:"version"});
  const request=store.whatsappApprovals.prepare({commandToken:"12345",applicationId:"app",jobId:"job",resumeVersionId:"version",artifactId:"pdf",targetHash:"synthetic-target"});store.whatsappApprovals.markSent(request.id);
  const input={applicationId:"app",resumeVersionId:"version",actor:"synthetic-owner",channel:"WHATSAPP",decision:"APPROVE",mode:"AUTO_APPLY",idempotencyKey:"decision-message-1",approvalRequestId:request.id};
  return {get store(){return store;},request,input,restart:async()=>{store.close();store=await new UnifiedStateStore({dataDir}).initialize();}};
}

test("approval across WhatsApp/mobile commits one decision and one durable command",async t=>{
  const f=await setup(t),svc=f.store.applicationDecisionService;
  const one=svc.decide(f.input),two=svc.decide({...f.input,channel:"MOBILE",actor:"mobile-owner",idempotencyKey:"mobile-message-2"});
  assert.equal(one.decisionId,two.decisionId);assert.equal(two.reused,true);
  assert.equal(f.store.database.connection.prepare("SELECT COUNT(*) n FROM application_decisions").get().n,1);
  assert.equal(f.store.autoApplyRuns.pending(10).length,1);
  assert.equal(f.store.whatsappApprovals.findById(f.request.id).status,"APPROVED");
  await f.restart();assert.equal(f.store.autoApplyRuns.pending(10).length,1);
});

test("failed channel receipt rolls back approval, preference, decision and work",async t=>{
  const f=await setup(t);
  assert.throws(()=>f.store.applicationDecisionService.decide({...f.input,recordChannelReceipt:()=>{throw new Error("induced receipt write failure");}}),/induced/);
  assert.equal(f.store.applications.findById("app").status,"PLANNED");
  assert.equal(f.store.whatsappApprovals.findById(f.request.id).status,"AWAITING_APPROVAL");
  assert.equal(f.store.applicationDecisions.latest("app","version"),null);
  assert.equal(f.store.autoApplyRuns.pending(10).length,0);
});

test("conflicting decisions and stale resume cannot reuse approval",async t=>{
  const f=await setup(t),svc=f.store.applicationDecisionService;
  svc.decide(f.input);
  assert.throws(()=>svc.decide({...f.input,idempotencyKey:"reject-after-approve",decision:"REJECT"}),e=>e.code==="DECISION_VERSION_CONFLICT");
  assert.throws(()=>svc.decide({...f.input,idempotencyKey:"different-resume",resumeVersionId:"old"}),e=>e.code==="DECISION_CONTEXT_STALE");
  assert.throws(()=>svc.decide({...f.input,actor:"someone-else"}),e=>e.code==="DECISION_IDEMPOTENCY_CONFLICT");
});

test("changing the PDF hash invalidates authorization even when the version id is unchanged",async t=>{
  const f=await setup(t),svc=f.store.applicationDecisionService,result=svc.decide(f.input);
  f.store.database.connection.prepare("UPDATE resume_artifacts SET content_hash=? WHERE id='pdf'").run("b".repeat(64));
  const decision=f.store.applicationDecisions.findById(result.decisionId);assert.equal(svc.isCurrent(decision),false);
  assert.throws(()=>svc.enqueue(decision),e=>e.code==="AUTOAPPLY_RECOVERY_APPROVAL_REQUIRED");
  assert.equal(f.store.autoApplyRuns.pending(10).length,1);
});

test("expired pending request blocks both channels",async t=>{
  const f=await setup(t);
  f.store.database.connection.prepare("UPDATE whatsapp_approval_requests SET expires_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),f.request.id);
  for(const channel of ["WHATSAPP","MOBILE"])assert.throws(()=>f.store.applicationDecisionService.decide({...f.input,channel}),e=>e.code==="DECISION_REQUEST_EXPIRED");
  assert.equal(f.store.autoApplyRuns.pending(10).length,0);
});

test("repeated decision reports terminal state without putting a cancelled application back in queue",async t=>{
  const f=await setup(t),svc=f.store.applicationDecisionService;
  svc.decide(f.input);f.store.applicationService.transitionApplication("app","CANCELLED");
  const result=svc.decide({...f.input,idempotencyKey:"another-approved-message"});
  assert.equal(result.status,"CANCELLED");assert.equal(result.reused,true);
  assert.equal(f.store.autoApplyRuns.pending(10).length,1);
});

test("an expired approved request cannot authorize a recovered job",async t=>{
  const f=await setup(t),svc=f.store.applicationDecisionService,result=svc.decide(f.input);
  f.store.database.connection.prepare("UPDATE whatsapp_approval_requests SET expires_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),f.request.id);
  assert.equal(svc.isCurrent(f.store.applicationDecisions.findById(result.decisionId)),false);
  assert.throws(()=>svc.enqueue(f.store.applicationDecisions.findById(result.decisionId)),e=>e.code==="AUTOAPPLY_RECOVERY_APPROVAL_REQUIRED"&&/autoriza/.test(e.message));
});

test("answer remains saved after approval expiration but does not authorize a resume",async t=>{
  const f=await setup(t),svc=f.store.applicationDecisionService;svc.decide(f.input);
  f.store.database.connection.prepare("UPDATE whatsapp_approval_requests SET expires_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),f.request.id);
  const question=f.store.applicationQuestions.sync("app",[{externalKey:"q",semanticKey:"CUSTOM.QUESTION",fingerprint:"synthetic-expired-question",label:"Synthetic question",type:"text",required:true,answerStatus:"USER_REQUIRED"}])[0];
  const result=svc.answer({applicationId:"app",questionId:question.id,answer:"Synthetic response",actor:"synthetic-owner",channel:"MOBILE",idempotencyKey:"expired-answer"});
  assert.equal(result.status,"ANSWERED");assert.equal(f.store.applicationQuestions.forApplication("app")[0].answerStatus,"KNOWN");
  assert.equal(f.store.autoApplyRuns.pending(10).length,1);assert.match(f.store.applications.findById("app").nextAction,/renovar aprovacao/);
});

test("saved approval can be promoted once without a second independent flow",async t=>{
  const f=await setup(t),svc=f.store.applicationDecisionService;
  svc.decide({...f.input,mode:"REVIEW_ONLY"});assert.equal(f.store.autoApplyRuns.pending(10).length,0);
  const promoted=svc.decide({...f.input,idempotencyKey:"send-now"});
  assert.equal(promoted.status,"QUEUED");assert.equal(f.store.autoApplyRuns.pending(10).length,1);
  assert.equal(svc.decide({...f.input,idempotencyKey:"send-again"}).reused,true);
});

test("answer and WhatsApp token converge; incompatible second channel answer is refused",async t=>{
  const f=await setup(t);
  const question=f.store.applicationQuestions.sync("app",[{externalKey:"english",semanticKey:"CUSTOM.QUESTION",fingerprint:"english-choice",label:"English?",type:"select",options:[{label:"Basic",value:"basic"},{label:"Advanced",value:"advanced"}],required:true,answerStatus:"USER_REQUIRED"}])[0];
  const wa=f.store.whatsappQuestions.prepare({commandToken:"PERG-123456",applicationId:"app",questionId:question.id,targetHash:"synthetic"});f.store.whatsappQuestions.markSent(wa.id);
  const input={applicationId:"app",questionId:question.id,resumeVersionId:"version",fingerprint:question.fingerprint,answer:"basic",actor:"mobile-owner",channel:"MOBILE",idempotencyKey:"answer-mobile-1"};
  assert.equal(f.store.applicationDecisionService.answer(input).status,"ANSWERED");
  assert.equal(f.store.whatsappQuestions.findById(wa.id).status,"ANSWERED");
  assert.equal(f.store.applicationDecisionService.answer({...input,idempotencyKey:"answer-whatsapp-2",channel:"WHATSAPP"}).reused,true);
  assert.throws(()=>f.store.applicationDecisionService.answer({...input,idempotencyKey:"answer-conflict",answer:"advanced"}),e=>e.code==="QUESTION_ANSWER_CONFLICT");
});

test("answer failure rolls back all persistent changes",async t=>{
  const f=await setup(t),q=f.store.applicationQuestions.sync("app",[{externalKey:"answer",fingerprint:"synthetic-answer",label:"Question",type:"text",required:true,answerStatus:"USER_REQUIRED"}])[0];
  assert.throws(()=>f.store.applicationDecisionService.answer({applicationId:"app",questionId:q.id,answer:"test",actor:"owner",channel:"WHATSAPP",idempotencyKey:"answer-fails",recordChannelReceipt:()=>{throw new Error("induced crash");}}),/induced/);
  assert.equal(f.store.applicationQuestions.forApplication("app")[0].answerStatus,"USER_REQUIRED");
  assert.equal(f.store.applicationDecisions.command("answer-fails"),null);
});

test("mobile replays committed decision when HTTP receipt was interrupted",async t=>{
  const f=await setup(t),mobile=new MobileIdempotencyStore(f.store.database.connection),key="mobile-crash-key-1",action="application-action:app",userLogin="mobile-owner";
  mobile.claim(key,{action,userLogin});
  f.store.applicationDecisionService.decide({...f.input,idempotencyKey:key,actor:userLogin,channel:"MOBILE"});
  const recovered=mobile.claim(key,{action,userLogin});assert.equal(recovered.owned,false);assert.equal(recovered.body.result.status,"QUEUED");
  assert.equal(f.store.database.connection.prepare("SELECT COUNT(*) n FROM application_decisions").get().n,1);
});
