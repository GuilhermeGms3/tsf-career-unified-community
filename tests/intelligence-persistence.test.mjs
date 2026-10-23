import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { IntelligenceWorker } from "../src/intelligence/intelligence-worker.mjs";
import { HubDatabase } from "../db/database.mjs";

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-intelligence-"));
  await writeFile(
    path.join(dataDir, "unified-state.json"),
    JSON.stringify({}),
    "utf8",
  );
  return {
    dataDir,
    store: await new UnifiedStateStore({ dataDir }).initialize(),
    async close() {
      this.store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
async function seed(store) {
  const now = new Date().toISOString();
  store.jobs.upsert({
    id: "job-1",
    title: "DevOps",
    company: "Acme",
    description: "CI/CD",
    url: "https://example.test/job",
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  store.resumes.upsert({
    id: "resume-1",
    title: "Base",
    focus: "DevOps",
    text: "GitHub Actions pipelines",
    storedPath: "",
    fileName: "base.txt",
    createdAt: now,
    updatedAt: now,
  });
  store.applications.create(
    {
      id: "application-1",
      jobId: "job-1",
      resumeId: "resume-1",
      status: "PLANNED",
      appliedAt: "",
      nextAction: "",
      notes: "",
      createdAt: now,
      updatedAt: now,
    },
    { source: "test" },
  );
}

test("migrations criam schemas intelligence, discovery, documentos, automacao, conhecimento, submission e resume batch aditivos", async () => {
  const f = await fixture();
  try {
    const versions = f.store.database.connection
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((x) => x.version);
    assert.deepEqual(
      versions,
      [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
        21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
        39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
      ],
    );
    for (const table of [
      "intelligence_settings",
      "intelligence_runs",
      "intelligence_cache",
      "intelligence_benchmarks",
      "intelligence_jobs",
      "generated_application_answers",
      "resume_tailoring_runs",
      "resume_tailoring_changes",
      "skill_gap_snapshots",
      "discovery_runs",
      "integration_outbox",
      "resume_versions",
      "resume_artifacts",
      "job_hunt_profiles",
      "provider_configurations",
      "job_feedback",
      "decision_inbox_dismissals",
      "candidate_fact_history",
      "candidate_fact_conflicts",
      "candidate_fact_usage",
      "search_intents",
      "expanded_queries",
      "discovery_query_planner_state",
      "source_capabilities",
      "source_setup_diagnostics",
      "whatsapp_connection_metadata",
      "community_sources",
      "community_webhook_receipts",
      "opportunity_leads",
      "hiring_signals",
      "source_credentials",
      "source_connection_events",
      "career_entities",
      "knowledge_evidence",
      "evidence_claims",
      "experience_enrichment_proposals",
      "evidence_gaps",
      "knowledge_audit_events",
      "submission_preflight_evaluations",
      "submission_consents",
      "submission_attempts",
      "submission_receipts",
      "github_repositories",
      "github_repository_evidence",
      "coverage_reference_jobs",
      "coverage_benchmark_runs",
      "coverage_benchmark_items",
      "whatsapp_question_requests",
      "whatsapp_question_receipts",
    ])
      assert.ok(
        f.store.database.connection
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table),
      );
    assert.equal(
      f.store.database.connection
        .prepare("PRAGMA table_info(resume_tailoring_runs)")
        .all()
        .some((column) => column.name === "quality_json"),
      true,
    );
    assert.ok(
      f.store.database.connection
        .prepare("PRAGMA table_info(ats_analyses)")
        .all()
        .some((x) => x.name === "semantic_enhancement_json"),
    );
  } finally {
    await f.close();
  }
});
test("intelligence settings persistem apos restart", async () => {
  const f = await fixture();
  try {
    f.store.intelligenceSettings.save({
      endpoint: "http://127.0.0.1:11434",
      fastModel: "fast",
      hardwareProfile: "LOW_VRAM",
      contextBudget: 2048,
    });
    f.store.close();
    f.store = await new UnifiedStateStore({ dataDir: f.dataDir }).initialize();
    assert.equal(f.store.intelligenceSettings.get().fastModel, "fast");
    assert.equal(
      f.store.intelligenceSettings.get().policies.allowCloudProvider,
      false,
    );
  } finally {
    await f.close();
  }
});
test("intelligence run guarda telemetria sem prompt", async () => {
  const f = await fixture();
  try {
    const run = f.store.intelligenceRuns.create({
      task: "QUESTION_CLASSIFICATION",
      provider: "fake",
      model: "m",
      promptVersion: "p1",
      schemaVersion: "s1",
      status: "COMPLETED",
      latencyMs: 4,
      contextHash: "hash",
      metrics: { evalCount: 3 },
    });
    assert.equal(run.contextHash, "hash");
    assert.equal("prompt" in run, false);
    assert.equal(f.store.intelligenceRuns.metrics().calls, 1);
  } finally {
    await f.close();
  }
});
test("cache persiste e incrementa hit", async () => {
  const f = await fixture();
  try {
    f.store.intelligenceCache.put({
      key: "k",
      task: "x",
      promptVersion: "p",
      schemaVersion: "s",
      provider: "fake",
      model: "m",
      result: { ok: true },
    });
    assert.deepEqual(f.store.intelligenceCache.get("k").result, { ok: true });
    assert.equal(f.store.intelligenceCache.getWithoutHit("k").hitCount, 1);
  } finally {
    await f.close();
  }
});
test("intelligence queue persiste e claim e atomico", async () => {
  const f = await fixture();
  try {
    const job = f.store.intelligenceJobs.enqueue("RESUME_TAILORING", {
      jobId: "j",
    });
    assert.equal(job.status, "QUEUED");
    assert.equal(f.store.intelligenceJobs.claim("w").status, "RUNNING");
    assert.equal(f.store.intelligenceJobs.claim("w"), null);
    f.store.close();
    f.store = await new UnifiedStateStore({ dataDir: f.dataDir }).initialize();
    assert.ok(f.store.intelligenceJobs.findById(job.id));
  } finally {
    await f.close();
  }
});
test("intelligence queue permite cancelamento antes do claim", async () => {
  const f = await fixture();
  try {
    const job = f.store.intelligenceJobs.enqueue("COVER_LETTER", {});
    assert.equal(f.store.intelligenceJobs.cancel(job.id).status, "CANCELLED");
    assert.equal(f.store.intelligenceJobs.claim("w"), null);
  } finally {
    await f.close();
  }
});
test("crash recovery devolve RUNNING para QUEUED", async () => {
  const f = await fixture();
  try {
    const job = f.store.intelligenceJobs.enqueue("x", {});
    f.store.intelligenceJobs.claim("w");
    f.store.database.connection
      .prepare(
        "UPDATE intelligence_jobs SET locked_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(job.id);
    assert.equal(
      f.store.intelligenceJobs.recover("2020-01-01T00:00:00.000Z"),
      1,
    );
    assert.equal(f.store.intelligenceJobs.findById(job.id).status, "QUEUED");
  } finally {
    await f.close();
  }
});
test("worker completa job sem bloquear request criador", async () => {
  const f = await fixture();
  try {
    const job = f.store.intelligenceJobs.enqueue("FAST", { value: 2 });
    const worker = new IntelligenceWorker({
      repository: f.store.intelligenceJobs,
      handlers: { FAST: async (input) => ({ value: input.value * 2 }) },
    });
    await worker.runOne();
    assert.equal(f.store.intelligenceJobs.findById(job.id).result.value, 4);
  } finally {
    await f.close();
  }
});
test("worker registra timeout como falha", async () => {
  const f = await fixture();
  try {
    const job = f.store.intelligenceJobs.enqueue("TIMEOUT", {});
    const worker = new IntelligenceWorker({
      repository: f.store.intelligenceJobs,
      handlers: {
        TIMEOUT: async () => {
          throw Object.assign(new Error("timeout"), {
            code: "PROVIDER_TIMEOUT",
          });
        },
      },
    });
    await worker.runOne();
    assert.equal(
      f.store.intelligenceJobs.findById(job.id).errorCode,
      "PROVIDER_TIMEOUT",
    );
  } finally {
    await f.close();
  }
});
test("generated answer exige review e nao vira candidate answer", async () => {
  const f = await fixture();
  try {
    await seed(f.store);
    const item = f.store.generatedContent.create({
      applicationId: "application-1",
      contentType: "ANSWER_DRAFT",
      state: "REVIEW_REQUIRED",
      draft: "Texto",
      evidenceIds: ["e1"],
      promptVersion: "p",
      schemaVersion: "s",
    });
    assert.equal(item.state, "REVIEW_REQUIRED");
    assert.equal(f.store.candidateAnswers.all().length, 0);
    assert.equal(
      f.store.generatedContent.review(item.id, "APPROVED").state,
      "APPROVED",
    );
    assert.equal(f.store.generatedContent.review(item.id, "APPROVED"), null);
  } finally {
    await f.close();
  }
});
test("resume tailoring changeset persiste e revisa", async () => {
  const f = await fixture();
  try {
    await seed(f.store);
    const run = f.store.resumeTailoring.createRun({
      jobId: "job-1",
      resumeId: "resume-1",
      state: "REVIEW_REQUIRED",
      originalScore: 70,
      tailoredScore: 80,
      evidenceStatus: "VALID",
      promptVersion: "p",
      schemaVersion: "s",
      changes: [
        {
          type: "REWRITE_BULLET",
          sourceEvidenceIds: ["e1"],
          original: "a",
          proposed: "b",
          reason: "fit",
          validationStatus: "VALID",
        },
      ],
    });
    assert.equal(run.changes.length, 1);
    assert.equal(
      f.store.resumeTailoring.review(run.id, "APPROVED").state,
      "APPROVED",
    );
    assert.equal(
      f.store.resumeTailoring.latestFor("job-1", "resume-1").id,
      run.id,
    );
  } finally {
    await f.close();
  }
});
test("benchmark medido persiste", async () => {
  const f = await fixture();
  try {
    const saved = f.store.intelligenceBenchmarks.save({
      provider: "fake",
      model: "m",
      hardwareProfile: "LOW_VRAM",
      totalLatencyMs: 10,
      jsonValidity: 1,
      schemaValidity: 1,
      semanticAccuracy: 0.5,
      timeoutRate: 0,
      runtime: {},
    });
    assert.equal(f.store.intelligenceBenchmarks.latest().id, saved.id);
  } finally {
    await f.close();
  }
});
test("skill gap snapshot persiste 100 analises", async () => {
  const f = await fixture();
  try {
    const snapshot = f.store.skillGapSnapshots.save(
      [{ skill: "terraform", relevantJobs: 100 }],
      100,
    );
    assert.equal(snapshot.analysisCount, 100);
    assert.equal(snapshot.gaps[0].skill, "terraform");
  } finally {
    await f.close();
  }
});
test("review-before-fill aparece no preflight", async () => {
  const f = await fixture();
  try {
    await seed(f.store);
    f.store.generatedContent.create({
      applicationId: "application-1",
      contentType: "COVER_LETTER",
      state: "REVIEW_REQUIRED",
      draft: "Texto",
      evidenceIds: [],
      promptVersion: "p",
      schemaVersion: "s",
    });
    assert.ok(
      f.store.generatedContent
        .forApplication("application-1")
        .some((x) => x.state === "REVIEW_REQUIRED"),
    );
  } finally {
    await f.close();
  }
});
test("migrations 005 a 058 atualizam banco no schema 004", async () => {
  const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "career-intelligence-v004-"),
    ),
    migrationsDir = path.join(dataDir, "migrations"),
    databasePath = path.join(dataDir, "db.sqlite");
  await mkdir(migrationsDir);
  for (const name of [
    "001_initial.sql",
    "002_ats_matcher_v2.sql",
    "003_application_engine.sql",
    "004_greenhouse_production_hardening.sql",
  ])
    await copyFile(
      path.resolve(import.meta.dirname, "..", "db", "migrations", name),
      path.join(migrationsDir, name),
    );
  const old = await new HubDatabase(databasePath, {
    migrationsDir,
  }).initialize();
  old.close();
  const upgraded = await new HubDatabase(databasePath).initialize();
  try {
    assert.equal(
      upgraded.connection
        .prepare("SELECT MAX(version) version FROM schema_migrations")
        .get().version,
      58,
    );
    assert.ok(
      upgraded.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='intelligence_runs'",
        )
        .get(),
    );
    assert.ok(
      upgraded.connection
        .prepare("SELECT name FROM sqlite_master WHERE name='discovery_runs'")
        .get(),
    );
    assert.ok(
      upgraded.connection
        .prepare("SELECT name FROM sqlite_master WHERE name='resume_versions'")
        .get(),
    );
    assert.ok(
      upgraded.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='job_hunt_profiles'",
        )
        .get(),
    );
    assert.ok(
      upgraded.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='candidate_fact_history'",
        )
        .get(),
    );
    assert.ok(
      upgraded.connection
        .prepare("SELECT name FROM sqlite_master WHERE name='search_intents'")
        .get(),
    );
    assert.ok(
      upgraded.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='opportunity_leads'",
        )
        .get(),
    );
    assert.ok(
      upgraded.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='knowledge_evidence'",
        )
        .get(),
    );
    assert.ok(
      upgraded.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='github_repository_evidence'",
        )
        .get(),
    );
  } finally {
    upgraded.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("migration 011 preserva limiar legado e perfil pausado", async () => {
  const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "career-autopilot-v010-"),
    ),
    migrationsDir = path.join(dataDir, "migrations"),
    databasePath = path.join(dataDir, "db.sqlite");
  await mkdir(migrationsDir);
  for (const name of [
    "001_initial.sql",
    "002_ats_matcher_v2.sql",
    "003_application_engine.sql",
    "004_greenhouse_production_hardening.sql",
    "005_intelligence_layer.sql",
    "006_discovery_multi_ats.sql",
    "007_resume_document_engine.sql",
    "008_resume_archetypes_and_template_hardening.sql",
    "009_automation_job_hunt_and_source_setup.sql",
    "010_product_hardening.sql",
  ])
    await copyFile(
      path.resolve(import.meta.dirname, "..", "db", "migrations", name),
      path.join(migrationsDir, name),
    );
  const old = await new HubDatabase(databasePath, {
    migrationsDir,
  }).initialize();
  old.connection
    .prepare(
      "INSERT INTO job_hunt_profiles(id,name,enabled,queries_json,locations_json,remote_policy,providers_json,company_watchlist_ids_json,minimum_match_score,allowed_eligibility_json,prepare_resume,notification_policy_json,schedule_json,created_at,updated_at) VALUES('legacy','Legado',0,'[\"DevOps\"]','[\"Brasil\"]','ANY','[\"jobspy\"]','[]',77,'[\"ELIGIBLE\"]',1,'{}','{}',?,?)",
    )
    .run(new Date().toISOString(), new Date().toISOString());
  old.close();
  const upgraded = await new HubDatabase(databasePath).initialize();
  try {
    const row = upgraded.connection
      .prepare(
        "SELECT enabled,minimum_match_score,consider_threshold,prepare_resume_threshold,notify_threshold,source_preferences_json,work_models_json FROM job_hunt_profiles WHERE id='legacy'",
      )
      .get();
    assert.deepEqual(
      { ...row },
      {
        enabled: 0,
        minimum_match_score: 77,
        consider_threshold: 77,
        prepare_resume_threshold: 77,
        notify_threshold: 77,
        source_preferences_json: '["indeed","linkedin","glassdoor","google"]',
        work_models_json: '["REMOTE","HYBRID","ONSITE"]',
      },
    );
  } finally {
    upgraded.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
test("worker LOW_VRAM drena job pendente sem starvation", async () => {
  const f = await fixture();
  let worker;
  try {
    const first = f.store.intelligenceJobs.enqueue("SLOW", { value: 1 }),
      second = f.store.intelligenceJobs.enqueue("SLOW", { value: 2 });
    worker = new IntelligenceWorker({
      repository: f.store.intelligenceJobs,
      concurrency: 1,
      handlers: {
        SLOW: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return input;
        },
      },
    });
    worker.schedule();
    worker.schedule();
    const deadline = Date.now() + 1000;
    while (
      Date.now() < deadline &&
      f.store.intelligenceJobs.findById(second.id).status !== "COMPLETED"
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(
      f.store.intelligenceJobs.findById(first.id).status,
      "COMPLETED",
    );
    assert.equal(
      f.store.intelligenceJobs.findById(second.id).status,
      "COMPLETED",
    );
  } finally {
    worker?.stop();
    await f.close();
  }
});
