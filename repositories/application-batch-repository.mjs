import {randomUUID} from "node:crypto";
import {fingerprint} from "../src/application/application-field-schema.mjs";
import {assertDraftTransition,draftError} from "../src/application/application-draft-state.mjs";
const now=()=>new Date().toISOString();
export class ApplicationBatchRepository {
  constructor(connection,database){Object.assign(this,{connection,database});}
  map(r){return r?{...JSON.parse(r.payload_json),id:r.id,jobId:r.job_id,applicationProvider:r.provider,applicationUrl:r.application_url,canonicalIdentity:r.canonical_identity,canonicalIdentityKey:r.canonical_identity_key,attemptNo:r.attempt_no,stateRevision:r.state_revision,resumeVersionId:r.resume_version_id||"",adapterVersion:r.adapter_version,status:r.status,mode:r.mode,applicationId:r.application_id||"",lockedBy:r.locked_by,createdAt:r.created_at,updatedAt:r.updated_at}:null;}
  findItem(id){return this.map(this.connection.prepare("SELECT * FROM application_drafts WHERE id=?").get(id));}
  forApplication(id){return this.map(this.connection.prepare("SELECT * FROM application_drafts WHERE application_id=?").get(id));}
  createDraft(input){
    return this.database.transaction(()=>{
    const key=fingerprint([input.jobId,input.applicationProvider,input.canonicalIdentity,input.resumeVersionId||"",input.adapterVersion]);
    const protectedDraft=this.connection.prepare("SELECT * FROM application_drafts WHERE provider=? AND (canonical_identity=? OR job_id=?) AND status IN ('SUBMITTING','SUBMITTED','SUBMISSION_UNCERTAIN') ORDER BY created_at DESC LIMIT 1").get(input.applicationProvider,input.canonicalIdentity,input.jobId);
    if(protectedDraft)return this.map(protectedDraft);
    const existing=this.connection.prepare("SELECT * FROM application_drafts WHERE canonical_identity_key=? AND status<>'CANCELLED'").get(key);if(existing){if(input.applicationId&&!existing.application_id&&!['SUBMITTING','SUBMITTED','SUBMISSION_UNCERTAIN'].includes(existing.status)){const payload={...JSON.parse(existing.payload_json),applicationId:input.applicationId,approvalRequestId:input.approvalRequestId||""};this.connection.prepare("UPDATE application_drafts SET application_id=?,payload_json=?,updated_at=? WHERE id=?").run(input.applicationId,JSON.stringify(payload),now(),existing.id);return this.findItem(existing.id);}return this.map(existing);}
    if(!["PREPARING","PREPARATION_REQUIRED","BLOCKED"].includes(input.status))throw draftError("DRAFT_INITIAL_STATE_INVALID",null,input.status);
    const attemptNo=this.connection.prepare("SELECT COALESCE(MAX(attempt_no),0)+1 n FROM application_drafts WHERE canonical_identity_key=?").get(key).n;
    const id=`application-draft-${randomUUID()}`,t=now();
    this.connection.prepare("INSERT INTO application_drafts(id,job_id,provider,application_url,canonical_identity,resume_version_id,adapter_version,identity_key,status,mode,payload_json,created_at,updated_at,canonical_identity_key,attempt_no,application_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id,input.jobId,input.applicationProvider,input.applicationUrl,input.canonicalIdentity,input.resumeVersionId||null,input.adapterVersion,`${key}:attempt:${attemptNo}`,input.status,input.mode,JSON.stringify(input),t,t,key,attemptNo,input.applicationId||null);return this.findItem(id);
    });
  }
  transitionItem(id,status,patch={},expected={}){
    const current=this.findItem(id);if(!current)throw draftError("DRAFT_NOT_FOUND");
    const expectedStatus=expected.expectedStatus??current.status,expectedRevision=expected.expectedRevision??current.stateRevision;
    if(current.status!==expectedStatus||current.stateRevision!==expectedRevision)throw draftError("DRAFT_STATE_CONFLICT",current,status);
    assertDraftTransition(current,status);
    const result=this.connection.prepare("UPDATE application_drafts SET status=?,mode=?,application_id=?,payload_json=?,updated_at=?,state_revision=state_revision+1 WHERE id=? AND status=? AND state_revision=?").run(status,patch.mode||current.mode,patch.applicationId||current.applicationId||null,JSON.stringify({...current,...patch,status}),now(),id,expectedStatus,expectedRevision);
    if(!result.changes)throw draftError("DRAFT_STATE_CONFLICT",this.findItem(id),status);
    return this.findItem(id);
  }
  claim(status,owner,{since=""}={}){return this.database.transaction(()=>{const r=this.connection.prepare("SELECT id FROM application_drafts WHERE status=? AND locked_by IS NULL AND updated_at>=? ORDER BY created_at LIMIT 1").get(status,since);if(!r)return null;const result=this.connection.prepare("UPDATE application_drafts SET locked_by=?,state_revision=state_revision+1 WHERE id=? AND status=? AND locked_by IS NULL").run(owner,r.id,status);return result.changes?this.findItem(r.id):null;});}
  release(id,owner){if(owner===undefined)this.connection.prepare("UPDATE application_drafts SET locked_by=NULL WHERE id=?").run(id);else this.connection.prepare("UPDATE application_drafts SET locked_by=NULL WHERE id=? AND locked_by=?").run(id,owner);}
  recover(){this.connection.prepare("UPDATE application_drafts SET status=CASE WHEN status='SUBMITTING' THEN 'SUBMISSION_UNCERTAIN' WHEN status IN ('FILLING','FILLED','VALIDATING') THEN 'PREPARING' ELSE status END,locked_by=NULL,state_revision=state_revision+1 WHERE locked_by IS NOT NULL OR status IN ('FILLING','FILLED','VALIDATING','SUBMITTING')").run();}
  createBatch(drafts,policyMode){const key=fingerprint([drafts.map(d=>d.id).sort(),policyMode]);const existing=this.connection.prepare("SELECT id FROM application_batch_runs WHERE identity_key=?").get(key);if(existing)return this.getBatch(existing.id);return this.database.transaction(()=>{const id=`application-batch-${randomUUID()}`;this.connection.prepare("INSERT INTO application_batch_runs VALUES(?,?,?,?)").run(id,key,policyMode,now());for(const d of drafts)this.connection.prepare("INSERT INTO application_batch_items VALUES(?,?,?)").run(`application-item-${randomUUID()}`,id,d.id);return this.getBatch(id);});}
  getBatch(id){const r=this.connection.prepare("SELECT * FROM application_batch_runs WHERE id=?").get(id);if(!r)return null;const items=this.connection.prepare("SELECT d.* FROM application_drafts d JOIN application_batch_items i ON i.draft_id=d.id WHERE i.batch_id=? ORDER BY i.rowid").all(id).map(x=>this.map(x));const running=items.some(i=>["PREPARING","FILLING","VALIDATING","SUBMITTING"].includes(i.status)),ready=items.filter(i=>["READY_TO_FILL","READY_TO_SUBMIT","SUBMITTED"].includes(i.status)).length;return {id:r.id,policyMode:r.policy_mode,createdAt:r.created_at,status:running?"RUNNING":ready===items.length?"COMPLETE":ready?"PARTIAL_SUCCESS":"REVIEW_REQUIRED",items};}
  list(){return this.connection.prepare("SELECT id FROM application_batch_runs ORDER BY created_at DESC LIMIT 50").all().map(r=>this.getBatch(r.id));}
}
export class ApplicationAnswerLibrary {
  constructor(connection){this.connection=connection;}
  find(identity){const r=this.connection.prepare("SELECT * FROM application_answer_library WHERE question_identity=?").get(identity);return r?{value:JSON.parse(r.value_json),scope:JSON.parse(r.scope_json),provenance:r.provenance}:null;}
  save(field,value){const t=now();this.connection.prepare("INSERT INTO application_answer_library VALUES(?,?,?,?,'USER_CONFIRMED',?,?) ON CONFLICT(question_identity) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(field.questionIdentity,field.normalizedSemanticType,JSON.stringify(value),JSON.stringify({provider:"GUPY",type:field.type,options:field.options}),t,t);}
}
