import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import test, { after, before } from "node:test";
import { chromium } from "playwright";

const publicRoot = path.resolve("public");
let server;
let baseUrl;
let browser;
let activeInbox;
let activeFeedbackHandler = () => {};
let activeRequests = [];
let activeRefreshRun;
let activeHuntPolls = 0;

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

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

before(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://local");
    activeRequests.push(url.pathname);
    if (url.pathname === "/api/today" && request.method === "GET")
      return json(response, 200, { ok: true, inbox: activeInbox });
    if (url.pathname === "/api/source-center")
      return json(response, 200, { ok: true, sources: [] });
    if (url.pathname === "/api/product/onboarding")
      return json(response, 200, { ok: true, onboarding: { status: "COMPLETED" } });
    if (url.pathname === "/api/today/review")
      return json(response, 200, { ok: true });
    if (url.pathname === "/api/today/refresh" && request.method === "POST") {
      activeRefreshRun = { id: "daily-refresh-ui", status: "RUNNING", stage: "SEARCHING", verificationTotal: 0, verificationChecked: 0 };
      return json(response, 202, { ok: true, run: activeRefreshRun });
    }
    if (url.pathname === "/api/today/refresh/daily-refresh-ui") {
      activeRefreshRun = { ...activeRefreshRun, status: "COMPLETED", stage: "COMPLETED", result: { search: { status: "COMPLETED", found: 8, newJobs: 6, duplicates: 2, sources: [] } } };
      return json(response, 200, { ok: true, run: activeRefreshRun });
    }
    if (url.pathname === "/api/job-hunt/profiles/profile/run" && request.method === "POST") {
      activeHuntPolls = 0;
      return json(response, 202, { ok: true, runId: "hunt-ui", run: { id: "hunt-ui", status: "RUNNING" } });
    }
    if (url.pathname === "/api/job-hunt/runs/hunt-ui") {
      activeHuntPolls += 1;
      const completed = activeHuntPolls > 1;
      return json(response, 200, { ok: true, run: {
        id: "hunt-ui",
        status: completed ? "COMPLETED" : "RUNNING",
        matchedCount: completed ? 1 : 0,
        report: {
          progress: { stage: completed ? "COMPLETED" : "DISCOVERY", plannedQueries: 4, completedRequests: completed ? 4 : 1, partialDiscoveredCount: 3, partialCanonicalCount: 2, recentDiscoveries: [{ id: "job-live", title: "Backend Junior", company: "Acme", location: "Remoto, BR", source: "indeed" }] },
          sourceReports: [{ provider: "jobspy", status: "CONSULTED", sites: [{ site: "indeed", status: "SUCCESS", acceptedResults: 3 }] }],
          recentDiscoveries: [{ id: "job-live", title: "Backend Junior", company: "Acme", location: "Remoto, BR", source: "indeed" }],
        },
      } });
    }
    if (url.pathname === "/api/job-hunt/runs/hunt-ui/pause" && request.method === "POST")
      return json(response, 200, { ok: true, run: { id: "hunt-ui", status: "SKIPPED", errorCode: "USER_PAUSED", report: {} } });
    if (/^\/api\/opportunities\/[^/]+\/feedback$/.test(url.pathname)) {
      const feedback = JSON.parse((await requestBody(request)) || "{}");
      activeInbox = activeFeedbackHandler(activeInbox, feedback) || activeInbox;
      return json(response, 200, { ok: true });
    }
    if (url.pathname.startsWith("/api/") && !url.pathname.endsWith(".js"))
      return json(response, 404, { ok: false });
    const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    try {
      const data = await readFile(path.join(publicRoot, relative));
      const contentType = relative.endsWith(".css")
        ? "text/css"
        : relative.endsWith(".js")
          ? "text/javascript"
          : relative.endsWith(".html")
            ? "text/html"
            : "text/plain";
      response.writeHead(200, { "content-type": `${contentType}; charset=utf-8` });
      response.end(data);
    } catch {
      activeRequests.push(`404:${url.pathname}`);
      response.writeHead(404);
      response.end("Not found");
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

function opportunity(id, overrides = {}) {
  return {
    job: {
      id,
      title: `Vaga ${id}`,
      company: "Empresa Teste",
      location: "Remoto, BR",
      workModel: "Remoto",
      sourcePortal: "indeed",
    },
    tier: "GOOD",
    calibratedMatchScore: 84,
    evidenceCoverage: 91,
    confidenceBand: "HIGH",
    strengths: ["Java", "Spring Boot", "PostgreSQL"],
    gaps: ["Terraform"],
    hardBlockers: [],
    decisionSummary: "Boa aderência com evidência suficiente.",
    ...overrides,
  };
}

function inbox(dailyDecision = {}) {
  return {
    generatedAt: "2026-09-09T12:00:00.000Z",
    items: [],
    dailyDecision: {
      discoveredSinceLastReview: 13,
      worthAttention: 4,
      reviewRequired: 3,
      automaticallyExcluded: 4,
      bestOpportunity: null,
      triageQueue: [],
      dailyProgress: { reviewed: 0, prepared: 0, applied: 0 },
      needsAttention: { analysesToRecalculate: 0 },
      dailyPlan: [{ priority: 1, kind: "SEARCH", title: "Atualizar a busca de vagas", description: "A busca precisa de atualização.", href: "/opportunities?section=discover" }],
      searchQueue: { status: "UPDATE_RECOMMENDED", profileId: "profile", profileName: "Principal", enabled: true, lastRunAt: "2026-09-08T12:00:00.000Z", recommendedQueries: [{ query: "Backend junior", familyId: "BACKEND" }], latestRun: { discoveredCount: 12, matchedCount: 3 } },
      opportunityTrend: { direction: "UP", delta: 4, recent: 7, days: [4,5,6,7,8,9,10].map((day,index)=>({date:`2026-09-${String(day).padStart(2,"0")}`,discovered:index})) },
      weeklyTechRadar: { status: "AVAILABLE", source: "DEV Community", items: [{ id: "1", title: "Discussão real da semana", url: "https://dev.to/test/post", author: "Dev", reactions: 10, comments: 2, tags: ["node"] }] },
      ...dailyDecision,
    },
  };
}

async function openToday(initialInbox, onFeedback = () => {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  activeInbox = initialInbox;
  activeFeedbackHandler = onFeedback;
  activeRequests = [];
  await page.addInitScript(() => localStorage.clear());
  await page.goto(baseUrl);
  try {
    await page.getByRole("heading", { name: /Bom dia|Boa tarde|Boa noite/ }).waitFor({ timeout: 5000 });
  } catch (error) {
    const body = await page.locator("body").innerText();
    throw new Error(`${error.message}\nRuntime: ${runtimeErrors.join(" | ") || "sem erro capturado"}\nRequests: ${activeRequests.join(", ")}\nBody: ${body}`);
  }
  return page;
}

test("Today mostra novas vagas e quantas merecem atenção no topo", async () => {
  const page = await openToday(inbox());
  try {
    const brief = page.locator(".daily-brief");
    assert.match(await brief.innerText(), /Novas\s+13/i);
    assert.match(await brief.innerText(), /Valem atenção\s+4/i);
    await captureReference(page, "today-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureReference(page, "today-mobile.png");
  } finally {
    await page.close();
  }
});

test("Today organiza plano, fila de busca, tendência e radar semanal", async () => {
  const page = await openToday(inbox());
  try {
    await page.getByRole("heading", { name: "O que fazer hoje" }).waitFor();
    assert.match(await page.locator(".search-queue").innerText(), /Atualização recomendada[\s\S]*Backend junior/i);
    assert.match(await page.locator(".opportunity-trend").innerText(), /Vagas encontradas em 7 dias[\s\S]*aumentou/i);
    assert.match(await page.locator(".weekly-tech-radar").innerText(), /Discussão real da semana/i);
  } finally {
    await page.close();
  }
});

test("Today inicia busca em massa e acompanha fontes e vagas em painel lateral", async () => {
  const page = await openToday(inbox());
  try {
    await page.getByRole("button", { name: "Buscar vagas em massa" }).first().click();
    const panel = page.locator(".hunt-live-panel");
    await panel.getByRole("heading", { name: "Caça em massa" }).waitFor();
    await panel.getByText("Backend Junior", { exact: true }).waitFor();
    assert.match(await panel.innerText(), /indeed[\s\S]*3/i);
    assert.ok(activeRequests.includes("/api/job-hunt/profiles/profile/run"));
    assert.ok(activeRequests.includes("/api/job-hunt/runs/hunt-ui"));
    await captureReference(page, "today-mass-hunt-desktop.png");
    await page.setViewportSize({ width: 390, height: 844 });
    await captureReference(page, "today-mass-hunt-mobile.png");
    await panel.getByRole("button", { name: "Minimizar radar" }).click();
    assert.equal(await panel.isHidden(), true);
    const launcher = page.getByRole("button", { name: "Reabrir radar de oportunidades" });
    await launcher.waitFor();
    await launcher.click();
    assert.equal(await panel.isVisible(), true);
    await panel.getByRole("button", { name: "Pausar" }).click();
    await panel.waitFor({ state: "hidden" });
    assert.equal(await launcher.isHidden(), true);
    assert.ok(activeRequests.includes("/api/job-hunt/runs/hunt-ui/pause"));
  } finally {
    await page.close();
  }
});

test("Today mostra score calibrado, cobertura e confiança da melhor vaga", async () => {
  const bestOpportunity = opportunity("principal");
  const page = await openToday(inbox({ bestOpportunity, triageQueue: [bestOpportunity] }));
  try {
    const summary = page.locator(".match-trust-summary");
    assert.match(await summary.innerText(), /Compatibilidade estimada\s+84/i);
    assert.match(await summary.innerText(), /Cobertura\s+91/i);
    assert.match(await summary.innerText(), /Confiança\s+Alta/i);
    assert.equal(await page.locator('[data-triage-card="principal"]').count(), 1, "a melhor vaga deve aparecer uma única vez");
  } finally {
    await page.close();
  }
});

test("Today separa vagas fortes das que valem revisão", async () => {
  const best = opportunity("melhor"), strong = opportunity("forte"), uncertain = opportunity("incerta", { tier: "REVIEW", calibratedMatchScore: 61 });
  const page = await openToday(inbox({ bestOpportunity: best, applyToday: [best, strong], worthReviewing: [uncertain], triageQueue: [best, strong, uncertain] }));
  try {
    assert.match(await page.locator(".daily-triage").filter({ hasText: "Boas opções para decidir" }).innerText(), /Vaga forte/i);
    assert.match(await page.locator(".daily-triage").filter({ hasText: "Incertezas que você resolve rápido" }).innerText(), /Vaga incerta/i);
  } finally {
    await page.close();
  }
});

test("Renovar vagas dispara o processo diário e acompanha a conclusão", async () => {
  const page = await openToday(inbox());
  try {
    await page.getByRole("button", { name: "Renovar vagas de hoje" }).click();
    await page.waitForTimeout(1600);
    assert.ok(activeRequests.includes("/api/today/refresh"));
    assert.ok(activeRequests.includes("/api/today/refresh/daily-refresh-ui"));
  } finally {
    await page.close();
  }
});

test("Today alerta quando score tem baixa cobertura e confiança", async () => {
  const limited = opportunity("limitada", { calibratedMatchScore: 58, evidenceCoverage: 20, confidenceBand: "LOW" });
  const page = await openToday(inbox({ bestOpportunity: limited, triageQueue: [limited] }));
  try {
    await page.getByText("Análise limitada", { exact: true }).first().waitFor();
    assert.match(await page.locator(".match-trust-summary").innerText(), /58[\s\S]*20[\s\S]*Baixa/i);
  } finally {
    await page.close();
  }
});

test("Today não apresenta vaga bloqueada como melhor oportunidade", async () => {
  const allowed = opportunity("permitida");
  const page = await openToday(inbox({ bestOpportunity: allowed, triageQueue: [allowed], automaticallyExcluded: 1 }));
  try {
    await page.getByRole("heading", { name: "Vaga permitida" }).first().waitFor();
    assert.equal(await page.getByText("Vaga bloqueada", { exact: true }).count(), 0);
  } finally {
    await page.close();
  }
});

test("Não é para mim remove a vaga da triagem principal", async () => {
  const rejected = opportunity("descartável");
  const page = await openToday(
    inbox({ bestOpportunity: rejected, triageQueue: [rejected], automaticallyExcluded: 0 }),
    (current, feedback) => {
      assert.equal(feedback.userDecision, "REJECT");
      assert.equal(feedback.rejectionReason, "NOT_INTERESTED");
      return inbox({ ...current.dailyDecision, bestOpportunity: null, triageQueue: [], automaticallyExcluded: 1 });
    },
  );
  try {
    await page.getByRole("button", { name: "Não é para mim" }).click();
    await page.getByLabel("Motivo (opcional)").waitFor();
    await page.getByRole("button", { name: "Descartar vaga" }).click();
    await page.getByRole("heading", { name: "Nenhuma oportunidade forte agora" }).waitFor();
    assert.equal(await page.locator('[data-triage-card="descartável"]').count(), 0);
  } finally {
    await page.close();
  }
});
