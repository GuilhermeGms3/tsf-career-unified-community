import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { ResumeSpecNormalizer } from "../src/resume/resume-spec-normalizer.mjs";
import { ResumeSpecBuilder } from "../src/resume/resume-spec-builder.mjs";
import { ResumeArchetypeSelector } from "../src/resume/archetypes/resume-archetype-selector.mjs";
import { TemplateRegistry } from "../src/resume/templates/template-registry.mjs";
import { TemplatePolicy } from "../src/resume/templates/template-policy.mjs";
import { LatexTemplateRenderer } from "../src/resume/templates/latex-template-renderer.mjs";
import { recommendTemplates } from "../src/product/experience-service.mjs";

test("migration 008 cria archetypes sem remover templates historicos", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "career-archetype-")),
    store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  try {
    assert.deepEqual(
      store.resumeArchetypes.list().map((x) => x.id),
      ["INFRA_NOC", "CLOUD_DEVOPS", "CYBER_SOC", "BACKEND_PYTHON", "GENERAL"],
    );
    assert.ok(new TemplateRegistry().get("ATS_CLEAN", "ats-clean-v1"));
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizador separa blocos e marca ambiguidade para revisao", () => {
  const result = new ResumeSpecNormalizer().normalize({
    profile: {
      experience:
        "Support Analyst - Example Labs (2024 - Present)\n- Linux troubleshooting",
      education: "Technology Degree\nExample Institute",
      certifications: "Cloud Fundamentals\nSecurity Fundamentals",
      career: { skills: "Linux, Python" },
    },
    resume: {},
  });
  assert.equal(result.resume.sections.experience.length, 1);
  assert.equal(result.resume.sections.education.length, 2);
  assert.equal(result.resume.sections.certifications.length, 2);
  assert.ok(result.requiresReview);
  assert.ok(!JSON.stringify(result.resume).includes("---"));
});

test("normalizador substitui resumo importado com palavras coladas por fonte confirmada", () => {
  const confirmed =
      "Profissional de tecnologia com experiência em suporte técnico corporativo.",
    result = new ResumeSpecNormalizer().normalize({
      profile: { career: { summary: confirmed } },
      resume: {
        sections: {
          summary:
            "ProfissionaldeTIcomformaçãosuperioremAnáliseeDesenvolvimentodeSoftware.",
        },
      },
    });
  assert.equal(result.resume.sections.summary, confirmed);
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === "COLLAPSED_WORD_SPACING",
    ),
  );
  assert.equal(result.requiresReview, true);
});

test("currículo selecionado prevalece sobre resumeData global na versão final", () => {
  const resume = {
      id: "resume-base-selected",
      focus: "Suporte técnico e Service Desk",
      sections: {
        summary: "Resumo da base escolhida.",
        experience: "Empresa Base jan/2024 — dez/2025\nAnalista de Suporte\n* Atendi incidentes técnicos.\nPROJETOS TÉCNICOS\nMonitor de rede Infraestrutura / Observabilidade\n* Monitorei disponibilidade.",
        education: "Universidade Exemplo Conclusão: Jun/2028\nEngenharia de Software\nInstituto Base 2023 — 2025\nAnálise e Desenvolvimento de Sistemas\nCOMPETÊNCIAS TÉCNICAS\nSuporte: Windows, Active Directory.\nIdiomas: Inglês B2",
      },
      extraction: { contact: { location: { value: "Brasília, DF" } } },
    },
    profile = {
      personal: { city: "Brasília, DF", state: "DF", country: "Brazil" },
      career: { headline: "Headline legada" },
      resumeData: {
        experience: [{ title: "Emprego legado", company: "Outra empresa", bullets: ["SLA inventado"] }],
        education: [{ institution: "Outra faculdade" }],
        certifications: ["Certificação legada"],
      },
    },
    spec = new ResumeSpecBuilder().build({ resume, profile });
  assert.equal(spec.candidate.headline, "Suporte técnico e Service Desk");
  assert.equal(spec.candidate.location, "Brasília, DF");
  assert.match(JSON.stringify(spec), /Empresa Base/);
  assert.match(JSON.stringify(spec), /Monitor de rede/);
  assert.match(JSON.stringify(spec), /Active Directory/);
  assert.match(JSON.stringify(spec), /Inglês B2/);
  assert.doesNotMatch(JSON.stringify(spec), /Emprego legado|Outra empresa|SLA inventado|Headline legada|Certificação legada/);
  assert.equal(spec.education[0].startDate, "");
  assert.equal(spec.education[0].endDate, "Jun/2028");
  assert.deepEqual(spec.certifications, []);
});

test("selector escolhe Cloud DevOps apenas com evidencia e explica cobertura", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "career-selector-")),
    store = await new UnifiedStateStore({ dataDir: dir }).initialize();
  try {
    const result = new ResumeArchetypeSelector().select({
      job: {
        title: "Cloud DevOps Engineer",
        description: "AWS Docker Linux CI/CD",
      },
      requirements: [{ normalizedName: "AWS", required: true }],
      evidence: [
        { id: "e1", normalizedName: "AWS", text: "AWS project" },
        { id: "e2", normalizedName: "Docker", text: "Docker project" },
      ],
      archetypes: store.resumeArchetypes.list(),
    });
    assert.equal(result.archetypeId, "CLOUD_DEVOPS");
    assert.ok(result.reasons.some((x) => x.includes("Hard requirements")));
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("default novo preserva BASE 01 e ATS_TECH continua disponivel", () => {
  const policy = new TemplatePolicy(),
    registry = new TemplateRegistry(),
    renderer = new LatexTemplateRenderer(),
    spec = {
      language: "en",
      candidate: { fullName: "Candidate Example" },
      summary: { text: "Summary" },
      experiences: [
        {
          title: "Analyst",
          company: "Example",
          bullets: [{ text: "Worked with systems" }],
        },
      ],
      skills: [{ name: "Linux" }],
      education: [{ institution: "Institute" }],
    };
  assert.equal(
    policy.select({ purpose: "APPLICATION" }).templateId,
    "BASE_01",
  );
  const source = renderer.render(spec, {
    template: registry.get("ATS_TECH"),
  }).source;
  assert.ok(
    source.indexOf("Technical Skills") <
      source.indexOf("Professional Experience"),
  );
  assert.ok(!/includegraphics|multicol|fontawesome/i.test(source));
  assert.match(source, /\\titlespacing\*\{\\section\}\{0pt\}\{8pt\}\{4pt\}/);
});

test("BASE 01 reproduz a estrutura aprovada e preserva links clicaveis", () => {
  const registry = new TemplateRegistry(),
    renderer = new LatexTemplateRenderer(),
    spec = {
      language: "pt-BR",
      candidate: {
        fullName: "Alex Silva",
        headline: "Suporte tecnico N1/N2 | Service Desk | Infraestrutura",
        email: "alex.silva@example.test",
        phone: "+351 910 000 000",
        location: "Lisboa, Portugal",
        links: [
          { label: "LinkedIn", url: "https://www.linkedin.com/in/teste" },
          { label: "GitHub", url: "https://github.com/teste" },
        ],
      },
      summary: { text: "Profissional de tecnologia" },
      experiences: [{ title: "Suporte de TI", company: "Empresa Exemplo", startDate: "jan/2024", endDate: "dez/2025", bullets: [{ text: "Atendimento tecnico N1/N2." }] }],
      projects: [{ name: "Servidor de Infraestrutura", bullets: [{ text: "Monitoramento com Zabbix." }] }],
      education: [{ institution: "Universidade Exemplo", degree: "Engenharia de Software", endDate: "Jun/2028" }],
      skills: [{ name: "Windows" }, { name: "TCP/IP" }, { name: "Grafana" }, { name: "Python" }],
      languages: [{ name: "Ingles B2" }],
    },
    source = renderer.render(spec, { template: registry.get("BASE_01") }).source;
  assert.ok(source.indexOf("RESUMO PROFISSIONAL") < source.indexOf("EXPERIÊNCIA PROFISSIONAL"));
  assert.ok(source.indexOf("EXPERIÊNCIA PROFISSIONAL") < source.indexOf("PROJETOS TÉCNICOS"));
  assert.ok(source.indexOf("PROJETOS TÉCNICOS") < source.indexOf("FORMAÇÃO ACADÊMICA"));
  assert.match(source, /\\href\{https:\/\/github\.com\/teste\}\{GitHub\}/);
  assert.match(source, /\\href\{https:\/\/www\.linkedin\.com\/in\/teste\}\{LinkedIn\}/);
  assert.match(source, /\\href\{mailto:alex\.silva@example\.test\}/);
  assert.match(source, /Suporte e infraestrutura/);
  assert.match(source, /Redes e conectividade/);
  assert.match(source, /Monitoramento e observabilidade/);
  assert.match(source, /Automacao e ferramentas/);
});

test("modelos Overleaf usam o mesmo ResumeSpec sem placeholders externos", () => {
  const registry = new TemplateRegistry(), renderer = new LatexTemplateRenderer(), spec = {
    language: "pt-BR",
    candidate: { fullName: "Alex Silva", email: "alex@example.test", links: [{ label: "GitHub", url: "https://github.com/teste" }] },
    summary: { text: "Resumo comprovado" },
    experiences: [{ title: "Analista", company: "Empresa Real", bullets: [{ text: "Atividade comprovada" }] }],
    projects: [{ name: "Projeto Real", bullets: [] }],
    education: [{ institution: "Instituicao Real" }],
    skills: [{ name: "Linux" }],
  };
  for (const id of ["OVERLEAF_BLUE", "OVERLEAF_CLASSIC"]) {
    const source = renderer.render(spec, { template: registry.get(id) }).source;
    assert.match(source, /Alex Silva/i);
    assert.match(source, /Empresa Real/);
    assert.match(source, /Projeto Real/);
    assert.match(source, /\\href\{https:\/\/github\.com\/teste\}\{GitHub\}/);
    assert.doesNotMatch(source, /Prashant|xxxx|RCOEM|AICTE/);
  }
});

test("novos templates ATS sao preenchiveis e preservam ordem linear por objetivo", () => {
  const registry = new TemplateRegistry(),
    renderer = new LatexTemplateRenderer(),
    spec = {
      language: "pt-BR",
      candidate: { fullName: "Pessoa Teste", email: "pessoa@example.test" },
      summary: { text: "Profissional de tecnologia" },
      experiences: [{ title: "Analista", company: "Empresa", bullets: [{ text: "Documentou incidentes" }] }],
      projects: [{ name: "Projeto Cloud", description: "Automacao local", bullets: [] }],
      education: [{ institution: "Instituto", degree: "Tecnologia" }],
      certifications: [{ name: "Cloud Fundamentals" }],
      skills: [{ name: "Linux" }, { name: "Docker" }],
      languages: [{ name: "Ingles", level: "Intermediario" }],
    },
    early = renderer.render(spec, { template: registry.get("ATS_EARLY_CAREER") }).source,
    impact = renderer.render(spec, { template: registry.get("ATS_IMPACT") }).source;
  for (const id of ["ATS_BALANCED", "ATS_EARLY_CAREER", "ATS_IMPACT"])
    assert.equal(registry.get(id).atsOptimized, true);
  assert.ok(early.indexOf("Projetos") < early.indexOf("Experiencia Profissional"));
  assert.ok(impact.indexOf("Experiencia Profissional") < impact.indexOf("Competencias Tecnicas"));
  assert.ok(!/includegraphics|multicol|fontawesome|tikz/i.test(`${early}${impact}`));
});

test("recomendacao mantem BASE 01 como padrao e oferece os demais modelos", () => {
  const templates = new TemplateRegistry().list();
  for (const job of [
    { title: "Analista de Suporte Junior", description: "Linux e Docker" },
    { title: "Tech Lead", description: "Lideranca de plataforma cloud" },
    { title: "Analista de Operacoes", description: "Rotinas e documentacao" },
  ]) {
    const recommendation = recommendTemplates(job, [], templates);
    assert.equal(recommendation.recommendedTemplateId, "BASE_01");
    assert.ok(recommendation.candidates.some((item) => item.id === "OVERLEAF_BLUE"));
    assert.ok(recommendation.candidates.some((item) => item.id === "OVERLEAF_CLASSIC"));
  }
});
