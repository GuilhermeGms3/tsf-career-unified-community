
-- Metadata-only transition events: never copy form answers, provider payloads or documents.
CREATE TRIGGER observe_matching AFTER INSERT ON ats_analyses BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,correlation_id,job_id,resume_id,status)
 VALUES('log-'||lower(hex(randomblob(16))),NEW.created_at,'INFO','MATCHING','MATCH_COMPLETED','Local matching completed',NEW.id,NEW.job_id,NEW.resume_id,'COMPLETED');
END;
CREATE TRIGGER observe_evidence AFTER INSERT ON knowledge_audit_events BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,correlation_id,status)
 VALUES('log-'||lower(hex(randomblob(16))),NEW.created_at,'INFO','EVIDENCE','EVIDENCE_UPDATED','Knowledge audit event recorded',NEW.id,'RECORDED');
END;
CREATE TRIGGER observe_application_history AFTER INSERT ON application_events BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,correlation_id,application_id,status)
 VALUES('log-'||lower(hex(randomblob(16))),NEW.created_at,'INFO','CONTROLLED_SUBMIT','APPLICATION_STATE_CHANGED','Application lifecycle transition',NEW.application_id,NEW.application_id,NEW.to_status);
END;
CREATE TRIGGER observe_provider_health AFTER INSERT ON provider_health_history WHEN NEW.provider_id<>'brave-public-web' BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,correlation_id,provider,status,duration_ms,reason_code)
 VALUES('log-'||lower(hex(randomblob(16))),NEW.checked_at,CASE WHEN NEW.health_status IN ('ERROR','DEGRADED','OFFLINE') THEN 'WARN' ELSE 'INFO' END,'SOURCE_HEALTH','SOURCE_STATUS_CHECKED','Explicit source health check',NEW.id,NEW.provider_id,NEW.health_status,NEW.latency_ms,CASE WHEN NEW.health_status IN ('ERROR','DEGRADED','OFFLINE') THEN 'SOURCE_UNAVAILABLE' ELSE NULL END);
END;
CREATE TRIGGER observe_source_auth AFTER INSERT ON source_connection_events WHEN NEW.provider_id<>'brave-public-web' BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,correlation_id,provider,status,reason_code)
 VALUES('log-'||lower(hex(randomblob(16))),NEW.created_at,CASE WHEN NEW.outcome='FAILED' THEN 'ERROR' ELSE 'INFO' END,'SOURCE_AUTH','SOURCE_AUTH_CHANGED','Source authentication operation',NEW.id,NEW.provider_id,NEW.outcome,CASE WHEN NEW.outcome='FAILED' THEN 'SOURCE_AUTH_FAILED' ELSE NULL END);
END;
CREATE TRIGGER observe_queue AFTER UPDATE OF status ON application_queue WHEN OLD.status<>NEW.status BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,correlation_id,application_id,status,reason_code)
 VALUES('log-'||lower(hex(randomblob(16))),NEW.updated_at,CASE WHEN NEW.status='FAILED' THEN 'ERROR' ELSE 'INFO' END,'QUEUE','QUEUE_STATE_CHANGED','Application worker queue transition',NEW.application_id,NEW.application_id,NEW.status,CASE WHEN NEW.status='FAILED' THEN 'QUEUE_FAILED' ELSE NULL END);
END;
CREATE TRIGGER aggregate_operational_problem AFTER INSERT ON structured_log_events
WHEN NEW.level IN ('WARN','ERROR') AND NEW.reason_code IS NOT NULL AND COALESCE(NEW.provider,'')<>'brave-public-web'
BEGIN
 INSERT INTO operational_problems VALUES(
 lower(hex(NEW.category||':'||COALESCE(NEW.provider,'')||':'||NEW.reason_code)),NEW.category,COALESCE(NEW.provider,''),NEW.reason_code,COALESCE(NEW.severity,NEW.level),NEW.message,NEW.timestamp,NEW.timestamp,1,'OPEN',NEW.correlation_id,NULL)
 ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,occurrences=occurrences+1,severity=excluded.severity,correlation_id=excluded.correlation_id,status=CASE WHEN status='RESOLVED' THEN 'OPEN' ELSE status END,resolved_at=CASE WHEN status='RESOLVED' THEN NULL ELSE resolved_at END;
END;
CREATE TRIGGER observe_application_drafts_insert AFTER INSERT ON application_drafts
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json,job_id,resume_version_id,application_item_id,application_id)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'APPLICATION_BATCH','APPLICATION_BATCH_'||NEW.status,'APPLICATION_BATCH state transition','gupy',NEW.id,NEW.id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'APPLICATION_BATCH_'||NEW.status ELSE NULL END,'{}',NEW.job_id,NEW.resume_version_id,NEW.id,NEW.application_id);
END;
CREATE TRIGGER observe_application_drafts_update AFTER UPDATE OF status ON application_drafts WHEN OLD.status<>NEW.status
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json,job_id,resume_version_id,application_item_id,application_id)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'APPLICATION_BATCH','APPLICATION_BATCH_'||NEW.status,'APPLICATION_BATCH state transition','gupy',NEW.id,NEW.id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'APPLICATION_BATCH_'||NEW.status ELSE NULL END,'{}',NEW.job_id,NEW.resume_version_id,NEW.id,NEW.application_id);
END;
CREATE TRIGGER observe_resume_render_runs_insert AFTER INSERT ON resume_render_runs
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json,resume_version_id)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'TECTONIC','TECTONIC_'||NEW.status,'TECTONIC state transition','tectonic',NEW.id,NEW.resume_version_id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'TECTONIC_'||NEW.status ELSE NULL END,'{}',NEW.resume_version_id);
END;
CREATE TRIGGER observe_resume_render_runs_update AFTER UPDATE OF status ON resume_render_runs WHEN OLD.status<>NEW.status
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json,resume_version_id)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'TECTONIC','TECTONIC_'||NEW.status,'TECTONIC state transition','tectonic',NEW.id,NEW.resume_version_id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'TECTONIC_'||NEW.status ELSE NULL END,'{}',NEW.resume_version_id);
END;
CREATE TRIGGER observe_document_exports_insert AFTER INSERT ON document_exports
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json,resume_version_id)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'DOCUMENT','DOCUMENT_'||NEW.status,'DOCUMENT state transition',LOWER(NEW.destination),NEW.id,NEW.resume_version_id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'DOCUMENT_'||NEW.status ELSE NULL END,'{}',NEW.resume_version_id);
END;
CREATE TRIGGER observe_document_exports_update AFTER UPDATE OF status ON document_exports WHEN OLD.status<>NEW.status
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json,resume_version_id)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'DOCUMENT','DOCUMENT_'||NEW.status,'DOCUMENT state transition',LOWER(NEW.destination),NEW.id,NEW.resume_version_id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'DOCUMENT_'||NEW.status ELSE NULL END,'{}',NEW.resume_version_id);
END;
CREATE TRIGGER observe_github_evidence_snapshots_insert AFTER INSERT ON github_evidence_snapshots
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'GITHUB_SYNC','GITHUB_SYNC_'||NEW.status,'GITHUB_SYNC state transition','github',NEW.id,NEW.id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'GITHUB_SYNC_'||NEW.status ELSE NULL END,'{}');
END;
CREATE TRIGGER observe_github_evidence_snapshots_update AFTER UPDATE OF status ON github_evidence_snapshots WHEN OLD.status<>NEW.status
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'GITHUB_SYNC','GITHUB_SYNC_'||NEW.status,'GITHUB_SYNC state transition','github',NEW.id,NEW.id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'GITHUB_SYNC_'||NEW.status ELSE NULL END,'{}');
END;
CREATE TRIGGER observe_intelligence_runs_insert AFTER INSERT ON intelligence_runs
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'OLLAMA','OLLAMA_'||NEW.status,'OLLAMA state transition','ollama',NEW.id,NEW.id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'OLLAMA_'||NEW.status ELSE NULL END,'{}');
END;
CREATE TRIGGER observe_intelligence_runs_update AFTER UPDATE OF status ON intelligence_runs WHEN OLD.status<>NEW.status
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'OLLAMA','OLLAMA_'||NEW.status,'OLLAMA state transition','ollama',NEW.id,NEW.id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'OLLAMA_'||NEW.status ELSE NULL END,'{}');
END;
CREATE TRIGGER observe_job_hunt_runs_insert AFTER INSERT ON job_hunt_runs
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'MASS_HUNT','MASS_HUNT_'||NEW.status,'MASS_HUNT state transition','',NEW.id,NEW.id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'MASS_HUNT_'||NEW.status ELSE NULL END,'{}');
END;
CREATE TRIGGER observe_job_hunt_runs_update AFTER UPDATE OF status ON job_hunt_runs WHEN OLD.status<>NEW.status
BEGIN
 INSERT INTO structured_log_events(id,timestamp,level,category,event,message,provider,run_id,correlation_id,status,reason_code,metadata_json)
 VALUES('log-'||lower(hex(randomblob(16))),strftime('%Y-%m-%dT%H:%M:%fZ','now'),CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'ERROR' ELSE 'INFO' END,'MASS_HUNT','MASS_HUNT_'||NEW.status,'MASS_HUNT state transition','',NEW.id,NEW.id,NEW.status,CASE WHEN NEW.status IN ('FAILED','ERROR','SUBMISSION_UNCERTAIN','UNAVAILABLE') THEN 'MASS_HUNT_'||NEW.status ELSE NULL END,'{}');
END;
