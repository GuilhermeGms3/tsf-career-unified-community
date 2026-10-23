import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = "http://127.0.0.1:7123", output = path.resolve(process.argv[2] || "tmp/processes-ui");
await mkdir(output, { recursive: true });
const { items } = await fetch(`${base}/api/whatsapp/processes?limit=1`).then(r => r.json());
assert.ok(items?.length, "A homologação visual requer um processo real existente.");
const item = items[0], browser = await chromium.launch({ headless: true }), errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  for (const [name, route, selector] of [
    ["processes", "/processes", ".process-row"],
    ["process-detail", `/processes/${encodeURIComponent(item.jobId)}`, ".process-timeline"],
    ["application", `/applications/${encodeURIComponent(item.applicationId)}`, ".application-stepper"],
    ["opportunity", `/opportunities/${encodeURIComponent(item.jobId)}`, ".workspace-body"],
  ]) {
    await page.goto(base + route, { waitUntil: "domcontentloaded" });
    await page.locator(selector).first().waitFor({ state: "visible", timeout: 60_000 });
    if (name === "application" && item.status === "CANCELLED") assert.equal(await page.getByRole("button", { name: "Gerar plano", exact: true }).count(), 0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow horizontal em ${name}/${width}`);
      await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: false });
      if(name==="opportunity"){
        const requirements=page.locator(".requirement-group").first();
        if(await requirements.count()){
          await requirements.scrollIntoViewIfNeeded();
          const overlaps=await page.locator(".requirement-group article").evaluateAll(articles=>articles.filter(article=>{
            const a=article.querySelector("div")?.getBoundingClientRect(),b=article.querySelector("small")?.getBoundingClientRect();
            return a&&b&&Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
          }).length);
          assert.equal(overlaps,0,`Requisitos sobrepostos em ${width}px`);
          await page.screenshot({path:path.join(output,`requirements-${width}.png`),fullPage:false});
        }
      }
    }
  }
  await page.goto(`${base}/applications/${encodeURIComponent(item.applicationId)}?tab=timeline`);
  const selector = page.locator("[data-tracking-kind]");
  await selector.waitFor({ state: "visible" });
  assert.equal(await page.locator(".tracking-actions form:visible").count(), 1);
  await selector.selectOption("1");
  assert.equal(await page.locator(".tracking-actions form:visible").count(), 1);
  assert.equal(await page.locator('.tracking-actions form:visible input[name="scheduledAt"]').count(), 1);
  assert.deepEqual(errors, []);
  const report = { status: "PASS", pages: 4, viewports: [1440, 390], trackingForms: "one-at-a-time", consoleErrors: errors, externalSubmission: false };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
