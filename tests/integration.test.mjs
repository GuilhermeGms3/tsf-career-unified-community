import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test, { after, before } from "node:test";
import { chromium } from "playwright";

const projectRoot = path.resolve(import.meta.dirname, "..");
let dataDir;
let engine;
let engineUrl;
let hub;
let hubUrl;

function sendJson(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${hubUrl}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  return { response, data };
}

async function waitForHub() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${hubUrl}/api/unified`);
      if (response.ok) return;
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test hub did not start.");
}

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "career-hub-test-"));
  engine = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const input = raw ? JSON.parse(raw) : {};
    if (request.url === "/fixture/greenhouse") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><form id="application_form" data-source="greenhouse"><label for="first_name">First Name</label><input id="first_name" required><label for="last_name">Last Name</label><input id="last_name" required><label for="email">Email</label><input id="email" type="email" required><label for="resume">Resume/CV</label><input id="resume" type="file" required><button type="submit">Submit Application</button></form><script>window.submitCount=0;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submitCount++})</script>`,
      );
      return;
    }
    if (request.url === "/fixture/greenhouse-unknown") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><form id="application_form"><label for="email">Email</label><input id="email" type="email" required><label for="unknown">Favorite constellation</label><textarea id="unknown" required></textarea><button type="submit">Submit</button></form><script>window.submitCount=0;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submitCount++})</script>`,
      );
      return;
    }
    if (request.url === "/fixture/greenhouse-consent") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><form id="application_form"><label for="email">Email</label><input id="email" type="email" required><label><input id="privacy" type="checkbox" required>I agree to the Privacy Policy</label><button type="submit">Submit</button></form>`,
      );
      return;
    }
    if (request.url === "/fixture/greenhouse-unsupported") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html><main data-source="greenhouse"><div role="application">Unsupported proprietary widget</div></main>`,
      );
      return;
    }
    if (request.url === "/health") {
      sendJson(response, { ok: true, services: ["test"] });
      return;
    }
    if (request.url === "/documents/extract") {
      if (input.filename === "engine-unavailable.txt") {
        request.socket.destroy();
        return;
      }
      if (input.filename === "engine-timeout.txt") {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      sendJson(response, {
        ok: true,
        text: "Analista de redes com experiencia em NOC, DNS, DHCP, Linux, Zabbix e atendimento N2. ".repeat(
          4,
        ),
        sections: {
          skills: ["DNS", "DHCP", "Linux", "Zabbix"],
          experience: "Experiencia real de teste.",
        },
        method: "test-extractor",
        pages: 1,
        characters: 340,
      });
      return;
    }
    if (request.url === "/documents/generate") {
      sendJson(response, {
        ok: true,
        docx: Buffer.from("DOCX-TEST").toString("base64"),
        pdf: Buffer.from("%PDF-TEST").toString("base64"),
      });
      return;
    }
    if (request.url === "/jobs/search") {
      if (input.query === "engine timeout") {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const duplicate = {
        title: "Analista NOC N2",
        company: "Empresa Teste",
        location: "Brasilia, DF",
        description:
          "Monitoramento com Zabbix, Linux, DNS, DHCP, redes e troubleshooting.",
        datePosted: "2026-07-29",
        salary: "4.000 BRL / month",
        salaryMin: 4000,
        salaryMax: 4000,
        salaryCurrency: "BRL",
        salaryInterval: "month",
        isRemote: false,
        workModel: "",
        jobType: "fulltime",
      };
      sendJson(response, {
        ok: true,
        sites: input.sites,
        jobs: [
          {
            ...duplicate,
            externalId: "indeed:1",
            source: "indeed",
            url: "https://example.com/job/1?utm_source=test",
          },
          {
            ...duplicate,
            externalId: "google:1",
            source: "google",
            url: "https://example.com/job/1",
          },
        ],
        sourceReports: input.sites.map((source) => ({
          source,
          status: "ok",
          count: 1,
          elapsedMs: 25,
          message: "1 vaga encontrada.",
        })),
      });
      return;
    }
    sendJson(response, { ok: false, error: "Unknown test route." }, 404);
  });
  engine.listen(0, "127.0.0.1");
  await once(engine, "listening");
  engineUrl = `http://127.0.0.1:${engine.address().port}`;

  const hubPort = 18000 + (process.pid % 1000);
  hubUrl = `http://127.0.0.1:${hubPort}`;
  hub = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    windowsHide: true,
    env: {
      ...process.env,
      HUB_HOST: "127.0.0.1",
      HUB_PORT: String(hubPort),
      HUB_DATA_DIR: dataDir,
      CAREER_ENGINE_URL: engineUrl,
      CAREER_ENGINE_TIMEOUT_MS: "100",
      JOB_SEARCH_TIMEOUT_MS: "100",
      LEGACY_ROOT: dataDir,
      OLLAMA_URL: "http://127.0.0.1:9",
      AUTOMATION_HEADLESS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHub();
});

after(async () => {
  if (hub && !hub.killed) {
    hub.kill();
    await Promise.race([
      once(hub, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
  if (engine) {
    engine.close();
    await once(engine, "close");
  }
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

test("server shell preserva deep links validos sem mascarar APIs ou assets inexistentes", async () => {
  const cases = [
    ["/", 200, true],
    ["/analyze", 200, true],
    ["/analyze?foo=bar", 200, true],
    ["/connections", 200, true],
    ["/quality-lab", 200, true],
    ["/api/nonexistent", 404, false],
    ["/nonexistent-static-file.js", 404, false],
    ["/analyze/nonexistent-static-file.js", 404, false],
  ];
  for (const [pathname, status, shell] of cases) {
    const response = await fetch(`${hubUrl}${pathname}`), body = await response.text();
    assert.equal(response.status, status, pathname);
    assert.equal(body.includes('<main id="app-content"'), shell, pathname);
  }
});

test("imports, searches, generates, backs up, deletes and restores local data", async () => {
  const fileData = `data:text/plain;base64,${Buffer.from("resume test content").toString("base64")}`;
  const imported = await requestJson("/api/unified/resume", {
    method: "POST",
    body: JSON.stringify({
      fileName: "curriculo-teste.txt",
      fileData,
      focus: "NOC",
    }),
  });
  assert.equal(imported.response.status, 200);
  assert.equal(imported.data.resume.extraction.method, "test-extractor");
  assert.equal(
    await readFile(imported.data.resume.storedPath, "utf8"),
    "resume test content",
  );

  const searched = await requestJson("/api/unified/jobs/search", {
    method: "POST",
    body: JSON.stringify({
      query: "NOC N2",
      location: "Brasilia, DF",
      sites: ["indeed", "google"],
      resultsWanted: 10,
      hoursOld: 168,
      minimumScore: 0,
      useLlm: true,
    }),
  });
  assert.equal(searched.response.status, 200);
  assert.equal(searched.data.rawCount, 2);
  assert.equal(searched.data.count, 1);
  assert.equal(searched.data.rankingMode, "regras");
  assert.match(searched.data.rankingWarning, /Ollama/);
  assert.deepEqual(searched.data.jobs[0].sources.sort(), ["google", "indeed"]);

  const saved = await requestJson("/api/unified/job", {
    method: "POST",
    body: JSON.stringify(searched.data.jobs[0]),
  });
  assert.equal(saved.response.status, 200);

  const ats = await requestJson("/api/unified/ats", {
    method: "POST",
    body: JSON.stringify({
      jobId: saved.data.job.id,
      resumeId: imported.data.resume.id,
    }),
  });
  assert.equal(ats.response.status, 200);
  assert.equal(ats.data.analysis.algorithmVersion, "ats-matcher-v2");
  assert.equal(ats.data.analysis.score, ats.data.analysis.overallScore);
  assert.ok(Array.isArray(ats.data.analysis.matched));
  assert.ok(Array.isArray(ats.data.analysis.missing));
  assert.ok(Array.isArray(ats.data.analysis.suggestions));
  assert.ok(ats.data.analysis.items.length > 0);
  assert.ok(ats.data.analysis.dimensions.resumeAts.score >= 0);

  const atsDatabase = new DatabaseSync(
    path.join(dataDir, "career-hub.sqlite"),
    { readOnly: true },
  );
  try {
    assert.equal(
      atsDatabase
        .prepare("SELECT algorithm_version FROM ats_analyses WHERE id = ?")
        .get(ats.data.analysis.id).algorithm_version,
      "ats-matcher-v2",
    );
    assert.equal(
      atsDatabase
        .prepare(
          "SELECT COUNT(1) AS count FROM ats_analysis_items WHERE analysis_id = ?",
        )
        .get(ats.data.analysis.id).count,
      ats.data.analysis.items.length,
    );
  } finally {
    atsDatabase.close();
  }

  const generated = await requestJson("/api/unified/resume/generate", {
    method: "POST",
    body: JSON.stringify({
      jobId: saved.data.job.id,
      resumeId: imported.data.resume.id,
    }),
  });
  assert.equal(generated.response.status, 200);
  assert.equal(generated.data.generation.usedFallback, true);

  const docx = await fetch(
    `${hubUrl}/api/unified/generated?id=${generated.data.generation.id}&format=docx`,
  );
  assert.equal(docx.status, 200);
  assert.equal(Buffer.from(await docx.arrayBuffer()).toString(), "DOCX-TEST");

  const backupResponse = await fetch(`${hubUrl}/api/unified/backup`);
  const backup = await backupResponse.json();
  assert.equal(backup.product, "career-hub-unified");
  assert.ok(backup.files.some((item) => item.kind === "resume"));
  assert.ok(
    backup.files.some(
      (item) => item.kind === "generation" && item.format === "pdf",
    ),
  );

  const deleted = await requestJson("/api/unified/delete", {
    method: "POST",
    body: JSON.stringify({
      type: "generation",
      id: generated.data.generation.id,
    }),
  });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.data.state.generations.length, 0);
  const missingFile = await fetch(
    `${hubUrl}/api/unified/generated?id=${generated.data.generation.id}&format=pdf`,
  );
  assert.equal(missingFile.status, 404);

  const restored = await requestJson("/api/unified/backup/restore", {
    method: "POST",
    body: JSON.stringify({ backup }),
  });
  assert.equal(restored.response.status, 200);
  assert.equal(restored.data.state.resumes.length, 1);
  assert.equal(restored.data.state.jobs.length, 1);
  assert.equal(restored.data.state.generations.length, 1);

  const restoredPdf = await fetch(
    `${hubUrl}/api/unified/generated?id=${generated.data.generation.id}&format=pdf`,
  );
  assert.equal(restoredPdf.status, 200);
  assert.equal(
    Buffer.from(await restoredPdf.arrayBuffer()).toString(),
    "%PDF-TEST",
  );
});

test("Intelligence API permanece compativel sem Ollama", async () => {
  const status = await requestJson("/api/intelligence/status");
  assert.equal(status.response.status, 200);
  assert.equal(status.data.fallbackDeterministic, true);
  assert.equal(status.data.status, "OFFLINE");
  const settings = await requestJson("/api/intelligence/settings");
  assert.equal(settings.response.status, 200);
  assert.equal(settings.data.settings.provider, "ollama");
  const legacy = await requestJson("/api/ollama/status");
  assert.equal(legacy.response.status, 503);
  assert.equal(legacy.data.status, "OFFLINE");
});

test("resume generation does not copy an unsupported job skill", async () => {
  const state = (await requestJson("/api/unified")).data.state;
  const resume = state.resumes[0];
  const created = await requestJson("/api/unified/job", {
    method: "POST",
    body: JSON.stringify({
      title: "Administrador Kubernetes",
      company: "Empresa Segura",
      description: "Kubernetes obrigatorio para operacao de clusters.",
      location: "Brasil",
      workModel: "Remoto",
    }),
  });
  assert.equal(created.response.status, 200);
  const generated = await requestJson("/api/unified/resume/generate", {
    method: "POST",
    body: JSON.stringify({ jobId: created.data.job.id, resumeId: resume.id }),
  });
  assert.equal(generated.response.status, 200);
  assert.ok(
    !JSON.stringify(generated.data.generation.sections)
      .toLowerCase()
      .includes("kubernetes"),
  );
});

test("scheduled search creates local alerts and can be marked read", async () => {
  const created = await requestJson("/api/unified/search-schedule", {
    method: "POST",
    body: JSON.stringify({
      name: "NOC Brasilia",
      query: "NOC N2",
      location: "Brasilia, DF",
      sites: ["indeed"],
      intervalHours: 12,
      resultsWanted: 10,
      minimumScore: 0,
      enabled: true,
    }),
  });
  assert.equal(created.response.status, 200);

  const run = await requestJson("/api/unified/search-schedule/run", {
    method: "POST",
    body: JSON.stringify({ id: created.data.schedule.id }),
  });
  assert.equal(run.response.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.newCount, 1);
  assert.equal(run.data.state.alerts.filter((item) => !item.read).length, 1);

  const read = await requestJson("/api/unified/alerts", {
    method: "POST",
    body: JSON.stringify({ ids: [run.data.state.alerts[0].id] }),
  });
  assert.equal(read.response.status, 200);
  assert.equal(read.data.state.alerts[0].read, true);
});

test("persists application transitions and rejects invalid jumps", async () => {
  const state = (await requestJson("/api/unified")).data.state;
  const job = state.jobs[0];
  assert.ok(job);
  const created = await requestJson("/api/unified/application", {
    method: "POST",
    body: JSON.stringify({
      jobId: job.id,
      status: "PLANNED",
      nextAction: "Revisar candidatura",
    }),
  });
  assert.equal(created.response.status, 200);
  assert.equal(created.data.application.status, "PLANNED");

  const approved = await requestJson("/api/unified/application", {
    method: "POST",
    body: JSON.stringify({ ...created.data.application, status: "APPROVED" }),
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.data.application.status, "APPROVED");

  const invalid = await requestJson("/api/unified/application", {
    method: "POST",
    body: JSON.stringify({ ...approved.data.application, status: "SUBMITTED" }),
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.data.error, /nao permitida/);

  const database = new DatabaseSync(path.join(dataDir, "career-hub.sqlite"), {
    readOnly: true,
  });
  try {
    assert.equal(
      database
        .prepare("SELECT status FROM applications WHERE id = ?")
        .get(created.data.application.id).status,
      "APPROVED",
    );
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM application_events WHERE application_id = ?",
        )
        .get(created.data.application.id).count,
      2,
    );
  } finally {
    database.close();
  }
});

test("Application Engine API executa Greenhouse FILL_ONLY ate READY_TO_SUBMIT sem SUBMITTED", async () => {
  await requestJson("/api/profile", {
    method: "POST",
    body: JSON.stringify({
      personal: { fullName: "Ana Silva", email: "ana@example.test" },
    }),
  });
  const imported = await requestJson("/api/unified/resume", {
    method: "POST",
    body: JSON.stringify({
      fileName: "greenhouse-e2e.txt",
      fileData: `data:text/plain;base64,${Buffer.from("Linux DNS NOC").toString("base64")}`,
      focus: "NOC",
    }),
  });
  const job = await requestJson("/api/unified/job", {
    method: "POST",
    body: JSON.stringify({
      title: "Analista NOC",
      company: "Fixture",
      description: "Experiencia com Linux e DNS",
      url: `${engineUrl}/fixture/greenhouse`,
      status: "open",
    }),
  });
  const analysis = await requestJson("/api/unified/ats", {
    method: "POST",
    body: JSON.stringify({
      jobId: job.data.job.id,
      resumeId: imported.data.resume.id,
    }),
  });
  const application = await requestJson("/api/unified/application", {
    method: "POST",
    body: JSON.stringify({
      jobId: job.data.job.id,
      resumeId: imported.data.resume.id,
      status: "PLANNED",
    }),
  });
  const id = application.data.application.id;
  const planned = await requestJson(`/api/unified/applications/${id}/plan`, {
    method: "POST",
    body: JSON.stringify({
      analysisId: analysis.data.analysis.id,
      policy: { minimumMatchScore: 0 },
    }),
  });
  assert.equal(planned.response.status, 200);
  assert.equal(planned.data.plan.requiresReview, true);
  const fetched = await requestJson(`/api/unified/applications/${id}/plan`);
  assert.equal(fetched.data.plan.id, planned.data.plan.id);
  const run = await requestJson(`/api/unified/applications/${id}/run`, {
    method: "POST",
    body: JSON.stringify({ mode: "FILL_ONLY" }),
  });
  assert.equal(run.response.status, 200, JSON.stringify(run.data));
  assert.equal(run.data.application.status, "READY_TO_SUBMIT");
  assert.equal(run.data.attempt.adapterVersion, "greenhouse-adapter-v2.1");
  assert.equal(
    run.data.events.some((event) => event.toStatus === "SUBMITTED"),
    false,
  );
  assert.equal(
    run.data.events.some((event) => event.eventType === "READY_TO_SUBMIT"),
    true,
  );
  const questions = await requestJson(
    `/api/unified/applications/${id}/questions`,
  );
  assert.equal(questions.response.status, 200);
  assert.ok(questions.data.questions.length >= 4);
  assert.ok(
    await readFile(path.join(run.data.attempt.evidencePath, "trace.zip")),
  );
  assert.ok(
    await readFile(
      path.join(
        run.data.attempt.evidencePath,
        "screenshots",
        "ready-to-submit.png",
      ),
    ),
  );
});

async function createEngineApplication(fixturePath, suffix) {
  const imported = await requestJson("/api/unified/resume", {
    method: "POST",
    body: JSON.stringify({
      fileName: `greenhouse-${suffix}.txt`,
      fileData: `data:text/plain;base64,${Buffer.from("Linux DNS NOC").toString("base64")}`,
      focus: "NOC",
    }),
  });
  const job = await requestJson("/api/unified/job", {
    method: "POST",
    body: JSON.stringify({
      title: `Analista ${suffix}`,
      company: `Fixture ${suffix}`,
      description: "Experiencia com Linux e DNS",
      url: `${engineUrl}${fixturePath}`,
      status: "open",
    }),
  });
  const analysis = await requestJson("/api/unified/ats", {
    method: "POST",
    body: JSON.stringify({
      jobId: job.data.job.id,
      resumeId: imported.data.resume.id,
    }),
  });
  const application = await requestJson("/api/unified/application", {
    method: "POST",
    body: JSON.stringify({
      jobId: job.data.job.id,
      resumeId: imported.data.resume.id,
      status: "PLANNED",
    }),
  });
  await requestJson(
    `/api/unified/applications/${application.data.application.id}/plan`,
    {
      method: "POST",
      body: JSON.stringify({
        analysisId: analysis.data.analysis.id,
        policy: { minimumMatchScore: 0 },
      }),
    },
  );
  return application.data.application.id;
}

test("WAITING_USER aceita resposta e rerun chega a READY_TO_SUBMIT", async () => {
  const id = await createEngineApplication(
    "/fixture/greenhouse-unknown",
    "unknown",
  );
  const first = await requestJson(`/api/unified/applications/${id}/run`, {
    method: "POST",
    body: JSON.stringify({ mode: "FILL_ONLY" }),
  });
  assert.equal(first.data.application.status, "WAITING_USER");
  const question = first.data.questions.find(
    (x) => x.answerStatus === "USER_REQUIRED",
  );
  assert.ok(question);
  const answered = await requestJson(
    `/api/unified/applications/${id}/questions/${question.id}/answer`,
    {
      method: "POST",
      body: JSON.stringify({ value: "Orion", reusable: true }),
    },
  );
  assert.equal(answered.data.question.answerStatus, "KNOWN");
  assert.equal(answered.data.memory.reusable, false);
  const rerun = await requestJson(`/api/unified/applications/${id}/run`, {
    method: "POST",
    body: JSON.stringify({ mode: "FILL_ONLY" }),
  });
  assert.equal(rerun.data.application.status, "READY_TO_SUBMIT");
  assert.equal(
    rerun.data.events.some((e) => e.toStatus === "SUBMITTED"),
    false,
  );
});

test("consentimento nao confirmado permanece WAITING_USER", async () => {
  const id = await createEngineApplication(
    "/fixture/greenhouse-consent",
    "consent",
  );
  const run = await requestJson(`/api/unified/applications/${id}/run`, {
    method: "POST",
    body: JSON.stringify({ mode: "FILL_ONLY" }),
  });
  assert.equal(run.data.application.status, "WAITING_USER");
  assert.ok(
    run.data.questions.some(
      (x) =>
        x.consentType === "PRIVACY_POLICY" &&
        x.answerStatus === "USER_REQUIRED",
    ),
  );
});

test("layout incompatível registra UNSUPPORTED e nao continua", async () => {
  const id = await createEngineApplication(
    "/fixture/greenhouse-unsupported",
    "layout-incompativel",
  );
  const run = await requestJson(`/api/unified/applications/${id}/run`, {
    method: "POST",
    body: JSON.stringify({ mode: "FILL_ONLY" }),
  });
  const details =
    run.response.status === 200
      ? null
      : await requestJson(`/api/unified/applications/${id}/details`);
  assert.equal(
    run.response.status,
    200,
    JSON.stringify({ response: run.data, details: details?.data }),
  );
  assert.equal(run.data.application.status, "WAITING_USER");
  assert.equal(run.data.inspection.health, "UNSUPPORTED");
  assert.equal(
    run.data.events.some((e) => e.eventType === "FORM_FILL_STARTED"),
    false,
  );
});

test("deduplicacao associa agregador a canonical Greenhouse identity", async () => {
  const first = await requestJson("/api/unified/job", {
    method: "POST",
    body: JSON.stringify({
      title: "Canonical Role",
      company: "Canonical Co",
      description: "Long enough description",
      url: "https://aggregator.example/jobs/abc",
      canonicalUrl: "https://job-boards.greenhouse.io/canonical/jobs/777",
      greenhouseBoardToken: "canonical",
      greenhouseJobPostId: "777",
    }),
  });
  const second = await requestJson("/api/unified/job", {
    method: "POST",
    body: JSON.stringify({
      title: "Canonical Role updated",
      company: "Canonical Co",
      description: "Long enough description updated",
      url: "https://job-boards.greenhouse.io/canonical/jobs/777",
    }),
  });
  assert.equal(first.data.job.id, second.data.job.id);
});

test("details endpoint mantem contrato da UI", async () => {
  const state = (await requestJson("/api/unified")).data.state;
  const id = state.applications.at(-1).id;
  const details = await requestJson(`/api/unified/applications/${id}/details`);
  assert.equal(details.response.status, 200);
  for (const key of ["plan", "questions", "profileCompleteness", "queue"])
    assert.ok(key in details.data);
});

test("rejects invalid JSON and bodies above the default limit", async () => {
  const invalid = await requestJson("/api/unified/job", {
    method: "POST",
    body: "{",
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.data.code, "INVALID_JSON");

  const oversized = await requestJson("/api/unified/job", {
    method: "POST",
    body: JSON.stringify({
      title: "x",
      description: "a".repeat(2 * 1024 * 1024),
    }),
  });
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.data.code, "PAYLOAD_TOO_LARGE");
});

test("validates resume type and preserves the 12 MB original-file limit", async () => {
  const forbidden = await requestJson("/api/unified/resume", {
    method: "POST",
    body: JSON.stringify({
      fileName: "curriculo.exe",
      fileData: `data:application/octet-stream;base64,${Buffer.from("invalid").toString("base64")}`,
    }),
  });
  assert.equal(forbidden.response.status, 400);
  assert.equal(forbidden.data.code, "FILE_TYPE_NOT_ALLOWED");

  const tooLarge = await requestJson("/api/unified/resume", {
    method: "POST",
    body: JSON.stringify({
      fileName: "curriculo.txt",
      fileData: `data:text/plain;base64,${Buffer.alloc(12 * 1024 * 1024 + 1, 65).toString("base64")}`,
    }),
  });
  assert.equal(tooLarge.response.status, 413);
  assert.equal(tooLarge.data.code, "FILE_TOO_LARGE");
});

test("reports unavailable engine and engine timeout with stable codes", async () => {
  for (const [fileName, code, status] of [
    ["engine-unavailable.txt", "ENGINE_UNAVAILABLE", 503],
    ["engine-timeout.txt", "ENGINE_TIMEOUT", 504],
  ]) {
    const result = await requestJson("/api/unified/resume", {
      method: "POST",
      body: JSON.stringify({
        fileName,
        fileData: `data:text/plain;base64,${Buffer.from("conteudo curto").toString("base64")}`,
      }),
    });
    assert.equal(result.response.status, status);
    assert.equal(result.data.code, code);
  }
});

test("rejects a missing external project and an invalid backup", async () => {
  const project = await requestJson("/api/run", {
    method: "POST",
    body: JSON.stringify({ projectId: "jobsync", commandId: "dev" }),
  });
  assert.equal(project.response.status, 404);
  assert.equal(project.data.code, "PROJECT_NOT_FOUND");

  const backup = await requestJson("/api/unified/backup/restore", {
    method: "POST",
    body: JSON.stringify({ backup: { product: "outro", version: 1 } }),
  });
  assert.equal(backup.response.status, 400);
  assert.equal(backup.data.code, "INVALID_BACKUP");
});

test("Autopilot API cria, edita, executa e pausa política sem ativação silenciosa", async () => {
  const payload = {
    name: "DevOps Brasil",
    queries: ["DevOps"],
    locations: ["Brasil"],
    sourcePreferences: ["indeed", "linkedin", "greenhouse"],
    workModels: ["REMOTE", "HYBRID"],
    considerThreshold: 65,
    prepareResumeThreshold: 80,
    notifyThreshold: 90,
    prepareResume: false,
    enabled: false,
    schedule: { mode: "WEEKLY", days: [1, 5], time: "08:30" },
    allowedEligibility: ["ELIGIBLE", "ELIGIBLE_WITH_WARNINGS"],
    notificationPolicy: { maxInstantAlerts: 2, digestEnabled: true, decisionClasses:["RECOMMENDED","REVIEW"], delivery:["WHATSAPP"], summaryFields:["ROLE","COMPANY","JOB_LINK"] },
  };
  const created = await requestJson("/api/job-hunt/profiles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.profile.enabled, false);
  assert.deepEqual(
    created.data.profile.sourcePreferences,
    payload.sourcePreferences,
  );
  assert.equal(created.data.profile.considerThreshold, 65);
  assert.equal(created.data.profile.prepareResumeThreshold, 80);
  assert.equal(created.data.profile.notifyThreshold, 90);
  assert.deepEqual(created.data.profile.notificationPolicy.decisionClasses,["RECOMMENDED","REVIEW"]);
  assert.deepEqual(created.data.profile.notificationPolicy.delivery,["WHATSAPP"]);
  const edited = await requestJson(
    `/api/job-hunt/profiles/${created.data.profile.id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...created.data.profile,
        name: "DevOps e SRE",
        enabled: true,
      }),
    },
  );
  assert.equal(edited.data.profile.name, "DevOps e SRE");
  assert.equal(edited.data.profile.enabled, true);
  const paused = await requestJson(
    `/api/job-hunt/profiles/${created.data.profile.id}`,
    {
      method: "PUT",
      body: JSON.stringify({ ...edited.data.profile, enabled: false }),
    },
  );
  assert.equal(paused.data.profile.enabled, false);
  assert.equal(paused.data.profile.nextRunAt, "");
  const run = await requestJson(
    `/api/job-hunt/profiles/${created.data.profile.id}/run`,
    { method: "POST", body: "{}" },
  );
  assert.equal(run.response.status, 202, JSON.stringify(run.data));
  assert.equal(run.data.run.status, "RUNNING");
  assert.equal(run.data.runId, run.data.run.id);
  let persistedRun = run.data.run;
  const runDeadline = Date.now() + 5_000;
  while (persistedRun.status === "RUNNING" && Date.now() < runDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    persistedRun = (await requestJson(`/api/job-hunt/runs/${run.data.runId}`)).data.run;
  }
  assert.ok(["COMPLETED", "PARTIAL"].includes(persistedRun.status));
});

test("backup v2 inspeciona compatibilidade e restaura perfil e Autopilot sem segredos",async()=>{
  await requestJson("/api/profile",{method:"POST",body:JSON.stringify({personal:{fullName:"Pessoa antes do backup"},career:{targetRoles:["DevOps"]}})});
  const exported=await requestJson("/api/unified/backup");
  assert.equal(exported.response.status,200);
  assert.equal(exported.data.backupVersion,2);
  assert.ok(exported.data.schemaVersion>0);
  assert.ok(Array.isArray(exported.data.sections.job_hunt_profiles));
  assert.equal(JSON.stringify(exported.data).includes("source_credentials"),true);
  assert.equal(exported.data.exclusions.includes("authorization_headers"),true);
  const fileData=`data:application/json;base64,${Buffer.from(JSON.stringify(exported.data)).toString("base64")}`;
  const inspected=await requestJson("/api/unified/backup/inspect",{method:"POST",body:JSON.stringify({fileData})});
  assert.equal(inspected.response.status,200);
  assert.equal(inspected.data.summary.compatible,true);
  assert.equal(inspected.data.summary.secretsIncluded,false);
  assert.ok(inspected.data.summary.legacyState.resumes>=1);
  assert.ok(inspected.data.summary.sections.job_hunt_profiles>=1);
  assert.ok(inspected.data.summary.sections.search_intents>=1);
  assert.ok(inspected.data.summary.sections.candidate_facts>=1);
  await requestJson("/api/profile",{method:"POST",body:JSON.stringify({personal:{fullName:"Pessoa alterada"},career:{targetRoles:[]}})});
  const restored=await requestJson("/api/unified/backup/restore",{method:"POST",body:JSON.stringify({fileData})});
  assert.equal(restored.response.status,200,JSON.stringify(restored.data));
  const profile=await requestJson("/api/profile"),profiles=await requestJson("/api/job-hunt/profiles");
  assert.equal(profile.data.personal.fullName,"Pessoa antes do backup");
  assert.ok(profiles.data.profiles.length>=1);
  assert.deepEqual(profiles.data.profiles[0].notificationPolicy.delivery,["WHATSAPP"]);
});

test("jornadas P0 persistem onboarding explícito, busca geográfica e análise manual",async()=>{
  const progress=await requestJson("/api/product/onboarding",{method:"POST",body:JSON.stringify({status:"IN_PROGRESS",step:2,areas:["DEVOPS_SRE"],geographies:["LOCAL_DF","REMOTE_BRAZIL"],autopilot:false})});
  assert.equal(progress.data.onboarding.status,"IN_PROGRESS");
  const completed=await requestJson("/api/product/onboarding",{method:"POST",body:JSON.stringify({status:"COMPLETED",step:5,areas:["DEVOPS_SRE"],geographies:["LOCAL_DF","REMOTE_BRAZIL"],autopilot:false})});
  assert.equal(completed.data.onboarding.status,"COMPLETED");
  const search=await requestJson("/api/unified/jobs/search",{method:"POST",body:JSON.stringify({query:"Analista NOC",geographies:["LOCAL_DF","REMOTE_BRAZIL"],resultsWanted:10,hoursOld:168})});
  assert.equal(search.response.status,200,JSON.stringify(search.data));
  assert.equal(search.data.ok,true);
  assert.ok(search.data.analyzedCount>=1);
  assert.equal(typeof search.data.geographyRejectedCount,"number");
  const analyzed=await requestJson("/api/opportunities/analyze",{method:"POST",body:JSON.stringify({title:"Analista de Infraestrutura Jr.",company:"Empresa P0",location:"Brasília, DF",workModel:"HYBRID",description:"Administração de Linux, redes, monitoramento com Zabbix, suporte a usuários e documentação de incidentes em ambiente corporativo."})});
  assert.equal(analyzed.response.status,200,JSON.stringify(analyzed.data));
  assert.equal(analyzed.data.status,"ANALYZED");
  assert.ok(analyzed.data.job.id);
  assert.ok(analyzed.data.opportunity?.decision?.disposition);
});

test("Candidate Knowledge V2 expõe summary/sections/detail sem blobs ou dados sensíveis", async () => {
  await requestJson("/api/profile", {
    method: "POST",
    body: JSON.stringify({
      resumeData: {
        skills: [
          {
            id: "internal-skill-id",
            name: "Docker",
            rawText: "Docker",
            normalizationConfidence: 0.72,
          },
        ],
        projects: [],
      },
    }),
  });
  const sensitive = await requestJson("/api/candidate-knowledge/facts", {
    method: "POST",
    body: JSON.stringify({
      unitType: "SENSITIVE",
      value: "valor confidencial",
      sensitive: true,
      reusePolicy: "REUSABLE",
    }),
  });
  assert.equal(sensitive.response.status, 201);
  assert.equal(sensitive.data.fact.reusePolicy, "SENSITIVE_CONFIRM_EACH_TIME");
  const result = await requestJson("/api/candidate-knowledge");
  assert.equal(result.response.status, 200);
  const serialized = JSON.stringify(result.data);
  assert.equal(serialized.includes("PROFILE.SKILLS"), false);
  assert.equal(serialized.includes("internal-skill-id"), false);
  assert.equal(serialized.includes("valor confidencial"), false);
  assert.equal(
    result.data.sections
      .find((section) => section.id === "skills")
      .items.some((item) => item.label === "Docker"),
    true,
  );
  const detail = await requestJson(
    "/api/candidate-knowledge/facts/skill.docker",
  );
  assert.equal(detail.data.fact.extractionConfidence, 0.72);
  assert.equal(detail.data.fact.verificationStatus, "USER_CONFIRMED");
  assert.equal(detail.data.fact.source.label, "Perfil do candidato");
});

test("Playwright garante Meu Perfil humano, criação e responsividade", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(`${hubUrl}/knowledge`);
    await page.getByRole("heading", { name: "Meu Perfil", exact: true }).waitFor();
    const mainText = await page.locator("#app-content").textContent();
    assert.equal(mainText.includes("PROFILE.SKILLS"), false);
    assert.equal(mainText.includes("[]"), false);
    assert.equal(mainText.includes("valor confidencial"), false);
    assert.equal((mainText.match(/Nome completo/g) || []).length <= 1, true);
    await page.getByLabel("Seções").getByRole("link", { name: "Experiências" }).click();
    await page.getByRole("button", { name: "Adicionar experiência", exact: true }).click();
    const dialog = page.locator("#entity-dialog");
    await dialog.waitFor({ state: "visible" });
    await dialog.locator('[name="title"]').fill("Experiência de regressão V3");
    await dialog.locator('[name="role"]').fill("Analista de regressão");
    await dialog.getByRole("button", { name: "Salvar no inventário" }).click();
    await page.getByText("Item salvo no inventário.", { exact: true }).waitFor();
    await page.reload();
    await page.getByLabel("Seções").getByRole("link", { name: "Experiências" }).click();
    await page.getByText("Analista de regressão", { exact: true }).waitFor();
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
        true,
        JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(-12).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,text:el.textContent.slice(0,90)})))),
      );
    }
  } finally {
    await browser.close();
  }
});

test("tema escuro persiste sem alterar a rota atual",async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.goto(hubUrl);
    await page.waitForSelector("h1");
    await page.locator(".sidebar [data-theme-toggle]").click();
    assert.equal(await page.locator("html").getAttribute("data-theme"),"dark");
    await page.reload();
    await page.waitForSelector("h1");
    assert.equal(await page.locator("html").getAttribute("data-theme"),"dark");
    assert.equal(new URL(page.url()).pathname,"/");
  }finally{await browser.close();}
});

test("Playwright valida branding, Policy Builder V2, oportunidades e ausência de overflow", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(hubUrl);
    await page.waitForSelector("h1");
    assert.match(await page.title(), /Career Unified/);
    assert.equal(
      await page.locator(".brand").first().getAttribute("aria-label"),
      "TSF Career — Hoje",
    );
    assert.equal(await page.locator(".primary-nav .nav-group").count(), 4);
    assert.deepEqual(await page.locator(".primary-nav .nav-group-label").allTextContents(), ["Trabalho","Automação","Conhecimento","Sistema"]);
    assert.equal(await page.locator('.primary-nav a[href="/connections"]').count(), 1);
    assert.equal(await page.locator('.primary-nav a[href="/observability"]').count(), 1);
    assert.equal(await page.locator(".primary-nav a").filter({hasText:"Currículos em lote"}).count(), 0);
    const onboarding=page.locator("#product-onboarding");
    if(await onboarding.isVisible())await onboarding.getByRole("button",{name:"Pular configuração"}).click();
    await page.getByRole("link", { name: "Busca automática", exact: true }).click();
    await page.getByRole("heading", { name: "Deixe o Career Unified procurar por você" }).waitFor();
    await page.getByText("Configurações avançadas", { exact: true }).click();
    await page.getByRole("heading", { name: "Perfis de busca" }).waitFor();
    assert.equal(
      (await page.locator("main").textContent())
        .toLowerCase()
        .includes("jobspy"),
      false,
    );
    await page.getByRole("button", { name: "Novo perfil" }).click();
    const dialog = page.locator("#profile-dialog");
    await dialog.waitFor({ state: "visible" });
    for (const name of [
      "considerThreshold",
      "prepareResumeThreshold",
      "notifyThreshold",
    ])
      assert.equal(await dialog.locator(`[name="${name}"]`).count(), 1);
    await dialog.getByRole("button", { name: "Fechar" }).click();
    await dialog.waitFor({ state: "hidden" });
    const opportunities = await requestJson("/api/opportunities");
    if (!opportunities.data.opportunities?.length) {
      const created = await requestJson("/api/unified/job", {
        method: "POST",
        body: JSON.stringify({
          title: "Platform Engineer",
          company: "Empresa Experience V2",
          description:
            "Linux, automação, observabilidade e infraestrutura como código.",
          location: "Brasil",
          workModel: "Remoto",
        }),
      });
      assert.equal(created.response.status, 200);
    }
    await page.reload();
    await page.getByRole("link", { name: "Vagas", exact: true }).first().click();
    await page.locator(".opportunity-card").first().waitFor();
    const metricsText = await page
      .locator(".opportunity-card .opportunity-signals")
      .first()
      .textContent();
    assert.match(metricsText, /Compatibilidade técnica/);
    assert.match(metricsText, /Confiança/);
    assert.match(metricsText, /Transferíveis/);
    assert.match(metricsText, /Aprendíveis/);
    for (const width of [1024, 768, 390]) {
      await page.setViewportSize({ width, height: 800 });
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
        true,
        JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(-12).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,text:el.textContent.slice(0,90)})))),
      );
    }
  } finally {
    await browser.close();
  }
});

test("Playwright mantém Configurações > Integrações restrita ao n8n", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.route("**/api/integrations/n8n",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,enabled:false,eventAllowlist:[]})}));
    await page.goto(`${hubUrl}/settings?section=integrations`);
    await page.getByRole("heading", { name: "Integrações", level: 2 }).waitFor();
    await page.getByRole("heading", { name: "n8n" }).waitFor();
    assert.equal(await page.getByText("Brave Public Web",{exact:true}).count(),0);
    assert.equal(await page.locator(".integrations-authority").getByRole("heading",{name:"WhatsApp"}).count(),0);
    assert.match(await page.locator(".integrations-authority").innerText(),/Descoberta fica em Fontes, contas de portais ficam em Cofres/);
  } finally {
    await browser.close();
  }
});

test("Playwright atualiza GitHub conectado e oferece sincronização sem recarregar a página",async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    let connected=false;
    const source=()=>({providerId:"github",displayName:"GitHub",group:"EVIDÊNCIAS",optional:false,authentication:connected?"CONNECTED":"AUTH_REQUIRED",authMode:"TOKEN",operationalReadiness:connected?"READY":"CONFIG_REQUIRED",health:connected?"READY":"NOT_CONFIGURED",canDiscover:false,canAuthenticate:true,manualCapture:false,capabilities:{EVIDENCE:connected?"READY":"CONFIG_REQUIRED"},evidence:{status:connected?"READY":"NOT_INDEXED",details:{indexed:0,evidenceFacts:0}},surfaces:[]});
    await page.route("**/api/connections",route=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,sources:[source()],gupyContext:{targets:[],selected:null,request:null}})}));
    await page.route("**/api/connections/**",route=>{const pathname=new URL(route.request().url()).pathname;if(pathname.endsWith("/github/connect"))return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({provider:"github",id:"request-github",status:"USER_ACTION_REQUIRED",authMode:"TOKEN",loginUrl:"https://github.com/settings/tokens",expiresAt:new Date(Date.now()+300000).toISOString()})});if(pathname.endsWith("/requests/request-github/token")){connected=true;return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,status:"CONNECTED"})});}return route.continue();});
    await page.goto(`${hubUrl}/connections`);
    let card=page.locator(".connection-card",{hasText:"GitHub"});
    await card.getByRole("button",{name:"Conectar / Autorizar novamente",exact:true}).click();
    const form=page.locator("[data-token]");
    await form.locator('[name="token"]').fill("github-secret-that-must-disappear");
    await form.getByRole("button",{name:"Salvar e continuar"}).click();
    card=page.locator(".connection-card",{hasText:"GitHub"});
    await card.getByRole("button",{name:"Sincronizar",exact:true}).waitFor();
    await card.getByText(/0 repositórios analisados/).waitFor();
    assert.equal((await page.content()).includes("github-secret-that-must-disappear"),false);
  }finally{await browser.close();}
});

test("Playwright revisa recomendação Ashby, detecta URL e preserva monitoramento no reload",async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    let monitored=false;
    const page=await browser.newPage({viewport:{width:1366,height:768}});
    await page.route("**/api/source-center/companies**",route=>{const url=new URL(route.request().url()),pathname=url.pathname,method=route.request().method();let body={ok:true};if(pathname.endsWith("/recommendations"))body={ok:true,authority:"KNOWN_TARGETS_AND_PERSISTED_PROVENANCE",intentVersion:2,items:[{company:"Acme Ashby",provider:"ashby",careerUrl:"https://jobs.ashbyhq.com/acme",monitored,totalJobs:8,counts:{PASS:4,PASS_WITH_WARNINGS:1,REVIEW:0,REJECT:3},reason:"5 vagas plausíveis para seu Search Intent; 4 sem alertas e 1 com alertas."}]};else if(pathname.endsWith("/preview"))body={ok:true,detection:{status:"READY",provider:"ashby",careerUrl:"https://jobs.ashbyhq.com/acme",humanMessage:"Ashby detectado."},assessment:{totalJobs:8,counts:{PASS:4,PASS_WITH_WARNINGS:1},reason:"5 vagas plausíveis."}};else if(pathname.endsWith("/monitor")&&method==="POST"){monitored=true;body={ok:true,explicitOptIn:true};}else if(pathname==="/api/source-center/companies")body={ok:true,companies:monitored?[{id:"board-acme",watchlistId:"watch-acme",company:"Acme Ashby",provider:"ashby",careerUrl:"https://jobs.ashbyhq.com/acme",active:true,stats:{openJobs:8,lastSeenAt:new Date().toISOString()}}]:[]};return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});});
    await page.goto(`${hubUrl}/autopilot?section=companies`);
    await page.getByRole("button",{name:"Revisar e adicionar"}).click();
    const form=page.locator("#company-form");
    assert.equal(await form.locator('[name="careerUrl"]').inputValue(),"https://jobs.ashbyhq.com/acme");
    await form.getByRole("button",{name:"Detectar e pré-visualizar"}).click();
    await page.getByText("Prévia concluída. Revise e confirme o monitoramento.").waitFor();
    await form.getByRole("button",{name:"Monitorar empresa"}).click();
    await page.getByRole("heading",{name:"Acme Ashby"}).last().waitFor();
    assert.equal(await page.locator('[data-company-active="watch-acme"]').isChecked(),true);
  }finally{await browser.close();}
});

test("Playwright percorre conexão WhatsApp mockada sem expor chave", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    let connected = false,
      stateChecks = 0;
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.route("**/api/whatsapp/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          api: { online: true, version: "2.3.7" },
          configuration: {
            configured: true,
            instanceName: "career-unified",
            maskedTarget: "+55 ** *****-1234",
            credentialsVisibleToBrowser: false,
          },
          whatsapp: {
            connectionState: connected ? "CONNECTED" : "DISCONNECTED",
            instanceExists: connected,
            lastCheckedAt: "2026-08-15T12:00:00.000Z",
          },
          n8n: { online: true, configured: true },
          webhook: { configured: true },
          dispatcher: { enabled: true },
        }),
      }),
    );
    await page.route("**/api/whatsapp/connect", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          instanceName: "career-unified",
          connectionState: "PAIRING_REQUIRED",
          qr: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          expiresInSeconds: 60,
        }),
      }),
    );
    await page.route("**/api/whatsapp/connection-state", (route) => {
      stateChecks += 1;
      connected = stateChecks > 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          whatsapp: {
            connectionState: connected ? "CONNECTED" : "CONNECTING",
            instanceExists: true,
            lastCheckedAt: "2026-08-15T12:00:03.000Z",
          },
        }),
      });
    });
    await page.route("**/api/whatsapp/test-message", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          result: { sent: true, maskedTarget: "+55 ** *****-1234" },
        }),
      }),
    );
    await page.goto(`${hubUrl}/autopilot?section=notifications`);
    await page.getByRole("heading", { name: "Conecte o WhatsApp para receber alertas" }).waitFor();
    await page.getByRole("heading", { name: "Conexão do WhatsApp" }).waitFor();
    await page.getByRole("button", { name: "Conectar WhatsApp" }).click();
    await page.locator('img[alt*="QR Code"]').waitFor();
    await page
      .getByText("WhatsApp conectado", { exact: true })
      .waitFor({ timeout: 5000 });
    const dom = await page.content();
    assert.equal(dom.includes("EVOLUTION_API_KEY"), false);
    assert.equal(dom.includes("supersecret"), false);
    assert.equal(dom.includes("5561999991234"), false);
  } finally {
    await browser.close();
  }
});

test("reanálise canônica preserva histórico acima de 100 análises referenciadas", async () => {
  const unified = await requestJson("/api/unified"),
    source = unified.data.state.analyses.find(
      (item) => item.resumeId && item.items?.length,
    );
  assert.ok(source, "fixture precisa de análise com currículo e itens");
  const databasePath = path.join(dataDir, "career-hub.sqlite"),
    database = new DatabaseSync(databasePath);
  try {
    const analysisColumns = database
        .prepare("PRAGMA table_info(ats_analyses)")
        .all()
        .map((item) => item.name),
      itemColumns = database
        .prepare("PRAGMA table_info(ats_analysis_items)")
        .all()
        .map((item) => item.name),
      cloneAnalysis = database.prepare(
        `INSERT INTO ats_analyses (${analysisColumns.join(",")}) SELECT ${analysisColumns.map((name) => (name === "id" ? "?" : name)).join(",")} FROM ats_analyses WHERE id = ?`,
      ),
      cloneItem = database.prepare(
        `INSERT INTO ats_analysis_items (${itemColumns.join(",")}) SELECT ${itemColumns.map((name) => (name === "id" || name === "analysis_id" ? "?" : name)).join(",")} FROM ats_analysis_items WHERE id = ?`,
      ),
      sourceItemId = source.items[0].id;
    database.exec("BEGIN IMMEDIATE");
    for (let index = 0; index < 101; index += 1) {
      const analysisId = `history-analysis-${index}`;
      cloneAnalysis.run(analysisId, source.id);
      cloneItem.run(`history-item-${index}`, analysisId, sourceItemId);
    }
    database.exec("COMMIT");
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    database.close();
  }

  const response = await requestJson("/api/unified/ats", {
    method: "POST",
    body: JSON.stringify({ jobId: source.jobId, resumeId: source.resumeId }),
  });
  assert.equal(response.response.status, 200);
  assert.equal(response.data.ok, true);

  const verification = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(
      verification
        .prepare(
          "SELECT COUNT(*) count FROM ats_analyses WHERE id LIKE 'history-analysis-%'",
        )
        .get().count,
      101,
    );
    assert.equal(
      verification
        .prepare(
          "SELECT COUNT(*) count FROM ats_analysis_items WHERE id LIKE 'history-item-%'",
        )
        .get().count,
      101,
    );
  } finally {
    verification.close();
  }
});
