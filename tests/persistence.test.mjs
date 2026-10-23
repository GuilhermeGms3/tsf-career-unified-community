import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";
import { HubDatabase } from "../db/database.mjs";
import { ApplicationPreflight } from "../src/application/application-preflight.mjs";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";

function fixtureState() {
  const createdAt = "2026-08-08T12:00:00.000Z";
  return {
    jobs: [{ id: "job-1", externalId: "indeed:1", source: "indeed", title: "Analista NOC", company: "Exemplo", location: "Brasilia", workModel: "Hibrido", description: "DNS Linux", url: "https://example.com/job", salaryMin: 3000, salaryMax: 4000, salaryCurrency: "BRL", salaryInterval: "month", datePosted: "2026-08-01", jobType: "fulltime", seniority: "junior", fitScore: 80, status: "salva", createdAt, updatedAt: createdAt }],
    resumes: [{ id: "resume-1", title: "NOC", text: "Experiencia real com DNS e Linux em operacoes de rede.", fileName: "resume.txt", storedPath: "", focus: "NOC", sections: { skills: ["DNS"] }, extraction: { method: "plain-text" }, createdAt, updatedAt: createdAt }],
    applications: [{ id: "application-1", jobId: "job-1", resumeId: "resume-1", status: "planejada", appliedAt: "", nextAction: "Revisar", notes: "", createdAt, updatedAt: createdAt }],
    analyses: [{ id: "analysis-1", jobId: "job-1", resumeId: "resume-1", score: 75, matched: ["dns"], missing: ["zabbix"], suggestions: ["Revisar"], createdAt, updatedAt: createdAt }],
    generations: [{ id: "generation-legacy", title: "Mantida em JSON" }],
    searchResults: [],
    searchSchedules: [{ id: "schedule-1", name: "NOC", query: "NOC", enabled: true, nextRunAt: createdAt, createdAt, updatedAt: createdAt }],
    alerts: [{ id: "alert-1", scheduleId: "schedule-1", title: "Nova vaga", read: false, createdAt }],
    searchHistory: [{ id: "history-legacy" }],
    portalReports: []
  };
}

async function withStore(callback) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-hub-sqlite-"));
  const legacyStatePath = path.join(dataDir, "unified-state.json");
  await writeFile(legacyStatePath, `${JSON.stringify(fixtureState(), null, 2)}\n`);
  const store = await new UnifiedStateStore({ dataDir, legacyStatePath }).initialize();
  try {
    await callback({ store, dataDir, legacyStatePath });
  } finally {
    store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

test("applies migrations and imports legacy JSON idempotently", async () => {
  await withStore(async ({ store, dataDir, legacyStatePath }) => {
    const state = await store.read();
    assert.equal(state.jobs.length, 1);
    assert.equal(state.resumes.length, 1);
    assert.equal(state.applications[0].status, "PLANNED");
    assert.equal(state.generations[0].id, "generation-legacy");
    assert.equal(store.database.connection.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    assert.equal(store.database.connection.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 59);
    assert.ok(store.database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_question_requests'").get());
    assert.ok(store.database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_question_receipts'").get());
    assert.equal(state.analyses[0].algorithmVersion, "ats-matcher-v1");
    assert.equal(store.applications.events("application-1").length, 1);
    assert.ok(await readFile(path.join(dataDir, "career-hub.sqlite")));

    store.close();
    const reopened = await new UnifiedStateStore({ dataDir, legacyStatePath }).initialize();
    try {
      assert.equal((await reopened.read()).applications.length, 1);
      assert.equal(reopened.applications.events("application-1").length, 1);
      assert.equal(reopened.database.connection.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 59);
    } finally {
      reopened.close();
      store.database.connection = null;
    }
  });
});

test("search projection persists without synchronizing the complete canonical state", async () => {
  await withStore(async ({ store, dataDir, legacyStatePath }) => {
    const legacyBefore = await readFile(legacyStatePath, "utf8");
    const originalSync = store.jobs.sync;
    store.jobs.sync = () => { throw new Error("full state sync must not run"); };
    const projection = await store.saveSearchProjection({
      searchResults: [{ id: "result-1", title: "Nova vaga" }],
      searchHistory: [{ id: "history-fast", query: "backend" }],
      portalReports: [{ provider: "jobspy", status: "HEALTHY" }],
    });
    store.jobs.sync = originalSync;
    assert.equal(projection.searchResults[0].id, "result-1");
    assert.equal(store.jobs.findById("job-1").title, "Analista NOC");
    assert.equal(await readFile(legacyStatePath, "utf8"), legacyBefore);

    store.close();
    const reopened = await new UnifiedStateStore({ dataDir, legacyStatePath }).initialize();
    try {
      const restored = await reopened.read();
      assert.equal(restored.searchHistory[0].id, "history-fast");
      assert.equal(restored.portalReports[0].provider, "jobspy");
      assert.equal(restored.jobs[0].id, "job-1");
    } finally {
      reopened.close();
      store.database.connection = null;
    }
  });
});

test("enforces foreign keys and application event immutability", async () => {
  await withStore(async ({ store }) => {
    const now = new Date().toISOString();
    assert.throws(() => store.applicationAttempts.upsert({ id: "attempt-orphan", applicationId: "missing", attemptNumber: 1, startedAt: now, status: "FAILED", createdAt: now }), /FOREIGN KEY/);
    assert.throws(() => store.database.connection.prepare("UPDATE application_events SET to_status = 'CANCELLED' WHERE application_id = ?").run("application-1"), /append-only/);
    assert.throws(() => store.database.connection.prepare("DELETE FROM application_events WHERE application_id = ?").run("application-1"), /append-only/);
  });
});

test("persists valid transitions and rejects status jumps without events", async () => {
  await withStore(async ({ store }) => {
    const approved = store.applicationService.transitionApplication("application-1", "APPROVED", { actor: "test" });
    assert.equal(approved.status, "APPROVED");
    assert.equal(store.applications.events("application-1").length, 2);
    assert.throws(() => store.applicationService.transitionApplication("application-1", "SUBMITTED"), /nao permitida/);
    assert.equal(store.applications.findById("application-1").status, "APPROVED");
    assert.equal(store.applications.events("application-1").length, 2);
  });
});

test("keeps SQLite authoritative while preserving JSON-only collections", async () => {
  await withStore(async ({ store, dataDir, legacyStatePath }) => {
    store.jobs.upsert({ ...store.jobs.findById("job-1"), title: "Titulo no SQLite", updatedAt: new Date().toISOString() });
    const stale = fixtureState();
    stale.jobs[0].title = "Titulo antigo no JSON";
    stale.generations.push({ id: "generation-json-2" });
    await writeFile(legacyStatePath, `${JSON.stringify(stale, null, 2)}\n`);
    store.close();
    const reopened = await new UnifiedStateStore({ dataDir, legacyStatePath }).initialize();
    try {
      const state = await reopened.read();
      assert.equal(state.jobs[0].title, "Titulo no SQLite");
      assert.equal(state.generations.length, 2);
    } finally {
      reopened.close();
      store.database.connection = null;
    }
  });
});

test("persists ATS V2 requirements and analysis items across restart", async () => {
  await withStore(async ({ store, dataDir, legacyStatePath }) => {
    const state = await store.read();
    const analysis = runAtsMatcherV2({
      job: state.jobs[0],
      resume: state.resumes[0],
      profile: { personal: { city: "Brasilia", country: "Brasil" }, career: { skills: "DNS, Linux", yearsExperience: 2, workModels: "hibrido" }, experience: "Administracao profissional de DNS e Linux." }
    });
    state.analyses.unshift(analysis);
    await store.save(state);
    assert.throws(() => store.database.connection.prepare("UPDATE ats_analyses SET overall_score = 120 WHERE id = ?").run(analysis.id), /invalid ATS V2 analysis/);
    store.close();
    const reopened = await new UnifiedStateStore({ dataDir, legacyStatePath }).initialize();
    try {
      const persisted = (await reopened.read()).analyses.find((item) => item.id === analysis.id);
      assert.equal(persisted.algorithmVersion, "ats-matcher-v2");
      assert.ok(persisted.requirements.length > 0);
      assert.equal(persisted.items.length, analysis.items.length);
      assert.equal(reopened.database.connection.prepare("SELECT COUNT(*) AS count FROM job_requirements WHERE job_id = ?").get(analysis.jobId).count, persisted.requirements.length);
      assert.equal(reopened.database.connection.prepare("SELECT COUNT(*) AS count FROM ats_analysis_items WHERE analysis_id = ?").get(analysis.id).count, analysis.items.length);
    } finally {
      reopened.close();
      store.database.connection = null;
    }
  });
});

test("upgrades a V1 database without destroying legacy ATS analyses", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-hub-upgrade-"));
  const migrationsDir = path.join(dataDir, "migrations-v1");
  const databasePath = path.join(dataDir, "upgrade.sqlite");
  await mkdir(migrationsDir);
  await copyFile(path.resolve(import.meta.dirname, "..", "db", "migrations", "001_initial.sql"), path.join(migrationsDir, "001_initial.sql"));
  const legacyDatabase = await new HubDatabase(databasePath, { migrationsDir }).initialize();
  const timestamp = "2026-08-08T12:00:00.000Z";
  legacyDatabase.connection.prepare("INSERT INTO jobs(id, title, company, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("job-v1", "NOC", "Empresa", "DNS", timestamp, timestamp);
  legacyDatabase.connection.prepare("INSERT INTO resumes(id, title, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("resume-v1", "NOC", "Experiencia com DNS", timestamp, timestamp);
  legacyDatabase.connection.prepare("INSERT INTO ats_analyses(id, job_id, resume_id, score, matched_json, missing_json, suggestions_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("analysis-v1", "job-v1", "resume-v1", 50, '["dns"]', '[]', '[]', timestamp, timestamp);
  legacyDatabase.close();
  const upgraded = await new HubDatabase(databasePath).initialize();
  try {
    const row = upgraded.connection.prepare("SELECT score, algorithm_version FROM ats_analyses WHERE id = ?").get("analysis-v1");
    assert.equal(row.score, 50);
    assert.equal(row.algorithm_version, "ats-matcher-v1");
    assert.equal(upgraded.connection.prepare("SELECT COUNT(1) AS count FROM schema_migrations").get().count, 59);
    assert.ok(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ats_analysis_items'").get());
  } finally {
    upgraded.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("persiste plano e snapshot de politica apos restart", async () => {
  await withStore(async ({ store, dataDir, legacyStatePath }) => {
    const timestamp=new Date().toISOString();
    store.analyses.upsert({id:"analysis-v2",jobId:"job-1",resumeId:"resume-1",score:88,overallScore:88,calibratedMatchScore:88,eligibility:"ELIGIBLE",algorithmVersion:"ats-matcher-v2",matcherVersion:"ats-matcher-v2",scoringModelVersion:"confidence-calibrated-v2",requirementExtractorVersion:"requirements-v3",createdAt:timestamp,updatedAt:timestamp});
    store.analyses.all=()=>{throw new Error("planner must not materialize every ATS analysis")};
    const plan=store.planApplication("application-1","analysis-v2",{personal:{fullName:"Ana Silva",email:"a@test"},preferences:{}});
    assert.equal(plan.decision,"APPLY");assert.equal(plan.policySnapshot.requireReviewBeforeSubmit,true);
    store.close();const reopened=await new UnifiedStateStore({dataDir,legacyStatePath}).initialize();
    try{assert.equal(reopened.applicationPlans.forApplication("application-1").id,plan.id)}finally{reopened.close();store.database.connection=null}
  });
});

test("retenção ATS preserva análises operacionais e remove histórico redundante", async () => {
  await withStore(async ({ store }) => {
    const timestamp = new Date().toISOString();
    store.database.setMetadata("default_resume_id", "resume-1");
    store.analyses.upsert({ id: "analysis-obsolete", jobId: "job-1", resumeId: "resume-1", score: 70, overallScore: 70, algorithmVersion: "ats-matcher-v1", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" });
    store.analyses.upsert({ id: "analysis-current", jobId: "job-1", resumeId: "resume-1", score: 80, overallScore: 80, algorithmVersion: "ats-matcher-v1", createdAt: timestamp, updatedAt: timestamp });
    store.applicationPlans.save({ applicationId: "application-1", analysisId: "analysis-1", selectedResumeId: "resume-1", atsType: "manual", decision: "REVIEW", matchScore: 75, eligibility: "ELIGIBLE", requiresReview: true });
    const report = store.analyses.pruneOperationalHistory({ baseResumeId: "resume-1" });
    assert.equal(report.removed >= 1, true);
    assert.equal(store.analyses.findById("analysis-obsolete"), null);
    assert.ok(store.analyses.findById("analysis-current"));
    assert.ok(store.analyses.findById("analysis-1"));
  });
});

test("currículo arquivado sai dos fluxos ativos sem quebrar o histórico", async () => {
  await withStore(async ({ store }) => {
    const archived = store.resumes.archive("resume-1");
    assert.ok(archived.archivedAt);
    assert.equal(store.resumes.allActive().length, 0);
    assert.ok(store.resumes.findById("resume-1"));
  });
});

test("perguntas persistem UNKNOWN USER_REQUIRED e resposta conhecida",async()=>withStore(async({store})=>{
  const questions=store.applicationQuestions.sync("application-1",[{externalKey:"q1",semanticKey:"CUSTOM.QUESTION",label:"Pergunta",fieldType:"text",required:true}]);
  assert.equal(questions[0].answerStatus,"USER_REQUIRED");const answered=store.applicationQuestions.answer("application-1",questions[0].id,"Sim");assert.equal(answered.answerStatus,"KNOWN");assert.equal(answered.answerValue,"Sim");
}));

test("candidate facts guardam origem, confianca e politica",async()=>withStore(async({store})=>{store.candidateFacts.sync([{key:"CONTACT.EMAIL",value:"a@test",source:"user_profile",confidence:1,verified:true}]);const fact=store.candidateFacts.find("CONTACT.EMAIL");assert.equal(fact.value,"a@test");assert.equal(fact.confidence,1);assert.equal(fact.verificationStatus,"IMPORTED_CONFIRMED");assert.equal(fact.reusePolicy,"REUSABLE");assert.equal(fact.lifecycleStatus,"ACTIVE");assert.equal(fact.unitType,"APPLICATION_FACT")}));

test("fila e persistente e claim possui lock atomico",async()=>withStore(async({store})=>{store.applicationService.transitionApplication("application-1","APPROVED");store.applicationService.transitionApplication("application-1","QUEUED");store.applicationQueue.enqueue("application-1","DRY_RUN");assert.equal(store.applicationQueue.claim("worker-a").lockedBy,"worker-a");assert.equal(store.applicationQueue.claim("worker-b"),null)}));

test("crash recovery retorna estado transitorio a RETRYABLE",async()=>withStore(async({store})=>{store.applicationService.transitionApplication("application-1","APPROVED");store.applicationService.transitionApplication("application-1","QUEUED");store.applicationQueue.enqueue("application-1","DRY_RUN");store.applicationQueue.claim("dead-worker");store.applicationService.transitionApplication("application-1","OPENING_PAGE");store.database.connection.prepare("UPDATE application_queue SET locked_at='2020-01-01T00:00:00.000Z'").run();assert.equal(store.recoverAutomationQueue(),1);assert.equal(store.applications.findById("application-1").status,"RETRYABLE")}));

test("attempts nunca sobrescrevem historico",async()=>withStore(async({store})=>{const t=new Date().toISOString();store.applicationAttempts.upsert({id:"a1",applicationId:"application-1",attemptNumber:1,startedAt:t,status:"FAILED",mode:"DRY_RUN",createdAt:t});store.applicationAttempts.upsert({id:"a2",applicationId:"application-1",attemptNumber:2,startedAt:t,status:"READY_TO_SUBMIT",mode:"FILL_ONLY",createdAt:t});assert.equal(store.applicationAttempts.forApplication("application-1").length,2);assert.equal(store.applicationAttempts.nextNumber("application-1"),3)}));

test("application events suportam tipos sem dados sensiveis",async()=>withStore(async({store})=>{store.applications.recordEvent("application-1","FIELD_FILLED",{field:"CONTACT.EMAIL",result:"FILLED"});const event=store.applications.events("application-1").at(-1);assert.equal(event.eventType,"FIELD_FILLED");assert.equal(JSON.stringify(event.metadata).includes("@"),false)}));

test("migration cria tabelas e colunas do Application Engine",async()=>withStore(async({store})=>{for(const name of ["application_plans","candidate_facts","application_questions","application_queue"])assert.ok(store.database.connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));const columns=store.database.connection.prepare("PRAGMA table_info(application_attempts)").all().map(x=>x.name);assert.ok(columns.includes("adapter_version"));assert.ok(columns.includes("evidence_path"))}));

test("migration 004 atualiza banco no schema 003",async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"career-hub-v003-"));
  const migrationsDir=path.join(dataDir,"migrations");const databasePath=path.join(dataDir,"db.sqlite");await mkdir(migrationsDir);
  for(const name of ["001_initial.sql","002_ats_matcher_v2.sql","003_application_engine.sql"])await copyFile(path.resolve(import.meta.dirname,"..","db","migrations",name),path.join(migrationsDir,name));
  const old=await new HubDatabase(databasePath,{migrationsDir}).initialize();old.close();const upgraded=await new HubDatabase(databasePath).initialize();
  try{assert.equal(upgraded.connection.prepare("SELECT COUNT(*) count FROM schema_migrations").get().count, 59);assert.ok(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE name='candidate_answers'").get());assert.ok(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE name='ats_analyses_job_updated_idx'").get());assert.ok(upgraded.connection.prepare("SELECT name FROM sqlite_master WHERE name='ats_analyses_projection_idx'").get());}
  finally{upgraded.close();await rm(dataDir,{recursive:true,force:true});}
});

test("candidate answer confirmada sobrevive restart",async()=>withStore(async({store,dataDir,legacyStatePath})=>{const q=store.applicationQuestions.sync("application-1",[{externalKey:"sponsor",fingerprint:"fp-sponsor",semanticKey:"WORK_AUTHORIZATION.REQUIRES_SPONSORSHIP",label:"Sponsorship",fieldType:"radio-group",required:true,answerCategory:"FACT",normalizedQuestion:"sponsorship"}])[0];store.answerApplicationQuestion("application-1",q.id,false,{reusable:true});store.close();const reopened=await new UnifiedStateStore({dataDir,legacyStatePath}).initialize();try{const answer=reopened.candidateAnswers.findByFingerprint("fp-sponsor");assert.equal(answer.answerValue,false);assert.equal(answer.reusable,true)}finally{reopened.close();store.database.connection=null}}));

test("resposta application specific nunca se torna reutilizavel",async()=>withStore(async({store})=>{const q=store.applicationQuestions.sync("application-1",[{externalKey:"motivation",fingerprint:"fp-motivation",semanticKey:"APPLICATION.MOTIVATION",label:"Why us",fieldType:"textarea",required:true,answerCategory:"FREE_TEXT_CONTEXTUAL",normalizedQuestion:"why us"}])[0];const result=store.answerApplicationQuestion("application-1",q.id,"Contextual",{reusable:true});assert.equal(result.memory.reusable,false)}));

test("resposta sensivel nunca se torna reutilizavel",async()=>withStore(async({store})=>{const q=store.applicationQuestions.sync("application-1",[{externalKey:"gender",fingerprint:"fp-gender",semanticKey:"DEMOGRAPHIC.SENSITIVE",label:"Gender",fieldType:"select-one",required:true,answerCategory:"APPLICATION_SPECIFIC",sensitive:true,normalizedQuestion:"gender"}])[0];const result=store.answerApplicationQuestion("application-1",q.id,"Prefer not to say",{reusable:true});assert.equal(result.memory.reusable,false);assert.equal(result.question.sensitive,true)}));

test("questions reconciliam por fingerprint mesmo com external key alterada",async()=>withStore(async({store})=>{const first=store.applicationQuestions.sync("application-1",[{externalKey:"old",fingerprint:"same-fp",semanticKey:"CUSTOM.QUESTION",label:"Question",fieldType:"text",required:true}])[0];const second=store.applicationQuestions.sync("application-1",[{externalKey:"new",fingerprint:"same-fp",semanticKey:"CUSTOM.QUESTION",label:"Question changed",fieldType:"text",required:true}]);assert.equal(second.length,1);assert.equal(second[0].id,first.id);assert.equal(second[0].externalKey,"new")}));

test("greenhouse identity impede duplicacao canonica",async()=>withStore(async({store})=>{const one=store.greenhouseJobs.save("job-1",{boardToken:"acme",jobPostId:"123",canonicalUrl:"https://job-boards.greenhouse.io/acme/jobs/123"},{source:"dom"});assert.equal(store.greenhouseJobs.findIdentity("acme","123").id,one.id)}));

test("adapter inspection persiste health e assinatura",async()=>withStore(async({store})=>{const x=store.applicationInspections.create({applicationId:"application-1",adapterType:"greenhouse",adapterVersion:"greenhouse-adapter-v2",detectedVariant:"hosted",compatibilityConfidence:.95,health:"HEALTHY",domSignature:"abc",report:{fieldsFound:4,requiredFields:2,knownFields:3,unknownFields:1}});assert.equal(store.applicationInspections.latest("application-1").id,x.id);assert.equal(x.domSignature,"abc")}));

async function preparePreflight(store,dataDir,{decision="APPLY",eligibility="ELIGIBLE"}={}){const folder=path.join(dataDir,"resumes");await mkdir(folder,{recursive:true});const storedPath=path.join(folder,"resume-1.txt");await writeFile(storedPath,"resume");store.resumes.upsert({...store.resumes.findById("resume-1"),storedPath,updatedAt:new Date().toISOString()});const timestamp=new Date().toISOString();store.analyses.upsert({id:"preflight-analysis",jobId:"job-1",resumeId:"resume-1",score:90,overallScore:90,eligibility,algorithmVersion:"ats-matcher-v2",createdAt:timestamp,updatedAt:timestamp});store.applicationPlans.save({applicationId:"application-1",analysisId:"preflight-analysis",selectedResumeId:"resume-1",atsType:"greenhouse",decision,matchScore:90,eligibility,requiresReview:true});return new ApplicationPreflight({store,dataDir,registry:new AdapterRegistry()});}
test("preflight READY",async()=>withStore(async({store,dataDir})=>{const p=await preparePreflight(store,dataDir);assert.equal((await p.evaluate("application-1")).status,"READY")}));
test("preflight REVIEW_REQUIRED",async()=>withStore(async({store,dataDir})=>{const p=await preparePreflight(store,dataDir,{decision:"REVIEW"});assert.equal((await p.evaluate("application-1")).status,"REVIEW_REQUIRED")}));
test("preflight BLOCKED",async()=>withStore(async({store,dataDir})=>{const p=await preparePreflight(store,dataDir,{decision:"BLOCKED",eligibility:"NOT_ELIGIBLE"});assert.equal((await p.evaluate("application-1")).status,"BLOCKED")}));
