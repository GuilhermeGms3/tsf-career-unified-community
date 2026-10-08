import { randomUUID } from 'node:crypto';
import { sanitizeStructuredLog as sanitize } from '../src/observability/redaction.mjs';
export { sanitizeStructuredLog } from '../src/observability/redaction.mjs';

const fields={runId:'run_id',profileId:'profile_id',provider:'provider',source:'source',query:'query',jobId:'job_id',status:'status',reasonCode:'reason_code',batchRunId:'batch_run_id',batchItemId:'batch_item_id',resumeId:'resume_id',operation:'operation',correlationId:'correlation_id',resumeVersionId:'resume_version_id',applicationBatchId:'application_batch_id',applicationItemId:'application_item_id',applicationId:'application_id'};
const bounded=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Math.floor(Number(value)))):fallback;
export class StructuredLogRepository {
  constructor(connection,{retentionDays=process.env.LOG_RETENTION_DAYS||30,maxRows=process.env.LOG_MAX_ROWS||5000}={}){Object.assign(this,{connection,retentionDays:bounded(retentionDays,30,1,365),maxRows:bounded(maxRows,5000,100,100000)});}
  recordMany(events=[]){
    const keys=Object.keys(fields),columns=['id','timestamp','level','category','event','message',...Object.values(fields),'duration_ms','result_count','metadata_json','severity'];
    const insert=this.connection.prepare(`INSERT INTO structured_log_events(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
    for(const input of events){
      const s=sanitize(input),timestamp=s.timestamp||new Date().toISOString(),severity=['DEBUG','INFO','WARN','ERROR','CRITICAL'].includes(s.level)?s.level:'INFO';
      s.reasonCode=s.errorCode||s.reasonCode;s.correlationId||=s.applicationItemId||s.batchRunId||s.runId||s.applicationId||`operation-${randomUUID()}`;
      insert.run(s.id||`log-${randomUUID()}`,timestamp,severity==='CRITICAL'?'ERROR':severity,s.category||'SYSTEM',s.eventCode||s.event||'EVENT',s.message||'',...keys.map(k=>s[k]||null),bounded(s.durationMs,0,0,2147483647),bounded(s.resultCount,0,0,2147483647),JSON.stringify(s.metadata||{}),severity);
    }
    if(events.length)this.prune();
  }
  record(event){this.recordMany([event]);}
  prune(){
    this.connection.prepare('DELETE FROM structured_log_events WHERE timestamp<?').run(new Date(Date.now()-this.retentionDays*86400000).toISOString());
    this.connection.prepare('DELETE FROM structured_log_events WHERE id NOT IN (SELECT id FROM structured_log_events ORDER BY timestamp DESC,rowid DESC LIMIT ?)').run(this.maxRows);
  }
  list(filters={}){
    const where=[],params=[];
    for(const [key,column] of Object.entries(fields))if(filters[key]){if(key==='applicationBatchId'){where.push('(application_batch_id=? OR application_item_id IN (SELECT draft_id FROM application_batch_items WHERE batch_id=?))');params.push(String(filters[key]),String(filters[key]));}else{where.push(`${column}=?`);params.push(String(filters[key]).slice(0,200));}}
    if(filters.level){const levels=String(filters.level).split(',').filter(x=>['DEBUG','INFO','WARN','ERROR','CRITICAL'].includes(x));if(levels.length){where.push(`COALESCE(severity,level) IN (${levels.map(()=>'?').join(',')})`);params.push(...levels);}}
    if(filters.category){where.push('category=?');params.push(String(filters.category));}
    for(const [key,operator] of [['from','>='],['to','<=']])if(filters[key]){where.push(`timestamp${operator}?`);params.push(String(filters[key]));}
    if(filters.search){where.push('(message LIKE ? OR event LIKE ? OR reason_code LIKE ?)');params.push(...Array(3).fill(`%${String(filters.search).slice(0,100)}%`));}
    params.push(bounded(filters.limit||100,100,1,this.maxRows),bounded(filters.offset||0,0,0,100000));
    return this.connection.prepare(`SELECT * FROM structured_log_events ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY timestamp DESC,rowid DESC LIMIT ? OFFSET ?`).all(...params).map(r=>sanitize({id:r.id,timestamp:r.timestamp,level:r.severity||r.level,category:r.category,event:r.event,eventCode:r.event,message:r.message,...Object.fromEntries(Object.entries(fields).map(([k,c])=>[k,r[c]||''])),errorCode:r.reason_code||'',durationMs:r.duration_ms,resultCount:r.result_count,metadata:JSON.parse(r.metadata_json)}));
  }
  problems(){return this.connection.prepare('SELECT * FROM operational_problems ORDER BY last_seen DESC LIMIT 200').all().map(r=>sanitize(r));}
  setProblemStatus(id,status){if(!['OPEN','RESOLVED','ACKNOWLEDGED','IGNORED'].includes(status))throw Object.assign(Error('PROBLEM_STATUS_INVALID'),{code:'PROBLEM_STATUS_INVALID',status:400});this.connection.prepare('UPDATE operational_problems SET status=?,resolved_at=? WHERE id=?').run(status,status==='RESOLVED'?new Date().toISOString():null,id);}
  resolve(provider,codes){for(const code of codes)this.connection.prepare("UPDATE operational_problems SET status='RESOLVED',resolved_at=? WHERE provider=? AND error_code=? AND status<>'RESOLVED'").run(new Date().toISOString(),provider,code);}
}
