import test from "node:test";
import assert from "node:assert/strict";
import { escoSkillIndexInfo } from "../src/matching/esco-skills.mjs";
import { findSkillMentions, normalizeSkillName } from "../src/matching/normalization.mjs";
import { extractJobRequirements } from "../src/matching/job-requirement-extractor.mjs";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";
import { guardGeneratedResumeSections } from "../src/matching/resume-content-guard.mjs";

const nursingJob = {
  id: "esco-nursing", title: "Enfermeiro(a) Assistencial", location: "São Paulo, SP", workModel: "presencial",
  description: "Requisitos:\n- COREN ativo e experiência em UTI.\n- Administração de medicamentos e curativos.\n- Primeiros socorros e controle de infecção hospitalar.\nDiferenciais:\n- Pós-graduação em terapia intensiva."
};
const accountingJob = {
  id: "esco-accounting", title: "Técnico de Contabilidade (m/f)", location: "Lisboa", workModel: "híbrido",
  description: "Requisitos:\n- Experiência em contabilidade financeira e processamento salarial.\n- Conhecimentos de fiscalidade (IVA, IRC).\n- Domínio de Excel e SAP."
};
const salesJob = { id: "esco-sales", title: "Vendedor Externo", description: "Requisitos:\n- Prospecção de clientes e fechamento de vendas.\n- Atendimento ao cliente e pós-venda." };
const kitchenJob = { id: "esco-kitchen", title: "Cozinheiro(a)", location: "Porto", description: "Requisitos:\n- Higiene e segurança alimentar (HACCP).\n- Gestão de stocks da cozinha.\n- Confeção de sobremesas." };
const skillNames = (job) => extractJobRequirements(job).filter((item) => item.type === "skill").map((item) => item.normalizedName);

test("extrato ESCO v1.2.1 carrega e todos os termos de mercado apontam para conceitos existentes", () => {
  const info = escoSkillIndexInfo();
  assert.equal(info.enabled, true);
  assert.equal(info.version, "v1.2.1");
  assert.ok(info.aliases > 15000, `aliases=${info.aliases}`);
  assert.deepEqual(info.missingMarketConcepts, []);
});

test("vagas de saúde, contabilidade, vendas e cozinha passam a ter requisitos de skill", () => {
  const nursing = extractJobRequirements(nursingJob).filter((item) => item.type === "skill");
  for (const name of ["medicina-dos-cuidados-intensivos", "administrar-medicamentos-prescritos", "tratar-feridas", "primeiros-socorros", "controlo-das-infecoes"]) {
    assert.ok(nursing.some((item) => item.normalizedName === name), `${name} ausente em ${nursing.map((item) => item.normalizedName)}`);
  }
  assert.ok(nursing.every((item) => item.metadata.escoId), "requisitos ESCO guardam o conceito de origem");
  assert.deepEqual(skillNames(accountingJob).sort(), ["documentacao-e-processamento-de-dados-contabilisticos", "gerir-folhas-de-pagamento", "legislacao-fiscal", "sap-r3", "utilizar-software-de-folha-de-calculo"]);
  assert.deepEqual(skillNames(salesJob).sort(), ["argumentacao-de-vendas", "efetuar-a-prospecao-de-novos-clientes", "servico-ao-cliente"]);
  assert.deepEqual(skillNames(kitchenJob).sort(), ["aplicar-o-sistema-haccp", "gerir-inventario", "normas-de-seguranca-dos-generos-alimenticios", "preparar-sobremesas"]);
});

test("o mesmo conceito tem o mesmo nome em português do Brasil, de Portugal e em inglês", () => {
  const same = (...values) => assert.equal(new Set(values.map((value) => normalizeSkillName(value, value))).size, 1, values.join(" / "));
  same("search engine optimisation", "otimização de motores de busca");
  same("Excel", "planilhas", "folhas de cálculo", "use spreadsheets software");
  same("gestão de estoques", "gestão de stocks", "controlo de stocks", "inventory management");
  same("controle de infecção", "controlo das infeções", "infection control");
  same("planejamento de transporte", "planeamento de transportes");
});

test("vagas de TI não ganham duplicatas nem requisitos genéricos", () => {
  const job = { id: "esco-ti", title: "Analista de Infraestrutura Jr", description: "Requisitos:\n- Experiência com Linux, Docker e Python.\n- Boa comunicação e trabalho em equipe.\n- Less than 2 years of experience is fine.\n- Inglês intermediário." };
  const skillTypes = new Set(["skill", "tool", "framework", "platform", "cloud", "operating_system", "methodology"]);
  const skills = extractJobRequirements(job).filter((item) => skillTypes.has(item.type));
  assert.deepEqual(skills.map((item) => item.normalizedName).sort(), ["docker", "linux", "python"]);
  assert.equal(skills.some((item) => item.metadata.escoId), false);
});

test("matcher ponta a ponta: currículo de enfermagem atende a vaga de enfermagem", () => {
  const nurse = { career: { headline: "Enfermeira", targetRoles: ["Enfermeira"], skills: ["primeiros socorros"], yearsExperience: 4 },
    experience: "Enfermeira na UTI do Hospital Central (2020-2024): administração de medicamentos, curativos e controle de infecção hospitalar." };
  const developer = { career: { headline: "Desenvolvedor", targetRoles: ["Desenvolvedor Backend"], skills: ["Java", "Docker"], yearsExperience: 4 },
    experience: "Desenvolvedor backend com Java, Spring e Docker." };
  const nurseResult = runAtsMatcherV2({ job: nursingJob, profile: nurse, resume: {} });
  const developerResult = runAtsMatcherV2({ job: nursingJob, profile: developer, resume: {} });
  const matchedSkills = (result) => result.items.filter((item) => item.requirement.type === "skill" && item.status === "MATCH").map((item) => item.requirement.normalizedName);
  assert.ok(matchedSkills(nurseResult).length >= 4, `matches=${matchedSkills(nurseResult)}`);
  assert.equal(matchedSkills(developerResult).length, 0);
  assert.ok(nurseResult.dimensions.skills.score >= 80, `skills=${nurseResult.dimensions.skills.score}`);
  // "Enfermeira" atende o cargo "Enfermeiro(a)"; sem evidência alguma o dev fica no neutro (50).
  assert.equal(nurseResult.items.find((item) => item.requirement.type === "role").status, "MATCH");
  assert.ok(nurseResult.overallScore >= 65 && nurseResult.overallScore > developerResult.overallScore, `${nurseResult.overallScore} vs ${developerResult.overallScore}`);
});

test("cargo com flexão de gênero conta como o mesmo cargo", () => {
  const job = { id: "esco-role", title: "Técnica de Contabilidade", description: "Requisitos:\n- Contabilidade geral." };
  const result = runAtsMatcherV2({ job, profile: { career: { targetRoles: ["Técnico de Contabilidade"] } }, resume: {} });
  assert.equal(result.items.find((item) => item.requirement.type === "role").status, "MATCH");
});

test("trava do currículo recusa skill ESCO que o candidato não comprovou", () => {
  const analysis = { candidateEvidence: [{ type: "skill", normalizedName: normalizeSkillName("Excel", "Excel") }], requirements: [] };
  const fallback = { summary: "", skills: ["Excel"], experience: [], education: [], certifications: [], projects: [], languages: [] };
  const guarded = guardGeneratedResumeSections({ generated: { skills: ["Planilhas", "HACCP"] }, fallback, analysis });
  assert.deepEqual(guarded.sections.skills, ["Planilhas"]);
  assert.ok(guarded.rejectedUnsupportedContent.includes("skills"));
});

test("CAREER_ESCO_SKILLS=false volta ao dicionário curado", () => {
  const previous = process.env.CAREER_ESCO_SKILLS;
  process.env.CAREER_ESCO_SKILLS = "false";
  try {
    assert.deepEqual(findSkillMentions(nursingJob.description), []);
    assert.equal(normalizeSkillName("planilhas", "planilhas"), "planilhas");
  } finally {
    if (previous === undefined) delete process.env.CAREER_ESCO_SKILLS;
    else process.env.CAREER_ESCO_SKILLS = previous;
  }
});
