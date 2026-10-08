import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";

const root = path.resolve("public");
let server, baseUrl, browser;
before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://local"),
      deep =
        /^\/(opportunities|applications|resumes|resume-batches|autopilot)(\/|$)/.test(
          url.pathname,
        ),
      relative =
        url.pathname === "/" || deep ? "index.html" : url.pathname.slice(1);
    try {
      const data = await readFile(path.join(root, relative)),
        type = relative.endsWith(".css")
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
const opportunity = {
  job: {
    id: "job-a",
    title: "Backend Junior",
    company: "Acme",
    location: "Remoto",
    workModel: "REMOTE",
    description: "Node Docker",
    createdAt: "2026-08-26T10:00:00.000Z",
  },
  analysis: { overallScore: 84, matched: [] },
  preMatch: {},
  priority: { level: "HIGH", technicalMatch: 84, components: {} },
  decision: { disposition: "RECOMMENDED", gapSummary: { counts: {} } },
};
async function jsonRoute(page, pattern, value) {
  await page.route(pattern, async (route) => {
    const body =
      typeof value === "function" ? await value(route.request()) : value;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("multi-seleção cria batch com saídas e contexto explícitos", async () => {
  const page = await browser.newPage(),
    requests = [];
  await jsonRoute(page, "**/api/opportunities", {
    ok: true,
    opportunities: [opportunity],
  });
  await jsonRoute(page, "**/api/experience/resumes", {
    ok: true,
    resumes: [
      { resume: { id: "resume-a", title: "Base Backend" }, versions: [] },
      { resume: { id: "resume-b", title: "Base DevOps" }, versions: [] },
    ],
  });
  await jsonRoute(page, "**/api/resume-batches", (request) => {
    if (request.method() === "POST") {
      requests.push(request.postDataJSON());
      return { ok: true, batch: { id: "batch-1" } };
    }
    return { ok: true, batches: [] };
  });
  await jsonRoute(page, "**/api/resume-batches/batch-1/compare", {
    ok: true,
    batch: { id: "batch-1", status: "ANALYZING" },
  });
  await jsonRoute(page, "**/api/resume-batches/batch-1", {
    ok: true,
    batch: batchFixture("AWAITING_SELECTION"),
  });
  await page.goto(`${baseUrl}/opportunities?section=recommended`);
  await page.getByLabel("Selecionar Backend Junior").check();
  await page.getByText("1 oportunidades selecionadas").waitFor();
  await page.getByRole("button", { name: "Preparar currículos" }).click();
  await page.getByLabel("Currículo-base").selectOption("resume-a");
  await page.getByRole("checkbox", { name: "Base DevOps" }).check();
  await page.getByLabel("ZIP Overleaf").check();
  await page.getByRole("button", { name: "Criar fila e comparar" }).click();
  await page
    .getByRole("heading", { name: /currículos em preparação/ })
    .waitFor();
  assert.deepEqual(requests[0].jobIds, ["job-a"]);
  assert.equal(requests[0].baseResumeId, "resume-a");
  assert.deepEqual(requests[0].comparisonResumeIds, ["resume-b"]);
  assert.deepEqual(requests[0].requestedOutputs, ["pdf", "latex", "overleaf"]);
  assert.equal(requests[0].afterReady, "PREPARE_ONLY");
  await page.close();
});

test("workspace para polling em revisão e apresenta diff humano", async () => {
  const page = await browser.newPage();
  let reads = 0,
    approval = null;
  await jsonRoute(page, "**/api/resume-batches/batch-review", () => {
    reads++;
    return {
      ok: true,
      batch: batchFixture("AWAITING_REVIEW", {
        itemStatus: "TAILORING_REVIEW_REQUIRED",
        tailoring: true,
      }),
    };
  });
  await jsonRoute(
    page,
    "**/api/resume-batches/batch-review/approve",
    (request) => {
      approval = request.postDataJSON();
      return { ok: true, batch: batchFixture("GENERATING") };
    },
  );
  await page.goto(`${baseUrl}/resume-batches/batch-review`);
  await page.getByRole("heading", { name: "Ajustes propostos" }).waitFor();
  await new Promise((resolve) => setTimeout(resolve, 1400));
  assert.equal(reads, 1);
  assert.match(
    await page.locator("main").textContent(),
    /Evidências Validado[\s\S]*Antes[\s\S]*Depois/,
  );
  await page.getByRole("button", { name: "Aprovar ajustes seguros" }).click();
  assert.equal(approval.phase, "TAILORING");
  assert.equal(approval.state, "APPROVED");
  assert.deepEqual(approval.itemIds,["item-1"]);
  await page.close();
});

test("recomendação não substitui a base e escolha individual é persistida", async () => {
  const page=await browser.newPage(),batch=batchFixture("AWAITING_SELECTION");let selection;
  const alternative={...batch.comparisons[0],id:"comparison-2",resumeId:"resume-b",score:95};
  batch.resumes=[{id:"resume-a",title:"Minha base"},{id:"resume-b",title:"Alternativa"}];
  batch.comparisons.push(alternative);batch.items[0].comparisons.push(alternative);batch.items[0].recommendedResumeId="resume-b";batch.items[0].selectedBaseResumeId="resume-a";
  await jsonRoute(page,"**/api/resume-batches/batch-1",{ok:true,batch});
  await jsonRoute(page,"**/api/resume-batches/batch-1/selections",request=>{selection=request.postDataJSON();return {ok:true,batch};});
  await page.goto(`${baseUrl}/resume-batches/batch-1`);
  await page.getByLabel("Currículo escolhido").waitFor();
  assert.equal(await page.getByLabel("Currículo escolhido").inputValue(),"resume-a");
  await page.getByRole("button",{name:"Usar recomendação"}).click();
  await page.getByText("Escolha salva para esta vaga.").waitFor();
  assert.deepEqual(selection.selections,[{itemId:"item-1",resumeId:"resume-b"}]);
  await page.close();
});

test("fila global narra o item atual e pode ser minimizada sem perder o batch", async () => {
  const page = await browser.newPage(),
    batch = batchFixture("GENERATING", {
      itemStatus: "RENDERING",
      tailoring: true,
    });
  batch.items[0].tailoring.quality = {
    status: "PASS",
    score: 92,
    autoApplyEligible: true,
  };
  await jsonRoute(page, "**/api/resume-batches", {
    ok: true,
    batches: [{ id: batch.id, status: batch.status }],
  });
  await jsonRoute(page, `**/api/resume-batches/${batch.id}`, {
    ok: true,
    batch,
  });
  await page.goto(`${baseUrl}/resume-batches/${batch.id}`);
  const panel = page.getByLabel("Fila de preparação de currículos");
  await panel.locator(".resume-queue-head strong").getByText("Gerando LaTeX e PDF").waitFor();
  await panel.getByText("Qualidade: Aprovada pelo gate editorial · 92%").waitFor();
  await panel.getByRole("button", { name: "Minimizar fila" }).click();
  const reopen = page.getByRole("button", { name: /Fila de currículos/ });
  await reopen.waitFor();
  await reopen.click();
  await panel.locator(".resume-queue-current").getByText("Backend Junior").waitFor();
  await page.close();
});

function batchFixture(
  status,
  {
    itemStatus = status === "AWAITING_SELECTION" ? "ANALYZED" : "SELECTED",
    tailoring = false,
  } = {},
) {
  const comparison = {
    id: "comparison-1",
    batchRunId: "batch-1",
    batchItemId: "item-1",
    jobId: "job-a",
    resumeId: "resume-a",
    status: "COMPLETED",
    score: 84,
    result: {},
    reused: false,
  };
  return {
    id: status === "AWAITING_REVIEW" ? "batch-review" : "batch-1",
    status,
    baseResumeId: "resume-a",
    comparisonResumeIds: ["resume-a"],
    requestedOutputs: { pdf: true, latex: true, overleaf: false },
    totalItems: 1,
    completedItems: 0,
    failedItems: 0,
    reviewRequiredItems: status === "AWAITING_REVIEW" ? 1 : 0,
    createdAt: "2026-08-26T10:00:00.000Z",
    items: [
      {
        id: "item-1",
        batchRunId: "batch-1",
        jobId: "job-a",
        status: itemStatus,
        recommendedResumeId: "resume-a",
        finalResumeId: "",
        reviewState: tailoring ? "REVIEW_REQUIRED" : "PENDING",
        outputStatus: {},
        job: opportunity.job,
        comparisons: [comparison],
        tailoring: tailoring
          ? {
              id: "tailoring-1",
              state: "REVIEW_REQUIRED",
              originalScore: 80,
              tailoredScore: 84,
              evidenceStatus: "VALID",
              changes: [
                {
                  type: "SUMMARY",
                  original: "Backend",
                  proposed: "Backend Node",
                  reason: "Evidência existente",
                  validationStatus: "VALID",
                },
              ],
            }
          : null,
        version: null,
      },
    ],
    comparisons: [comparison],
  };
}
