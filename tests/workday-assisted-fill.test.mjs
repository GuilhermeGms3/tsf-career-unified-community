import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { WorkdayAdapter } from "../src/automation/ats/workday/workday-adapter.mjs";

let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser.close();
});

test("Workday abre a candidatura, inspeciona a etapa e exige handoff para avançar", async () => {
  const page = await browser.newPage();
  await page.setContent(`
    <button data-automation-id="jobPostingApplyButton">Apply</button>
    <main data-automation-id="applyFlowPage"></main>
    <script>
      document.querySelector('button').addEventListener('click', () => {
        document.querySelector('main').innerHTML = '<form><label for="first">First name</label><input id="first" name="first" required></form>';
      });
    </script>
  `);
  const adapter = new WorkdayAdapter();
  const inspected = await adapter.inspectApplicationForm(page);
  assert.equal(inspected.fields.length, 1);
  assert.equal(inspected.schema.variant, "workday-external-apply-step");
  await page.locator("#first").fill("Ana");
  const validation = await adapter.validate(page, [
    { ...inspected.fields[0], answer: "Ana", answerStatus: "KNOWN" },
  ]);
  assert.equal(validation.valid, false);
  assert.equal(
    validation.unknown.some(
      (field) => field.semanticKey === "WORKDAY.NEXT_STEP",
    ),
    true,
  );
  await page.close();
});

test("Workday transforma login obrigatório em handoff explícito", async () => {
  const page = await browser.newPage();
  await page.setContent(`
    <button data-automation-id="jobPostingApplyButton">Apply</button>
    <main></main>
    <script>
      document.querySelector('button').addEventListener('click', () => {
        document.querySelector('main').innerHTML = '<h1>Sign in</h1><input type="password">';
      });
    </script>
  `);
  await assert.rejects(
    new WorkdayAdapter().inspectApplicationForm(page),
    (error) => error.code === "WORKDAY_AUTH_REQUIRED",
  );
  await page.close();
});
