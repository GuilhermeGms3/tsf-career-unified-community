import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { HubDatabase } from "../db/database.mjs";
import { AutoApplyRunRepository } from "../repositories/submission-repository.mjs";
import { AutoApplyOrchestrator } from "../src/automation/auto-apply-orchestrator.mjs";

async function setup(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "autoapply-worker-"));
  let store = await new UnifiedStateStore({ dataDir }).initialize();
  t.after(async () => { store.close(); await rm(dataDir, { recursive: true, force: true }); });
  const at = new Date().toISOString();
  store.jobs.upsert({ id: "job", title: "Synthetic", company: "Test", url: "https://example.test/1", createdAt: at, updatedAt: at });
  store.resumes.upsert({ id: "base", title: "Synthetic", text: "Test", createdAt: at, updatedAt: at });
  store.applications.create({ id: "app", jobId: "job", resumeId: "base", status: "APPROVED", createdAt: at, updatedAt: at }, {}, { allowHistorical: true });
  store.resumeVersions.create({ id: "version", resumeId: "base", jobId: "job", applicationId: "app", templateId: "ATS_STRICT", templateVersion: "ats-strict-v1", language: "en", status: "READY", contentHash: "test", resumeSpec: {}, source: "USER", approvedAt: at });
  store.applications.updateDetails({ ...store.applications.findById("app"), resumeVersionId: "version" });
  const input = { requestId: "approval", applicationId: "app", source: "whatsapp-autoapply", context: { request: { id: "approval" }, resumeVersionId: "version" } };
  return { get store() { return store; }, dataDir, input, restart: async () => { store.close(); store = await new UnifiedStateStore({ dataDir }).initialize(); } };
}

test("two SQLite connections cannot own the same run; expired owner is fenced", async t => {
  const f = await setup(t), other = await new HubDatabase(path.join(f.dataDir, "career-hub.sqlite")).initialize();
  try {
    const a = f.store.autoApplyRuns, b = new AutoApplyRunRepository(other.connection, other);
    const first = a.claim({ ...f.input, workerId: "one" });
    assert.equal(b.claim({ ...f.input, workerId: "two" }).reused, true);
    f.store.database.connection.prepare("UPDATE auto_apply_runs SET lease_expires_at=?").run(new Date(Date.now() - 1000).toISOString());
    const second = b.claim({ ...f.input, workerId: "two" });
    assert.equal(second.reused, false);
    assert.ok(second.run.generation > first.run.generation);
    assert.equal(a.owns("approval", "one", first.run.generation), false);
    a.complete("approval", { status: "SUBMITTED" }, { workerId: "one", generation: first.run.generation });
    assert.equal(b.find("approval").status, "RUNNING");
    b.complete("approval", { status: "WAITING_USER" }, { workerId: "two", generation: second.run.generation });
    assert.equal(a.find("approval").result.status, "WAITING_USER");
  } finally { other.close(); }
});

test("upgrade preserves duplicate legacy RUNNING requests without failing the new unique lease index",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"autoapply-upgrade-")),migrationsDir=path.join(dir,"migrations"),file=path.join(dir,"fixture.sqlite");let db;
  try{
    await mkdir(migrationsDir);
    for(const name of await readdir("db/migrations"))if(/^\d{3}_.*\.sql$/.test(name)&&Number(name.slice(0,3))<=56)await copyFile(path.join("db/migrations",name),path.join(migrationsDir,name));
    db=await new HubDatabase(file,{migrationsDir}).initialize();
    db.connection.prepare("INSERT INTO jobs(id,title,company,description,created_at,updated_at) VALUES('job','Fixture','Fixture','Fixture','t','t')").run();
    db.connection.prepare("INSERT INTO applications(id,job_id,status,created_at,updated_at) VALUES('app','job','APPROVED','t','t')").run();
    for(const id of ["one","two"])db.connection.prepare("INSERT INTO auto_apply_runs(request_id,application_id,source,status,started_at,updated_at) VALUES(?,'app','fixture','RUNNING','t','t')").run(id);
    db.close();db=await new HubDatabase(file).initialize();
    assert.equal(db.connection.prepare("SELECT COUNT(*) n FROM auto_apply_runs WHERE status='RETRYABLE'").get().n,2);
    assert.equal(db.connection.prepare("SELECT COUNT(*) n FROM applications").get().n,1);
    assert.equal(db.connection.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n,58);
    assert.deepEqual(db.connection.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{db?.close();await rm(dir,{recursive:true,force:true});}
});

test("startup RETRYABLE is actually dispatched using persisted exact context", async t => {
  const f = await setup(t);
  f.store.autoApplyRuns.claim({ ...f.input, workerId: "dead" });
  await f.restart();
  assert.equal(f.store.autoApplyRuns.find("approval").status, "RETRYABLE");
  const worker = new AutoApplyOrchestrator({ store: f.store }); let executions = 0;
  worker.recoveryAuthorized = () => true;
  worker.execute = async context => { executions++; assert.equal(context.application.resumeVersionId, "version"); return { status: "READY_TO_SUBMIT", reason: "SUBMISSION_DISABLED" }; };
  await worker.resumePending(); await worker.wait("approval");
  assert.equal(executions, 1);
  assert.equal(f.store.autoApplyRuns.find("approval").status, "COMPLETED");
  await worker.resumePending(); assert.equal(executions, 1);
});

test("a fenced worker cannot publish completion or overwrite the new owner's state",async t=>{
  const f=await setup(t);let release,notifications=0;
  const worker=new AutoApplyOrchestrator({store:f.store,resultHandler:async()=>{notifications++;}});
  worker.execute=()=>new Promise(resolve=>{release=resolve;});
  worker.start({request:f.input.context.request,application:f.store.applications.findById("app")});
  const pending=worker.wait("approval");await new Promise(resolve=>setImmediate(resolve));
  f.store.database.connection.prepare("UPDATE auto_apply_runs SET lease_expires_at=? WHERE request_id='approval'").run(new Date(Date.now()-1000).toISOString());
  const replacement=f.store.autoApplyRuns.claim({...f.input,workerId:"replacement"});assert.equal(replacement.reused,false);
  release({status:"READY_TO_SUBMIT"});const result=await pending;
  assert.equal(result.reason,"AUTOAPPLY_LEASE_LOST");assert.equal(notifications,0);
  assert.equal(f.store.autoApplyRuns.find("approval").workerId,"replacement");
  assert.equal(f.store.applications.events("app").some(event=>event.eventType==="AUTOAPPLY_COMPLETED"),false);
});

for (const reason of ["cancelled", "changed-version", "missing-approval", "missing-context", "question", "recovery-limit"]) {
  test(`recovery refuses ${reason} without invoking form or submit`, async t => {
    const f = await setup(t);
    f.store.autoApplyRuns.enqueue(f.input);
    if (reason === "cancelled") f.store.applicationService.transitionApplication("app", "CANCELLED");
    if (reason === "changed-version") f.store.autoApplyRuns.connection.prepare("UPDATE auto_apply_runs SET context_json=?").run(JSON.stringify({ ...f.input.context, resumeVersionId: "old" }));
    if (reason === "missing-context") f.store.autoApplyRuns.connection.prepare("UPDATE auto_apply_runs SET context_json='{}'").run();
    if (reason === "recovery-limit") f.store.autoApplyRuns.connection.prepare("UPDATE auto_apply_runs SET attempt_count=3").run();
    if (reason === "question") f.store.applicationQuestions.sync("app", [{ externalKey: "question", semanticKey: "CUSTOM.QUESTION", label: "Synthetic question", type: "text", required: true, answerStatus: "USER_REQUIRED", confidence: 0.9 }]);
    const worker = new AutoApplyOrchestrator({ store: f.store });
    if (reason !== "missing-approval") worker.recoveryAuthorized = () => true;
    worker.execute = async () => { throw new Error("Must not execute"); };
    const result = await worker.resumePending();
    assert.ok(result.reason);
    assert.equal(f.store.autoApplyRuns.find("approval").status, "COMPLETED");
  });
}

test("recovery exposes WAITING_USER and escalates a persisted required question without opening a browser",async t=>{
  const f=await setup(t);f.store.autoApplyRuns.enqueue(f.input);
  f.store.applicationQuestions.sync("app",[{externalKey:"question",semanticKey:"CUSTOM.QUESTION",label:"Synthetic required question",type:"text",required:true,answerStatus:"USER_REQUIRED"}]);
  let escalations=0;const worker=new AutoApplyOrchestrator({store:f.store,questionEscalation:{escalate:async id=>{assert.equal(id,"app");escalations++;return {status:"AWAITING_ANSWER"};}}});
  worker.recoveryAuthorized=()=>true;worker.execute=async()=>assert.fail("must not open a browser");
  const result=await worker.resumePending();assert.equal(result.status,"WAITING_USER");assert.equal(escalations,1);
  assert.equal(f.store.applications.findById("app").status,"WAITING_USER");
  assert.match(f.store.applications.findById("app").nextAction,/pergunta obrigatoria/);
});
