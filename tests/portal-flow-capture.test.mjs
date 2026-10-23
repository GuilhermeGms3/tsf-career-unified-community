import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { captureFlow, proposeProfile, redactionPatterns, redactText, sanitizePage, summarizePage } from "../src/automation/capture/portal-flow-capture.mjs";

const person = ["Ana Beatriz Souza", "ana.souza@example.test", "+55 61 99999-1234", "70000-000"];
const personalPage = `
  <header>Olá, Ana Beatriz Souza · <a href="https://portal.example.test/perfil?token=abc123">Meu perfil</a><img src="https://cdn.example.test/avatar/ana.png"></header>
  <form action="/candidatar?session=xyz"><input type="hidden" name="csrf" value="tok-123">
    <label for="email">E-mail</label><input id="email" value="ana.souza@example.test" data-testid="email-field" data-user-id="991">
    <label for="cpf">CPF</label><input id="cpf" value="123.456.789-09">
    <label for="bio">Sobre</label><textarea id="bio">Moro em Brasília, telefone +55 61 99999-1234</textarea>
    <p>Currículo: Curriculo_Ana_Souza.pdf · CPF 123.456.789-09 · CEP 70000-000 · linkedin.com/in/ana-souza · contato ana.souza@example.test</p>
    <button type="button" onclick="steal()">Enviar candidatura</button></form>
  <script>window.secret = "segredo-da-pagina";</script>`;

test("sanitização remove dados pessoais, tokens e scripts e mantém a estrutura do formulário", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(personalPage);
    const html = await sanitizePage(page, redactionPatterns(person));
    for (const leaked of ["Ana", "Souza", "ana.souza", "99999", "123.456.789", "70000", "tok-123", "token=abc123", "session=xyz", "avatar", "segredo-da-pagina", "steal()", "991", "Moro em"]) assert.equal(html.includes(leaked), false, leaked);
    for (const kept of ["Enviar candidatura", "E-mail", "CPF", "data-testid=\"email-field\"", "[pessoal]", "[cpf]", "[email]", "/candidatar"]) assert.equal(html.includes(kept), true, kept);
    const summary = await summarizePage(page, redactionPatterns(person));
    assert.ok(summary.buttons.includes("Enviar candidatura"));
    assert.equal(JSON.stringify(summary).includes("Souza"), false);
  } finally { await browser.close(); }
});

test("redação cobre nome sem acento e cada parte do nome", () => {
  const patterns = redactionPatterns(["José Antônio"]);
  assert.equal(redactText("Jose Antonio, José e Antônio", patterns), "[pessoal], [pessoal] e [pessoal]");
});

test("proposta de perfil exige um único botão final e confirmação nova depois dele", () => {
  const step = (buttons, messages = []) => ({ buttons, messages });
  const ok = proposeProfile([step(["Próximo"]), step(["Voltar", "Enviar candidatura"]), step([], ["Candidatura enviada com sucesso!"])], { provider: "catho" });
  assert.deepEqual([ok.ready, ok.confirmationStep, ok.finalButtonCandidates, ok.successTextCandidates, ok.progressionCandidates], [true, 3, ["Enviar candidatura"], ["Candidatura enviada com sucesso!"], ["Próximo"]]);
  assert.equal(new RegExp(ok.suggested.finalButton, "i").test("Enviar candidatura"), true);
  const ambiguous = proposeProfile([step(["Enviar candidatura", "Candidatar-se agora"]), step([], ["Candidatura recebida"])]);
  assert.deepEqual([ambiguous.ready, ambiguous.suggested.finalButton], [false, null]);
  const preexisting = proposeProfile([step(["Enviar candidatura"], ["Candidatura enviada"]), step(["Enviar candidatura"], ["Candidatura enviada"])]);
  assert.deepEqual([preexisting.ready, preexisting.confirmationStep], [false, null]);
});

test("captura observa a pessoa navegar e grava etapas sanitizadas e o manifesto", async () => {
  const browser = await chromium.launch({ headless: true }), outDir = await mkdtemp(path.join(os.tmpdir(), "portal-capture-"));
  try {
    const page = await browser.newPage(), controller = new AbortController();
    await page.setContent(`<h1>Dados pessoais</h1><label for="n">Nome</label><input id="n" value="Ana Beatriz Souza"><button>Próximo</button>`);
    const capture = captureFlow(page, { outDir, provider: "catho", redact: person, pollMs: 40, signal: controller.signal });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
    await settle();
    await page.setContent(`<h1>Revisão</h1><button>Voltar</button><button>Enviar candidatura</button>`);
    await settle();
    await page.setContent(`<h1>Pronto, Ana!</h1><p>Candidatura enviada com sucesso!</p>`);
    await settle();
    controller.abort();
    const { steps, proposal } = await capture;
    assert.equal(steps.length, 3);
    assert.deepEqual([proposal.ready, proposal.finalButtonCandidates, proposal.successTextCandidates], [true, ["Enviar candidatura"], ["Candidatura enviada com sucesso!"]]);
    const files = (await readdir(outDir)).sort();
    assert.deepEqual(files, ["manifest.json", "step-01.html", "step-01.json", "step-02.html", "step-02.json", "step-03.html", "step-03.json"]);
    const everything = (await Promise.all(files.map((file) => readFile(path.join(outDir, file), "utf8")))).join("\n");
    assert.equal(/Ana|Souza/.test(everything), false, "nada pessoal nos arquivos");
    assert.equal(JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8")).observedOnly, true);
  } finally { await browser.close(); await rm(outDir, { recursive: true, force: true }); }
});

test("CLI recusa portal desconhecido e URL fora dos hosts oficiais sem abrir navegador", () => {
  const run = (...args) => spawnSync(process.execPath, ["scripts/capture-portal-flow.mjs", ...args], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 20000 });
  for (const args of [["--provider=linkedin", "--url=https://www.linkedin.com/jobs/1"], ["--provider=catho", "--url=https://catho.com.br.evil.test/vaga"], ["--provider=catho", "--url=http://www.catho.com.br/vaga"]]) {
    const result = run(...args);
    assert.equal(result.status, 2, args.join(" "));
    assert.match(result.stderr, /Uso: npm run capture:portal/);
  }
});
