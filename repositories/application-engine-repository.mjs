import { randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now = () => new Date().toISOString();

export class ApplicationPlanRepository {
  constructor(connection) { this.connection = connection; }
  save(plan) {
    const current = this.forApplication(plan.applicationId);
    const timestamp = now();
    const id = current?.id || `plan-${randomUUID()}`;
    this.connection.prepare(`INSERT INTO application_plans
      (id, application_id, analysis_id, selected_resume_id, selected_resume_version_id, selected_archetype_id, ats_type, decision, match_score, eligibility, requires_review,
       blocking_issues_json, warnings_json, unknown_requirements_json, reasons_json, policy_snapshot_json, greenhouse_identity_json, preflight_json, profile_completeness_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(application_id) DO UPDATE SET analysis_id=excluded.analysis_id, selected_resume_id=excluded.selected_resume_id, selected_resume_version_id=excluded.selected_resume_version_id, selected_archetype_id=excluded.selected_archetype_id,
       ats_type=excluded.ats_type, decision=excluded.decision, match_score=excluded.match_score, eligibility=excluded.eligibility,
       requires_review=1, blocking_issues_json=excluded.blocking_issues_json, warnings_json=excluded.warnings_json,
       unknown_requirements_json=excluded.unknown_requirements_json, reasons_json=excluded.reasons_json,
       policy_snapshot_json=excluded.policy_snapshot_json, greenhouse_identity_json=excluded.greenhouse_identity_json,
       preflight_json=excluded.preflight_json, profile_completeness_json=excluded.profile_completeness_json, updated_at=excluded.updated_at`)
      .run(id, plan.applicationId, plan.analysisId || null, plan.selectedResumeId || null, plan.selectedResumeVersionId || null, plan.selectedArchetypeId || null, plan.atsType || "unknown", plan.decision,
        plan.matchScore, plan.eligibility, JSON.stringify(plan.blockingIssues || []), JSON.stringify(plan.warnings || []),
        JSON.stringify(plan.unknownRequirements || []), JSON.stringify(plan.reasons || []), JSON.stringify(plan.policySnapshot || {}), JSON.stringify(plan.greenhouseIdentity||current?.greenhouseIdentity||{}), JSON.stringify(plan.preflight||current?.preflight||{}), JSON.stringify(plan.profileCompleteness||current?.profileCompleteness||{}), current?.createdAt || timestamp, timestamp);
    return this.forApplication(plan.applicationId);
  }
  forApplication(id) {
    const r = this.connection.prepare("SELECT * FROM application_plans WHERE application_id = ?").get(id);
    return r ? { id:r.id, applicationId:r.application_id, analysisId:r.analysis_id||"", selectedResumeId:r.selected_resume_id||"", selectedResumeVersionId:r.selected_resume_version_id||"", selectedArchetypeId:r.selected_archetype_id||"GENERAL", atsType:r.ats_type,
      decision:r.decision, matchScore:r.match_score, eligibility:r.eligibility, requiresReview:Boolean(r.requires_review),
      blockingIssues:parseJson(r.blocking_issues_json,[]), warnings:parseJson(r.warnings_json,[]), unknownRequirements:parseJson(r.unknown_requirements_json,[]),
      reasons:parseJson(r.reasons_json,[]), policySnapshot:parseJson(r.policy_snapshot_json,{}), greenhouseIdentity:parseJson(r.greenhouse_identity_json,{}), preflight:parseJson(r.preflight_json,{}), profileCompleteness:parseJson(r.profile_completeness_json,{}), createdAt:r.created_at, updatedAt:r.updated_at } : null;
  }
}
export class ApplicationQuestionRepository {
  constructor(connection) { this.connection=connection; }
  sync(applicationId, fields=[]) {
    const timestamp=now();
    for(const f of fields){const current=this.connection.prepare("SELECT * FROM application_questions WHERE application_id=? AND (external_key=? OR (fingerprint IS NOT NULL AND fingerprint=?)) ORDER BY CASE WHEN fingerprint=? THEN 0 ELSE 1 END LIMIT 1").get(applicationId,f.externalKey,f.fingerprint||"",f.fingerprint||"");
      const values=[f.externalKey,f.semanticKey||"CUSTOM.QUESTION",f.label||"",f.fieldType||f.type||"text",f.required?1:0,JSON.stringify(f.options||[]),f.answer===undefined||f.answer===null?null:JSON.stringify(f.answer),f.answerSource||null,f.answerStatus||(f.required?"USER_REQUIRED":"UNKNOWN"),f.sensitive?1:0,f.fingerprint||null,f.normalizedQuestion||"",f.questionClass||"CUSTOM_UNKNOWN",f.answerCategory||"APPLICATION_SPECIFIC",f.description||"",f.multiple?1:0,Number(f.confidence||0),JSON.stringify(f.signals||[]),f.consentType||null,f.reusable?1:0,f.reasonRequired||"",timestamp];
      if(current)this.connection.prepare(`UPDATE application_questions SET external_key=?,semantic_key=?,label=?,field_type=?,required=?,options_json=?,answer_value_json=COALESCE(answer_value_json,?),answer_source=COALESCE(answer_source,?),answer_status=CASE WHEN answer_value_json IS NULL THEN ? ELSE answer_status END,sensitive=?,fingerprint=?,normalized_question=?,question_class=?,answer_category=?,description=?,multiple=?,confidence=?,signals_json=?,consent_type=?,reusable=?,reason_required=?,updated_at=? WHERE id=?`).run(...values,current.id);
      else this.connection.prepare(`INSERT INTO application_questions(id,application_id,external_key,semantic_key,label,field_type,required,options_json,answer_value_json,answer_source,answer_status,sensitive,fingerprint,normalized_question,question_class,answer_category,description,multiple,confidence,signals_json,consent_type,reusable,reason_required,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`question-${randomUUID()}`,applicationId,...values.slice(0,-1),timestamp,timestamp);
    }
    return this.forApplication(applicationId);
  }
  answer(applicationId,id,value,{source="USER_CONFIRMED",reusable=false}={}) {
    const result=this.connection.prepare("UPDATE application_questions SET answer_value_json=?,answer_source=?,answer_status='KNOWN',reusable=?,updated_at=? WHERE id=? AND application_id=?")
      .run(JSON.stringify(value),source,reusable?1:0,now(),id,applicationId);
    if(!result.changes) throw new Error("Pergunta nao encontrada.");
    return this.forApplication(applicationId).find((q)=>q.id===id);
  }
  forApplication(id) { return this.connection.prepare("SELECT * FROM application_questions WHERE application_id=? ORDER BY created_at,rowid").all(id).map((r)=>({
    id:r.id,applicationId:r.application_id,externalKey:r.external_key,semanticKey:r.semantic_key,label:r.label,fieldType:r.field_type,required:Boolean(r.required),options:parseJson(r.options_json,[]),
    answerValue:r.answer_value_json===null?null:parseJson(r.answer_value_json,null),answerSource:r.answer_source||"",answerStatus:r.answer_status,sensitive:Boolean(r.sensitive),fingerprint:r.fingerprint||"",normalizedQuestion:r.normalized_question||"",questionClass:r.question_class||"CUSTOM_UNKNOWN",answerCategory:r.answer_category||"APPLICATION_SPECIFIC",description:r.description||"",multiple:Boolean(r.multiple),confidence:r.confidence||0,signals:parseJson(r.signals_json,[]),consentType:r.consent_type||"",reusable:Boolean(r.reusable),reasonRequired:r.reason_required||"",createdAt:r.created_at,updatedAt:r.updated_at
  })); }
}

export class CandidateAnswerRepository {
  constructor(connection){this.connection=connection;}
  saveConfirmed(question,value,{reusable=false,scope={}}={}){if(!question?.fingerprint)throw new Error("Pergunta sem fingerprint nao pode ser memorizada.");const canReuse=Boolean(reusable)&&["FACT","PREFERENCE"].includes(question.answerCategory)&&!question.sensitive&&!question.consentType;const timestamp=now();this.connection.prepare(`INSERT INTO candidate_answers(id,fingerprint,semantic_key,normalized_question,answer_value_json,answer_type,answer_category,source,verified,reusable,sensitive,scope_json,created_at,updated_at,last_used_at) VALUES(?,?,?,?,?,?,?,?,1,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET answer_value_json=excluded.answer_value_json,answer_type=excluded.answer_type,answer_category=excluded.answer_category,source='USER_CONFIRMED',verified=1,reusable=excluded.reusable,sensitive=excluded.sensitive,scope_json=excluded.scope_json,updated_at=excluded.updated_at`).run(`answer-${randomUUID()}`,question.fingerprint,question.semanticKey,question.normalizedQuestion,JSON.stringify(value),question.fieldType,question.answerCategory,"USER_CONFIRMED",canReuse?1:0,question.sensitive?1:0,JSON.stringify(scope),timestamp,timestamp,null);return this.findByFingerprint(question.fingerprint);}
  findByFingerprint(fingerprint){const r=this.connection.prepare("SELECT * FROM candidate_answers WHERE fingerprint=?").get(fingerprint);return r?this.map(r):null;}
  reusable(){return this.connection.prepare("SELECT * FROM candidate_answers WHERE verified=1 AND reusable=1 ORDER BY updated_at DESC").all().map(r=>this.map(r));}
  all(){return this.connection.prepare("SELECT * FROM candidate_answers ORDER BY updated_at DESC").all().map(r=>this.map(r));}
  markUsed(fingerprint){this.connection.prepare("UPDATE candidate_answers SET last_used_at=? WHERE fingerprint=?").run(now(),fingerprint);}
  updatePolicy(fingerprint,{reusable=false}={}){const current=this.findByFingerprint(fingerprint);if(!current)throw Object.assign(new Error("Resposta confirmada não encontrada."),{code:"CANDIDATE_ANSWER_NOT_FOUND"});const canReuse=Boolean(reusable)&&["FACT","PREFERENCE"].includes(current.answerCategory)&&!current.sensitive;this.connection.prepare("UPDATE candidate_answers SET reusable=?,updated_at=? WHERE fingerprint=?").run(canReuse?1:0,now(),fingerprint);return this.findByFingerprint(fingerprint);}
  updateConfirmed(fingerprint,{value,reusable=false}={}){const current=this.findByFingerprint(fingerprint);if(!current)throw Object.assign(new Error("Resposta confirmada não encontrada."),{code:"CANDIDATE_ANSWER_NOT_FOUND"});const canReuse=Boolean(reusable)&&["FACT","PREFERENCE"].includes(current.answerCategory)&&!current.sensitive;this.connection.prepare("UPDATE candidate_answers SET answer_value_json=?,source='USER_CONFIRMED',verified=1,reusable=?,updated_at=? WHERE fingerprint=?").run(JSON.stringify(value),canReuse?1:0,now(),fingerprint);return this.findByFingerprint(fingerprint);}
  map(r){return {id:r.id,fingerprint:r.fingerprint,semanticKey:r.semantic_key,normalizedQuestion:r.normalized_question,answerValue:parseJson(r.answer_value_json,null),answerType:r.answer_type,answerCategory:r.answer_category,source:r.source,verified:Boolean(r.verified),reusable:Boolean(r.reusable),sensitive:Boolean(r.sensitive),scope:parseJson(r.scope_json,{}),createdAt:r.created_at,updatedAt:r.updated_at,lastUsedAt:r.last_used_at||""};}
}

export class GreenhouseJobMetadataRepository {
  constructor(connection){this.connection=connection;}
  save(jobId,identity,metadata={}){const timestamp=now();const current=this.forJob(jobId);this.connection.prepare(`INSERT INTO greenhouse_job_metadata(id,job_id,board_token,job_post_id,canonical_url,aggregator_url,board_name,language,title,location,metadata_json,source,fetched_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET board_token=excluded.board_token,job_post_id=excluded.job_post_id,canonical_url=excluded.canonical_url,aggregator_url=excluded.aggregator_url,board_name=excluded.board_name,language=excluded.language,title=excluded.title,location=excluded.location,metadata_json=excluded.metadata_json,source=excluded.source,fetched_at=excluded.fetched_at,updated_at=excluded.updated_at`).run(current?.id||`greenhouse-job-${randomUUID()}`,jobId,identity.boardToken||"",identity.jobPostId||"",identity.canonicalUrl||"",identity.aggregatorUrl||"",identity.boardName||"",identity.language||"",identity.title||"",identity.location||"",JSON.stringify(metadata||{}),metadata?.source||"dom",metadata?.fetchedAt||null,current?.createdAt||timestamp,timestamp);return this.forJob(jobId);}
  forJob(jobId){const r=this.connection.prepare("SELECT * FROM greenhouse_job_metadata WHERE job_id=?").get(jobId);return r?this.map(r):null;}
  findIdentity(boardToken,jobPostId){const r=this.connection.prepare("SELECT * FROM greenhouse_job_metadata WHERE board_token=? AND job_post_id=?").get(boardToken,jobPostId);return r?this.map(r):null;}
  map(r){return {id:r.id,jobId:r.job_id,boardToken:r.board_token,jobPostId:r.job_post_id,canonicalUrl:r.canonical_url,aggregatorUrl:r.aggregator_url,boardName:r.board_name,language:r.language,title:r.title,location:r.location,metadata:parseJson(r.metadata_json,{}),source:r.source,fetchedAt:r.fetched_at||"",createdAt:r.created_at,updatedAt:r.updated_at};}
}

export class ApplicationInspectionRepository {
  constructor(connection){this.connection=connection;}
  create(item){const createdAt=now();const report=item.report||{};const id=item.id||`inspection-${randomUUID()}`;this.connection.prepare(`INSERT INTO application_inspections(id,application_id,attempt_id,adapter_type,adapter_version,detected_variant,compatibility_confidence,health,dom_signature,fields_found,required_fields,known_fields,unknown_fields,validation_failures_json,unsupported_signals_json,warnings_json,report_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,item.applicationId||null,item.attemptId||null,item.adapterType,item.adapterVersion,item.detectedVariant||"unknown",Number(item.compatibilityConfidence||0),item.health,item.domSignature||"",Number(report.fieldsFound||0),Number(report.requiredFields||0),Number(report.knownFields||0),Number(report.unknownFields||0),JSON.stringify(item.validationFailures||[]),JSON.stringify(item.unsupportedSignals||[]),JSON.stringify(item.warnings||[]),JSON.stringify(report),createdAt);return this.findById(id);}
  findById(id){const r=this.connection.prepare("SELECT * FROM application_inspections WHERE id=?").get(id);return r?this.map(r):null;}
  latest(applicationId){const r=this.connection.prepare("SELECT * FROM application_inspections WHERE application_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(applicationId);return r?this.map(r):null;}
  updateOutcome(id,{health,validationFailures=[]}={}){this.connection.prepare("UPDATE application_inspections SET health=COALESCE(?,health),validation_failures_json=? WHERE id=?").run(health||null,JSON.stringify(validationFailures),id);return this.findById(id);}
  map(r){return {id:r.id,applicationId:r.application_id||"",attemptId:r.attempt_id||"",adapterType:r.adapter_type,adapterVersion:r.adapter_version,detectedVariant:r.detected_variant,compatibilityConfidence:r.compatibility_confidence,health:r.health,domSignature:r.dom_signature,fieldsFound:r.fields_found,requiredFields:r.required_fields,knownFields:r.known_fields,unknownFields:r.unknown_fields,validationFailures:parseJson(r.validation_failures_json,[]),unsupportedSignals:parseJson(r.unsupported_signals_json,[]),warnings:parseJson(r.warnings_json,[]),report:parseJson(r.report_json,{}),createdAt:r.created_at};}
}

export class ApplicationQueueRepository {
  constructor(connection,database){this.connection=connection;this.database=database;}
  enqueue(applicationId,mode){const timestamp=now();this.connection.prepare(`INSERT INTO application_queue(id,application_id,mode,status,available_at,created_at,updated_at) VALUES(?,?,?,'QUEUED',?,?,?)
    ON CONFLICT(application_id) DO UPDATE SET mode=excluded.mode,status='QUEUED',available_at=excluded.available_at,locked_at=NULL,locked_by=NULL,last_error_code=NULL,last_error_message=NULL,updated_at=excluded.updated_at`)
    .run(`queue-${randomUUID()}`,applicationId,mode,timestamp,timestamp,timestamp);return this.forApplication(applicationId);}
  claim(workerId,applicationId=null){return this.database.transaction(()=>{const row=applicationId?this.connection.prepare("SELECT * FROM application_queue WHERE application_id=? AND status='QUEUED'").get(applicationId):this.connection.prepare("SELECT * FROM application_queue WHERE status='QUEUED' AND available_at<=? ORDER BY created_at LIMIT 1").get(now());if(!row)return null;const t=now();const result=this.connection.prepare("UPDATE application_queue SET status='RUNNING',locked_at=?,locked_by=?,run_count=run_count+1,updated_at=? WHERE id=? AND status='QUEUED'").run(t,workerId,t,row.id);return result.changes?this.forApplication(row.application_id):null;});}
  finish(applicationId,status,error={}){this.connection.prepare("UPDATE application_queue SET status=?,locked_at=NULL,locked_by=NULL,last_error_code=?,last_error_message=?,updated_at=? WHERE application_id=?").run(status,error.code||null,error.message||null,now(),applicationId);}
  recover(staleBefore){const rows=this.connection.prepare("SELECT * FROM application_queue WHERE status='RUNNING' AND locked_at<?").all(staleBefore);for(const r of rows)this.connection.prepare("UPDATE application_queue SET status='QUEUED',locked_at=NULL,locked_by=NULL,available_at=?,last_error_code='WORKER_CRASH_RECOVERY',updated_at=? WHERE id=?").run(now(),now(),r.id);return rows;}
  forApplication(id){const r=this.connection.prepare("SELECT * FROM application_queue WHERE application_id=?").get(id);return r?{id:r.id,applicationId:r.application_id,mode:r.mode,status:r.status,availableAt:r.available_at,lockedAt:r.locked_at||"",lockedBy:r.locked_by||"",runCount:r.run_count,lastErrorCode:r.last_error_code||"",lastErrorMessage:r.last_error_message||""}:null;}
}
