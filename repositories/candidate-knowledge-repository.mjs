import {randomUUID} from "node:crypto";
import {parseJson} from "./base-repository.mjs";
import {applyKnowledgePolicy,wouldDowngradeAuthority,isConfirmedKnowledge} from "../src/candidate-knowledge/candidate-knowledge-policy.mjs";

const now=()=>new Date().toISOString();
const validKey=key=>/^[a-zA-Z0-9_.-]+$/.test(key);
const persistenceView=fact=>({
  value:fact.value,
  source:String(fact.source||"SYSTEM_EXTRACTED").slice(0,80),
  confidence:Math.max(0,Math.min(1,Number(fact.confidence??1))),
  verified:Boolean(fact.verified),
  sensitive:Boolean(fact.sensitive),
  classification:fact.sensitive?"SENSITIVE":["FACT","PREFERENCE"].includes(fact.classification)?fact.classification:"FACT",
  reusable:Boolean(fact.reusable),
  requiresConfirmation:Boolean(fact.requiresConfirmation),
  lastUsedAt:fact.lastUsedAt||"",
  unitType:fact.unitType,
  verificationStatus:fact.verificationStatus,
  reusePolicy:fact.reusePolicy,
  lifecycleStatus:fact.lifecycleStatus,
  rawText:String(fact.rawText||"").slice(0,4000),
  sourceType:String(fact.sourceType||"SYSTEM").slice(0,80),
  sourceId:fact.sourceId||"",
  sourceVersionId:fact.sourceVersionId||"",
  legacyKey:fact.legacyKey||"",
  provenance:fact.provenance||{},
  confirmedAt:fact.confirmedAt||"",
});
const samePersistedFact=(current,next)=>JSON.stringify(persistenceView(current))===JSON.stringify(persistenceView(next));

export class CandidateFactRepository {
  constructor(connection,database=null){this.connection=connection;this.database=database;}

  save(input,{actor="SYSTEM",detectConflict=false}={}){
    const key=String(input.key||"").trim().slice(0,160);
    if(!key||!validKey(key))throw Object.assign(new Error("Chave de conhecimento inválida."),{code:"CANDIDATE_FACT_INVALID"});
    const current=this.find(key,{includeInactive:true});
    const machineArchive = actor === "PROFILE_SYNC" ? "PROFILE_RECONCILIATION" : actor === "GITHUB_SYNC" ? "GITHUB_RECONCILIATION" : null;
    if(current&&machineArchive&&["REJECTED","ARCHIVED","LEGACY_READ_ONLY"].includes(current.lifecycleStatus)&&
      !(current.lifecycleStatus==="ARCHIVED"&&this.lifecycleActor(key)===machineArchive&&current.sourceType===(actor==="PROFILE_SYNC"?"CANDIDATE_PROFILE":"GITHUB")))return current;
    const fact=applyKnowledgePolicy({...current,...input,key});
    if(machineArchive&&current?.lifecycleStatus==="ARCHIVED")fact.lifecycleStatus="ACTIVE";
    const downgrade=wouldDowngradeAuthority(current,fact);
    if(current&&isConfirmedKnowledge(current)&&JSON.stringify(current.value)!==JSON.stringify(fact.value)&&(downgrade||detectConflict&&fact.source!=="USER_CONFIRMED")){
      this.createConflict(key,current.key,fact.value,{source:fact.source,sourceType:fact.sourceType,sourceId:fact.sourceId,sourceVersionId:fact.sourceVersionId});
      return current;
    }
    if(downgrade)return current;
    const timestamp=now(),createdAt=current?.createdAt||fact.createdAt||timestamp,confirmedAt=fact.verificationStatus==="USER_CONFIRMED"?(fact.confirmedAt||current?.confirmedAt||timestamp):fact.confirmedAt||current?.confirmedAt||null;
    if(current&&samePersistedFact(current,{...fact,confirmedAt}))return current;
    this.connection.prepare(`INSERT INTO candidate_facts(key,value_json,source,confidence,verified,sensitive,classification,reusable,requires_confirmation,last_used_at,updated_at,unit_type,verification_status,reuse_policy,lifecycle_status,raw_text,source_type,source_id,source_version_id,legacy_key,provenance_json,created_at,confirmed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,source=excluded.source,confidence=excluded.confidence,verified=excluded.verified,sensitive=excluded.sensitive,classification=excluded.classification,reusable=excluded.reusable,requires_confirmation=excluded.requires_confirmation,updated_at=excluded.updated_at,unit_type=excluded.unit_type,verification_status=excluded.verification_status,reuse_policy=excluded.reuse_policy,lifecycle_status=excluded.lifecycle_status,raw_text=excluded.raw_text,source_type=excluded.source_type,source_id=excluded.source_id,source_version_id=excluded.source_version_id,legacy_key=excluded.legacy_key,provenance_json=excluded.provenance_json,confirmed_at=excluded.confirmed_at`)
      .run(key,JSON.stringify(fact.value),String(fact.source||"SYSTEM_EXTRACTED").slice(0,80),Math.max(0,Math.min(1,Number(fact.confidence??1))),fact.verified?1:0,fact.sensitive?1:0,fact.sensitive?"SENSITIVE":["FACT","PREFERENCE"].includes(fact.classification)?fact.classification:"FACT",fact.reusable?1:0,fact.requiresConfirmation?1:0,fact.lastUsedAt||current?.lastUsedAt||null,timestamp,fact.unitType,fact.verificationStatus,fact.reusePolicy,fact.lifecycleStatus,String(fact.rawText||"").slice(0,4000),String(fact.sourceType||"SYSTEM").slice(0,80),fact.sourceId||null,fact.sourceVersionId||null,fact.legacyKey||null,JSON.stringify(fact.provenance||{}),createdAt,confirmedAt);
    const saved=this.find(key,{includeInactive:true});this.recordHistory(saved,current?"UPDATED":"CREATED",actor);return saved;
  }

  sync(facts,{actor="SYSTEM",detectConflict=true}={}){return facts.map(fact=>this.save(fact,{actor,detectConflict}));}
  lifecycleActor(key){const event=this.connection.prepare("SELECT action,actor FROM candidate_fact_history WHERE fact_key=? ORDER BY rowid DESC LIMIT 1").get(key);return event?.action==="ARCHIVED"?event.actor:null;}
  syncProfile(facts){
    const keys=new Set(facts.map(fact=>fact.key)),structured=new Set(["SKILL","LANGUAGE","CERTIFICATION","PROJECT","WORK_EXPERIENCE","EDUCATION"]);
    const stale=this.active().filter(fact=>fact.sourceType==="CANDIDATE_PROFILE"&&structured.has(fact.unitType)&&!fact.legacyKey&&!keys.has(fact.key));
    for(const fact of stale)this.changeStatus(fact.key,"ARCHIVED",{actor:"PROFILE_RECONCILIATION"});
    return this.sync(facts,{actor:"PROFILE_SYNC",detectConflict:true});
  }
  find(key,{includeInactive=false}={}){const row=this.connection.prepare(`SELECT * FROM candidate_facts WHERE key=?${includeInactive?"":" AND lifecycle_status='ACTIVE'"}`).get(key);return row?this.map(row):null;}
  active({unitType=null}={}){const rows=unitType?this.connection.prepare("SELECT * FROM candidate_facts WHERE lifecycle_status='ACTIVE' AND unit_type=? ORDER BY updated_at DESC,key").all(unitType):this.connection.prepare("SELECT * FROM candidate_facts WHERE lifecycle_status='ACTIVE' ORDER BY updated_at DESC,key").all();return rows.map(row=>this.map(row));}
  all({includeLegacy=true,includeInactive=true}={}){const clauses=[];if(!includeLegacy)clauses.push("lifecycle_status<>'LEGACY_READ_ONLY'");if(!includeInactive)clauses.push("lifecycle_status='ACTIVE'");const where=clauses.length?` WHERE ${clauses.join(" AND ")}`:"";return this.connection.prepare(`SELECT * FROM candidate_facts${where} ORDER BY updated_at DESC,key`).all().map(row=>this.map(row));}

  changeStatus(key,status,{actor="USER"}={}){
    if(!["ACTIVE","REJECTED","ARCHIVED","LEGACY_READ_ONLY"].includes(status))throw Object.assign(new Error("Status de conhecimento inválido."),{code:"CANDIDATE_FACT_STATUS_INVALID"});
    const current=this.find(key,{includeInactive:true});if(!current)throw Object.assign(new Error("Informação não encontrada."),{code:"CANDIDATE_FACT_NOT_FOUND"});
    const verification=status==="REJECTED"?"REJECTED":current.verificationStatus,reuse=status==="REJECTED"?"NEVER_AUTO_REUSE":current.reusePolicy;
    this.connection.prepare("UPDATE candidate_facts SET lifecycle_status=?,verification_status=?,reuse_policy=?,reusable=?,updated_at=? WHERE key=?").run(status,verification,reuse,reuse==="REUSABLE"?1:0,now(),key);
    const saved=this.find(key,{includeInactive:true});this.recordHistory(saved,status==="REJECTED"?"REJECTED":status==="ARCHIVED"||status==="LEGACY_READ_ONLY"?"ARCHIVED":"RESTORED",actor);return saved;
  }

  remove(key,{actor="USER"}={}){
    const current=this.find(key,{includeInactive:true});if(!current)return {ok:false,action:"NOT_FOUND"};
    const used=this.connection.prepare("SELECT 1 FROM candidate_fact_usage WHERE fact_key=? LIMIT 1").get(key);
    if(current.source==="USER_CONFIRMED"&&!used&&!current.legacyKey){this.recordHistory(current,"ARCHIVED",actor);this.connection.prepare("DELETE FROM candidate_facts WHERE key=?").run(key);return {ok:true,action:"DELETED"};}
    this.changeStatus(key,"REJECTED",{actor});return {ok:true,action:"REJECTED"};
  }

  markUsed(key,{consumer,contextId=null}={}){
    if(!["APPLICATION","ANSWER_REUSE","RESUME_TAILORING","MATCHER","EVIDENCE"].includes(consumer))throw new Error("Consumidor de conhecimento inválido.");
    const current=this.find(key);if(!current)return null;const timestamp=now();
    this.connection.prepare("INSERT OR IGNORE INTO candidate_fact_usage(id,fact_key,consumer,context_id,created_at) VALUES(?,?,?,?,?)").run(`knowledge-use-${randomUUID()}`,key,consumer,contextId||null,timestamp);
    this.connection.prepare("UPDATE candidate_facts SET last_used_at=? WHERE key=?").run(timestamp,key);return this.find(key);
  }

  usages(key){return this.connection.prepare("SELECT consumer,context_id,created_at FROM candidate_fact_usage WHERE fact_key=? ORDER BY created_at DESC").all(key).map(row=>({consumer:row.consumer,contextId:row.context_id||"",createdAt:row.created_at}));}
  conflicts(){return this.connection.prepare("SELECT * FROM candidate_fact_conflicts WHERE status='REVIEW_REQUIRED' ORDER BY created_at DESC").all().map(row=>({id:row.id,canonicalKey:row.canonical_key,existingFactKey:row.existing_fact_key,incomingValue:parseJson(row.incoming_value_json,null),incomingSource:parseJson(row.incoming_source_json,{}),status:row.status,createdAt:row.created_at,resolvedAt:row.resolved_at||""}));}
  createConflict(canonicalKey,existingFactKey,incomingValue,incomingSource={}){this.connection.prepare("INSERT OR IGNORE INTO candidate_fact_conflicts(id,canonical_key,existing_fact_key,incoming_value_json,incoming_source_json,status,created_at) VALUES(?,?,?,?,?,'REVIEW_REQUIRED',?)").run(`knowledge-conflict-${randomUUID()}`,canonicalKey,existingFactKey,JSON.stringify(incomingValue),JSON.stringify(incomingSource),now());return this.conflicts().find(item=>item.canonicalKey===canonicalKey)||null;}
  recordHistory(fact,action,actor){this.connection.prepare("INSERT INTO candidate_fact_history(id,fact_key,action,snapshot_json,actor,created_at) VALUES(?,?,?,?,?,?)").run(`knowledge-history-${randomUUID()}`,fact.key,action,JSON.stringify(fact),actor,now());}

  map(r){return {key:r.key,value:parseJson(r.value_json,null),source:r.source,confidence:r.confidence,verified:Boolean(r.verified),sensitive:Boolean(r.sensitive),classification:r.classification||"FACT",reusable:Boolean(r.reusable),requiresConfirmation:Boolean(r.requires_confirmation),lastUsedAt:r.last_used_at||"",updatedAt:r.updated_at,unitType:r.unit_type||"APPLICATION_FACT",verificationStatus:r.verification_status||"SYSTEM_EXTRACTED",reusePolicy:r.reuse_policy||"NEVER_AUTO_REUSE",lifecycleStatus:r.lifecycle_status||"ACTIVE",rawText:r.raw_text||"",sourceType:r.source_type||"LEGACY",sourceId:r.source_id||"",sourceVersionId:r.source_version_id||"",legacyKey:r.legacy_key||"",provenance:parseJson(r.provenance_json,{}),createdAt:r.created_at||r.updated_at,confirmedAt:r.confirmed_at||""};}
}
