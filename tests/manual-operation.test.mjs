import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {UnifiedStateStore} from '../server/unified-state-store.mjs';
import {runtimeOperationPolicy} from '../server/runtime-operation-policy.mjs';
import {AutoApplyOrchestrator} from '../src/automation/auto-apply-orchestrator.mjs';
import {ApplicationQuestionEscalationService} from '../src/automation/application-question-escalation-service.mjs';

async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'manual-runtime-')),store=await new UnifiedStateStore({dataDir:dir}).initialize();
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const at=new Date().toISOString();
  store.jobs.upsert({id:'job',title:'Synthetic',company:'Test',url:'https://example.test/jobs/1',createdAt:at,updatedAt:at});
  store.resumes.upsert({id:'base',title:'BASE 01',resumeKind:'BASE',text:'Synthetic',createdAt:at,updatedAt:at});
  store.database.setMetadata('default_resume_id','base');
  store.applications.create({id:'app',jobId:'job',resumeId:'base',status:'PLANNED',createdAt:at,updatedAt:at});
  store.resumeVersions.create({id:'version',resumeId:'base',jobId:'job',applicationId:'app',templateId:'ATS_STRICT',templateVersion:'ats-strict-v1',language:'en',status:'READY',contentHash:'synthetic',resumeSpec:{},source:'USER',approvedAt:at});
  store.resumeArtifacts.create({id:'pdf',resumeVersionId:'version',artifactType:'PDF',storagePath:path.join(dir,'fixture.pdf'),contentHash:'a'.repeat(64),sizeBytes:20,mimeType:'application/pdf',status:'READY'});
  store.applications.updateDetails({...store.applications.findById('app'),resumeVersionId:'version'});
  return store;
}

test('manual mode enables explicit work without schedules, startup recovery or webhooks',()=>{
  const p=runtimeOperationPolicy({CAREER_OPERATION_MODE:'manual',CAREER_SUBMISSION_ENABLED:'true'});
  assert.equal(p.workersEnabled,true);assert.equal(p.backgroundEnabled,false);assert.equal(p.maintenance,false);assert.ok(Date.parse(p.queueSince));
  assert.equal(p.allowRequest('POST','/api/vaults/gupy/connect'),true);
  for(const route of ['/api/discovery-v4/webhooks/evolution','/api/automation/resume-documents/jobs','/api/run'])assert.equal(p.allowRequest('POST',route),false);
});

test('manual workers skip historical queued rows but claim newly requested work',async t=>{
  const s=await fixture(t),db=s.database.connection,since='2020-01-01T00:00:00.000Z';
  const old=s.intelligenceJobs.enqueue('BENCHMARK',{jobId:'old'}),fresh=s.intelligenceJobs.enqueue('BENCHMARK',{jobId:'new'});
  db.prepare("UPDATE intelligence_jobs SET created_at='2000-01-01' WHERE id=?").run(old.id);
  assert.equal(s.intelligenceJobs.claim('manual',{since}).id,fresh.id);assert.equal(s.intelligenceJobs.findById(old.id).status,'QUEUED');
  const oldDoc=s.resumeDocumentJobs.enqueue('BUILD_SPEC',{resumeId:'base',jobId:'old'}),newDoc=s.resumeDocumentJobs.enqueue('BUILD_SPEC',{resumeId:'base',jobId:'new'});
  db.prepare("UPDATE resume_document_jobs SET created_at='2000-01-01' WHERE id=?").run(oldDoc.id);
  assert.equal(s.resumeDocumentJobs.claim('manual',{since}).id,newDoc.id);assert.equal(s.resumeDocumentJobs.findById(oldDoc.id).status,'QUEUED');
  const batch=s.resumeBatches.create({baseResumeId:'base',jobIds:['job']});
  db.prepare("UPDATE resume_batch_items SET status='ANALYZING',updated_at='2000-01-01' WHERE id=?").run(batch.items[0].id);
  assert.equal(s.resumeBatches.claim('ANALYZING','manual',{since}),null);
  db.prepare('UPDATE resume_batch_items SET updated_at=? WHERE id=?').run(new Date().toISOString(),batch.items[0].id);
  assert.equal(s.resumeBatches.claim('ANALYZING','manual',{since}).id,batch.items[0].id);
  const draft=s.applicationBatches.createDraft({jobId:'job',applicationProvider:'gupy',applicationUrl:'https://example.gupy.io/jobs/1',canonicalIdentity:'synthetic',adapterVersion:'test',status:'PREPARING',mode:'FILL_ONLY'});
  db.prepare("UPDATE application_drafts SET updated_at='2000-01-01' WHERE id=?").run(draft.id);
  assert.equal(s.applicationBatches.claim('PREPARING','manual',{since}),null);
  db.prepare('UPDATE application_drafts SET updated_at=? WHERE id=?').run(new Date().toISOString(),draft.id);
  assert.equal(s.applicationBatches.claim('PREPARING','manual',{since}).id,draft.id);
});

test('manual AutoApply drains only fresh explicit mobile decisions, not ATS or old queues',async t=>{
  const s=await fixture(t),db=s.database.connection,since='2020-01-01T00:00:00.000Z';
  const decision=s.applicationDecisionService.decide({applicationId:'app',resumeVersionId:'version',actor:'operator',channel:'MOBILE',decision:'APPROVE',mode:'AUTO_APPLY',idempotencyKey:'manual-approve'});
  const request=s.autoApplyRuns.pending(10)[0].context.request;
  s.autoApplyRuns.enqueue({requestId:'old',applicationId:'app',source:'legacy',context:{request:{...request,id:'old'},resumeVersionId:'version'}});
  db.prepare("UPDATE auto_apply_runs SET started_at='2000-01-01' WHERE request_id='old'").run();
  s.autoApplyRuns.enqueue({requestId:'ats',applicationId:'app',source:'ats',context:{request:{id:'ats',source:'ATS_THRESHOLD'},resumeVersionId:'version'}});
  const worker=new AutoApplyOrchestrator({store:s,manualSince:since});let executions=0;
  worker.execute=async()=>{executions++;return {status:'WAITING_USER'};};
  assert.equal(worker.start({request:{id:'ats',source:'ATS_THRESHOLD'},application:s.applications.findById('app')}).errorCode,'MANUAL_APPROVAL_REQUIRED');
  assert.equal((await worker.resumePending()).status,'STARTED');await worker.wait(request.id);
  assert.equal(executions,1);assert.equal(s.autoApplyRuns.find(request.id).status,'COMPLETED');
  assert.equal(s.autoApplyRuns.find('old').status,'RETRYABLE');assert.equal(s.autoApplyRuns.find('ats').status,'RETRYABLE');
  assert.equal((await worker.resumePending()),undefined);assert.ok(decision.decisionId);
});

test('manual question handoff remains in mobile without sending WhatsApp or scheduling AI',async t=>{
  const s=await fixture(t);
  const q=s.applicationQuestions.sync('app',[{externalKey:'q',fingerprint:'q1',label:'Synthetic?',type:'text',required:true,answerStatus:'USER_REQUIRED'}])[0];
  const service=new ApplicationQuestionEscalationService({store:s,notificationsEnabled:false,approvalGateway:{publicConfiguration(){throw Error('must not call channel');}}});
  service.delayedQuestions={schedule(){throw Error('must not schedule');}};
  assert.equal((await service.escalate('app')).questionId,q.id);assert.equal(s.applicationQuestions.forApplication('app')[0].answerStatus,'USER_REQUIRED');
});

test('manual claims do not rewrite historical expired leases',async t=>{
  const s=await fixture(t),at=new Date().toISOString();
  s.autoApplyRuns.claim({requestId:'expired',applicationId:'app',source:'legacy',workerId:'old'});
  s.database.connection.prepare("UPDATE auto_apply_runs SET lease_expires_at='2000-01-01' WHERE request_id='expired'").run();
  s.jobs.upsert({id:'other-job',title:'Synthetic',company:'Test',url:'https://example.test/jobs/2',createdAt:at,updatedAt:at});
  s.applications.create({id:'other-app',jobId:'other-job',resumeId:'base',status:'PLANNED',createdAt:at,updatedAt:at});
  s.autoApplyRuns.claim({requestId:'fresh',applicationId:'other-app',source:'manual',workerId:'new',recoverExpired:false});
  assert.equal(s.autoApplyRuns.find('expired').status,'RUNNING');assert.equal(s.autoApplyRuns.find('fresh').status,'RUNNING');
});
