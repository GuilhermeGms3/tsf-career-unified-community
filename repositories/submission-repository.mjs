import {randomUUID} from "node:crypto";
import {parseJson} from "./base-repository.mjs";

const now=()=>new Date().toISOString();

export class SubmissionPreflightRepository{
  constructor(connection){this.connection=connection;}
  create(item){const id=item.id||`submission-preflight-${randomUUID()}`;this.connection.prepare(`INSERT INTO submission_preflight_evaluations(id,application_id,adapter_type,status,gates_json,blocking_reasons_json,warnings_json,form_snapshot_json,answer_snapshot_hash,snapshot_hash,ready_for_preview,ready_for_consent,ready_for_submit,version,evaluated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,item.applicationId,item.adapterType,item.status,JSON.stringify(item.gates||[]),JSON.stringify(item.blockingReasons||[]),JSON.stringify(item.warnings||[]),JSON.stringify(item.formSnapshot||[]),item.answerSnapshotHash||"",item.snapshotHash,item.readyForPreview?1:0,item.readyForConsent?1:0,item.readyForSubmit?1:0,item.version,item.evaluatedAt||now());return this.findById(id);}
  findById(id){const r=this.connection.prepare("SELECT * FROM submission_preflight_evaluations WHERE id=?").get(id);return r?this.map(r):null;}
  latest(applicationId){const r=this.connection.prepare("SELECT * FROM submission_preflight_evaluations WHERE application_id=? ORDER BY evaluated_at DESC,rowid DESC LIMIT 1").get(applicationId);return r?this.map(r):null;}
  forApplication(applicationId){return this.connection.prepare("SELECT * FROM submission_preflight_evaluations WHERE application_id=? ORDER BY evaluated_at DESC,rowid DESC").all(applicationId).map(r=>this.map(r));}
  map(r){const gates=parseJson(r.gates_json,[]),freshness=gates.find(item=>item.id==="INSPECTION_FRESHNESS")?.details||{},jobCheck=gates.find(item=>item.id==="JOB_OPEN")?.details||{},formSnapshot=parseJson(r.form_snapshot_json,[]);return {id:r.id,applicationId:r.application_id,adapterType:r.adapter_type,status:r.status,gates,blockingReasons:parseJson(r.blocking_reasons_json,[]),warnings:parseJson(r.warnings_json,[]),formSnapshot,formStructureHash:freshness.formStructureHash||"",domSignature:freshness.domSignature||"",inspectionId:freshness.inspectionId||"",jobCheck,answerSnapshotHash:r.answer_snapshot_hash,snapshotHash:r.snapshot_hash,readyForPreview:Boolean(r.ready_for_preview),readyForConsent:Boolean(r.ready_for_consent),readyForSubmit:Boolean(r.ready_for_submit),fresh:Boolean(freshness.fresh),submissionEnabled:gates.find(item=>item.id==="KILL_SWITCH")?.status==="READY",version:r.version,evaluatedAt:r.evaluated_at,freshUntil:freshness.inspectedAt&&freshness.maxAgeMs?new Date(Date.parse(freshness.inspectedAt)+Number(freshness.maxAgeMs)).toISOString():""};}
}

export class SubmissionConsentRepository{
  constructor(connection){this.connection=connection;}
  create(item){const id=item.id||`submission-consent-${randomUUID()}`;this.connection.prepare("UPDATE submission_consents SET status='REVOKED' WHERE application_id=? AND status='ACTIVE'").run(item.applicationId);this.connection.prepare(`INSERT INTO submission_consents(id,application_id,preflight_id,resume_version_id,answer_snapshot_hash,preflight_snapshot_hash,scope,token_hash,status,consented_at,expires_at,authorization_source,authorization_reference,authorization_snapshot_hash) VALUES(?,?,?,?,?,?, 'CONTROLLED_SUBMIT',?,'ACTIVE',?,?,?,?,?)`).run(id,item.applicationId,item.preflightId,item.resumeVersionId,item.answerSnapshotHash,item.preflightSnapshotHash,item.tokenHash,item.consentedAt||now(),item.expiresAt,item.authorizationSource,item.authorizationReference,item.authorizationSnapshotHash);return this.findById(id);}
  findById(id){const r=this.connection.prepare("SELECT * FROM submission_consents WHERE id=?").get(id);return r?this.map(r):null;}
  findActiveByTokenHash(hash){const r=this.connection.prepare("SELECT * FROM submission_consents WHERE token_hash=? AND status='ACTIVE'").get(hash);return r?this.map(r):null;}
  consume(id){const t=now(),result=this.connection.prepare("UPDATE submission_consents SET status='CONSUMED',consumed_at=? WHERE id=? AND status='ACTIVE' AND expires_at>?").run(t,id,t);return result.changes?this.findById(id):null;}
  expireBefore(timestamp=now()){return this.connection.prepare("UPDATE submission_consents SET status='EXPIRED' WHERE status='ACTIVE' AND expires_at<=?").run(timestamp).changes;}
  latest(applicationId){const r=this.connection.prepare("SELECT * FROM submission_consents WHERE application_id=? ORDER BY consented_at DESC,rowid DESC LIMIT 1").get(applicationId);return r?this.map(r):null;}
  map(r){return {id:r.id,applicationId:r.application_id,preflightId:r.preflight_id,resumeVersionId:r.resume_version_id,answerSnapshotHash:r.answer_snapshot_hash,preflightSnapshotHash:r.preflight_snapshot_hash,scope:r.scope,status:r.status,consentedAt:r.consented_at,expiresAt:r.expires_at,consumedAt:r.consumed_at||"",authorizationSource:r.authorization_source,authorizationReference:r.authorization_reference,authorizationSnapshotHash:r.authorization_snapshot_hash};}
}

export class AutoApplyRunRepository{
  constructor(connection,database){this.connection=connection;this.database=database;}
  find(requestId){const row=this.connection.prepare("SELECT * FROM auto_apply_runs WHERE request_id=?").get(requestId);return row?this.map(row):null;}
  context(input={}){
    return {resumeVersionId:String(input.resumeVersionId||""),request:{id:String(input.request?.id||""),source:String(input.request?.source||""),approvalRequestId:String(input.request?.approvalRequestId||""),decisionId:String(input.request?.decisionId||"")}};
  }
  enqueue({requestId,applicationId,source,context={}}){
    const t=now(),existing=this.find(requestId);
    if(existing&&existing.applicationId!==applicationId)throw Object.assign(new Error("Solicitacao pertence a outra candidatura."),{code:"AUTOAPPLY_REQUEST_SCOPE_CONFLICT",status:409});
    this.connection.prepare("INSERT INTO auto_apply_runs(request_id,application_id,source,status,context_json,started_at,updated_at,available_at) VALUES(?,?,?,'RETRYABLE',?,?,?,?) ON CONFLICT(request_id) DO NOTHING")
      .run(requestId,applicationId,source,JSON.stringify(this.context(context)),t,t,t);
    return this.find(requestId);
  }
  claim({requestId,applicationId,source,context={},workerId="legacy",leaseMs=60000,recoverExpired=true}){
    return this.database.transaction(()=>{
      if(recoverExpired)this.recoverExpired();
      let existing=this.find(requestId);
      if(existing&&existing.applicationId!==applicationId)throw Object.assign(new Error("A solicitacao pertence a outra candidatura."),{code:"AUTOAPPLY_REQUEST_SCOPE_CONFLICT",status:409});
      if(existing&&existing.status!=="RETRYABLE")return {run:existing,reused:true};
      const active=this.connection.prepare("SELECT request_id FROM auto_apply_runs WHERE application_id=? AND status='RUNNING' AND request_id<>? LIMIT 1").get(applicationId,requestId);
      if(active)return {run:this.find(active.request_id),reused:true};
      if(!existing)existing=this.enqueue({requestId,applicationId,source,context});
      const at=now(),expires=new Date(Date.now()+Math.max(1000,Number(leaseMs)||60000)).toISOString();
      this.connection.prepare("UPDATE auto_apply_runs SET status='RUNNING',source=?,result_json='{}',error_code='',started_at=?,updated_at=?,completed_at=NULL,locked_by=?,lease_expires_at=?,generation=generation+1,attempt_count=attempt_count+1 WHERE request_id=? AND status='RETRYABLE'")
        .run(source,at,at,workerId,expires,requestId);
      return {run:this.find(requestId),reused:false};
    });
  }
  owns(requestId,workerId,generation){
    return Boolean(this.connection.prepare("SELECT 1 FROM auto_apply_runs WHERE request_id=? AND status='RUNNING' AND locked_by=? AND generation=? AND lease_expires_at>?").get(requestId,workerId,generation,now()));
  }
  renew(requestId,workerId,generation,leaseMs=60000){
    const at=now(),expires=new Date(Date.now()+leaseMs).toISOString();
    return this.connection.prepare("UPDATE auto_apply_runs SET lease_expires_at=?,updated_at=? WHERE request_id=? AND status='RUNNING' AND locked_by=? AND generation=? AND lease_expires_at>?").run(expires,at,requestId,workerId,generation,at).changes>0;
  }
  complete(requestId,result,{workerId="legacy",generation}={}){
    const at=now(),guard=generation===undefined?"locked_by='legacy'":"locked_by=? AND generation=? AND lease_expires_at>?";
    this.connection.prepare("UPDATE auto_apply_runs SET status='COMPLETED',result_json=?,error_code=?,updated_at=?,completed_at=?,locked_by=NULL,lease_expires_at=NULL WHERE request_id=? AND status='RUNNING' AND "+guard)
      .run(JSON.stringify(result||{}),String(result?.errorCode||""),at,at,requestId,...(generation===undefined?[]:[workerId,generation,at]));
    return this.find(requestId);
  }
  finishPending(requestId,result){
    const at=now();this.connection.prepare("UPDATE auto_apply_runs SET status='COMPLETED',result_json=?,error_code=?,updated_at=?,completed_at=? WHERE request_id=? AND status='RETRYABLE'")
      .run(JSON.stringify(result),String(result.reason||result.errorCode||""),at,at,requestId);
  }
  pending(limit=1,{since="",manualOnly=false}={}){return this.connection.prepare("SELECT * FROM auto_apply_runs WHERE status='RETRYABLE' AND available_at<=? AND started_at>=? AND (?=0 OR (json_extract(context_json,'$.request.source')='MOBILE' AND coalesce(json_extract(context_json,'$.request.decisionId'),'')<>'')) ORDER BY updated_at,request_id LIMIT ?").all(now(),since,manualOnly?1:0,Math.max(1,Math.min(10,limit))).map(row=>this.map(row));}
  recoverExpired(){const at=now();return this.connection.prepare("UPDATE auto_apply_runs SET status='RETRYABLE',locked_by=NULL,lease_expires_at=NULL,error_code='AUTOAPPLY_LEASE_EXPIRED',updated_at=? WHERE status='RUNNING' AND lease_expires_at<=?").run(at,at).changes;}
  // Called at startup only while the exclusive data-directory owner lease is held.
  recoverInterrupted(){const at=now();return this.connection.prepare("UPDATE auto_apply_runs SET status='RETRYABLE',locked_by=NULL,lease_expires_at=NULL,error_code='AUTOAPPLY_PROCESS_RESTARTED',updated_at=? WHERE status='RUNNING'").run(at).changes;}
  map(row){return {requestId:row.request_id,applicationId:row.application_id,source:row.source,status:row.status,result:parseJson(row.result_json,{}),context:parseJson(row.context_json,{}),workerId:row.locked_by||"",leaseExpiresAt:row.lease_expires_at||"",generation:row.generation,attemptCount:row.attempt_count,errorCode:row.error_code||"",startedAt:row.started_at,updatedAt:row.updated_at,completedAt:row.completed_at||""};}
}

export class SubmissionAttemptRepository{
  constructor(connection,database){this.connection=connection;this.database=database;}
  findById(id){const r=this.connection.prepare("SELECT * FROM submission_attempts WHERE id=?").get(id);return r?this.map(r):null;}
  findByIdempotencyKey(key){const r=this.connection.prepare("SELECT * FROM submission_attempts WHERE idempotency_key=?").get(key);return r?this.map(r):null;}
  latest(applicationId){const r=this.connection.prepare("SELECT * FROM submission_attempts WHERE application_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(applicationId);return r?this.map(r):null;}
  countSince(timestamp){return this.connection.prepare("SELECT COUNT(*) count FROM submission_attempts WHERE created_at>=?").get(timestamp).count;}
  begin(item,{lockTtlMs=120000}={}){return this.database.transaction(()=>{const existing=this.findByIdempotencyKey(item.idempotencyKey);if(existing){if(existing.applicationId!==item.applicationId)throw Object.assign(new Error("Idempotency-Key já pertence a outra candidatura."),{code:"IDEMPOTENCY_KEY_SCOPE_CONFLICT",status:409});return {attempt:existing,reused:true};}const active=this.connection.prepare("SELECT id FROM submission_attempts WHERE application_id=? AND status IN ('PENDING','SUBMITTING','UNCERTAIN')").get(item.applicationId);if(active)throw Object.assign(new Error("Já existe uma tentativa de envio ativa ou incerta."),{code:"SUBMISSION_LOCKED",status:409});const id=item.id||`submission-attempt-${randomUUID()}`,t=now(),expiresAt=new Date(Date.now()+lockTtlMs).toISOString();this.connection.prepare(`INSERT INTO submission_attempts(id,application_id,consent_id,preflight_id,idempotency_key,adapter_type,status,phase,created_at,updated_at) VALUES(?,?,?,?,?,?,'PENDING','PRE_ACTION',?,?)`).run(id,item.applicationId,item.consentId,item.preflightId,item.idempotencyKey,item.adapterType,t,t);this.connection.prepare("INSERT INTO submission_locks(application_id,submission_attempt_id,locked_at,expires_at) VALUES(?,?,?,?)").run(item.applicationId,id,t,expiresAt);return {attempt:this.findById(id),reused:false};});}
  transition(id,status,{phase,errorCode="",failureClass="",completed=false}={}){
    return this.database.transaction(()=>{
      const current=this.findById(id),allowed={
        PENDING:["PENDING","SUBMITTING","FAILED","BLOCKED"],
        SUBMITTING:["SUBMITTING","SUBMITTED","UNCERTAIN","FAILED","BLOCKED"],
        UNCERTAIN:["UNCERTAIN","SUBMITTED","FAILED"],
        SUBMITTED:["SUBMITTED"],FAILED:["FAILED"],BLOCKED:["BLOCKED"]
      };
      const nextPhase=phase||current?.phase,phases=["PRE_ACTION","ACTION_TRIGGERED","CONFIRMATION"];
      const reconciled=failureClass==="RECONCILED_NOT_SUBMITTED";
      if(!current||!allowed[current.status]?.includes(status)||phases.indexOf(nextPhase)<phases.indexOf(current.phase)||!phases.includes(nextPhase)||
        current.phase!=="PRE_ACTION"&&["FAILED","BLOCKED"].includes(status)&&!reconciled)
        throw Object.assign(new Error("Transicao de tentativa de envio nao permitida."),{code:"INVALID_SUBMISSION_TRANSITION",status:409});
      const t=now();
      this.connection.prepare("UPDATE submission_attempts SET status=?,phase=?,error_code=?,failure_class=?,updated_at=?,completed_at=? WHERE id=?")
        .run(status,nextPhase,errorCode||null,failureClass||null,t,completed?t:null,id);
      if(["SUBMITTED","FAILED","BLOCKED"].includes(status))this.connection.prepare("DELETE FROM submission_locks WHERE submission_attempt_id=?").run(id);
      return this.findById(id);
    });
  }
  recoverExpired(timestamp=now()){return this.database.transaction(()=>{const rows=this.connection.prepare("SELECT a.id,a.application_id FROM submission_attempts a JOIN submission_locks l ON l.submission_attempt_id=a.id WHERE l.expires_at<=? AND a.status IN ('PENDING','SUBMITTING')").all(timestamp);for(const row of rows){const attempt=this.findById(row.id),postAction=attempt.phase!=="PRE_ACTION";this.transition(row.id,postAction?"UNCERTAIN":"FAILED",{phase:attempt.phase,errorCode:"SUBMISSION_CRASH_RECOVERY",failureClass:postAction?"UNKNOWN_SUBMISSION_STATE":"TRANSIENT",completed:!postAction});}return rows.map(row=>({id:row.id,applicationId:row.application_id,attempt:this.findById(row.id)}));});}
  recoverInterrupted(){return this.database.transaction(()=>{const rows=this.connection.prepare("SELECT a.id,a.application_id FROM submission_attempts a JOIN submission_locks l ON l.submission_attempt_id=a.id WHERE a.status IN ('PENDING','SUBMITTING')").all();for(const row of rows){const attempt=this.findById(row.id),receipt=this.connection.prepare('SELECT id FROM submission_receipts WHERE submission_attempt_id=?').get(row.id);if(receipt){this.transition(row.id,'SUBMITTED',{phase:'CONFIRMATION',completed:true});continue;}const postAction=attempt.phase!=="PRE_ACTION";this.transition(row.id,postAction?"UNCERTAIN":"FAILED",{phase:attempt.phase,errorCode:"SUBMISSION_CRASH_RECOVERY",failureClass:postAction?"UNKNOWN_SUBMISSION_STATE":"TRANSIENT",completed:!postAction});}return rows.map(row=>({id:row.id,applicationId:row.application_id,attempt:this.findById(row.id)}));});}
  map(r){return {id:r.id,applicationId:r.application_id,consentId:r.consent_id,preflightId:r.preflight_id,idempotencyKey:r.idempotency_key,adapterType:r.adapter_type,status:r.status,phase:r.phase,failureClass:r.failure_class||"",errorCode:r.error_code||"",createdAt:r.created_at,updatedAt:r.updated_at,completedAt:r.completed_at||""};}
}

export class SubmissionReceiptRepository{
  constructor(connection){this.connection=connection;}
  create(item){const id=item.id||`submission-receipt-${randomUUID()}`;this.connection.prepare(`INSERT INTO submission_receipts(id,application_id,submission_attempt_id,provider,external_reference,confirmation_url,confirmation_text,submitted_at,receipt_hash,resume_version_id,answer_snapshot_hash,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_attempt_id) DO NOTHING`).run(id,item.applicationId,item.submissionAttemptId,item.provider,item.externalReference||"",item.confirmationUrl||"",String(item.confirmationText||"").slice(0,1000),item.submittedAt,item.receiptHash,item.resumeVersionId,item.answerSnapshotHash,JSON.stringify(item.metadata||{}),item.createdAt||now());return this.forAttempt(item.submissionAttemptId);}
  forAttempt(id){const r=this.connection.prepare("SELECT * FROM submission_receipts WHERE submission_attempt_id=?").get(id);return r?this.map(r):null;}
  latest(applicationId){const r=this.connection.prepare("SELECT * FROM submission_receipts WHERE application_id=? ORDER BY submitted_at DESC,rowid DESC LIMIT 1").get(applicationId);return r?this.map(r):null;}
  map(r){return {id:r.id,applicationId:r.application_id,submissionAttemptId:r.submission_attempt_id,provider:r.provider,externalReference:r.external_reference,confirmationUrl:r.confirmation_url,confirmationText:r.confirmation_text,submittedAt:r.submitted_at,receiptHash:r.receipt_hash,resumeVersionId:r.resume_version_id,answerSnapshotHash:r.answer_snapshot_hash,metadata:parseJson(r.metadata_json,{}),createdAt:r.created_at};}
}
