import test from "node:test";
import assert from "node:assert/strict";
import { ResumeTailor } from "../src/intelligence/tasks/resume-tailor.mjs";
import { buildResumeSourceEvidence } from "../src/resume/resume-source-evidence.mjs";
import { taskPrompt } from "../src/intelligence/prompts/task-definitions.mjs";

const offlineService = {
  execute: async () => ({
    result: { changes: [] },
    meta: {
      promptVersion: "resume-tailor-v2",
      schemaVersion: "resume-tailor-schema-v1",
      fallback: true,
    },
  }),
};

const resume = {
  id: "resume-fixture",
  sections: {
    summary:
      "Atuar como Analista de Infraestrutura, Redes, Segurança ou Desenvolvedor Backend.",
    experience:
      "Empresa Farmacêutica Nacional jan/2024 - dez/2025\nService Desk N2\nAdministração de Active Directory e Azure. Automação com PowerShell. Implantação de aplicações e CI/CD.",
    education: "Análise e Desenvolvimento de Software",
    projects:
      "API REST em Python com Docker, Git e integração contínua.",
  },
};

test("resumo offline narra atividades comprovadas sem compilar stacks ou escolaridade", async () => {
  const base = { id: "natural", sections: {
    summary: "Profissional de tecnologia com formação e experiência em TI.",
    experience: [{ bullets: [
      "Suporte a ambientes Microsoft Azure, incluindo provisionamento, monitoramento e manutenção de máquinas virtuais.",
      "Atendimento N1/N2, com diagnóstico, registro e resolução de incidentes em ambiente corporativo.",
    ] }],
    skills: "Inglês B2, Java, Docker e Kubernetes",
    education: "Engenharia de Software em andamento",
  } };
  const result = await new ResumeTailor(offlineService).tailor({
    job: { title: "Analista de Infraestrutura", description: "Azure, máquinas virtuais e atendimento de incidentes" }, resume: base,
  });
  assert.equal(result.evidenceStatus, "VALID");
  const summary = result.tailoredResume.sections.summary;
  assert.match(summary, /provisionamento, monitoramento e manutenção de máquinas virtuais/);
  assert.doesNotMatch(summary, /Profissional de tecnologia|Vivência com|Atuação voltada|Inglês|Kubernetes|Engenharia/);
  assert.doesNotMatch(summary, /inclui .*incluindo/);
  assert.doesNotMatch(summary, /\b(?:Minha|Meus|Tenho|trabalhei|desenvolvi)\b/i);
  assert.equal(result.meta.libraryVersion, "role-texts-v2");
  assert.match(taskPrompt("RESUME_TAILORING", {}), /No resumo, use redação impessoal/);
});

test("resumo mantém atividade de projeto identificada como projeto", async () => {
  const base = { id: "project", sections: {
    summary: "Conhecimentos técnicos em desenvolvimento e infraestrutura.",
    projects: [{ bullets: ["Desenvolvimento de APIs REST com Python e Docker para uma aplicação de estudo."] }],
  } };
  const result = await new ResumeTailor(offlineService).tailor({ job: { title: "Desenvolvedor Python", description: "APIs REST" }, resume: base });
  assert.equal(result.evidenceStatus, "VALID");
  assert.match(result.tailoredResume.sections.summary, /projetos.*APIs REST/i);
  assert.doesNotMatch(result.tailoredResume.sections.summary, /experiência profissional|ambiente corporativo/);
});

test("fallback sem Ollama compara tres perspectivas e reescreve objetivo amplo", async () => {
  const result = await new ResumeTailor(offlineService).tailor({
    job: {
      title: "Desenvolvedor Backend Júnior",
      description: "Python, APIs REST, Docker e CI/CD",
    },
    resume,
    originalScore: 60,
    scoreEvaluator: (candidate) =>
      candidate.sections.summary.includes("desenvolvimento de software")
        ? 68
        : 60,
  });

  assert.equal(result.variantCount, 3);
  assert.equal(result.evidenceStatus, "VALID");
  assert.equal(result.tailoredScore, 68);
  assert.equal(result.changes[0].type, "REWRITE_SUMMARY");
  assert.match(result.changes[0].reason, /3 variações factuais/);
  assert.doesNotMatch(result.tailoredResume.sections.summary, /Empresa Farmacêutica Nacional/);
  assert.doesNotMatch(
    result.tailoredResume.sections.summary,
    /Empresa Farmacêutica Nacional jan\/2024/,
  );
  assert.match(result.tailoredResume.sections.summary, /desenvolvimento de software/);
  assert.doesNotMatch(
    result.tailoredResume.sections.summary,
    /Atuar como|Infraestrutura, Redes, Segurança ou/,
  );
});

test("a mesma experiência produz narrativas diferentes para desenvolvimento e suporte", async () => {
  const tailor = new ResumeTailor(offlineService),
    development = await tailor.tailor({
      job: { title: "Desenvolvedor Backend", description: "Python e Docker" },
      resume,
    }),
    support = await tailor.tailor({
      job: {
        title: "Analista de Suporte N2",
        description: "Active Directory, PowerShell e troubleshooting",
      },
      resume,
    });

  assert.match(development.tailoredResume.sections.summary, /Python|Docker/);
  assert.match(support.tailoredResume.sections.summary, /Active Directory/);
  assert.match(support.tailoredResume.sections.summary, /suporte técnico/);
  assert.notEqual(
    development.tailoredResume.sections.summary,
    support.tailoredResume.sections.summary,
  );
});

test("IDs usados pelo tailoring permanecem iguais aos aceitos pelo ResumeSpec", async () => {
  const result = await new ResumeTailor(offlineService).tailor({
      job: { title: "Analista Cloud", description: "Azure e automação" },
      resume,
    }),
    knownIds = new Set(buildResumeSourceEvidence(resume).map((item) => item.id));

  assert.ok(result.changes[0].sourceEvidenceIds.length > 0);
  assert.ok(
    result.changes[0].sourceEvidenceIds.every((id) => knownIds.has(id)),
  );
});
