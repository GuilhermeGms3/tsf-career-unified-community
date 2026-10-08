import { parseJson } from "./base-repository.mjs";

const now=()=>new Date().toISOString();
const allowedReasons=new Set(["ROLE","SENIORITY","LOCATION","WORK_MODEL","COMPANY","COMPENSATION","STACK","DESCRIPTION","OTHER"]);
const allowedDecisions=new Set(["APPLY","SAVE","REJECT","REVIEW"]);
const allowedRejectionReasons=new Set(["BAD_ROLE","BAD_SENIORITY","BAD_LOCATION","LOW_PAY","BAD_COMPANY","MISSING_REQUIREMENT","NOT_INTERESTED","OTHER"]);

export class JobFeedbackRepository{
  constructor(connection){this.connection=connection;}
  save(jobId,{verdict,userDecision,rejectionReason,reasons=[],note=""}={}){
    const normalizedDecision=String(userDecision||"").toUpperCase();
    if(normalizedDecision&&!allowedDecisions.has(normalizedDecision))throw Object.assign(new Error("Decisão de triagem inválida."),{code:"JOB_DECISION_INVALID"});
    const normalizedVerdict=String(verdict||(normalizedDecision==="REJECT"?"NOT_FOR_ME":normalizedDecision?"INTERESTED":"")).toUpperCase();
    if(!["INTERESTED","NOT_FOR_ME"].includes(normalizedVerdict))throw Object.assign(new Error("Feedback de vaga inválido."),{code:"JOB_FEEDBACK_INVALID"});
    const normalizedRejectionReason=String(rejectionReason||"").toUpperCase();
    if(normalizedRejectionReason&&!allowedRejectionReasons.has(normalizedRejectionReason))throw Object.assign(new Error("Motivo de descarte inválido."),{code:"JOB_REJECTION_REASON_INVALID"});
    const normalizedReasons=[...new Set((Array.isArray(reasons)?reasons:[]).map(item=>String(item).toUpperCase()).filter(item=>allowedReasons.has(item)))].slice(0,8);
    const timestamp=now(),current=this.forJob(jobId);
    this.connection.prepare(`INSERT INTO job_feedback(job_id,verdict,reasons_json,note,created_at,updated_at,user_decision,rejection_reason) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET verdict=excluded.verdict,reasons_json=excluded.reasons_json,note=excluded.note,user_decision=excluded.user_decision,rejection_reason=excluded.rejection_reason,updated_at=excluded.updated_at`)
      .run(jobId,normalizedVerdict,JSON.stringify(normalizedReasons),String(note||"").trim().slice(0,500),current?.createdAt||timestamp,timestamp,normalizedDecision||current?.userDecision||null,normalizedDecision==="REJECT"?(normalizedRejectionReason||null):null);
    return this.forJob(jobId);
  }
  forJob(jobId){const row=this.connection.prepare("SELECT * FROM job_feedback WHERE job_id=?").get(jobId);return row?this.map(row):null;}
  all(){return this.connection.prepare("SELECT * FROM job_feedback ORDER BY updated_at DESC").all().map(row=>this.map(row));}
  remove(jobId){return this.connection.prepare("DELETE FROM job_feedback WHERE job_id=?").run(jobId).changes>0;}
  map(row){return {jobId:row.job_id,verdict:row.verdict,userDecision:row.user_decision||"",rejectionReason:row.rejection_reason||"",reasons:parseJson(row.reasons_json,[]),note:row.note,createdAt:row.created_at,updatedAt:row.updated_at};}
}

export class DailyReviewStateRepository{
  constructor(connection){this.connection=connection;}
  get(){const row=this.connection.prepare("SELECT * FROM daily_review_state WHERE id=1").get();return row?{lastTriageAt:row.last_triage_at||"",lastDailyReviewAt:row.last_daily_review_at||"",updatedAt:row.updated_at}:{lastTriageAt:"",lastDailyReviewAt:"",updatedAt:""};}
  markReviewed(at=now()){this.connection.prepare(`INSERT INTO daily_review_state(id,last_triage_at,last_daily_review_at,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET last_triage_at=excluded.last_triage_at,last_daily_review_at=excluded.last_daily_review_at,updated_at=excluded.updated_at`).run(at,at,at);return this.get();}
}

export class DecisionInboxDismissalRepository{
  constructor(connection){this.connection=connection;}
  dismiss(itemKey,reason=""){const key=String(itemKey||"").trim().slice(0,240);if(!key)throw Object.assign(new Error("Item da caixa de decisão inválido."),{code:"DECISION_ITEM_INVALID"});const dismissedAt=now();this.connection.prepare("INSERT INTO decision_inbox_dismissals(item_key,reason,dismissed_at) VALUES(?,?,?) ON CONFLICT(item_key) DO UPDATE SET reason=excluded.reason,dismissed_at=excluded.dismissed_at").run(key,String(reason||"").trim().slice(0,240),dismissedAt);return {itemKey:key,reason:String(reason||"").trim().slice(0,240),dismissedAt};}
  keys({since=""}={}){const rows=since?this.connection.prepare("SELECT item_key FROM decision_inbox_dismissals WHERE dismissed_at>=?").all(since):this.connection.prepare("SELECT item_key FROM decision_inbox_dismissals").all();return new Set(rows.map(row=>row.item_key));}
  restore(itemKey){return this.connection.prepare("DELETE FROM decision_inbox_dismissals WHERE item_key=?").run(String(itemKey||"")).changes>0;}
}
