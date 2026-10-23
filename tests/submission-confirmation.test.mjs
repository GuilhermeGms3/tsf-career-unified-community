import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { chromium } from "playwright";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser.close(); });
const providers = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "nerdin", "teamtailor"];

async function run(provider, { beforeText = "", afterText = "", redirect = "" } = {}) {
  const page = await browser.newPage();
  try {
    const label = provider === "nerdin" ? "Enviar Candidatura" : "Submit application";
    const body = `<p>${beforeText}</p><form id="form-candidatura" class="application-form" data-testid="application-form" action="/applications"><button type="submit" id="btn-enviar-candidatura">${label}</button></form><script>window.actions=0;document.querySelector('form').onsubmit=event=>{event.preventDefault();window.actions++;${redirect ? `history.pushState({},'',${JSON.stringify(redirect)});` : ""}${afterText ? `document.body.innerHTML=${JSON.stringify(`<h1>${afterText}</h1>`)};` : ""}}</script>`;
    await page.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html", body }));
    await page.goto("https://fixture.example.test/apply");
    let armed = 0;
    const result = await new AdapterRegistry().get(provider).submit(page, { onActionTriggered: async () => { armed++; }, confirmationTimeoutMs: 40 });
    assert.equal(armed, 1);
    assert.equal(await page.evaluate(() => window.actions), 1);
    return result;
  } finally { await page.close(); }
}

for (const provider of providers) {
  test(`${provider}: nova confirmacao explicita gera receipt apos um unico clique`, async () => {
    const result = await run(provider, { afterText: "Your application has been received" });
    assert.equal(result.status, "SUBMITTED");
    assert.equal(result.receipt.metadata.confirmationKind, "NEW_VISIBLE_SUCCESS_TEXT");
  });
  test(`${provider}: URL de application/success sem confirmacao nao prova envio`, async () => {
    assert.equal((await run(provider, { redirect: "/application?success=true&error=validation" })).status, "UNCERTAIN");
  });
  test(`${provider}: texto de sucesso anterior ao clique nao vira receipt`, async () => {
    assert.equal((await run(provider, { beforeText: "Thank you for applying" })).status, "UNCERTAIN");
  });
  test(`${provider}: palavra sucesso isolada nao confirma candidatura`, async () => {
    assert.equal((await run(provider, { afterText: "Desejamos sucesso na sua carreira" })).status, "UNCERTAIN");
  });
  test(`${provider}: erro junto a texto de envio nao confirma candidatura`, async () => {
    assert.equal((await run(provider, { afterText: "Your application received an error and could not be sent" })).status, "UNCERTAIN");
  });
}
