import assert from "node:assert/strict";
import test from "node:test";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";
import { extractCandidateEvidence } from "../src/matching/candidate-evidence-extractor.mjs";
import { extractJobRequirements } from "../src/matching/job-requirement-extractor.mjs";
import { findSkillMentions } from "../src/matching/normalization.mjs";
import { guardGeneratedResumeSections } from "../src/matching/resume-content-guard.mjs";
import { matchRequirements } from "../src/matching/matching-engine.mjs";

const baseProfile = {
  personal: { city: "Brasilia", state: "DF", country: "Brasil" },
  career: {
    headline: "Analista DevOps Junior",
    targetRoles: "DevOps\nAnalista de Infraestrutura",
    yearsExperience: 4,
    skills: "Docker, Linux, Amazon Web Services",
    workModels: "remoto, hibrido",
    locationRule: "Somente Brasilia, DF ou remoto",
    englishLevel: "Avancado",
    availability: "Disponibilidade imediata"
  },
  experience: "Administracao de containers Docker em producao, Linux e AWS para monitoramento de aplicacoes.",
  education: "Bacharelado em Sistemas de Informacao.",
  certifications: "AWS Certified Cloud Practitioner."
};

const baseResume = {
  id: "resume-test",
  text: "contato@example.com https://linkedin.com/in/teste\nEXPERIENCIA\n2022 - 2026 Administracao de containers Docker em producao no Linux e AWS.\nFORMACAO\nBacharelado em Sistemas de Informacao.\nCERTIFICACOES\nAWS Certified Cloud Practitioner.\nIDIOMAS\nIngles avancado.",
  sections: {
    experience: "2022 - 2026 Administracao de containers Docker em producao no Linux e AWS.",
    education: "Bacharelado em Sistemas de Informacao.",
    certifications: "AWS Certified Cloud Practitioner.",
    languages: "Ingles avancado.",
    skills: ["Docker", "Linux", "AWS"]
  },
  extraction: { method: "pdf-text" }
};

function job(description, overrides = {}) {
  return { id: overrides.id || "job-test", title: "Analista DevOps Junior", company: "Empresa", description, location: "Brasil", workModel: "Remoto", ...overrides };
}

function analyze(description, options = {}) {
  return runAtsMatcherV2({ job: job(description, options.job), profile: options.profile || baseProfile, resume: options.resume || baseResume });
}

function itemFor(analysis, normalizedName, type) {
  return analysis.items.find((item) => item.requirement.normalizedName === normalizedName && (!type || item.requirement.type === type));
}

test("matches a required skill with professional evidence", () => {
  const analysis = analyze("Obrigatorio conhecimento em Docker e Linux.");
  assert.equal(itemFor(analysis, "docker").status, "MATCH");
  assert.equal(itemFor(analysis, "docker").evidence[0].strength, "PROFESSIONAL_EXPERIENCE");
});

test("marks an unsupported required skill as UNKNOWN without inventing evidence", () => {
  const analysis = analyze("Kubernetes e obrigatorio para a funcao.");
  const item = itemFor(analysis, "kubernetes");
  assert.equal(item.status, "UNKNOWN");
  assert.deepEqual(item.evidence, []);
  assert.ok(!analysis.candidateEvidence.some((evidence) => evidence.normalizedName === "kubernetes"));
});

test("treats an unproven preferred skill as unknown, not a blocker", () => {
  const analysis = analyze("Docker obrigatorio. Terraform sera considerado diferencial.");
  assert.equal(itemFor(analysis, "terraform").status, "UNKNOWN");
  assert.equal(analysis.blockingIssues.length, 0);
  assert.ok(analysis.unknownRequirements.some((item) => item.requirement.includes("Terraform") || item.requirement.includes("terraform")));
});

test("uses UNKNOWN when work authorization was not declared", () => {
  const analysis = analyze("Work authorization in Brazil is required.");
  assert.equal(itemFor(analysis, "work-authorization").status, "UNKNOWN");
  assert.equal(analysis.eligibility, "REVIEW_REQUIRED");
});

test("creates a blocker from an explicit negative work authorization declaration", () => {
  const profile = structuredClone(baseProfile);
  profile.experience += " Not authorized to work in Brazil.";
  const analysis = analyze("Work authorization in Brazil is required.", { profile });
  assert.equal(itemFor(analysis, "work-authorization").status, "NO_MATCH");
  assert.equal(analysis.eligibility, "NOT_ELIGIBLE");
  assert.equal(analysis.blockingIssues[0].blocking, true);
});

test("normalizes Amazon Web Services and AWS to the same skill", () => {
  const analysis = analyze("3+ years of experience with AWS required. Terraform is preferred.");
  assert.equal(itemFor(analysis, "aws").status, "MATCH");
  assert.ok(extractCandidateEvidence(baseProfile, baseResume).some((item) => item.normalizedName === "aws"));
});

test("IaC and Infrastructure as Code resolve the same evidence without fabrication", () => {
  const requirements = extractJobRequirements({
    id: "iac-job",
    title: "Junior DevOps Engineer",
    description: "Requirements:\nExperience with Infrastructure as Code."
  });
  const evidence = extractCandidateEvidence({}, {
    sections: { experience: ["Automatizei infraestrutura usando IaC em projeto profissional."] }
  });
  const iac = requirements.find((item) => item.normalizedName === "infrastructure-as-code");
  assert.ok(iac);
  const matched = matchRequirements(requirements, evidence).find((item) => item.requirementId === iac.id);
  assert.equal(matched.status, "MATCH");
  const absent = matchRequirements(requirements, extractCandidateEvidence({}, { text: "Linux e redes" }))
    .find((item) => item.requirementId === iac.id);
  assert.equal(absent.status, "UNKNOWN");
});

test("does not normalize ambiguous AD without Active Directory context", () => {
  assert.ok(!findSkillMentions("Created an ad hoc campaign report.").some((item) => item.name === "active-directory"));
  assert.ok(findSkillMentions("Managed AD domain users in Windows.").some((item) => item.name === "active-directory"));
});

test("gives weaker evidence to an isolated skill mention", () => {
  const profile = structuredClone(baseProfile);
  profile.experience = "";
  const resume = { ...baseResume, text: "Skills: Docker", sections: { skills: ["Docker"] } };
  const analysis = analyze("Docker obrigatorio.", { profile, resume });
  assert.equal(itemFor(analysis, "docker").status, "PARTIAL_MATCH");
});

test("recognizes professional experience as stronger than a mention", () => {
  const analysis = analyze("Experiencia com Docker obrigatoria.");
  const docker = itemFor(analysis, "docker");
  assert.equal(docker.status, "MATCH");
  assert.ok(docker.score >= 0.9);
});

test("matches a specific professional experience from contextual evidence", () => {
  const analysis = analyze("Experiencia obrigatoria com administracao de containers Docker em producao.");
  const specific = analysis.items.find((item) => item.requirement.type === "specific_experience");
  assert.equal(specific.status, "MATCH");
  assert.equal(specific.evidence[0].strength, "PROFESSIONAL_EXPERIENCE");
});

test("compares minimum years in English", () => {
  const matching = analyze("3+ years of experience with AWS required.");
  assert.equal(matching.items.find((item) => item.requirement.type === "experience_years").status, "MATCH");
  const profile = structuredClone(baseProfile);
  profile.career.yearsExperience = 2;
  const blocked = analyze("3+ years of experience required.", { profile });
  assert.equal(blocked.items.find((item) => item.requirement.type === "experience_years").status, "NO_MATCH");
  assert.equal(blocked.eligibility, "NOT_ELIGIBLE");
});

test("evaluates seniority independently", () => {
  const analysis = analyze("Experiencia em operacoes.", { job: { title: "Engenheiro DevOps Senior" } });
  assert.equal(analysis.items.find((item) => item.requirement.type === "seniority").status, "NO_MATCH");
  assert.ok(analysis.seniorityScore < 50);
});

test("matches an education requirement", () => {
  const analysis = analyze("Graduacao em tecnologia obrigatoria.");
  assert.equal(analysis.items.find((item) => item.requirement.type === "education").status, "MATCH");
});

test("matches a certification and requests review when a required certification is unproven", () => {
  assert.equal(itemFor(analyze("AWS Certified e obrigatoria."), "aws-certified").status, "MATCH");
  const missing = analyze("CCNA obrigatorio.");
  assert.equal(itemFor(missing, "ccna").status, "UNKNOWN");
  assert.equal(missing.eligibility, "REVIEW_REQUIRED");
});

test("compares required language level", () => {
  assert.equal(itemFor(analyze("Ingles avancado obrigatorio."), "english").status, "MATCH");
  const profile = structuredClone(baseProfile);
  profile.career.englishLevel = "Basico";
  const resume = { ...baseResume, text: baseResume.text.replace(/Ingles avancado/gi, "Ingles basico"), sections: { ...baseResume.sections, languages: "Ingles basico" } };
  assert.equal(itemFor(analyze("Fluent English required.", { profile, resume }), "english").status, "NO_MATCH");
});

test("matches compatible location", () => {
  const analysis = analyze("Docker obrigatorio.", { job: { location: "Brasilia, DF", workModel: "Hibrido" } });
  assert.equal(analysis.items.find((item) => item.requirement.type === "location").status, "MATCH");
});

test("matches declared remote preference", () => {
  const analysis = analyze("This is a remote role.", { job: { location: "Brasil", workModel: "Remoto" } });
  assert.equal(itemFor(analysis, "remote", "work_model").status, "MATCH");
});

test("blocks an incompatible mandatory onsite location", () => {
  const analysis = analyze("Trabalho presencial obrigatorio.", { job: { location: "Sao Paulo, SP", workModel: "Presencial" } });
  assert.equal(analysis.eligibility, "NOT_ELIGIBLE");
  assert.ok(analysis.blockingIssues.some((issue) => /localizacao|modalidade/i.test(issue.reason)));
});

test("marks absent dimensions as NOT_APPLICABLE instead of inventing 100 percent", () => {
  const analysis = analyze("Docker obrigatorio.");
  assert.equal(analysis.educationScore, null);
  assert.equal(analysis.certificationsScore, null);
  assert.equal(analysis.dimensions.education.status, "NOT_APPLICABLE");
});

test("never divides by zero when the description has no recognized qualification", () => {
  const analysis = analyze("Venha fazer parte do nosso time.", { profile: {}, resume: { id: "empty", text: "", sections: {} } });
  assert.ok(Number.isFinite(analysis.overallScore));
  assert.ok(analysis.overallScore >= 0 && analysis.overallScore <= 100);
});

test("returns requirement-level explanation and source evidence", () => {
  const docker = itemFor(analyze("Docker obrigatorio."), "docker");
  assert.ok(docker.explanation.length > 10);
  assert.equal(docker.evidence[0].source, "profile");
  assert.ok(docker.evidence[0].text.toLowerCase().includes("docker"));
});

test("extracts required and preferred requirements in Portuguese", () => {
  const requirements = extractJobRequirements(job("Obrigatorio conhecimento em Docker e Linux.\nDiferenciais:\nKubernetes sera considerado diferencial."));
  assert.equal(requirements.find((item) => item.normalizedName === "docker").required, true);
  assert.equal(requirements.find((item) => item.normalizedName === "kubernetes").importance, "preferred");
});

test("records algorithm version and separate resume parseability", () => {
  const analysis = analyze("Docker obrigatorio.");
  assert.equal(analysis.algorithmVersion, "ats-matcher-v2");
  assert.equal(analysis.resumeAtsScore, analysis.resumeParseability.score);
  assert.match(analysis.resumeParseability.disclaimer, /generica/i);
});

test("resume guard rejects a job skill absent from candidate evidence", () => {
  const analysis = analyze("Docker obrigatorio. Kubernetes desejavel.");
  const fallback = { summary: "Profissional com Docker.", skills: ["Docker"], experience: "Administracao de Docker.", education: "Bacharelado.", certifications: ["AWS Certified"], projects: "", languages: ["Ingles avancado"] };
  const guarded = guardGeneratedResumeSections({
    generated: { ...fallback, summary: "Especialista em Kubernetes.", skills: ["Docker", "Kubernetes"], experience: "Liderou Kubernetes em producao." },
    fallback,
    analysis
  });
  assert.equal(guarded.sections.summary, fallback.summary);
  assert.deepEqual(guarded.sections.skills, ["Docker"]);
  assert.equal(guarded.sections.experience, fallback.experience);
  assert.ok(!JSON.stringify(guarded.sections).toLowerCase().includes("kubernetes"));
});
