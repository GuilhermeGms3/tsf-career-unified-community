import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function availablePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  probe.close();
  await once(probe, "close");
  return port;
}

async function post(baseUrl, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`${pathname}: ${data.error || response.status}`);
  return data;
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/unified`);
      if (response.ok) return;
    } catch {
      // The isolated child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("O servidor temporario do ATS V2 nao iniciou.");
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-hub-ats-v2-"));
const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const hub = spawn(process.execPath, ["server.mjs"], {
  cwd: projectRoot,
  windowsHide: true,
  env: {
    ...process.env,
    HUB_DATA_DIR: dataDir,
    HUB_HOST: "127.0.0.1",
    HUB_PORT: String(port),
    CAREER_ENGINE_URL: "http://127.0.0.1:9",
    OLLAMA_URL: "http://127.0.0.1:9"
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer(baseUrl);
  await post(baseUrl, "/api/profile", {
    personal: { city: "Brasilia", state: "DF", country: "Brasil" },
    career: {
      headline: "Analista DevOps Junior", targetRoles: "DevOps", yearsExperience: 4,
      skills: "Docker, Linux, AWS", workModels: "remoto, hibrido",
      locationRule: "Somente Brasilia, DF ou remoto", englishLevel: "Avancado",
      availability: "Disponibilidade imediata"
    },
    experience: "Administracao de containers Docker em producao no Linux e AWS.",
    education: "Bacharelado em Sistemas de Informacao.",
    certifications: "AWS Certified Cloud Practitioner.",
    preferences: {}
  });
  const { resume } = await post(baseUrl, "/api/unified/resume", {
    title: "Curriculo de validacao", focus: "DevOps",
    text: "contato@example.com\nEXPERIENCIA\n2022 - 2026 Administracao de containers Docker em producao no Linux e AWS.\nFORMACAO\nBacharelado em Sistemas de Informacao.\nCERTIFICACOES\nAWS Certified Cloud Practitioner.\nIDIOMAS\nIngles avancado."
  });
  const scenarios = [
    { scenario: "compativel", job: { title: "Analista DevOps Junior", company: "Empresa A", description: "Obrigatorio conhecimento em Docker e Linux. AWS sera considerado diferencial.", location: "Brasil", workModel: "Remoto" } },
    { scenario: "parcial", job: { title: "Engenheiro DevOps Senior", company: "Empresa B", description: "Docker obrigatorio. Kubernetes e Terraform sao desejaveis.", location: "Brasil", workModel: "Remoto" } },
    { scenario: "blocker", job: { title: "Analista de Redes", company: "Empresa C", description: "CCNA obrigatorio. Trabalho presencial obrigatorio.", location: "Sao Paulo, SP", workModel: "Presencial" } }
  ];
  const summaries = [];
  for (const scenario of scenarios) {
    const { job } = await post(baseUrl, "/api/unified/job", scenario.job);
    const { analysis } = await post(baseUrl, "/api/unified/ats", { jobId: job.id, resumeId: resume.id });
    summaries.push({
      scenario: scenario.scenario,
      overallScore: analysis.overallScore,
      eligibility: analysis.eligibility,
      blockers: analysis.blockingIssues.length,
      warnings: analysis.warnings.length,
      unknown: analysis.unknownRequirements.length,
      algorithmVersion: analysis.algorithmVersion
    });
  }
  console.log(JSON.stringify(summaries, null, 2));
} finally {
  if (!hub.killed) {
    hub.kill();
    await Promise.race([once(hub, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  await rm(dataDir, { recursive: true, force: true });
}
