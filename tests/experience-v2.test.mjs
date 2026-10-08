import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";

const root = path.resolve("public");
let server, baseUrl, browser;
async function captureReference(page, name) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    false,
    `${name} não deve ter overflow horizontal`,
  );
  const directory = process.env.FRONTEND_VISUAL_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
}
before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://local"),
      deep = /^\/(opportunities|applications|resumes|autopilot)(\/|$)/.test(
        url.pathname,
      );
    const relative =
      url.pathname === "/" || deep ? "index.html" : url.pathname.slice(1);
    try {
      const data = await readFile(path.join(root, relative));
      const type = relative.endsWith(".css")
        ? "text/css"
        : relative.endsWith(".js")
          ? "text/javascript"
          : relative.endsWith(".html")
            ? "text/html"
            : "text/plain";
      res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser.close();
  server.close();
  await once(server, "close");
});

const job = {
  id: "job-v2",
  title: "Senior Platform Engineer",
  company: "NuvemTech",
  location: "São Paulo, SP",
  workModel: "Híbrido",
  description: "Kubernetes, Terraform, AWS e observabilidade",
  url: "https://example.test/jobs/1",
  applicationUrl: "https://jobs.lever.co/acme/1",
  atsType: "lever",
  applicationMethod: "ATS",
  createdAt: "2026-08-20T10:00:00.000Z",
  firstSeenAt: "2026-08-20T10:00:00.000Z",
  lifecycleStatus: "OPEN",
};
const resumeRecommendation = {
  selectedResumeId: "resume-1",
  selectedArchetypeId: "CLOUD_DEVOPS",
  coverage: 82,
  reasons: ["Maior cobertura de evidências"],
  resume: { id: "resume-1", title: "Cloud & Platform", language: "pt-BR" },
};
const analysis = {
  id: "analysis-1",
  analysisStatus: "CURRENT",
  overallScore: 82,
  calibratedMatchScore: 82,
  evidenceCoverage: 78,
  matchConfidence: 91,
  eligibility: "ELIGIBLE",
  resumeParseability: {
    textExtracted: true,
    sectionsDetected: true,
    status: "READY",
  },
  blockingIssues: [],
  missing: ["GCP"],
  updatedAt: "2026-08-20T11:00:00.000Z",
  algorithmVersion: "ats-matcher-v2",
};
const priority = {
  score: 88,
  level: "HIGH",
  technicalMatch: 82,
  components: { confidence: 91 },
  reasons: ["Aderência técnica 82% com confiança 91%."],
};
const version = {
  id: "resume-version-1",
  resumeId: "resume-1",
  jobId: job.id,
  templateId: "ATS_STRICT",
  archetypeId: "CLOUD_DEVOPS",
  language: "pt-BR",
  status: "REVIEW_REQUIRED",
  resumeSpec: {
    candidate: {
      fullName: "Ana Silva",
      email: "ana@example.test",
      location: "São Paulo, SP",
      headline: "Platform Engineer",
    },
    summary: { text: "Engenheira de plataforma com experiência em nuvem." },
    experiences: [
      {
        title: "Platform Engineer",
        company: "Empresa Atlas",
        startDate: "2023",
        endDate: "Atual",
        bullets: [{ text: "Operação de clusters Kubernetes em produção." }],
      },
    ],
    skills: [{ name: "Kubernetes" }, { name: "Terraform" }],
  },
  changeset: {
    changes: [
      {
        before: "Operação de clusters",
        after: "Operação de clusters Kubernetes",
        reason: "Evidência no projeto Atlas",
      },
    ],
  },
  artifacts: [],
  updatedAt: "2026-08-20T12:00:00.000Z",
};
const tailoring = {
  id: "tailoring-1",
  jobId: job.id,
  resumeId: "resume-1",
  state: "REVIEW_REQUIRED",
  originalScore: 82,
  tailoredScore: 84,
  evidenceStatus: "VALID",
  changes: [
    {
      original: "Operação de clusters",
      proposed: "Operação de clusters Kubernetes",
      reason: "Evidência no projeto Atlas",
      sourceEvidenceIds: ["evidence-1"],
    },
  ],
};
const application = {
  id: "application-1",
  jobId: job.id,
  resumeId: "resume-1",
  resumeVersionId: version.id,
  status: "WAITING_USER",
  nextAction: "Responder disponibilidade",
  createdAt: "2026-08-20T12:30:00.000Z",
  updatedAt: "2026-08-20T12:30:00.000Z",
};
const method = {
  method: "ATS",
  atsType: "lever",
  applicationUrl: job.applicationUrl,
  capability: {
    level: "INSPECT_ONLY",
    label: "Inspeção disponível; envio manual",
  },
};
function opportunityWorkspace(overrides = {}) {
  return {
    job,
    analysis,
    requirements: [],
    analysisItems: [
      {
        status: "MATCH",
        requirement: { label: "Kubernetes" },
        evidence: [{ text: "Projeto Atlas" }],
        explanation: "Evidência profissional",
      },
      {
        status: "NO_MATCH",
        requirement: { label: "GCP" },
        evidence: [],
        explanation: "Não identificado",
      },
    ],
    priority,
    feedback: null,
    application: null,
    resumeRecommendation,
    resumeTailoring: null,
    resumeVersion: null,
    applicationMethod: method,
    nextAction: {
      label: "Preparar currículo",
      reason: "Use a base recomendada.",
      tab: "resume",
    },
    timeline: [],
    ...overrides,
  };
}
function applicationWorkspace(overrides = {}) {
  return {
    application,
    job,
    plan: {
      decision: "REVIEW",
      matchScore: 82,
      eligibility: "ELIGIBLE",
      blockingIssues: [],
      warnings: [],
      selectedResumeVersionId: version.id,
    },
    questions: [
      {
        id: "question-1",
        label: "Disponibilidade para início",
        answerStatus: "USER_REQUIRED",
        reasonRequired: "Confirmação do candidato",
      },
    ],
    generatedContent: [],
    resumeTailoring: null,
    latestAttempt: null,
    inspection: null,
    profileCompleteness: { complete: true },
    queue: null,
    attempts: [],
    uploads: [],
    resumeVersion: version,
    method,
    nextAction: {
      label: "Responder pendências",
      reason: "Uma resposta precisa da sua confirmação.",
      tab: "questions",
    },
    timeline: [
      {
        id: "event-1",
        label: "candidatura criada em WAITING_USER",
        createdAt: application.createdAt,
        metadata: {},
      },
    ],
    ...overrides,
  };
}
async function jsonRoute(page, pattern, body, status = 200) {
  await page.route(pattern, (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(
        typeof body === "function" ? body(route.request()) : body,
      ),
    }),
  );
}

test("Experience V2 jornada 1: descobrir, abrir, analisar e revisar evidências", async () => {
  const page = await browser.newPage();
  let analyzed = false;
  await jsonRoute(page, "**/api/opportunities", {
    ok: true,
    opportunities: [
      { job, analysis: null, priority, application: null, feedback: null },
    ],
  });
  await jsonRoute(page, "**/api/opportunities/job-v2/workspace*", () => ({
    ok: true,
    workspace: opportunityWorkspace(
      analyzed
        ? {}
        : {
            analysis: null,
            analysisItems: [],
            nextAction: {
              label: "Analisar oportunidade",
              reason: "Confirme aderência.",
              tab: "analysis",
            },
          },
    ),
  }));
  await page.route("**/api/unified/ats", (route) => {
    analyzed = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, analysis }),
    });
  });
  await jsonRoute(page, "**/api/opportunities/job-v2/feedback", {
    ok: true,
    feedback: { verdict: "INTERESTED" },
  });
  await page.goto(`${baseUrl}/opportunities`);
  await page.getByLabel("Seções").getByRole("link", { name: "Todas" }).click();
  await page.locator(".compact-record").first().waitFor();
  await page.getByLabel("Seções").getByRole("link", { name: "Empresas" }).click();
  await page.getByRole("heading", { name: "NuvemTech" }).waitFor();
  await page.getByRole("link", { name: "Histórico" }).first().click();
  await page.getByText(/Descoberta via/i).waitFor();
  await page.getByLabel("Seções").getByRole("link", { name: "Descobrir" }).click();
  await page.getByRole("link", { name: "Senior Platform Engineer" }).click();
  await page.getByRole("heading", { name: "Senior Platform Engineer" }).waitFor();
  assert.equal(await page.locator(".workspace-header .tabs").count(), 0);
  if ((await page.locator("#opportunity-analysis").getAttribute("open")) === null)
    await page.locator("#opportunity-analysis > summary").click();
  await page.getByRole("heading", { name: "Por que esta vaga combina com você" }).waitFor();
  await page.getByRole("button", { name: "Aplicaria", exact: true }).click();
  await page
    .getByText("Marcada como uma vaga em que você aplicaria.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Analisar agora" }).click();
  await page.getByText("Com evidência (1)").waitFor();
  assert.match(await page.locator("#opportunity-summary").textContent(), /82%/);
  assert.match(await page.locator("#opportunity-analysis").textContent(), /Kubernetes/);
  assert.match(await page.locator("#opportunity-analysis").textContent(), /GCP/);
  await captureReference(page, "opportunity-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await captureReference(page, "opportunity-mobile.png");
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.match(await page.locator("main").textContent(), /GCP/);
  await page.close();
});
test("Experience V2 jornada 2: recomendação, preparação e revisão obrigatória", async () => {
  const page = await browser.newPage();
  await jsonRoute(page, "**/api/experience/resumes", {
    ok: true,
    resumes: [
      {
        resume: resumeRecommendation.resume,
        versions: [version],
        assignment: { archetypeId: "CLOUD_DEVOPS" },
      },
    ],
  });
  await jsonRoute(page, "**/api/resume-documents/templates", {
    ok: true,
    templates: [
      {
        id: "ATS_STRICT",
        name: "Modelo de leitura simplificada",
        purpose: "Compatibilidade ATS",
        version: "ats-strict-v1",
        layoutType: "SINGLE_COLUMN",
        supportedLanguages: ["pt-BR", "en"],
        atsOptimized: true,
      },
    ],
  });
  await jsonRoute(page, "**/api/opportunities/job-v2/workspace*", {
    ok: true,
    workspace: opportunityWorkspace({ resumeVersion: version }),
  });
  await jsonRoute(
    page,
    "**/api/resume-documents/versions/resume-version-1/review",
    { ok: true, version: { ...version, status: "APPROVED" } },
  );
  await page.goto(`${baseUrl}/resumes`);
  await page.getByRole("heading", { name: "Currículos", exact: true }).waitFor();
  await captureReference(page, "resumes-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await captureReference(page, "resumes-mobile.png");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${baseUrl}/resumes?section=review`);
  await page.getByText("Há alterações que precisam da sua revisão", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Modelos ATS" }).click();
  await page.getByRole("heading", { name: "Modelo de leitura simplificada" }).waitFor();
  await page.getByRole("heading", { name: "Modelos ATS e bases recomendadas" }).waitFor();
  await page.goto(`${baseUrl}/opportunities/job-v2?tab=resume`);
  await page.getByRole("heading", { name: "Como este currículo será preparado" }).waitFor();
  await page.getByRole("heading", { name: "Ana Silva" }).waitFor();
  await page
    .getByLabel("Prévia completa do currículo")
    .getByText("Engenheira de plataforma com experiência em nuvem.")
    .waitFor();
  await page.getByRole("heading", { name: "Platform Engineer", exact: true }).waitFor();
  await page.getByText("Kubernetes · Terraform").waitFor();
  await captureReference(page, "resume-review-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await captureReference(page, "resume-review-mobile.png");
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.match(
    await page.locator("main").textContent(),
    /Verificação das evidências\s*Aplicado/,
  );
  await page.getByRole("button", { name: "Aprovar currículo" }).click();
  await page.getByRole("status").getByText("Currículo aprovado.").waitFor();
  await page.close();
});
test("Experience V2 bloqueia aprovação sem prévia completa do currículo", async () => {
  const page = await browser.newPage();
  await jsonRoute(page, "**/api/opportunities/job-v2/workspace*", {
    ok: true,
    workspace: opportunityWorkspace({
      resumeVersion: {
        ...version,
        resumeSpec: { candidate: { fullName: "Ana Silva" } },
      },
    }),
  });
  await page.goto(`${baseUrl}/opportunities/job-v2?tab=resume`);
  await page.getByRole("heading", { name: "Prévia ainda indisponível" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Aprovar currículo" }).isDisabled(),
    true,
  );
  await page.close();
});
test("Experience V2 conecta revisão do tailoring à ResumeVersion específica", async () => {
  const page = await browser.newPage();
  let reviewState = "",
    versionRequest = null,
    versionReady = false;
  await jsonRoute(page, "**/api/opportunities/job-v2/workspace*", () => ({
    ok: true,
    workspace: opportunityWorkspace({
      resumeTailoring: { ...tailoring, state: reviewState || tailoring.state },
      resumeVersion: versionReady ? version : null,
      nextAction: {
        label: versionReady ? "Revisar currículo" : "Revisar ajustes do currículo",
        reason: "Revisão humana obrigatória.",
        tab: "resume",
      },
    }),
  }));
  await jsonRoute(page, "**/api/intelligence/tailoring/tailoring-1/review", (request) => {
    reviewState = request.postDataJSON().state;
    return { ok: true, run: { ...tailoring, state: reviewState } };
  });
  await jsonRoute(page, "**/api/resume-documents/versions", (request) => {
    versionRequest = request.postDataJSON();
    return { ok: true, job: { id: "document-job-1", status: "QUEUED" } };
  });
  await jsonRoute(page, "**/api/resume-documents/jobs/document-job-1", () => {
    versionReady = true;
    return { ok: true, job: { id: "document-job-1", status: "COMPLETED" } };
  });
  await page.goto(`${baseUrl}/opportunities/job-v2?tab=resume`);
  await page.getByRole("heading", { name: "Ajustes preparados" }).waitFor();
  assert.match(await page.locator("main").textContent(), /Operação de clusters Kubernetes/);
  assert.equal(
    await page.getByRole("button", { name: "Ajustes aguardando revisão" }).isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "Aprovar ajustes e gerar versão" }).click();
  await page.getByText("Versão do currículo pronta para revisão.", { exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Revise o currículo completo" }).waitFor();
  assert.equal(reviewState, "APPROVED");
  assert.equal(versionRequest.tailoringRunId, tailoring.id);
  assert.equal(versionRequest.jobId, job.id);
  await page.close();
});
test("Experience V2 recupera tailoring rejeitado sem prender a preparação", async () => {
  const page = await browser.newPage();
  let requestedVersion = null;
  await jsonRoute(page, "**/api/opportunities/job-v2/workspace*", {
    ok: true,
    workspace: opportunityWorkspace({
      resumeTailoring: {
        ...tailoring,
        state: "REJECTED",
        originalScore: 67,
        tailoredScore: 64,
      },
      resumeVersion: null,
    }),
  });
  await jsonRoute(page, "**/api/resume-documents/versions", (request) => {
    requestedVersion = request.postDataJSON();
    return { ok: true, job: { id: "base-document-job", status: "QUEUED" } };
  });
  await page.goto(`${baseUrl}/opportunities/job-v2?tab=resume`);
  await page.getByRole("heading", { name: "Como seguir agora" }).waitFor();
  assert.equal(
    await page.locator("[data-resume-base-select]").isEnabled(),
    true,
  );
  assert.equal(
    await page.locator("[data-resume-template-select]").isEnabled(),
    true,
  );
  await page
    .getByRole("button", { name: "Usar currículo base sem ajustes" })
    .click();
  assert.equal(requestedVersion.resumeId, "resume-1");
  assert.equal(requestedVersion.jobId, job.id);
  assert.equal(requestedVersion.tailoringRunId, "");
  await page.close();
});
test("Experience V2 permite editar o currículo como nova versão", async () => {
  const page = await browser.newPage();
  let revisionRequest = null;
  await jsonRoute(page, "**/api/opportunities/job-v2/workspace*", {
    ok: true,
    workspace: opportunityWorkspace({ resumeVersion: version }),
  });
  await jsonRoute(
    page,
    "**/api/resume-documents/versions/resume-version-1/revise",
    (request) => {
      revisionRequest = request.postDataJSON();
      return {
        ok: true,
        version: {
          ...version,
          id: "resume-version-edited",
          parentVersionId: version.id,
        },
      };
    },
    201,
  );
  await page.goto(`${baseUrl}/opportunities/job-v2?tab=resume`);
  await page.getByRole("tab", { name: "Editar" }).click();
  await page
    .getByLabel("Título profissional")
    .fill("Platform Engineer Cloud");
  await page
    .getByRole("button", { name: "Salvar como nova versão" })
    .click();
  assert.equal(
    revisionRequest.resumeSpec.candidate.headline,
    "Platform Engineer Cloud",
  );
  assert.equal(
    revisionRequest.resumeSpec.experiences[0].bullets[0].text,
    "Operação de clusters Kubernetes em produção.",
  );
  await page.close();
});
test("Experience V2 jornada 3: currículo aprovado, planner e workspace da candidatura", async () => {
  const page = await browser.newPage();
  await jsonRoute(page, "**/api/opportunities/job-v2/workspace*", {
    ok: true,
    workspace: opportunityWorkspace({
      resumeVersion: { ...version, status: "APPROVED" },
    }),
  });
  await jsonRoute(page, "**/api/unified/application", {
    ok: true,
    application: { ...application, status: "PLANNED" },
  });
  await jsonRoute(page, "**/api/unified/applications/application-1/plan", {
    ok: true,
    plan: {
      decision: "REVIEW",
      analysisId: analysis.id,
      selectedResumeVersionId: version.id,
    },
  });
  await jsonRoute(page, "**/api/experience/applications/application-1", {
    ok: true,
    workspace: applicationWorkspace({
      application: { ...application, status: "PLANNED" },
      nextAction: {
        label: "Continuar preparação",
        reason: "Revise o plano.",
        tab: "summary",
      },
    }),
  });
  await page.goto(`${baseUrl}/opportunities/job-v2?tab=application`);
  await page.getByRole("button", { name: "Preparar candidatura" }).click();
  await page.getByRole("heading", { name: "Decisão do planner" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/applications/application-1");
  await page.close();
});
test("Experience V2 jornada 4: USER_REQUIRED na caixa, deep link e resposta", async () => {
  const page = await browser.newPage();
  await jsonRoute(page, "**/api/today", {
    ok: true,
    inbox: {
      items: [
        {
          key: "question:1",
          category: "APPLICATIONS",
          inboxPriority: 100,
          title: "Responder pergunta obrigatória",
          description: "Disponibilidade para início",
          why: ["Confirmação do candidato"],
          cta: { label: "Responder", applicationId: application.id },
          dismissible: true,
        },
      ],
      categories: {},
    },
  });
  await jsonRoute(page, "**/api/experience/applications/application-1", {
    ok: true,
    workspace: applicationWorkspace(),
  });
  await jsonRoute(
    page,
    "**/api/unified/applications/application-1/questions/question-1/answer",
    { ok: true, question: { answerStatus: "KNOWN" } },
  );
  await page.goto(baseUrl);
  await page.getByRole("link", { name: "Responder" }).first().click();
  await page.getByRole("link", { name: "Perguntas" }).click();
  await page.getByLabel("Sua resposta").fill("Em 15 dias");
  await page.getByRole("button", { name: "Salvar resposta" }).click();
  await page.getByText("Resposta salva.", { exact: true }).waitFor();
  await page.close();
});
test("Experience V2: sugestao da IA fica visivel e exige aprovacao", async () => {
  const page = await browser.newPage();
  let generated = false, reviewState = "";
  await jsonRoute(page, "**/api/experience/applications/application-1", () => ({
    ok: true,
    workspace: applicationWorkspace({
      questions: [{ id: "question-1", label: "Por que quer trabalhar aqui?", fieldType: "textarea", answerStatus: generated ? "USER_REQUIRED" : "USER_REQUIRED", reasonRequired: "Resposta especifica da vaga", sensitive: false, consentType: "" }],
      generatedContent: generated ? [{ id: "generated-1", applicationId: "application-1", questionId: "question-1", contentType: "ANSWER_DRAFT", state: "REVIEW_REQUIRED", draft: "Quero contribuir com suporte e automacao usando experiencias comprovadas." }] : [],
    }),
  }));
  await page.route("**/api/intelligence/jobs", async (route) => {
    const input = route.request().postDataJSON();
    assert.equal(input.task, "APPLICATION_ANSWER_DRAFT");
    assert.equal(input.questionId, "question-1");
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, job: { id: "intelligence-1", status: "QUEUED" } }) });
  });
  await page.route("**/api/intelligence/jobs/intelligence-1", async (route) => {
    generated = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, job: { id: "intelligence-1", status: "COMPLETED" } }) });
  });
  await page.route("**/api/intelligence/generated/generated-1/review", async (route) => {
    reviewState = route.request().postDataJSON().state;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, item: { id: "generated-1", state: reviewState } }) });
  });
  await page.goto(`${baseUrl}/applications/application-1?tab=questions`);
  await page.getByRole("button", { name: "Pedir sugestão à IA" }).click();
  await page.getByText("Quero contribuir com suporte e automacao usando experiencias comprovadas.").waitFor();
  await page.getByRole("button", { name: "Usar sugestão" }).click();
  assert.equal(reviewState, "APPROVED");
  await page.close();
});
test("Experience V2 jornada 5: status, tentativa e timeline auditável", async () => {
  const page = await browser.newPage();
  const attempt = {
    attemptNumber: 1,
    status: "FAILED",
    adapterType: "greenhouse",
    mode: "FILL_ONLY",
    startedAt: application.createdAt,
    evidencePath: "artifacts/application-1/attempt-1.png",
    errorMessage: "Layout alterado",
  };
  await jsonRoute(page, "**/api/experience/applications/application-1", {
    ok: true,
    workspace: applicationWorkspace({ attempts: [attempt] }),
  });
  await jsonRoute(page, "**/api/experience/applications", {
    ok: true,
    applications: [
      {
        application: {
          ...application,
          updatedAt: "2026-07-01T12:30:00.000Z",
        },
        job: { ...job, interviewDate: "2026-08-28T14:00:00.000Z" },
        journey: {
          followUpDue: true,
          interviews: [
            {
              id: "interview-1",
              type: "INTERVIEW",
              status: "SCHEDULED",
              scheduledAt: "2026-08-28T14:00:00.000Z",
            },
          ],
        },
        pendingQuestions: 1,
        nextAction: { label: "Responder pendências" },
      },
    ],
  });
  await page.goto(`${baseUrl}/applications?section=pending`);
  await page.getByText("Responder pendências", { exact: true }).waitFor();
  await captureReference(page, "applications-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await captureReference(page, "applications-mobile.png");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByLabel("Seções").getByRole("link", { name: "Entrevistas" }).click();
  await page.getByText("Agendada", { exact: true }).waitFor();
  await page.getByText("Mais opções de acompanhamento").click();
  await page.getByRole("link", { name: "Retornos pendentes" }).click();
  await page.getByText("Responder pendências", { exact: true }).waitFor();
  await page.goto(`${baseUrl}/applications/application-1?tab=attempts`);
  await page.getByText("Tentativa 1").waitFor();
  await page.getByRole("link", { name: "Linha do tempo" }).click();
  await page.getByText(/candidatura criada/i).waitFor();
  await page.close();
});
test("Experience V2 jornada 6: Autopilot, execução, notificação e deep link", async () => {
  const page = await browser.newPage();
  await jsonRoute(page, "**/api/job-hunt/profiles", {
    ok: true,
    profiles: [
      {
        id: "profile-1",
        name: "Platform Brasil",
        enabled: true,
        queries: ["Platform Engineer"],
        locations: ["Brasil"],
        sourcePreferences: ["linkedin"],
        considerThreshold: 70,
        prepareResumeThreshold: 82,
        notifyThreshold: 90,
      },
    ],
  });
  await jsonRoute(page, "**/api/automation/status", {
    ok: true,
    recentRuns: [
      {
        id: "run-1",
        profileId: "profile-1",
        status: "COMPLETED",
        queryCount: 12,
        discoveredCount: 48,
        matchedCount: 5,
        alertCount: 1,
        startedAt: job.createdAt,
      },
    ],
  });
  await jsonRoute(page, "**/api/source-configurations", {
    ok: true,
    sources: [],
  });
  await jsonRoute(page, "**/api/company-radar", { ok: true, companies: [] });
  await jsonRoute(page, "**/api/whatsapp/status", {
    ok: true,
    whatsapp: { connectionState: "CONNECTED" },
    configuration: { maskedTarget: "+55 ** *****-1234" },
  });
  await jsonRoute(page, "**/api/opportunities/job-v2/workspace*", {
    ok: true,
    workspace: opportunityWorkspace(),
  });
  await page.goto(`${baseUrl}/autopilot?section=runs`);
  await page.getByText(/48 descobertas/).waitFor();
  await page.goto(`${baseUrl}/opportunities/job-v2`);
  await page
    .getByRole("heading", { name: "Senior Platform Engineer" })
    .waitFor();
  await page.close();
});

const submissionPreflight={id:"preflight-1",applicationId:application.id,adapterType:"greenhouse",status:"REVIEW_REQUIRED",fresh:true,freshUntil:"2026-08-23T12:05:00.000Z",submissionEnabled:true,readyForPreview:true,readyForConsent:true,readyForSubmit:false,blockingReasons:[],warnings:[],gates:[{id:"ELIGIBILITY",status:"READY",message:"Elegibilidade confirmada."},{id:"SENSITIVE_QUESTIONS",status:"READY",message:"Resposta humana confirmada."},{id:"RESUME_ARTIFACT",status:"READY",message:"Currículo exato e íntegro."},{id:"JOB_OPEN",status:"READY",message:"Vaga aberta.",details:{status:"OPEN",checkedAt:"2026-08-23T12:00:00.000Z"}},{id:"ADAPTER_HEALTH",status:"READY",message:"Adapter saudável."},{id:"DOM_CONFIDENCE",status:"READY",message:"Alta confiança."},{id:"INSPECTION_FRESHNESS",status:"READY",message:"Formulário verificado agora.",details:{fresh:true,inspectedAt:"2026-08-23T12:00:00.000Z"}},{id:"DUPLICATE",status:"READY",message:"Sem duplicata."},{id:"RATE_LIMIT",status:"READY",message:"Limite disponível."}],formSnapshot:[{field:"Pretensão salarial",presentation:"Resposta fornecida (oculta)",source:"USER_CONFIRMED",status:"KNOWN"}]};

test("Application V2 UI: preflight e revisão final são responsivos e mascaram sensível",async()=>{
  for(const viewport of [{width:1920,height:1080},{width:1366,height:768},{width:390,height:844}]){
    const page=await browser.newPage({viewport});
    await jsonRoute(page,"**/api/experience/applications/application-1",{ok:true,workspace:applicationWorkspace({application:{...application,status:"READY_TO_SUBMIT"},submissionPreflight,method:{...method,atsType:"greenhouse",capability:{level:"CONTROLLED_SUBMIT",label:"Greenhouse Controlled Submit"}}})});
    await page.goto(`${baseUrl}/applications/application-1?tab=preflight`);
    await page.getByRole("heading",{name:"Verificações antes de qualquer envio"}).waitFor();
    await page.getByRole("link",{name:"Revisão final",exact:true}).click();
    await page.getByText("Resposta fornecida (oculta)",{exact:true}).waitFor();
    await page.getByRole("button",{name:"Autorizar envio"}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.close();
  }
});

test("Application V2 UI: uncertainty não oferece retry e receipt mostra versão exata",async()=>{
  const uncertain=await browser.newPage();
  await jsonRoute(uncertain,"**/api/experience/applications/application-1",{ok:true,workspace:applicationWorkspace({application:{...application,status:"SUBMISSION_UNCERTAIN"},submissionAttempt:{id:"submission-attempt-1",status:"UNCERTAIN"},submissionPreflight})});
  await uncertain.goto(`${baseUrl}/applications/application-1?tab=review`);
  await uncertain.getByText(/não conseguimos confirmar/i).waitFor();
  assert.equal(await uncertain.getByRole("button",{name:/tentar|reenviar/i}).count(),0);
  await uncertain.close();
  const submitted=await browser.newPage();
  await jsonRoute(submitted,"**/api/experience/applications/application-1",{ok:true,workspace:applicationWorkspace({application:{...application,status:"SUBMITTED"},submissionPreflight,submissionReceipt:{provider:"fixture",submittedAt:"2026-08-23T12:00:00.000Z",externalReference:"fixture-42",resumeVersionId:version.id,confirmationUrl:"https://example.test/receipt"}})});
  await submitted.goto(`${baseUrl}/applications/application-1?tab=review`);
  await submitted.getByRole("heading",{name:"Candidatura enviada"}).waitFor();
  await submitted.getByText("Currículo aprovado para esta vaga",{exact:false}).waitFor();
  await submitted.getByText("Detalhes técnicos",{exact:true}).click();
  assert.match(await submitted.locator("pre").innerText(),new RegExp(version.id));
  await submitted.close();
});

test("Application V2.1 UI: kill switch, stale preview e handoff são explícitos",async()=>{
  const disabled=await browser.newPage();
  await jsonRoute(disabled,"**/api/experience/applications/application-1",{ok:true,workspace:applicationWorkspace({application:{...application,status:"READY_TO_SUBMIT"},submissionPreflight:{...submissionPreflight,submissionEnabled:false,readyForConsent:false},submissionSession:{status:"WAITING_USER",interactiveAvailable:true,expiresAt:"2026-08-23T12:10:00.000Z"}})});
  await disabled.goto(`${baseUrl}/applications/application-1?tab=review`);
  await disabled.getByText("Envio controlado está instalado, mas o envio externo está desativado nesta instalação.",{exact:true}).waitFor();
  await disabled.getByText(/Sessão interativa:/).waitFor();
  await disabled.close();

  const stale=await browser.newPage();
  await jsonRoute(stale,"**/api/experience/applications/application-1",{ok:true,workspace:applicationWorkspace({application:{...application,status:"READY_TO_SUBMIT"},submissionPreflight,submissionPreviewStale:true})});
  await stale.goto(`${baseUrl}/applications/application-1?tab=review`);
  await stale.getByText(/Esta revisão ficou desatualizada/).waitFor();
  await stale.getByRole("button",{name:"Atualizar revisão"}).waitFor();
  assert.equal(await stale.getByRole("button",{name:"Autorizar envio"}).count(),0);
  await stale.close();
});
