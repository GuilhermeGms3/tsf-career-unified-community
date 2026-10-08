import {randomUUID} from "node:crypto";
import {parseJson} from "./base-repository.mjs";
const now=()=>new Date().toISOString();

export class SearchIntentRepository{
  constructor(connection){this.connection=connection;}
  save(item){const current=this.forProfile(item.profileId),id=current?.id||item.id||`search-intent-${randomUUID()}`,timestamp=now();this.connection.prepare(`INSERT INTO search_intents(id,profile_id,version,original_intent_json,location_policy_json,seniorities_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET version=excluded.version,original_intent_json=excluded.original_intent_json,location_policy_json=excluded.location_policy_json,seniorities_json=excluded.seniorities_json,updated_at=excluded.updated_at`).run(id,item.profileId,Number(item.version||1),JSON.stringify(item.originalIntent||{}),JSON.stringify(item.locationPolicy||{}),JSON.stringify(item.seniorities||[]),current?.createdAt||timestamp,timestamp);return this.forProfile(item.profileId);}
  forProfile(profileId){const row=this.connection.prepare("SELECT * FROM search_intents WHERE profile_id=?").get(profileId);return row?{id:row.id,profileId:row.profile_id,version:row.version,originalIntent:parseJson(row.original_intent_json,{}),locationPolicy:parseJson(row.location_policy_json,{}),seniorities:parseJson(row.seniorities_json,[]),createdAt:row.created_at,updatedAt:row.updated_at}:null;}
}

export class ExpandedQueryRepository{
  constructor(connection){this.connection=connection;}
  replace(intentId,version,items=[]){this.connection.prepare("DELETE FROM expanded_queries WHERE intent_id=? AND version=?").run(intentId,version);const statement=this.connection.prepare("INSERT OR IGNORE INTO expanded_queries(id,intent_id,family_id,query,reason,source,version,created_at,query_tier) VALUES(?,?,?,?,?,?,?,?,?)"),timestamp=now();for(const item of items)statement.run(`expanded-query-${randomUUID()}`,intentId,item.familyId||"",item.query,item.reason,item.source,version,timestamp,item.tier||"TIER_2");return this.forIntent(intentId,version);}
  forIntent(intentId,version=null){const rows=version?this.connection.prepare("SELECT * FROM expanded_queries WHERE intent_id=? AND version=? ORDER BY rowid").all(intentId,version):this.connection.prepare("SELECT * FROM expanded_queries WHERE intent_id=? ORDER BY version DESC,rowid").all(intentId);return rows.map(row=>({id:row.id,intentId:row.intent_id,familyId:row.family_id,query:row.query,reason:row.reason,source:row.source,tier:row.query_tier||"TIER_2",version:row.version,createdAt:row.created_at}));}
}

export class DiscoveryQueryPlannerStateRepository{
  constructor(connection){this.connection=connection;}
  get(profileId){const row=this.connection.prepare("SELECT * FROM discovery_query_planner_state WHERE profile_id=?").get(profileId);return row?{profileId:row.profile_id,intentVersion:row.intent_version,round:row.round,familyCursor:row.family_cursor,familyOffsets:parseJson(row.family_offsets_json,{}),familySelectionCounts:parseJson(row.family_selection_counts_json,{}),combinationCursor:row.combination_cursor||0,combinationSelectionCounts:parseJson(row.combination_selection_counts_json,{}),updatedAt:row.updated_at}:null;}
  save(item){const timestamp=now();this.connection.prepare(`INSERT INTO discovery_query_planner_state(profile_id,intent_version,round,family_cursor,family_offsets_json,family_selection_counts_json,combination_cursor,combination_selection_counts_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET intent_version=excluded.intent_version,round=excluded.round,family_cursor=excluded.family_cursor,family_offsets_json=excluded.family_offsets_json,family_selection_counts_json=excluded.family_selection_counts_json,combination_cursor=excluded.combination_cursor,combination_selection_counts_json=excluded.combination_selection_counts_json,updated_at=excluded.updated_at`).run(item.profileId,Number(item.intentVersion||1),Math.max(0,Number(item.round||0)),Math.max(0,Number(item.familyCursor||0)),JSON.stringify(item.familyOffsets||{}),JSON.stringify(item.familySelectionCounts||{}),Math.max(0,Number(item.combinationCursor||0)),JSON.stringify(item.combinationSelectionCounts||{}),timestamp);return this.get(item.profileId);}
}

export class SourceCapabilityRepository{
  constructor(connection){this.connection=connection;}
  replace(providerId,items=[]){const statement=this.connection.prepare("INSERT INTO source_capabilities(provider_id,capability,status,evidence_url,verified_at,notes) VALUES(?,?,?,?,?,?) ON CONFLICT(provider_id,capability) DO UPDATE SET status=excluded.status,evidence_url=excluded.evidence_url,verified_at=excluded.verified_at,notes=excluded.notes");for(const item of items)statement.run(providerId,item.capability,item.status,item.evidenceUrl||"",item.verifiedAt||now(),item.notes||"");return this.forProvider(providerId);}
  forProvider(providerId){return this.connection.prepare("SELECT * FROM source_capabilities WHERE provider_id=? ORDER BY capability").all(providerId).map(row=>({providerId:row.provider_id,capability:row.capability,status:row.status,evidenceUrl:row.evidence_url,verifiedAt:row.verified_at,notes:row.notes}));}
  all(){return this.connection.prepare("SELECT DISTINCT provider_id FROM source_capabilities ORDER BY provider_id").all().flatMap(row=>this.forProvider(row.provider_id));}
}

export class SourceSetupDiagnosticRepository{
  constructor(connection){this.connection=connection;}
  record(item){const id=`source-diagnostic-${randomUUID()}`;this.connection.prepare("INSERT INTO source_setup_diagnostics(id,provider_id,capability,status,latency_ms,jobs_found,error_code,human_message,recommended_action,technical_json,tested_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id,item.providerId,item.capability||"DISCOVERY_COMPANY",item.status,Math.max(0,Number(item.latencyMs||0)),Math.max(0,Number(item.jobsFound||0)),item.errorCode||null,String(item.humanMessage||"").slice(0,500),String(item.recommendedAction||"").slice(0,500),JSON.stringify(item.technical||{}),item.testedAt||now());return this.latest(item.providerId);}
  latest(providerId){const row=this.connection.prepare("SELECT * FROM source_setup_diagnostics WHERE provider_id=? ORDER BY tested_at DESC,rowid DESC LIMIT 1").get(providerId);return row?{id:row.id,providerId:row.provider_id,capability:row.capability,status:row.status,latencyMs:row.latency_ms,jobsFound:row.jobs_found,errorCode:row.error_code||"",humanMessage:row.human_message,recommendedAction:row.recommended_action,technical:parseJson(row.technical_json,{}),testedAt:row.tested_at}:null;}
}

export class WhatsappConnectionMetadataRepository{
  constructor(connection){this.connection=connection;}
  get(){const row=this.connection.prepare("SELECT * FROM whatsapp_connection_metadata WHERE id='evolution'").get();return row?{instanceName:row.instance_name,connectionState:row.connection_state,maskedNumber:row.masked_number,lastErrorCode:row.last_error_code||"",lastCheckedAt:row.last_checked_at||"",updatedAt:row.updated_at}:null;}
  save(item={}){const timestamp=now();this.connection.prepare(`INSERT INTO whatsapp_connection_metadata(id,instance_name,connection_state,masked_number,last_error_code,last_checked_at,updated_at) VALUES('evolution',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET instance_name=excluded.instance_name,connection_state=excluded.connection_state,masked_number=excluded.masked_number,last_error_code=excluded.last_error_code,last_checked_at=excluded.last_checked_at,updated_at=excluded.updated_at`).run(item.instanceName||"",item.connectionState||"UNKNOWN",item.maskedNumber||"",item.lastErrorCode||null,item.lastCheckedAt||timestamp,timestamp);return this.get();}
}
