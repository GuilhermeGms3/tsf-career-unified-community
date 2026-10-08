import assert from "node:assert/strict";
import {copyFile,mkdir,mkdtemp,readdir,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {HubDatabase} from "../db/database.mjs";

test("migration 019 upgrades schema 18 additively and preserves application history",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"application-v2-migration-")),migrationsDir=path.join(root,"migrations"),databasePath=path.join(root,"career.sqlite");
  await mkdir(migrationsDir,{recursive:true});
  const source=path.resolve("db/migrations"),files=(await readdir(source)).filter(name=>/^\d{3}_.*\.sql$/.test(name));
  for(const name of files.filter(name=>Number(name.slice(0,3))<=18))await copyFile(path.join(source,name),path.join(migrationsDir,name));
  let db=await new HubDatabase(databasePath,{migrationsDir}).initialize();
  const t=new Date().toISOString();
  db.connection.prepare("INSERT INTO jobs(id,source,title,company,location,work_model,description,url,salary_currency,salary_interval,job_type,seniority,fit_score,status,payload_json,created_at,updated_at,provider,provider_job_id,canonical_key,canonical_url,application_url,ats_type,lifecycle_status,content_hash,application_method,application_email,application_instructions,application_subject_hint,application_method_evidence_json,discovery_v4_application_method,source_trust_tier,risk_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("job-019","fixture","Engineer","Acme","Brasil","REMOTE","Linux","https://example.test/jobs/019","BRL","YEAR","FULL_TIME","MID",80,"open","{}",t,t,"fixture","019","ats:fixture:019","https://example.test/jobs/019","https://example.test/jobs/019/apply","generic","OPEN","hash","ATS","","","","{}","ATS","A","VERIFIED");
  db.connection.prepare("INSERT INTO applications(id,job_id,status,next_action,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run("application-019","job-019","READY_TO_SUBMIT","Revisar","histórico preservado",t,t);
  db.connection.prepare("INSERT INTO application_events(id,application_id,to_status,event_type,metadata_json,created_at) VALUES(?,?,?,?,?,?)").run("event-019","application-019","READY_TO_SUBMIT","READY_TO_SUBMIT","{}",t);
  db.close();
  await copyFile(path.join(source,"019_application_engine_v2.sql"),path.join(migrationsDir,"019_application_engine_v2.sql"));
  db=await new HubDatabase(databasePath,{migrationsDir}).initialize();
  try{
    assert.equal(db.connection.prepare("SELECT MAX(version) version FROM schema_migrations").get().version,19);
    assert.equal(db.connection.prepare("SELECT notes FROM applications WHERE id='application-019'").get().notes,"histórico preservado");
    assert.equal(db.connection.prepare("SELECT COUNT(*) count FROM application_events WHERE application_id='application-019'").get().count,1);
    for(const table of ["submission_preflight_evaluations","submission_consents","submission_attempts","submission_locks","submission_receipts"])assert.ok(db.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    assert.equal(db.connection.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{db.close();await rm(root,{recursive:true,force:true});}
});
