import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// Browser plugin not available in this session; use the installed Playwright.
const output = path.resolve(process.argv[2] || "tmp/availability-ui");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:7123/autopilot", { waitUntil: "domcontentloaded" });
  const control = page.locator("[data-availability-control]");
  await control.waitFor({ state: "visible", timeout: 60_000 });
  assert.match(await page.title(), /Career Unified/);
  await control.scrollIntoViewIfNeeded();
  if (process.argv.includes("--exercise")) {
    await control.getByLabel("Verificar vagas automaticamente").check();
    await control.getByLabel("Intervalo (horas)").fill("24");
    await control.getByLabel("Vagas por rodada").fill("20");
    await control.getByRole("button", { name: "Salvar agenda" }).click();
    await page.waitForFunction(() => document.querySelector("[data-availability-control] .pill")?.textContent === "Ligada");
    await control.getByRole("button", { name: "Verificar agora" }).click();
    await page.waitForFunction(() => document.querySelector("[data-availability-results]")?.textContent.includes("Verificando vagas"));
    await page.waitForFunction(() => !document.querySelector("[data-check-catalog]")?.disabled, null, { timeout: 180_000 });
    await control.getByLabel("Vagas por rodada").fill("100");
    await control.getByRole("button", { name: "Salvar agenda" }).click();
    await page.waitForFunction(() => document.querySelector("[data-availability-policy] .form-status")?.textContent.includes("Agenda ligada"));
  }
  await control.screenshot({ path: path.join(output, "availability-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await control.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await control.screenshot({ path: path.join(output, "availability-mobile.png") });
  assert.deepEqual(errors, []);
  const report = { status: "PASS", url: page.url(), title: await page.title(), consoleErrors: errors, mobileOverflow: false, exercised: process.argv.includes("--exercise") };
  await writeFile(path.join(output, "ui-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
