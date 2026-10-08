import { createHash, randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now = () => new Date().toISOString();
const intelligenceJobIdentity=(task,payload)=>createHash("sha256").update(JSON.stringify([task,payload.jobId||"",payload.resumeId||"",payload.analysisId||"",payload.applicationId||"",payload.questionId||""])).digest("hex");

export const DEFAULT_INTELLIGENCE_POLICIES = Object.freeze({
  semanticEnhancementEnabled: true,
  questionClassificationEnabled: true,
  answerDraftingEnabled: true,
  resumeTailoringEnabled: true,
  coverLetterEnabled: true,
  minimumDeterministicConfidenceBeforeLlm: 0.75,
  requireReviewForGeneratedAnswers: true,
  requireReviewForResumeChanges: true,
  maxConcurrentLocalRequests: 1,
  allowCloudProvider: false
});

export class IntelligenceSettingsRepository {
  constructor(connection){this.connection=connection;}
  get(){const row=this.connection.prepare("SELECT * FROM intelligence_settings WHERE id='default'").get();return row?this.map(row):null;}
  save(input={}){const current=this.get();const createdAt=current?.createdAt||now();const updatedAt=now();const policies={...DEFAULT_INTELLIGENCE_POLICIES,...(current?.policies||{}),...(input.policies||{})};this.connection.prepare(`INSERT INTO intelligence_settings(id,provider,endpoint,fast_model,balanced_model,quality_model,hardware_profile,context_budget,policies_json,created_at,updated_at) VALUES('default',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,endpoint=excluded.endpoint,fast_model=excluded.fast_model,balanced_model=excluded.balanced_model,quality_model=excluded.quality_model,hardware_profile=excluded.hardware_profile,context_budget=excluded.context_budget,policies_json=excluded.policies_json,updated_at=excluded.updated_at`).run(input.provider||current?.provider||"ollama",input.endpoint||current?.endpoint||"http://localhost:11434",input.fastModel??current?.fastModel??"",input.balancedModel??current?.balancedModel??"",input.qualityModel??current?.qualityModel??"",input.hardwareProfile||current?.hardwareProfile||"AUTO",Number(input.contextBudget||current?.contextBudget||4096),JSON.stringify(policies),createdAt,updatedAt);return this.get();}
  map(r){return {id:r.id,provider:r.provider,endpoint:r.endpoint,fastModel:r.fast_model,balancedModel:r.balanced_model,qualityModel:r.quality_model,hardwareProfile:r.hardware_profile,contextBudget:r.context_budget,policies:{...DEFAULT_INTELLIGENCE_POLICIES,...parseJson(r.policies_json,{})},createdAt:r.created_at,updatedAt:r.updated_at};}
}

export class IntelligenceRunRepository {
  constructor(connection){this.connection=connection;}
  create(item){const id=item.id||`intelligence-run-${randomUUID()}`;this.connection.prepare(`INSERT INTO intelligence_runs(id,task,provider,model,prompt_version,schema_version,status,latency_ms,cached,fallback,error_code,context_hash,metrics_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,item.task,item.provider||"none",item.model||"",item.promptVersion,item.schemaVersion,item.status,Math.max(0,Number(item.latencyMs||0)),item.cached?1:0,item.fallback?1:0,item.errorCode||null,item.contextHash||"",JSON.stringify(item.metrics||{}),item.createdAt||now());return this.findById(id);}
  findById(id){const r=this.connection.prepare("SELECT * FROM intelligence_runs WHERE id=?").get(id);return r?this.map(r):null;}
  recent(limit=50){return this.connection.prepare("SELECT * FROM intelligence_runs ORDER BY created_at DESC,rowid DESC LIMIT ?").all(Math.min(500,Math.max(1,Number(limit)))).map(r=>this.map(r));}
  metrics(){const r=this.connection.prepare(`SELECT COUNT(*) calls,SUM(cached) cache_hits,SUM(fallback) fallbacks,COALESCE(AVG(latency_ms),0) average_latency,SUM(CASE WHEN error_code='INVALID_SCHEMA' THEN 1 ELSE 0 END) invalid_schema,SUM(CASE WHEN error_code='PROVIDER_TIMEOUT' THEN 1 ELSE 0 END) timeouts FROM intelligence_runs`).get();return {calls:r.calls,cacheHits:r.cache_hits||0,fallbackCount:r.fallbacks||0,averageLatencyMs:Math.round(r.average_latency||0),invalidSchemaCount:r.invalid_schema||0,timeoutCount:r.timeouts||0};}
  map(r){return {id:r.id,task:r.task,provider:r.provider,model:r.model,promptVersion:r.prompt_version,schemaVersion:r.schema_version,status:r.status,latencyMs:r.latency_ms,cached:Boolean(r.cached),fallback:Boolean(r.fallback),errorCode:r.error_code||"",contextHash:r.context_hash,metrics:parseJson(r.metrics_json,{}),createdAt:r.created_at};}
}

export class IntelligenceCacheRepository {
  constructor(connection){this.connection=connection;}
  get(key){const r=this.connection.prepare("SELECT * FROM intelligence_cache WHERE cache_key=?").get(key);if(!r)return null;this.connection.prepare("UPDATE intelligence_cache SET hit_count=hit_count+1,last_used_at=? WHERE cache_key=?").run(now(),key);return {key:r.cache_key,result:parseJson(r.result_json,null),hitCount:r.hit_count+1};}
  put(item){const timestamp=now();this.connection.prepare(`INSERT INTO intelligence_cache(cache_key,task,prompt_version,schema_version,provider,model,result_json,created_at,last_used_at,hit_count) VALUES(?,?,?,?,?,?,?,?,?,0) ON CONFLICT(cache_key) DO UPDATE SET result_json=excluded.result_json,last_used_at=excluded.last_used_at`).run(item.key,item.task,item.promptVersion,item.schemaVersion,item.provider,item.model,JSON.stringify(item.result),timestamp,timestamp);return this.getWithoutHit(item.key);}
  getWithoutHit(key){const r=this.connection.prepare("SELECT * FROM intelligence_cache WHERE cache_key=?").get(key);return r?{key:r.cache_key,result:parseJson(r.result_json,null),hitCount:r.hit_count}:null;}
}

export class IntelligenceBenchmarkRepository {
  constructor(connection){this.connection=connection;}
  save(item){const id=item.id||`benchmark-${randomUUID()}`;this.connection.prepare(`INSERT INTO intelligence_benchmarks(id,provider,model,hardware_profile,load_latency_ms,first_response_latency_ms,total_latency_ms,throughput,json_validity,schema_validity,semantic_accuracy,timeout_rate,runtime_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,item.provider,item.model,item.hardwareProfile,item.loadLatencyMs??null,item.firstResponseLatencyMs??null,Number(item.totalLatencyMs||0),item.throughput??null,Number(item.jsonValidity||0),Number(item.schemaValidity||0),Number(item.semanticAccuracy||0),Number(item.timeoutRate||0),JSON.stringify(item.runtime||{}),item.createdAt||now());return this.findById(id);}
  findById(id){const r=this.connection.prepare("SELECT * FROM intelligence_benchmarks WHERE id=?").get(id);return r?this.map(r):null;}
  latest(model=""){const r=model?this.connection.prepare("SELECT * FROM intelligence_benchmarks WHERE model=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(model):this.connection.prepare("SELECT * FROM intelligence_benchmarks ORDER BY created_at DESC,rowid DESC LIMIT 1").get();return r?this.map(r):null;}
  all(){return this.connection.prepare("SELECT * FROM intelligence_benchmarks ORDER BY created_at DESC,rowid DESC").all().map(r=>this.map(r));}
  map(r){return {id:r.id,provider:r.provider,model:r.model,hardwareProfile:r.hardware_profile,loadLatencyMs:r.load_latency_ms,firstResponseLatencyMs:r.first_response_latency_ms,totalLatencyMs:r.total_latency_ms,throughput:r.throughput,jsonValidity:r.json_validity,schemaValidity:r.schema_validity,semanticAccuracy:r.semantic_accuracy,timeoutRate:r.timeout_rate,runtime:parseJson(r.runtime_json,{}),createdAt:r.created_at};}
}

export class IntelligenceJobRepository {
  constructor(connection,database){this.connection=connection;this.database=database;}
  enqueue(task,payload={}){const identityKey=intelligenceJobIdentity(task,payload),active=this.connection.prepare("SELECT id FROM intelligence_jobs WHERE status IN ('QUEUED','RUNNING') AND json_extract(payload_json,'$._identityKey')=? ORDER BY created_at LIMIT 1").get(identityKey);if(active)return this.findById(active.id);const id=`intelligence-job-${randomUUID()}`,t=now();this.connection.prepare("INSERT INTO intelligence_jobs(id,task,status,payload_json,available_at,created_at,updated_at) VALUES(?,?,'QUEUED',?,?,?,?)").run(id,task,JSON.stringify({...payload,_identityKey:identityKey}),t,t,t);return this.findById(id);}
  claim(workerId){return this.database.transaction(()=>{const row=this.connection.prepare("SELECT * FROM intelligence_jobs WHERE status='QUEUED' AND available_at<=? ORDER BY created_at LIMIT 1").get(now());if(!row)return null;const t=now();const changed=this.connection.prepare("UPDATE intelligence_jobs SET status='RUNNING',locked_at=?,locked_by=?,updated_at=? WHERE id=? AND status='QUEUED'").run(t,workerId,t,row.id);return changed.changes?this.findById(row.id):null;});}
  complete(id,result){this.connection.prepare("UPDATE intelligence_jobs SET status='COMPLETED',result_json=?,locked_at=NULL,locked_by=NULL,completed_at=?,updated_at=? WHERE id=? AND status='RUNNING'").run(JSON.stringify(result),now(),now(),id);return this.findById(id);}
  fail(id,error){this.connection.prepare("UPDATE intelligence_jobs SET status='FAILED',error_code=?,error_message=?,locked_at=NULL,locked_by=NULL,completed_at=?,updated_at=? WHERE id=? AND status='RUNNING'").run(error.code||"INTELLIGENCE_FAILED",String(error.message||"").slice(0,500),now(),now(),id);return this.findById(id);}
  cancel(id){this.connection.prepare("UPDATE intelligence_jobs SET status='CANCELLED',locked_at=NULL,locked_by=NULL,completed_at=?,updated_at=? WHERE id=? AND status='QUEUED'").run(now(),now(),id);return this.findById(id);}
  recover(staleBefore){return this.connection.prepare("UPDATE intelligence_jobs SET status='QUEUED',locked_at=NULL,locked_by=NULL,error_code='WORKER_CRASH_RECOVERY',updated_at=? WHERE status='RUNNING' AND locked_at<?").run(now(),staleBefore).changes;}
  findById(id){const r=this.connection.prepare("SELECT * FROM intelligence_jobs WHERE id=?").get(id);return r?this.map(r):null;}
  recent(limit=50){return this.connection.prepare("SELECT * FROM intelligence_jobs ORDER BY created_at DESC,rowid DESC LIMIT ?").all(Math.min(200,Math.max(1,Number(limit)))).map(r=>this.map(r));}
  map(r){return {id:r.id,task:r.task,status:r.status,payload:parseJson(r.payload_json,{}),result:r.result_json?parseJson(r.result_json,null):null,availableAt:r.available_at,lockedAt:r.locked_at||"",lockedBy:r.locked_by||"",errorCode:r.error_code||"",errorMessage:r.error_message||"",createdAt:r.created_at,updatedAt:r.updated_at,completedAt:r.completed_at||""};}
}

export class GeneratedContentRepository {
  constructor(connection){this.connection=connection;}
  create(item){const id=item.id||`generated-content-${randomUUID()}`,t=now();this.connection.prepare(`INSERT INTO generated_application_answers(id,application_id,question_id,content_type,state,draft,evidence_ids_json,prompt_version,schema_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,item.applicationId||null,item.questionId||null,item.contentType,item.state||"REVIEW_REQUIRED",String(item.draft||""),JSON.stringify(item.evidenceIds||[]),item.promptVersion,item.schemaVersion,t,t);return this.findById(id);}
  review(id,state){if(!["APPROVED","REJECTED"].includes(state))throw new Error("Estado de revisao invalido.");const result=this.connection.prepare("UPDATE generated_application_answers SET state=?,updated_at=? WHERE id=? AND state IN ('DRAFT','REVIEW_REQUIRED')").run(state,now(),id);return result.changes?this.findById(id):null;}
  findById(id){const r=this.connection.prepare("SELECT * FROM generated_application_answers WHERE id=?").get(id);return r?this.map(r):null;}
  forApplication(id){return this.connection.prepare("SELECT * FROM generated_application_answers WHERE application_id=? ORDER BY created_at DESC").all(id).map(r=>this.map(r));}
  map(r){return {id:r.id,applicationId:r.application_id||"",questionId:r.question_id||"",contentType:r.content_type,state:r.state,draft:r.draft,evidenceIds:parseJson(r.evidence_ids_json,[]),promptVersion:r.prompt_version,schemaVersion:r.schema_version,createdAt:r.created_at,updatedAt:r.updated_at};}
}

export class ResumeTailoringRepository {
  constructor(connection){this.connection=connection;}
  createRun(item){const id=item.id||`tailoring-${randomUUID()}`,t=now();this.connection.prepare(`INSERT INTO resume_tailoring_runs(id,job_id,resume_id,analysis_id,state,original_score,tailored_score,evidence_status,prompt_version,schema_version,quality_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,item.jobId,item.resumeId,item.analysisId||null,item.state||"REVIEW_REQUIRED",item.originalScore??null,item.tailoredScore??null,item.evidenceStatus||"PENDING",item.promptVersion,item.schemaVersion,JSON.stringify(item.quality||{}),t,t);for(const change of item.changes||[])this.addChange(id,change);return this.findRun(id);}
  addChange(runId,item){this.connection.prepare(`INSERT INTO resume_tailoring_changes(id,tailoring_run_id,change_type,source_evidence_ids_json,original_text,proposed_text,reason,validation_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(`tailoring-change-${randomUUID()}`,runId,item.type,JSON.stringify(item.sourceEvidenceIds||[]),item.original||"",item.proposed||"",item.reason||"",item.validationStatus||"VALID",now());}
  review(id,state){if(!["APPROVED","REJECTED"].includes(state))throw new Error("Estado de revisao invalido.");this.connection.prepare("UPDATE resume_tailoring_runs SET state=?,updated_at=? WHERE id=? AND state IN ('DRAFT','REVIEW_REQUIRED')").run(state,now(),id);return this.findRun(id);}
  findRun(id){const r=this.connection.prepare("SELECT * FROM resume_tailoring_runs WHERE id=?").get(id);if(!r)return null;const changes=this.connection.prepare("SELECT * FROM resume_tailoring_changes WHERE tailoring_run_id=? ORDER BY created_at,rowid").all(id).map(c=>({id:c.id,type:c.change_type,sourceEvidenceIds:parseJson(c.source_evidence_ids_json,[]),original:c.original_text,proposed:c.proposed_text,reason:c.reason,validationStatus:c.validation_status}));return {id:r.id,jobId:r.job_id,resumeId:r.resume_id,analysisId:r.analysis_id||"",state:r.state,originalScore:r.original_score,tailoredScore:r.tailored_score,evidenceStatus:r.evidence_status,promptVersion:r.prompt_version,schemaVersion:r.schema_version,quality:parseJson(r.quality_json,{}),changes,createdAt:r.created_at,updatedAt:r.updated_at};}
  list({state=""}={}){const rows=state?this.connection.prepare("SELECT id FROM resume_tailoring_runs WHERE state=? ORDER BY updated_at DESC,rowid DESC").all(state):this.connection.prepare("SELECT id FROM resume_tailoring_runs ORDER BY updated_at DESC,rowid DESC").all();return rows.map(item=>this.findRun(item.id));}
  listSummaries(){return this.connection.prepare("SELECT id,job_id,resume_id,analysis_id,state,original_score,tailored_score,evidence_status,quality_json,created_at,updated_at FROM resume_tailoring_runs ORDER BY updated_at DESC,rowid DESC").all().map(r=>({id:r.id,jobId:r.job_id,resumeId:r.resume_id,analysisId:r.analysis_id||"",state:r.state,originalScore:r.original_score,tailoredScore:r.tailored_score,evidenceStatus:r.evidence_status,quality:parseJson(r.quality_json,{}),changes:[],createdAt:r.created_at,updatedAt:r.updated_at}));}
  latestForJob(jobId){const r=this.connection.prepare("SELECT id FROM resume_tailoring_runs WHERE job_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1").get(jobId);return r?this.findRun(r.id):null;}
  latestFor(jobId,resumeId){const r=this.connection.prepare("SELECT id FROM resume_tailoring_runs WHERE job_id=? AND resume_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(jobId,resumeId);return r?this.findRun(r.id):null;}
  linkApprovedVersion(id,versionId){this.connection.prepare("UPDATE resume_tailoring_runs SET approved_resume_version_id=?,updated_at=? WHERE id=? AND state='APPROVED'").run(versionId,now(),id);return this.findRun(id);}
}

export class SkillGapSnapshotRepository {
  constructor(connection){this.connection=connection;}
  save(snapshot,analysisCount){const id=`skill-gap-${randomUUID()}`;this.connection.prepare("INSERT INTO skill_gap_snapshots(id,analysis_count,snapshot_json,created_at) VALUES(?,?,?,?)").run(id,Number(analysisCount||0),JSON.stringify(snapshot),now());return this.latest();}
  latest(){const r=this.connection.prepare("SELECT * FROM skill_gap_snapshots ORDER BY created_at DESC,rowid DESC LIMIT 1").get();return r?{id:r.id,analysisCount:r.analysis_count,gaps:parseJson(r.snapshot_json,[]),createdAt:r.created_at}:null;}
}
