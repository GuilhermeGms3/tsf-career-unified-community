import { randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now=()=>new Date().toISOString();
const parse=(value,fallback)=>parseJson(value,fallback);

export class AutoApplyPolicyRepository{
  constructor(connection){this.connection=connection;}
  get(){
    const row=this.connection.prepare("SELECT * FROM auto_apply_policy WHERE id='default'").get();
    return row?{enabled:Boolean(row.enabled),minimumAtsScore:Number(row.minimum_ats_score),whatsappMinimumAtsScore:Number(row.whatsapp_minimum_ats_score),whatsappMaximumAtsScore:Number(row.whatsapp_maximum_ats_score),createdAt:row.created_at,updatedAt:row.updated_at}:{enabled:false,minimumAtsScore:80,whatsappMinimumAtsScore:60,whatsappMaximumAtsScore:79,createdAt:"",updatedAt:""};
  }
  save(input={}){
    const current=this.get(),minimumAtsScore=Number(input.minimumAtsScore??current.minimumAtsScore),whatsappMinimumAtsScore=Number(input.whatsappMinimumAtsScore??current.whatsappMinimumAtsScore),whatsappMaximumAtsScore=Number(input.whatsappMaximumAtsScore??current.whatsappMaximumAtsScore);
    if(!Number.isInteger(minimumAtsScore)||minimumAtsScore<0||minimumAtsScore>100)
      throw Object.assign(new Error("A nota mínima do AutoApply deve estar entre 0 e 100."),{code:"AUTO_APPLY_THRESHOLD_INVALID"});
    if(!Number.isInteger(whatsappMinimumAtsScore)||!Number.isInteger(whatsappMaximumAtsScore)||whatsappMinimumAtsScore<0||whatsappMaximumAtsScore>=minimumAtsScore||whatsappMinimumAtsScore>whatsappMaximumAtsScore)
      throw Object.assign(new Error("A faixa do WhatsApp deve ficar entre 0 e a nota de envio automático."),{code:"AUTO_APPLY_WHATSAPP_BAND_INVALID"});
    const timestamp=now(),enabled=input.enabled===true;
    this.connection.prepare("INSERT INTO auto_apply_policy(id,enabled,minimum_ats_score,whatsapp_minimum_ats_score,whatsapp_maximum_ats_score,created_at,updated_at) VALUES('default',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,minimum_ats_score=excluded.minimum_ats_score,whatsapp_minimum_ats_score=excluded.whatsapp_minimum_ats_score,whatsapp_maximum_ats_score=excluded.whatsapp_maximum_ats_score,updated_at=excluded.updated_at").run(enabled?1:0,minimumAtsScore,whatsappMinimumAtsScore,whatsappMaximumAtsScore,current.createdAt||timestamp,timestamp);
    return this.get();
  }
}

export class JobHuntProfileRepository{
  constructor(connection){this.connection=connection;}
  save(item){
    const id=item.id||`job-hunt-profile-${randomUUID()}`,timestamp=now();
    const consider=Number(item.considerThreshold??item.minimumMatchScore??70),prepare=Number(item.prepareResumeThreshold??consider),notify=Number(item.notifyThreshold??consider);
    this.connection.prepare(`INSERT INTO job_hunt_profiles(id,name,enabled,queries_json,locations_json,remote_policy,providers_json,company_watchlist_ids_json,minimum_match_score,allowed_eligibility_json,prepare_resume,notification_policy_json,schedule_json,next_run_at,last_run_at,created_at,updated_at,consider_threshold,prepare_resume_threshold,notify_threshold,source_preferences_json,work_models_json,search_intent_version,job_families_json,seniorities_json,location_policy_json,query_budget_json,mass_hunt)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,enabled=excluded.enabled,queries_json=excluded.queries_json,locations_json=excluded.locations_json,remote_policy=excluded.remote_policy,providers_json=excluded.providers_json,company_watchlist_ids_json=excluded.company_watchlist_ids_json,minimum_match_score=excluded.minimum_match_score,allowed_eligibility_json=excluded.allowed_eligibility_json,prepare_resume=excluded.prepare_resume,notification_policy_json=excluded.notification_policy_json,schedule_json=excluded.schedule_json,next_run_at=excluded.next_run_at,last_run_at=COALESCE(excluded.last_run_at,job_hunt_profiles.last_run_at),consider_threshold=excluded.consider_threshold,prepare_resume_threshold=excluded.prepare_resume_threshold,notify_threshold=excluded.notify_threshold,source_preferences_json=excluded.source_preferences_json,work_models_json=excluded.work_models_json,search_intent_version=excluded.search_intent_version,job_families_json=excluded.job_families_json,seniorities_json=excluded.seniorities_json,location_policy_json=excluded.location_policy_json,query_budget_json=excluded.query_budget_json,mass_hunt=excluded.mass_hunt,updated_at=excluded.updated_at`)
      .run(id,item.name,item.enabled?1:0,JSON.stringify(item.queries||[]),JSON.stringify(item.locations||[]),item.remotePolicy||"ANY",JSON.stringify(item.providers||[]),JSON.stringify(item.companyWatchlistIds||[]),consider,JSON.stringify(item.allowedEligibility||[]),item.prepareResume?1:0,JSON.stringify(item.notificationPolicy||{}),JSON.stringify(item.schedule||{}),item.nextRunAt||null,item.lastRunAt||null,item.createdAt||timestamp,timestamp,consider,prepare,notify,JSON.stringify(item.sourcePreferences||[]),JSON.stringify(item.workModels||[]),Number(item.searchIntentVersion||1),JSON.stringify(item.jobFamilies||[]),JSON.stringify(item.seniorities||[]),JSON.stringify(item.locationPolicy||{}),JSON.stringify(item.queryBudget||{}),item.massHunt?1:0);
    return this.findById(id);
  }
  findById(id){const row=this.connection.prepare("SELECT * FROM job_hunt_profiles WHERE id=?").get(id);return row?this.map(row):null;}
  all(){return this.connection.prepare("SELECT * FROM job_hunt_profiles ORDER BY created_at DESC,rowid DESC").all().map(row=>this.map(row));}
  due(at=now()){return this.connection.prepare("SELECT * FROM job_hunt_profiles WHERE enabled=1 AND next_run_at IS NOT NULL AND next_run_at<=? ORDER BY next_run_at LIMIT 2").all(at).map(row=>this.map(row));}
  markRun(id,{lastRunAt=now(),nextRunAt=null}={}){this.connection.prepare("UPDATE job_hunt_profiles SET last_run_at=?,next_run_at=?,updated_at=? WHERE id=?").run(lastRunAt,nextRunAt,now(),id);return this.findById(id);}
  remove(id){return this.connection.prepare("DELETE FROM job_hunt_profiles WHERE id=?").run(id).changes>0;}
  map(row){
    return {id:row.id,name:row.name,enabled:Boolean(row.enabled),queries:parse(row.queries_json,[]),locations:parse(row.locations_json,[]),remotePolicy:row.remote_policy,workModels:parse(row.work_models_json,[]),providers:parse(row.providers_json,[]),sourcePreferences:parse(row.source_preferences_json,[]),companyWatchlistIds:parse(row.company_watchlist_ids_json,[]),minimumMatchScore:row.minimum_match_score,considerThreshold:row.consider_threshold,prepareResumeThreshold:row.prepare_resume_threshold,notifyThreshold:row.notify_threshold,allowedEligibility:parse(row.allowed_eligibility_json,[]),prepareResume:Boolean(row.prepare_resume),notificationPolicy:parse(row.notification_policy_json,{}),schedule:parse(row.schedule_json,{}),searchIntentVersion:row.search_intent_version||1,jobFamilies:parse(row.job_families_json,[]),seniorities:parse(row.seniorities_json,[]),locationPolicy:parse(row.location_policy_json,{}),queryBudget:parse(row.query_budget_json,{}),massHunt:Boolean(row.mass_hunt),nextRunAt:row.next_run_at||"",lastRunAt:row.last_run_at||"",createdAt:row.created_at,updatedAt:row.updated_at};
  }
}

export class JobHuntRunRepository{
  constructor(connection){this.connection=connection;}
  start(profileId,triggerType){const id=`job-hunt-run-${randomUUID()}`,startedAt=now();this.connection.prepare("INSERT INTO job_hunt_runs(id,profile_id,trigger_type,status,started_at) VALUES(?,?,?,'RUNNING',?)").run(id,profileId,triggerType,startedAt);return this.findById(id);}
  finish(id,{status="COMPLETED",discoveryRunIds=[],discoveredCount=0,matchedCount=0,alertCount=0,digestCount=0,resumePreparationCount=0,queryCount=0,providerCount=0,requestCount=0,rawCount=0,canonicalCount=0,duplicateCount=0,closedCount=0,potentialMatchCount=0,highMatchCount=0,durationMs=0,report={},errorCode=""}={}){this.connection.prepare("UPDATE job_hunt_runs SET status=?,discovery_run_ids_json=?,discovered_count=?,matched_count=?,alert_count=?,digest_count=?,resume_preparation_count=?,query_count=?,provider_count=?,request_count=?,raw_count=?,canonical_count=?,duplicate_count=?,closed_count=?,potential_match_count=?,high_match_count=?,duration_ms=?,report_json=?,error_code=?,completed_at=? WHERE id=?").run(status,JSON.stringify(discoveryRunIds),discoveredCount,matchedCount,alertCount,digestCount,resumePreparationCount,queryCount,providerCount,requestCount,rawCount,canonicalCount,duplicateCount,closedCount,potentialMatchCount,highMatchCount,durationMs,JSON.stringify(report),errorCode||null,now(),id);return this.findById(id);}
  progress(id,{discoveryRunIds=[],discoveredCount=0,matchedCount=0,alertCount=0,digestCount=0,resumePreparationCount=0,queryCount=0,providerCount=0,requestCount=0,rawCount=0,canonicalCount=0,duplicateCount=0,closedCount=0,potentialMatchCount=0,highMatchCount=0,durationMs=0,report={}}={}){this.connection.prepare("UPDATE job_hunt_runs SET discovery_run_ids_json=?,discovered_count=?,matched_count=?,alert_count=?,digest_count=?,resume_preparation_count=?,query_count=?,provider_count=?,request_count=?,raw_count=?,canonical_count=?,duplicate_count=?,closed_count=?,potential_match_count=?,high_match_count=?,duration_ms=?,report_json=? WHERE id=? AND status='RUNNING'").run(JSON.stringify(discoveryRunIds),discoveredCount,matchedCount,alertCount,digestCount,resumePreparationCount,queryCount,providerCount,requestCount,rawCount,canonicalCount,duplicateCount,closedCount,potentialMatchCount,highMatchCount,durationMs,JSON.stringify(report),id);return this.findById(id);}
  pause(id){this.connection.prepare("UPDATE job_hunt_runs SET status='SKIPPED',error_code='USER_PAUSED',completed_at=? WHERE id=? AND status='RUNNING'").run(now(),id);return this.findById(id);}
  findById(id){const row=this.connection.prepare("SELECT * FROM job_hunt_runs WHERE id=?").get(id);return row?this.map(row):null;}
  active(profileId="",maxAgeMs=6*60*60*1000){
    const rows=profileId
      ? this.connection.prepare("SELECT * FROM job_hunt_runs WHERE profile_id=? AND status='RUNNING' ORDER BY started_at DESC").all(profileId)
      : this.connection.prepare("SELECT * FROM job_hunt_runs WHERE status='RUNNING' ORDER BY started_at DESC").all();
    const cutoff=Date.now()-Math.max(0,Number(maxAgeMs)||0);
    return rows.map(row=>this.map(row)).filter(run=>(Date.parse(run.startedAt)||0)>=cutoff);
  }
  recover(){const completedAt=now();return this.connection.prepare("UPDATE job_hunt_runs SET status='FAILED',error_code='PROCESS_INTERRUPTED',completed_at=? WHERE status='RUNNING'").run(completedAt).changes;}
  list(profileId=""){const rows=profileId?this.connection.prepare("SELECT * FROM job_hunt_runs WHERE profile_id=? ORDER BY started_at DESC LIMIT 100").all(profileId):this.connection.prepare("SELECT * FROM job_hunt_runs ORDER BY started_at DESC LIMIT 100").all();return rows.map(row=>this.map(row));}
  map(row){return {id:row.id,profileId:row.profile_id,triggerType:row.trigger_type,status:row.status,discoveryRunIds:parse(row.discovery_run_ids_json,[]),discoveredCount:row.discovered_count,matchedCount:row.matched_count,alertCount:row.alert_count,digestCount:row.digest_count,resumePreparationCount:row.resume_preparation_count,queryCount:row.query_count||0,providerCount:row.provider_count||0,requestCount:row.request_count||0,rawCount:row.raw_count||0,canonicalCount:row.canonical_count||0,duplicateCount:row.duplicate_count||0,closedCount:row.closed_count||0,potentialMatchCount:row.potential_match_count||0,highMatchCount:row.high_match_count||0,durationMs:row.duration_ms||0,report:parse(row.report_json,{}),errorCode:row.error_code||"",startedAt:row.started_at,completedAt:row.completed_at||""};}
}

export class JobAlertRepository{
  constructor(connection){this.connection=connection;}
  findFingerprint(fingerprint,channel="WHATSAPP"){const row=this.connection.prepare("SELECT * FROM job_alerts WHERE notification_fingerprint=? AND channel=?").get(fingerprint,channel);return row?this.map(row):null;}
  create(item){const id=item.id||`job-alert-${randomUUID()}`,timestamp=now();try{this.connection.prepare(`INSERT INTO job_alerts(id,profile_id,run_id,job_id,channel,notification_fingerprint,event_type,status,first_notified_at,last_notified_at,notification_count,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,item.profileId,item.runId,item.jobId,item.channel||"WHATSAPP",item.notificationFingerprint,item.eventType||"JOB_HIGH_MATCH",item.status||"QUEUED",item.firstNotifiedAt||null,item.lastNotifiedAt||null,Number(item.notificationCount||0),JSON.stringify(item.payload||{}),timestamp,timestamp);}catch(error){if(String(error.message).includes("UNIQUE"))return this.findFingerprint(item.notificationFingerprint,item.channel||"WHATSAPP");throw error;}return this.findById(id);}
  findById(id){const row=this.connection.prepare("SELECT * FROM job_alerts WHERE id=?").get(id);return row?this.map(row):null;}
  list({runId="",profileId=""}={}){const rows=runId?this.connection.prepare("SELECT * FROM job_alerts WHERE run_id=? ORDER BY created_at DESC").all(runId):profileId?this.connection.prepare("SELECT * FROM job_alerts WHERE profile_id=? ORDER BY created_at DESC LIMIT 200").all(profileId):this.connection.prepare("SELECT * FROM job_alerts ORDER BY created_at DESC LIMIT 200").all();return rows.map(row=>this.map(row));}
  mark(id,status){const timestamp=now();this.connection.prepare("UPDATE job_alerts SET status=?,first_notified_at=COALESCE(first_notified_at,?),last_notified_at=?,notification_count=notification_count+CASE WHEN ?='SENT' THEN 1 ELSE 0 END,updated_at=? WHERE id=?").run(status,status==="SENT"?timestamp:null,status==="SENT"?timestamp:null,status,timestamp,id);return this.findById(id);}
  map(row){return {id:row.id,profileId:row.profile_id,runId:row.run_id,jobId:row.job_id,channel:row.channel,notificationFingerprint:row.notification_fingerprint,eventType:row.event_type,status:row.status,firstNotifiedAt:row.first_notified_at||"",lastNotifiedAt:row.last_notified_at||"",notificationCount:row.notification_count,payload:parse(row.payload_json,{}),createdAt:row.created_at,updatedAt:row.updated_at};}
}

export class ProviderConfigurationRepository{
  constructor(connection){this.connection=connection;}
  get(providerId){const row=this.connection.prepare("SELECT * FROM provider_configurations WHERE provider_id=?").get(providerId);return row?{providerId:row.provider_id,enabled:Boolean(row.enabled),identity:parse(row.identity_json,{}),updatedAt:row.updated_at}:null;}
  all(){return this.connection.prepare("SELECT * FROM provider_configurations ORDER BY provider_id").all().map(row=>({providerId:row.provider_id,enabled:Boolean(row.enabled),identity:parse(row.identity_json,{}),updatedAt:row.updated_at}));}
  save(providerId,{enabled=true,identity={}}={}){const timestamp=now();this.connection.prepare("INSERT INTO provider_configurations(provider_id,enabled,identity_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET enabled=excluded.enabled,identity_json=excluded.identity_json,updated_at=excluded.updated_at").run(providerId,enabled?1:0,JSON.stringify(identity),timestamp);return this.get(providerId);}
}

export class ProviderHealthRepository{
  constructor(connection){this.connection=connection;}
  record(item){const id=`provider-health-${randomUUID()}`;this.connection.prepare("INSERT INTO provider_health_history(id,provider_id,setup_status,health_status,latency_ms,result_count,error_code,message,checked_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id,item.providerId,item.setupStatus,item.healthStatus,Math.max(0,Number(item.latencyMs||0)),Math.max(0,Number(item.resultCount||0)),item.errorCode||null,String(item.message||"").slice(0,500),item.checkedAt||now());return this.latest(item.providerId);}
  latest(providerId){const row=this.connection.prepare("SELECT * FROM provider_health_history WHERE provider_id=? ORDER BY checked_at DESC,rowid DESC LIMIT 1").get(providerId);return row?{id:row.id,providerId:row.provider_id,setupStatus:row.setup_status,healthStatus:row.health_status,latencyMs:row.latency_ms,resultCount:row.result_count,errorCode:row.error_code||"",message:row.message,checkedAt:row.checked_at}:null;}
  latestAll(){return this.connection.prepare("SELECT DISTINCT provider_id FROM provider_health_history ORDER BY provider_id").all().map(row=>this.latest(row.provider_id));}
}

export class AutomationRunRepository{
  constructor(connection){this.connection=connection;}
  start(runType,aggregateId="",stage="STARTED"){const id=`automation-run-${randomUUID()}`,createdAt=now();this.connection.prepare("INSERT INTO automation_runs(id,run_type,aggregate_id,status,stage,created_at) VALUES(?,?,?,'RUNNING',?,?)").run(id,runType,aggregateId,stage,createdAt);return this.findById(id);}
  finish(id,{status="COMPLETED",stage="COMPLETED",metrics={},errorCode=""}={}){this.connection.prepare("UPDATE automation_runs SET status=?,stage=?,metrics_json=?,error_code=?,completed_at=? WHERE id=?").run(status,stage,JSON.stringify(metrics),errorCode||null,now(),id);return this.findById(id);}
  findById(id){const row=this.connection.prepare("SELECT * FROM automation_runs WHERE id=?").get(id);return row?{id:row.id,runType:row.run_type,aggregateId:row.aggregate_id,status:row.status,stage:row.stage,metrics:parse(row.metrics_json,{}),errorCode:row.error_code||"",createdAt:row.created_at,completedAt:row.completed_at||""}:null;}
  list(){return this.connection.prepare("SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 200").all().map(row=>this.findById(row.id));}
}
