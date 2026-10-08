import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const externalUrl = process.env.DISCOVERY_SMOKE_URL || "";
const dataDir = externalUrl ? null : await mkdtemp(path.join(os.tmpdir(), "career-discovery-ui-"));
const baseUrl = externalUrl || "http://127.0.0.1:7129";
const screenshotPath = process.env.DISCOVERY_SMOKE_SCREENSHOT || path.join(os.tmpdir(), "discovery-ui-smoke.png");
const server = externalUrl ? null : spawn(process.execPath, ["server.mjs"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  env: { ...process.env, HUB_DATA_DIR: dataDir, HUB_PORT: "7129" },
  stdio: "ignore",
});

async function ready() {
  for (let index = 0; index < 60; index += 1) {
    try { if ((await fetch(`${baseUrl}/api/projects`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Servidor de UI smoke nao iniciou.");
}

async function navigate(page, href) {
  await page.evaluate((target) => document.querySelector(`a[href="${target}"]`)?.click(), href);
}

let browser;
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], httpErrors = [], requests = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  page.on("response", (response) => {
    if (response.status() >= 500) httpErrors.push({ url: response.url(), status: response.status() });
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("h1").waitFor();
  const initialRequestCount = requests.length;

  await navigate(page, "/opportunities?section=recommended");
  await page.getByRole("heading", { name: "Oportunidades", exact: true }).waitFor();
  await page.locator('a[href="/opportunities?section=review"]:visible').first().click();
  await page.getByRole("heading", { name: "Vale revisar", exact: true }).waitFor();
  await page.locator('a[href="/opportunities?section=stretch"]:visible').first().click();
  await page.getByRole("heading", { name: "Stretch", exact: true }).waitFor();
  const opportunityRequests = requests.slice(initialRequestCount).filter((item) => item === "/api/opportunities").length;

  const securityStart = requests.length;
  await navigate(page, "/settings?section=security");
  await page.getByRole("heading", { name: "Segurança", exact: true }).waitFor();
  const forbiddenSecurityProbes = requests.slice(securityStart).filter((item) => [
    "/api/runtime-diagnostics", "/api/intelligence/status", "/api/engine/status", "/api/whatsapp/status",
  ].includes(item));
  const securityRequests = requests.slice(securityStart);

  await navigate(page, "/opportunities?section=recommended");
  await navigate(page, "/knowledge?section=inventory");
  await navigate(page, "/applications?section=pipeline");
  await page.getByRole("heading", { name: "Candidaturas", exact: true }).waitFor();
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const report = {
    ok: !errors.length && !httpErrors.length && opportunityRequests <= 1 && !forbiddenSecurityProbes.length,
    errors,
    httpErrors,
    opportunityRequests,
    forbiddenSecurityProbes,
    securityRequests,
    finalHeading: await page.locator("h1").first().textContent(),
    performanceSamples: await page.evaluate(() => globalThis.__careerPerformance?.length || 0),
    screenshotPath,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  if (dataDir) {
    const resolved = path.resolve(dataDir), tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (!resolved.startsWith(tempRoot)) throw new Error("Diretorio temporario fora do escopo.");
    await rm(resolved, { recursive: true, force: true });
  }
}
