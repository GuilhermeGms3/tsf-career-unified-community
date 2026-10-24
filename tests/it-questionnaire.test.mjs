import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";
import { VaultFinalRevalidator } from "../src/application/vault-final-revalidator.mjs";
import { CandidateKnowledgeBase } from "../src/application/candidate-knowledge-base.mjs";
import { classifyQuestion, questionFingerprint } from "../src/application/question-semantics.mjs";
import { itAnswerForField, optionForLevel, optionForYears, yearRange } from "../src/application/it-question-answers.mjs";

const yesNo = [{ value: "1", label: "Sim" }, { value: "0", label: "Não" }];
const options = (...labels) => labels.map((label, index) => ({ value: `o${index}`, label }));

test("classifica perguntas de TI por tecnologia e não responde total de anos a pergunta específica", () => {
  const key = (field) => classifyQuestion(field).semanticKey;
  assert.equal(key({ label: "Possui experiência com Linux?", type: "radio-group", options: yesNo }), "PROFESSIONAL.SKILL_HAS.linux");
  assert.equal(key({ label: "Você já trabalhou com Zabbix?", type: "radio-group", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }), "PROFESSIONAL.SKILL_HAS.zabbix");
  assert.equal(key({ label: "Você tem conhecimento em Docker?", type: "radio-group", options: yesNo }), "PROFESSIONAL.SKILL_KNOWS.docker");
  assert.equal(key({ label: "Tenho experiência com Git", type: "checkbox" }), "PROFESSIONAL.SKILL_HAS.git");
  assert.equal(key({ label: "Experiência com AWS", type: "select-one", options: options("Nenhuma", "Menos de 1 ano", "1 a 3 anos") }), "PROFESSIONAL.SKILL_YEARS.aws");
  assert.equal(key({ label: "Quanto tempo de experiência com Kubernetes?", type: "text" }), "PROFESSIONAL.SKILL_YEARS.kubernetes");
  assert.equal(key({ label: "Qual seu nível de inglês?", type: "select-one", options: options("Básico", "Avançado") }), "PROFESSIONAL.ENGLISH_LEVEL");
  assert.equal(key({ label: "Espanhol", type: "radio-group", options: options("Intermediário", "Avançado") }), "PROFESSIONAL.SPANISH_LEVEL");
  assert.equal(key({ label: "Quantos anos de experiência você tem?", type: "number" }), "PROFESSIONAL.YEARS_EXPERIENCE");

  // Antes: "Rust" e "suporte técnico" recebiam o total de anos de carreira; "Java e Python" recebia só Python.
  assert.equal(key({ label: "Quantos anos de experiência com Rust?", type: "number" }), "CUSTOM.QUESTION");
  assert.equal(key({ label: "Anos de experiência em suporte técnico", type: "number" }), "CUSTOM.QUESTION");
  assert.notEqual(key({ label: "Quantos anos de experiência com Java e Python?", type: "number" }), "PROFESSIONAL.SKILL_YEARS.python");
  // Texto livre continua texto livre; Sim/Não sem tecnologia conhecida também não vira fato.
  assert.equal(key({ label: "Possui experiência com Linux?", type: "textarea" }), "PROFESSIONAL.SKILL_EXPERIENCE");
  assert.equal(key({ label: "Possui experiência com Rust?", type: "radio-group", options: yesNo }), "CUSTOM.QUESTION");
  // Mesma pergunta com outra redação no mesmo portal: mesma impressão digital, a resposta reutilizável vale para as duas.
  const fingerprint = (label) => questionFingerprint({ ats: "catho", ...classifyQuestion({ label, type: "radio-group", options: yesNo }), label, type: "radio-group", options: yesNo });
  assert.equal(fingerprint("Possui experiência com Linux?"), fingerprint("Você já trabalhou com Linux?"));
  assert.notEqual(fingerprint("Possui experiência com Linux?"), fingerprint("Possui experiência com Docker?"));
});

test("converte anos, Sim/Não e nível para a opção do formulário sem exagerar", () => {
  const ranges = options("Selecione", "Nenhuma", "Menos de 1 ano", "1 a 3 anos", "3 a 5 anos", "Mais de 5 anos");
  const pick = (years) => optionForYears(ranges, years)?.label;
  assert.deepEqual([0.5, 1, 2.9, 3, 4.2, 5, 5.5].map(pick), ["Menos de 1 ano", "1 a 3 anos", "1 a 3 anos", "3 a 5 anos", "3 a 5 anos", "3 a 5 anos", "Mais de 5 anos"]);
  assert.equal(optionForYears(options("Até 1 ano", "1 ano", "2 anos", "3+ anos"), 2.7).label, "2 anos");
  assert.equal(optionForYears(options("6 meses a 1 ano", "1 - 2 anos.", "5 anos ou mais"), 0.7).label, "6 meses a 1 ano");
  assert.equal(optionForYears(options("Júnior", "Pleno", "Sênior"), 3), null, "senioridade não é faixa de anos");
  assert.deepEqual([yearRange("Mais de 5 anos"), yearRange("+10 anos")].map((range) => range.min), [5, 10]);

  const levels = options("Básico", "Intermediário", "Avançado");
  assert.equal(optionForLevel(levels, 4).label, "Avançado", "fluente vira o maior nível oferecido");
  assert.equal(optionForLevel(levels, 2).label, "Intermediário");
  assert.equal(optionForLevel(options("A1", "A2", "B1", "B2", "C1", "C2"), 3).label, "B2");
  assert.equal(optionForLevel(options("Intermediário", "Avançado", "Fluente"), 1), null, "nunca acima do seu nível");

  const has = { semanticKey: "PROFESSIONAL.SKILL_HAS.linux", type: "radio-group", options: yesNo };
  assert.deepEqual([itAnswerForField(has, true).value, itAnswerForField(has, false).value], ["1", "0"]);
  assert.equal(itAnswerForField({ ...has, options: options("Sim", "Não", "Prefiro não informar") }, true), null);
  assert.equal(itAnswerForField({ semanticKey: "PROFESSIONAL.SKILL_YEARS.java", type: "number" }, 2.6).value, "2", "anos completos");
  assert.equal(itAnswerForField({ semanticKey: "PROFESSIONAL.SKILL_YEARS.java", type: "number" }, 0.4), null, "menos de um ano fica com você");
});

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "it-questionnaire-")), store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  const t = new Date(Date.now() - 60000).toISOString(), url = "https://www.catho.com.br/vagas/analista-de-infraestrutura/321/";
  store.jobs.upsert({ id: "job-it", title: "Analista de Infraestrutura", company: "Acme", description: "Linux, Docker", url, canonicalUrl: url, applicationUrl: url, status: "open", lifecycleStatus: "OPEN", createdAt: t, updatedAt: t });
  store.resumes.upsert({ id: "resume-it", title: "Base", text: "Infra", createdAt: t, updatedAt: t });
  store.applications.create({ id: "application-it", jobId: "job-it", resumeId: "resume-it", status: "READY_TO_SUBMIT", createdAt: t, updatedAt: t }, {}, { allowHistorical: true });
  store.candidateFacts.syncProfile(CandidateKnowledgeBase.fromProfile({ career: { yearsExperience: 6 }, resumeData: { languages: ["Inglês fluente"] } }).all());
  const confirm = (overrides) => store.candidateKnowledge.confirmEvidenceItem({ contextType: "PROFESSIONAL", depth: "PRODUCTION", usageDescription: "Operação", ...overrides });
  confirm({ label: "Linux", startDate: "2021-01-01", endDate: "2024-01-01" });
  confirm({ label: "Docker", depth: "USED", startDate: "2023-01-01", endDate: "2024-07-01" });
  confirm({ label: "Git", contextType: "COURSE", depth: "PRACTICED" });
  confirm({ label: "Kubernetes", contextType: "OTHER", depth: "AWARENESS", negative: true });
  confirm({ label: "Terraform", contextType: "SELF_STUDY", depth: "AWARENESS" });
  return { store, url, close: async () => { store.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("evidências confirmadas viram fatos de candidatura: experiência, conhecimento e nunca usei", async () => {
  const f = await fixture();
  try {
    const facts = new Map(f.store.candidateKnowledge.applicationFacts().map((item) => [item.key, item.value]));
    assert.equal(facts.get("PROFESSIONAL.SKILL_YEARS.linux"), 3);
    assert.deepEqual(["linux", "docker", "git", "kubernetes"].map((skill) => facts.get(`PROFESSIONAL.SKILL_HAS.${skill}`)), [true, true, undefined, false]);
    assert.deepEqual(["linux", "git", "kubernetes"].map((skill) => facts.get(`PROFESSIONAL.SKILL_KNOWS.${skill}`)), [true, true, false]);
    assert.equal([...facts.keys()].some((key) => key.endsWith(".terraform")), false, "só leitura não responde nada");
  } finally { await f.close(); }
});

const questionnaire = (extra = "") => `<main><h1>Questionário da vaga</h1><form>
<fieldset><legend>Possui experiência com Linux? *</legend><label><input type="radio" name="linux" value="1" required> Sim</label><label><input type="radio" name="linux" value="0"> Não</label></fieldset>
<label for="docker">Experiência com Docker *</label><select id="docker" required><option value="">Selecione</option><option value="a">Nenhuma</option><option value="b">Menos de 1 ano</option><option value="c">1 a 3 anos</option><option value="d">Mais de 3 anos</option></select>
<label for="en">Qual seu nível de inglês? *</label><select id="en" required><option value="">Selecione</option><option value="1">Básico</option><option value="2">Intermediário</option><option value="3">Avançado</option></select>
<fieldset><legend>Já trabalhou com Kubernetes? *</legend><label><input type="radio" name="k8s" value="s" required> Sim</label><label><input type="radio" name="k8s" value="n"> Não</label></fieldset>
<label><input type="checkbox" id="git"> Tenho conhecimento em Git</label>
${extra}<button type="button">Enviar candidatura</button></form></main>`;

test("etapa de questionário de TI nos Cofres: preenchida pelas evidências, pergunta sem base fica com você", async () => {
  const f = await fixture(), browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage(), pages = new Map();
    await tab.route("https://www.catho.com.br/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: pages.get(new URL(route.request().url()).pathname) }));
    const registry = new AdapterRegistry(), adapter = registry.get("catho");
    const revalidator = new VaultFinalRevalidator({ provider: "catho", store: f.store, dataDir: os.tmpdir(), registry, browserManager: {} });
    const open = async (body) => { const { pathname } = new URL(f.url); pages.set(pathname, body); await tab.goto(f.url); };

    await open(questionnaire());
    const started = Date.now();
    assert.deepEqual(await revalidator.fillStep("application-it", adapter, tab, {}), { status: "FILLED" });
    assert.ok(Date.now() - started < 10000, "lista com value diferente do texto não espera 30 s");
    const values = await tab.evaluate(() => ({ linux: document.querySelector("[name=linux]:checked")?.value, docker: document.getElementById("docker").value, en: document.getElementById("en").value, k8s: document.querySelector("[name=k8s]:checked")?.value, git: document.getElementById("git").checked }));
    assert.deepEqual(values, { linux: "1", docker: "c", en: "3", k8s: "n", git: true });

    await open(questionnaire(`<label for="total">Quantos anos de experiência você tem? *</label><input type="number" id="total" required>
<label for="rust">Quantos anos de experiência com Rust? *</label><input type="number" id="rust" required>`));
    assert.deepEqual(await revalidator.fillStep("application-it", adapter, tab, {}), { status: "USER_REQUIRED" });
    const saved = new Map(f.store.applicationQuestions.forApplication("application-it").map((question) => [question.label.replace(/\s*\*$/, ""), question]));
    assert.equal(saved.get("Quantos anos de experiência com Rust?").answerStatus, "USER_REQUIRED");
    assert.equal(saved.get("Quantos anos de experiência com Rust?").semanticKey, "CUSTOM.QUESTION");
    assert.deepEqual([saved.get("Quantos anos de experiência você tem?").answerStatus, String(saved.get("Quantos anos de experiência você tem?").answerValue)], ["KNOWN", "6"]);
    assert.equal(saved.get("Possui experiência com Linux?").answerStatus, "KNOWN");
  } finally { await browser.close(); await f.close(); }
});
