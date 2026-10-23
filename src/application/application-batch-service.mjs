import {randomUUID} from "node:crypto";
import {CandidateKnowledgeBase} from "./candidate-knowledge-base.mjs";
import {GupyApplicationAdapter} from "../automation/ats/gupy/gupy-application-adapter.mjs";
import {applicationProvider} from "../discovery/source-attribution.mjs";
import {BrowserManager} from "../automation/browser/browser-manager.mjs";
import {validateResumeArtifact} from "../automation/automation-validation.mjs";
import {resolveApplicationFields,isResolved,validateAnswer,fingerprint} from "./application-field-schema.mjs";
import {ControlledSubmissionService} from "./controlled-submission-service.mjs";
import {SubmissionConsentService} from "./submission-consent-service.mjs";
import {gupyConfirmedAnswers,publishGupyQuestions} from "./gupy-question-bridge.mjs";
import {classifyAutomationFailure} from "../automation/automation-failure.mjs";

const fail=code=>{throw Object.assign(new Error(code),{code,status:409});};
const now=()=>new Date().toISOString();
const active=new Set(["PREPARING","FILLING","FILLED","VALIDATING","SUBMITTING"]);
const terminal=new Set(["SUBMITTED","SUBMISSION_UNCERTAIN","CANCELLED"]);
const MAX_GUPY_STEPS=5;
export class ApplicationBatchService {
  constructor({store,dataDir,profileProvider,opportunityService,browserManager,headless=true,adapter=new GupyApplicationAdapter(),submissionEnabled=false,allowLocalFixtures=false,sourceReadiness=null,sourceAuth=null}){
    Object.assign(this,{sourceReadiness,sourceAuth});
    Object.assign(this,{store,dataDir,profileProvider,opportunityService,adapter,submissionEnabled,allowLocalFixtures});
    this.repository=store.applicationBatches;this.browser=browserManager||new BrowserManager({dataDir,headless,timeout:10000,allowLocalFixtures});this.submitting=new Map();this.activeBrowsers=0;
    this.consent=new SubmissionConsentService({store});
    this.submitService=new ControlledSubmissionService({store,preflight:{evaluate:(id,options)=>this.submitPreflight(id,options)},transport:{allowLocalFixtures,submit:command=>this.transportSubmit(command)}});
    this.telemetry={pagesDetected:0,formsParsed:0,fieldsDetected:0,fieldsAutoResolved:0,fieldsWaitingUser:0,resumeUploadsAttempted:0,resumeUploadsSucceeded:0,readyToSubmit:0,adapterMismatch:0,authRequired:0,captchaEncountered:0,fillFailures:0};
  }
  selectVersion(jobId,versionId=""){
    const versions=versionId?[this.store.resumeVersions.findById(versionId)]:this.store.resumeVersions.list({jobId,status:"READY"});
    return versions.find(v=>v?.jobId===jobId&&v.purpose==="JOB_SPECIFIC"&&v.status==="READY"&&v.approvedAt)||null;
  }
  duplicate(draft){
    return this.store.applications.all().some(app=>{
      if(app.id===draft.applicationId)return this.store.submissionReceipts.latest(app.id)||["SUBMITTED","SUBMISSION_UNCERTAIN"].includes(app.status);
      const job=this.store.jobs.findById(app.jobId),identity=this.adapter.identify(job?.applicationUrl||job?.canonicalUrl||job?.url).canonicalUrl;
      return (app.jobId===draft.jobId||identity===draft.canonicalIdentity)&&app.status!=="CANCELLED";
    })||this.store.database.connection.prepare("SELECT id FROM application_drafts WHERE canonical_identity=? AND id<>? AND status IN ('SUBMITTED','SUBMISSION_UNCERTAIN','SUBMITTING')").get(draft.canonicalIdentity,draft.id||"");
  }
  async create({jobIds,versions={},applications={},mode="DRY_RUN",policyMode="OFF",automatic=false,schedule=true,approvalRequestId=""}={}){
    if(!Array.isArray(jobIds)||!jobIds.length||jobIds.length>25||jobIds.some(id=>typeof id!=="string"||id.length>200))fail("APPLICATION_BATCH_INVALID_JOBS");
    if(!["DRY_RUN","FILL_ONLY"].includes(mode)||!["OFF","PREPARE_ONLY","APPROVAL_REQUIRED"].includes(policyMode))fail("APPLICATION_MODE_INVALID");
    if(automatic&&policyMode==="OFF")return {status:"OFF",items:[]};
    const opportunities=await this.opportunityService.list();
    const inputs=[...new Set(jobIds)].map(jobId=>{
      const job=this.store.jobs.findById(jobId);if(!job)fail("JOB_NOT_FOUND");
      const url=job.applicationUrl||job.canonicalUrl||job.url,provider=applicationProvider(url),identity=this.adapter.identify(url),version=this.selectVersion(jobId,versions[jobId]),decision=opportunities.find(o=>o.job.id===jobId)?.decision;
      let status="PREPARING",reason="";
      if(provider!==this.adapter.constructor.provider||!identity.canonicalUrl){status="BLOCKED";reason="UNSUPPORTED_PROVIDER";}
      else if(!decision||decision.hardBlockers?.length||decision.disposition==="BLOCKED"||decision.disposition==="SKIP"||(automatic&&!decision.visibility?.prepareEligible)){status="BLOCKED";reason="POLICY_NOT_ELIGIBLE";}
      else if(!version){status="PREPARATION_REQUIRED";reason="APPROVED_JOB_SPECIFIC_VERSION_REQUIRED";}
      const input={jobId,applicationProvider:provider,applicationUrl:identity.applicationUrl||url,canonicalIdentity:identity.canonicalUrl||url,resumeVersionId:version?.id||"",adapterVersion:this.adapter.constructor.version,status,reason,mode,policyMode,applicationId:applications[jobId]||"",approvalRequestId,answers:{},fields:[],accountSessionStatus:"NOT_MANAGED"};
      if(this.duplicate(input)){input.status="BLOCKED";input.reason="BLOCKED_DUPLICATE";}return input;
    });
    const batch=this.store.database.transaction(()=>this.repository.createBatch(inputs.map(i=>this.repository.createDraft(i)),policyMode));if(schedule)this.worker?.schedule();return this.present(batch);
  }
  present(batch){if(!batch)return null;return {...batch,submissionEnabled:this.submissionEnabled,items:batch.items.map(d=>{const job=this.store.jobs.findById(d.jobId);return {...d,sourceReadiness:String(d.applicationProvider).toLowerCase()==='gupy'?this.sourceReadiness?.forApplication(d):null,retryAllowed:this.canRetry(d),title:job?.title,company:job?.company,fields:(d.fields||[]).map(({binding,...field})=>field),answers:undefined,lockedBy:undefined};})};}
  get(id){const batch=this.repository.getBatch(id);if(!batch)fail("APPLICATION_BATCH_NOT_FOUND");return this.present(batch);}
  list(){return this.repository.list().map(b=>this.present(b));}
  policyMode(){return this.store.database.connection.prepare("SELECT value FROM app_metadata WHERE key='application_preparation_mode'").get()?.value||"OFF";}
  setPolicyMode(mode){if(!["OFF","PREPARE_ONLY","APPROVAL_REQUIRED"].includes(mode))fail("APPLICATION_MODE_INVALID");this.store.database.setMetadata("application_preparation_mode",mode);}
  async prepareEligible(){
    const policyMode=this.policyMode();if(policyMode==="OFF")return {status:"OFF",items:[]};
    if(this.autoPreparing)return {status:"RUNNING",items:[]};this.autoPreparing=true;
    try{const opportunities=await this.opportunityService.list(),jobIds=opportunities.filter(o=>o.decision.visibility?.prepareEligible&&!o.decision.hardBlockers?.length&&this.adapter.identify(o.job.applicationUrl||o.job.canonicalUrl||o.job.url).canonicalUrl&&this.selectVersion(o.job.id)).slice(0,25).map(o=>o.job.id);if(!jobIds.length)return {status:"NO_ELIGIBLE_OPPORTUNITIES",items:[]};return this.create({jobIds,policyMode,automatic:true,mode:policyMode==="APPROVAL_REQUIRED"?"FILL_ONLY":"DRY_RUN"});}
    finally{this.autoPreparing=false;}
  }
  async selected(draft){
    if(!draft.resumeVersionId)fail("APPROVED_JOB_SPECIFIC_VERSION_REQUIRED");
    const version=this.selectVersion(draft.jobId,draft.resumeVersionId);if(!version)fail("APPROVED_JOB_SPECIFIC_VERSION_REQUIRED");
    const tailoring=version.tailoringRunId?this.store.resumeTailoring.findRun(version.tailoringRunId):null;
    if(!tailoring||tailoring.state!=="APPROVED"||tailoring.jobId!==draft.jobId||tailoring.resumeId!==version.resumeId||tailoring.evidenceStatus!=="VALID"||tailoring.changes?.some(c=>c.validationStatus!=="VALID"))fail("EVIDENCE_GUARD_LINEAGE_REQUIRED");
    return validateResumeArtifact({version,artifact:this.store.resumeArtifacts.latest(version.id,"PDF"),dataDir:this.dataDir});
  }
  async open(draft){
    if(this.activeBrowsers+(this.browser.sessions?.size||0)>=2&&!this.browser.sessions?.has(draft.id))fail("APPLICATION_BROWSER_CAPACITY");
    this.activeBrowsers++;
    try{return await this.openSession(draft);}catch(error){this.activeBrowsers--;throw error;}
  }
  async closeSession(session,{hold=false,status="WAITING_USER"}={}){
    try{await this.browser.finalize(session,{keepOpen:hold,status,adapterType:"gupy"});}finally{this.activeBrowsers--;}
  }
  async openSession(draft){
    const state=this.sourceAuth?.storageState('gupy',new URL(draft.applicationUrl).hostname);
    const resumed=this.browser.resume(draft.id),session=resumed||await this.browser.open(draft.id,`prepare-${randomUUID()}`,{storageState:state,trace:false});
    // No screenshots, traces or browser storage are retained by this pipeline.
    if(!session.traceStopped){await session.context.tracing.stop();session.traceStopped=true;}
    try{
      if(!resumed){
        const identity=this.adapter.identify(draft.applicationUrl);if(!identity.canonicalUrl)fail("APPLICATION_TARGET_INVALID");
        if(!this.allowLocalFixtures)await this.adapter.configureSession(session,draft);
        const response=await session.page.goto(draft.applicationUrl,{waitUntil:"domcontentloaded"});
        if([500,502,503,504].includes(response?.status()))fail("PORTAL_TEMPORARILY_UNAVAILABLE");
        if([401,403,429].includes(response?.status()))fail(response.status()===429?"PORTAL_RATE_LIMITED":"PORTAL_ACCESS_RESTRICTED");
      }
      if(!this.allowLocalFixtures)this.adapter.validatePageTarget(session.page,draft);
      return session;
    }catch(error){await this.browser.close(session,{traceStopped:true});throw error;}
  }
  async inspectAndResolve(draft,session){
    const inspected=await this.adapter.inspect(session.page),profile=CandidateKnowledgeBase.fromProfile(await this.profileProvider()),knowledge=CandidateKnowledgeBase.fromFacts(this.store.candidateKnowledge?.applicationFacts?.()||[]);
    if(this.sourceAuth&&/AUTH|LOGIN/.test(inspected.challenge||''))this.sourceAuth.expire('gupy',new URL(draft.applicationUrl).hostname);
    this.store.structuredLogs?.record({category:'APPLICATION_FILL',provider:'gupy',eventCode:'FORM_INSPECTED',correlationId:draft.id,applicationItemId:draft.id,jobId:draft.jobId,resumeVersionId:draft.resumeVersionId,status:inspected.challenge||'PARSED',level:inspected.challenge?'WARN':'INFO',errorCode:inspected.challenge||'',metadata:{fieldCount:inspected.fields.length}});
    inspected.fields=resolveApplicationFields(inspected.fields,{answers:gupyConfirmedAnswers(this.store,draft),library:this.store.applicationAnswers,profile,knowledge,resumeVersion:this.selectVersion(draft.jobId,draft.resumeVersionId)});
    if(!inspected.challenge)publishGupyQuestions(this.store,draft,inspected.fields);
    return inspected;
  }
  assessStep(inspected,{final=false}={}){
    if(inspected.challenge)return inspected.challenge;
    if(inspected.metadata.status==="CLOSED")return "JOB_CLOSED";
    if(inspected.health!=="HEALTHY"&&!(final&&inspected.boundary))return "ADAPTER_MISMATCH";
    if(inspected.fields.some(f=>!f.hidden&&f.required&&!isResolved(f)))return "REQUIRED_ANSWER_UNKNOWN";
    return "";
  }
  async traverse(draft,session,selected,{fill=false}={}){
    const signatures=[],fields=[],audit=[],visited=new Set();
    let resumeUploads=0;
    for(let step=1;step<=MAX_GUPY_STEPS;step++){
      const inspected=await this.inspectAndResolve(draft,session),final=Boolean(inspected.boundary),reason=this.assessStep(inspected,{final});
      if(reason)return {...inspected,fields:[...fields,...inspected.fields],reason,flow:{stepsVisited:step,signatures:[...signatures,inspected.signature],finalStage:false}};
      if(visited.has(inspected.signature))return {...inspected,fields:[...fields,...inspected.fields],reason:"GUPY_STEP_NOT_ADVANCED",flow:{stepsVisited:step,signatures:[...signatures,inspected.signature],finalStage:false}};
      visited.add(inspected.signature);signatures.push(inspected.signature);fields.push(...inspected.fields);
      resumeUploads+=inspected.fields.filter(field=>!field.hidden&&field.category==="RESUME_UPLOAD").length;
      if(fill&&inspected.fields.length){
        const stepAudit=await this.adapter.fillResolved(session.page,inspected.fields,selected),validation=await this.adapter.validateResolved(session.page,inspected.fields);
        audit.push(...stepAudit.map(entry=>({...entry,step})));
        if(stepAudit.some(entry=>entry.status==="FAILED")||!validation.valid)return {...inspected,fields,reason:"FILL_VALIDATION_FAILED",audit,flow:{stepsVisited:step,signatures,finalStage:false}};
      }
      if(final){
        const signature=fingerprint(signatures),answerFingerprint=fingerprint(fields.map(field=>[field.questionIdentity,field.answer]));
        if(resumeUploads!==1)return {...inspected,fields,signature,answerFingerprint,reason:"RESUME_UPLOAD_MAPPING_REQUIRED",audit,flow:{stepsVisited:step,signatures,finalStage:true}};
        return {...inspected,fields,signature,answerFingerprint,reason:"",audit,flow:{stepsVisited:step,signatures,finalStage:true}};
      }
      if(!fill)return {...inspected,fields,signature:fingerprint(signatures),reason:"",audit,flow:{stepsVisited:step,signatures,finalStage:false,requiresFillToContinue:true}};
      try{await this.adapter.advance(session.page,{previousSignature:inspected.signature});}catch(error){return {...inspected,fields,signature:fingerprint(signatures),reason:error.code||"FINAL_STAGE_NOT_CONFIRMED",audit,flow:{stepsVisited:step,signatures,finalStage:false}};}
    }
    return {fields,signature:fingerprint(signatures),reason:"GUPY_STEP_LIMIT_EXCEEDED",audit,flow:{stepsVisited:MAX_GUPY_STEPS,signatures,finalStage:false}};
  }
  async prepare(item){
    const draft=this.repository.findItem(item.id);if(!draft||draft.status!=="PREPARING")return;
    if(item.stateRevision!==undefined&&item.stateRevision!==draft.stateRevision)fail("DRAFT_STATE_CONFLICT");
    let session;
    let cursor=draft;
    const finish=(status,patch)=>{cursor=this.repository.transitionItem(draft.id,status,patch,{expectedStatus:cursor.status,expectedRevision:cursor.stateRevision});return cursor;};
    try{
      if(this.duplicate(draft))return finish("BLOCKED",{reason:"BLOCKED_DUPLICATE"});
      await this.validateContext(draft);
      const selected=await this.selected(draft);session=await this.open(draft);
      if(draft.mode==="FILL_ONLY")finish("FILLING",{});
      const inspected=await this.traverse(draft,session,selected,{fill:draft.mode==="FILL_ONLY"}),reason=inspected.reason,patch={...inspected,reason,accountSessionStatus:"NOT_MANAGED"};
      this.telemetry.pagesDetected+=inspected.flow?.stepsVisited||1;this.telemetry.formsParsed+=inspected.flow?.stepsVisited||1;this.telemetry.fieldsDetected+=inspected.fields.length;this.telemetry.fieldsAutoResolved+=inspected.fields.filter(isResolved).length;this.telemetry.fieldsWaitingUser+=inspected.fields.filter(f=>!f.hidden&&!isResolved(f)).length;
      if(reason){if(/AUTH|LOGIN/.test(reason))this.telemetry.authRequired++;if(/CAPTCHA/.test(reason))this.telemetry.captchaEncountered++;if(reason==="ADAPTER_MISMATCH")this.telemetry.adapterMismatch++;if(reason==="FILL_VALIDATION_FAILED")this.telemetry.fillFailures++;return finish("WAITING_USER",patch);}
      if(draft.mode==="DRY_RUN")return finish("READY_TO_FILL",patch);
      this.telemetry.resumeUploadsAttempted+=inspected.fields.filter(f=>f.category==="RESUME_UPLOAD").length;
      this.telemetry.resumeUploadsSucceeded+=inspected.audit.filter(a=>a.field==="RESUME.FILE"&&a.status==="FILLED").length;
      finish("FILLED",patch);finish("VALIDATING",{});
      this.telemetry.readyToSubmit++;return finish("READY_TO_SUBMIT",{reason:"",signature:inspected.signature,fields:inspected.fields,flow:inspected.flow,audit:inspected.audit,artifactHash:selected.artifact.contentHash,answerFingerprint:inspected.answerFingerprint,readyAt:now()});
    }catch(error){this.store.structuredLogs?.record({category:"APPLICATION_FILL",level:"ERROR",eventCode:"DRAFT_PREPARATION_FAILED",provider:"gupy",applicationItemId:draft.id,jobId:draft.jobId,resumeVersionId:draft.resumeVersionId,errorCode:error.code||"GUPY_PREPARATION_FAILED",metadata:{from:cursor.status,to:error.to||"FAILED"}});if(error.code==="DRAFT_STATE_CONFLICT"||error.code==="DRAFT_TRANSITION_INVALID")throw error;const reason=classifyAutomationFailure(error)==="RETRYABLE"?"PORTAL_TEMPORARILY_UNAVAILABLE":error.code||"GUPY_PREPARATION_FAILED";return finish(/RESUME|VERSION|EVIDENCE/.test(reason)?"PREPARATION_REQUIRED":/AUTH|LOGIN|CAPTCHA/.test(reason)?"WAITING_USER":"FAILED",{reason});}
    finally{if(session)await this.closeSession(session,{hold:!this.browser.headless,status:this.repository.findItem(draft.id).reason||this.repository.findItem(draft.id).status});}
  }
  answer(id,{fieldId,value,saveForFuture=false}){
    const d=this.repository.findItem(id);if(!d||active.has(d.status)||terminal.has(d.status)||!this.canRetry(d))fail("DRAFT_NOT_EDITABLE");
    const field=d.fields?.find(f=>f.fieldId===fieldId);if(!field||field.hidden||["UNSUPPORTED","BLOCKED"].includes(field.answerState)||field.category==="RESUME_UPLOAD"||!validateAnswer(field,value))fail("INVALID_APPLICATION_ANSWER");
    if(saveForFuture&&(field.sensitive||field.category==="CONSENT"))fail("SENSITIVE_ANSWER_REQUIRES_EACH_APPLICATION");
    if(saveForFuture)this.store.applicationAnswers.save(field,value);
    return this.repository.transitionItem(id,"WAITING_USER",{answers:{...d.answers,[field.questionIdentity]:{value,source:"USER_CONFIRMED"}},reason:"ANSWER_SAVED_REVALIDATE"});
  }
  canRetry(d){const attempt=d.applicationId?this.store.submissionAttempts.latest(d.applicationId):null;return !attempt||attempt.status==="FAILED"&&attempt.phase==="PRE_ACTION";}
  queue(id,mode){
    const d=this.repository.findItem(id);if(!d||terminal.has(d.status)||!this.canRetry(d))fail("DRAFT_NOT_RETRYABLE");
    if(!["DRY_RUN","FILL_ONLY"].includes(mode))fail("APPLICATION_MODE_INVALID");if(active.has(d.status))return d;
    let target=id;
    if(!d.resumeVersionId){const version=this.selectVersion(d.jobId);if(!version)fail("APPROVED_JOB_SPECIFIC_VERSION_REQUIRED");target=this.store.database.transaction(()=>{const replacement=this.repository.createDraft({...d,resumeVersionId:version.id,status:"PREPARING",mode,reason:""});this.store.database.connection.prepare("UPDATE application_batch_items SET draft_id=? WHERE draft_id=?").run(replacement.id,id);return replacement.id;});}
    const current=this.repository.findItem(target),next=current.status==="PREPARING"?current:this.repository.transitionItem(target,"PREPARING",{mode,reason:""});this.worker?.schedule();return next;
  }
  cancel(id){const d=this.repository.findItem(id);if(!d||active.has(d.status)||d.applicationId||terminal.has(d.status))fail("DRAFT_NOT_CANCELLABLE");return this.repository.transitionItem(id,"CANCELLED");}
  async submit(id,{confirmed=false,idempotencyKey="",authorization={},assertExecutionAllowed}={}){
    if(!this.submissionEnabled)fail("SUBMISSION_DISABLED");if(confirmed!==true)fail("SUBMISSION_EXPLICIT_CONSENT_REQUIRED");
    if(this.submitting.has(id))return this.submitting.get(id);
    const promise=this.executeSubmit(id,{idempotencyKey,authorization,assertExecutionAllowed});this.submitting.set(id,promise);try{return await promise;}finally{this.submitting.delete(id);}
  }
  async executeSubmit(id,{idempotencyKey="",authorization={},assertExecutionAllowed}={}){
    let draft=this.repository.findItem(id);if(!draft||draft.status!=="READY_TO_SUBMIT"||this.duplicate(draft))fail("SUBMISSION_NOT_READY_OR_DUPLICATE");
    await this.selected(draft);
    // A draft is not an Application. Materialize it only at explicit final authorization.
    const applicationId=this.store.database.transaction(()=>{
      const d=this.repository.findItem(id);if(d.status!=="READY_TO_SUBMIT"||this.duplicate(d))fail("SUBMISSION_LOCKED");
      const applicationId=d.applicationId||`application-${randomUUID()}`;
      if(!d.applicationId){const version=this.selectVersion(d.jobId,d.resumeVersionId),t=now();this.store.applications.create({id:applicationId,jobId:d.jobId,resumeId:version.resumeId,resumeVersionId:version.id,status:"PLANNED",createdAt:t,updatedAt:t});}
      const currentApplication=this.store.applications.findById(applicationId);const route={PLANNED:["APPROVED","QUEUED","WAITING_USER","READY_TO_SUBMIT"],APPROVED:["QUEUED","WAITING_USER","READY_TO_SUBMIT"],QUEUED:["WAITING_USER","READY_TO_SUBMIT"],WAITING_USER:["READY_TO_SUBMIT"],READY_TO_SUBMIT:[],FAILED:["RETRYABLE","QUEUED","WAITING_USER","READY_TO_SUBMIT"]}[currentApplication.status];if(!route)fail("SUBMISSION_APPLICATION_STATE_INVALID");for(const status of route)this.store.applicationService.transitionApplication(applicationId,status,{source:currentApplication.status==="FAILED"?"EXPLICIT_PRE_ACTION_RETRY":"APPLICATION_DRAFT",draftId:id,approvalRequestId:d.approvalRequestId||""});
      draft=this.repository.transitionItem(id,"SUBMITTING",{applicationId},{expectedStatus:draft.status,expectedRevision:draft.stateRevision});return applicationId;
    });
    try{
      const preflight=await this.submitPreflight(applicationId,{persist:true}),granted=this.consent.grant(applicationId,preflight,authorization);
      const result=await this.submitService.submit({applicationId,consentToken:granted.token,idempotencyKey:idempotencyKey||`gupy-submit:${id}:${randomUUID()}`,assertExecutionAllowed});
      this.repository.transitionItem(id,result.uncertain?"SUBMISSION_UNCERTAIN":result.attempt.status==="SUBMITTED"&&result.receipt?"SUBMITTED":"WAITING_USER",{receiptId:result.receipt?.id||""},{expectedStatus:draft.status,expectedRevision:draft.stateRevision});return result;
    }catch(error){if(error.code==="DRAFT_STATE_CONFLICT"||error.code==="DRAFT_TRANSITION_INVALID")throw error;const attempt=this.store.submissionAttempts.latest(applicationId);this.repository.transitionItem(id,attempt?.phase&&attempt.phase!=="PRE_ACTION"?"SUBMISSION_UNCERTAIN":"WAITING_USER",{reason:error.code||"SUBMISSION_PREFLIGHT_FAILED"},{expectedStatus:draft.status,expectedRevision:draft.stateRevision});throw error;}
  }
  async freshSubmission(draft,{fill=false}={}){
    if(!this.submissionEnabled||this.duplicate(draft))fail("SUBMISSION_DISABLED_OR_DUPLICATE");
    await this.validateContext(draft);
    const selected=await this.selected(draft),session=await this.open({...draft,mode:"FILL_ONLY"});
    try{
      const live=await this.traverse(draft,session,selected,{fill:true}),reason=live.reason;
      if(reason)fail(reason);
      if(live.metadata?.status!=="OPEN")fail("GUPY_JOB_OPEN_NOT_CONFIRMED");
      if(live.signature!==draft.signature||selected.artifact.contentHash!==draft.artifactHash||live.answerFingerprint!==draft.answerFingerprint)fail("SUBMISSION_PREFLIGHT_STALE");
      if(fill&&(!live.flow?.finalStage||live.audit.some(entry=>entry.status==="FAILED")))fail("GUPY_FINAL_VALIDATION_FAILED");
      return {session,live,selected};
    }catch(error){await this.closeSession(session);throw error;}
  }
  async submitPreflight(applicationId,{persist=true,consentTokenHash=""}={}){
    const d=this.repository.forApplication(applicationId);if(!d||d.status!=="SUBMITTING")fail("GUPY_DRAFT_NOT_SUBMITTING");
    const fresh=await this.freshSubmission(d);await this.closeSession(fresh.session,{hold:!this.browser.headless,status:"READY_TO_SUBMIT"});
    const consent=consentTokenHash?this.store.submissionConsents.findActiveByTokenHash(consentTokenHash):null;
    const snapshot=fingerprint([d.jobId,d.applicationProvider,d.canonicalIdentity,d.resumeVersionId,d.adapterVersion,d.signature,d.artifactHash,d.answerFingerprint]);
    const result={applicationId,adapterType:"gupy",status:"READY",gates:[{id:"KILL_SWITCH",status:"READY"},{id:"INSPECTION_FRESHNESS",status:"READY",details:{fresh:true,domSignature:d.signature,inspectedAt:now(),maxAgeMs:60000}}],blockingReasons:[],warnings:[],formSnapshot:[],answerSnapshotHash:d.answerFingerprint,snapshotHash:snapshot,readyForPreview:true,readyForConsent:true,readyForSubmit:Boolean(consent&&consent.applicationId===applicationId&&consent.answerSnapshotHash===d.answerFingerprint&&consent.resumeVersionId===d.resumeVersionId),version:this.adapter.constructor.version,evaluatedAt:now()};
    return persist?this.store.submissionPreflights.create(result):result;
  }
  async transportSubmit(command){
    const d=this.repository.forApplication(command.applicationId),prepared=await this.freshSubmission(d,{fill:true});
    try{await command.onActionArmed?.();const outcome=await this.adapter.controlledSubmit(prepared.session.page,{onActionTriggered:command.onActionTriggered});if(outcome.receipt)outcome.receipt.metadata={...outcome.receipt.metadata,adapterVersion:d.adapterVersion,jobId:d.jobId};return outcome;}
    finally{await this.closeSession(prepared.session);}
  }
  async validateContext(draft){
    const job=this.store.jobs.findById(draft.jobId),identity=this.adapter.identify(job?.applicationUrl||job?.canonicalUrl||job?.url);
    if(identity.canonicalUrl!==draft.canonicalIdentity||this.adapter.constructor.version!==draft.adapterVersion)fail("GUPY_IDENTITY_MISMATCH");
    const decision=(await this.opportunityService.list()).find(o=>o.job.id===draft.jobId)?.decision;
    if(!decision||decision.hardBlockers?.length||["BLOCKED","SKIP"].includes(decision.disposition))fail("POLICY_NOT_ELIGIBLE");
    if(job.lifecycleStatus==="CLOSED"||/^(closed|encerrada|expirada)$/i.test(job.status||""))fail("JOB_CLOSED");
  }
}
