import {sanitizeStructuredLog} from './redaction.mjs';
export const LOG_CATEGORIES=Object.freeze(['SYSTEM','DATABASE','SECURITY','SOURCE_AUTH','SOURCE_HEALTH','GITHUB','GITHUB_SYNC','LINKEDIN','LINKEDIN_DISCOVERY','LINKEDIN_ENRICHMENT','OLLAMA','DISCOVERY','MASS_HUNT','MATCHING','DECISION','EVIDENCE','RESUME_BATCH','TAILORING','DOCUMENT','TECTONIC','OVERLEAF','GUPY','APPLICATION_BATCH','APPLICATION_FILL','CONTROLLED_SUBMIT','WORKER','QUEUE','HTTP','EXTERNAL_REQUEST']);
export class ObservabilityService {
  constructor({store,readiness,version='0.1.0',commit=process.env.APP_COMMIT||'unknown'}){Object.assign(this,{store,readiness,version,commit});this.logs=store.structuredLogs;this.db=store.database.connection;}
  executions(){
    const queries=[
      ['MASS_HUNT',`SELECT id,status,started_at start,completed_at end,discovered_count items,matched_count success,0 failed,0 waiting FROM job_hunt_runs ORDER BY started_at DESC LIMIT 50`],
      ['RESUME_BATCH',`SELECT id,status,created_at start,completed_at end,total_items items,completed_items success,failed_items failed,review_required_items waiting FROM resume_batch_runs ORDER BY created_at DESC LIMIT 50`],
      ['GITHUB_SYNC',`SELECT id,status,started_at start,synced_at end,0 items,0 success,0 failed,0 waiting FROM github_evidence_snapshots ORDER BY started_at DESC LIMIT 50`]
    ];
    const rows=queries.flatMap(([category,q])=>this.db.prepare(q).all().map(r=>({...r,category,correlationId:r.id,durationMs:r.end?Math.max(0,Date.parse(r.end)-Date.parse(r.start)):null})));
    for(const batch of this.store.applicationBatches.list()){
      const success=batch.items.filter(i=>['READY_TO_FILL','READY_TO_SUBMIT','SUBMITTED'].includes(i.status)).length,failed=batch.items.filter(i=>['FAILED','BLOCKED'].includes(i.status)).length,waiting=batch.items.filter(i=>['WAITING_USER','PREPARATION_REQUIRED'].includes(i.status)).length;
      const end=batch.status==='RUNNING'||waiting?null:batch.items.map(i=>i.updatedAt).sort().at(-1);
      rows.push({id:batch.id,category:'APPLICATION_BATCH',status:batch.status,start:batch.createdAt,end,durationMs:end?Math.max(0,Date.parse(end)-Date.parse(batch.createdAt)):null,items:batch.items.length,success,failed,waiting,correlationId:batch.id,applicationItems:batch.items.map(i=>i.id)});
    }
    return sanitizeStructuredLog(rows.sort((a,b)=>b.start.localeCompare(a.start)).slice(0,50));
  }
  overview(filters={}){
    const problems=this.logs.problems().filter(p=>(!filters.provider||p.provider===filters.provider)&&(!filters.category||p.category===filters.category)&&(!filters.from||p.last_seen>=filters.from)&&(!filters.to||p.first_seen<=filters.to)&&(!filters.search||`${p.error_code} ${p.message}`.toLowerCase().includes(filters.search.toLowerCase())));
    return {logs:this.logs.list({...filters,level:filters.level||'INFO,WARN,ERROR,CRITICAL'}),errors:this.logs.list({...filters,level:'ERROR,CRITICAL',limit:50}),problems,executions:this.executions(),categories:LOG_CATEGORIES,retention:{days:this.logs.retentionDays,maxRows:this.logs.maxRows}};
  }
  queueSummary(){return {applications:this.db.prepare('SELECT status,COUNT(*) count FROM application_drafts GROUP BY status').all(),resumes:this.db.prepare('SELECT status,COUNT(*) count FROM resume_batch_items GROUP BY status').all()};}
  async exportText(filters={},full=false){
    const selected=this.logs.list({...filters,offset:0,limit:this.logs.maxRows}),header={generatedAt:new Date().toISOString(),appVersion:this.version,commit:this.commit,filters:sanitizeStructuredLog(filters),environment:{runtime:process.version,platform:process.platform,schemaVersion:this.db.prepare('SELECT MAX(version) version FROM schema_migrations').get().version},eventCount:selected.length,retention:{days:this.logs.retentionDays,maxRows:this.logs.maxRows}};
    const lines=['Career Unified Diagnostics',JSON.stringify(header,null,2),'',...selected.map(e=>`${e.timestamp} ${e.level} ${e.category} ${e.eventCode}\n${e.message}\n${JSON.stringify(e)}`)];
    if(full){
      const readiness=(await this.readiness.list()).map(s=>({provider:s.providerId,authentication:s.authentication,health:s.health,authMode:s.authMode,canParse:s.canParse,canFill:s.canFill,canSubmit:s.canSubmit,canDiscover:s.canDiscover,canSyncEvidence:s.canSyncEvidence}));
      lines.push('','PROVIDER READINESS',JSON.stringify(readiness,null,2),'PROBLEMS',JSON.stringify(this.logs.problems(),null,2),'RECENT ERRORS',JSON.stringify(this.logs.list({level:'ERROR,CRITICAL',limit:50}),null,2),'EXECUTIONS',JSON.stringify(this.executions(),null,2),'QUEUES',JSON.stringify(this.queueSummary(),null,2));
    }
    return lines.join('\n');
  }
}
