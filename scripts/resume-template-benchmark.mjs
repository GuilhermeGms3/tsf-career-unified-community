import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HubDatabase } from "../db/database.mjs";
import { TemplateBenchmarkRepository } from "../repositories/resume-archetype-repository.mjs";
import { LocalLatexCompiler } from "../src/resume/compiler/latex-compiler.mjs";
import { LatexTemplateRenderer } from "../src/resume/templates/latex-template-renderer.mjs";
import { TemplateRegistry } from "../src/resume/templates/template-registry.mjs";
import { evaluateResumeParseability } from "../src/matching/resume-parseability.mjs";

const dataDir = path.resolve(process.env.HUB_DATA_DIR || "data"),
  engine = String(
    process.env.CAREER_ENGINE_URL || "http://career-engine:7130",
  ).replace(/\/$/, "");
const fixture = (language) => ({
  language,
  candidate: {
    fullName: "Candidate Example",
    email: "candidate@example.invalid",
    phone: "+00 000 000 000",
    location: "City, Country",
    headline:
      language === "en"
        ? "Technology Professional"
        : "Profissional de Tecnologia",
    links: [{ label: "GitHub", url: "https://github.com/example" }],
  },
  summary: {
    text:
      language === "en"
        ? "Technology professional with evidence-based operational and software experience."
        : "Profissional de tecnologia com experiência operacional, integração e automação baseada em evidências em São Paulo.",
  },
  experiences: [
    {
      title:
        language === "en" ? "Technology Analyst" : "Analista de Tecnologia",
      company: "Example Labs",
      startDate: "2024",
      endDate: language === "en" ? "Present" : "Atual",
      bullets: [
        {
          text:
            language === "en"
              ? "Maintained Linux systems, networks, and documented automation."
              : "Manteve sistemas Linux, redes e automacoes documentadas.",
        },
      ],
    },
  ],
  projects: [
    {
      name: "Career Demo",
      description:
        language === "en"
          ? "Local-first workflow with REST APIs."
          : "Fluxo local-first com APIs REST.",
      bullets: [],
    },
  ],
  education: [
    {
      institution: "Example Institute",
      degree:
        language === "en" ? "Technology Degree" : "Graduacao em Tecnologia",
      endDate: "2025",
    },
  ],
  certifications: [{ name: "Cloud Fundamentals" }],
  skills: [
    { name: "Linux" },
    { name: "Python" },
    { name: "Docker" },
    { name: "Networking" },
  ],
  languages: [
    { name: language === "en" ? "English" : "Ingles", level: "Professional" },
  ],
});
const extract = async (file) => {
  const response = await fetch(`${engine}/documents/extract`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filename: "resume.pdf",
      data: (await readFile(file)).toString("base64"),
    }),
  });
  if (!response.ok) throw new Error(`Extracao HTTP ${response.status}`);
  return response.json();
};
const database = new HubDatabase(path.join(dataDir, "career-hub.sqlite"));
await database.initialize();
const repository = new TemplateBenchmarkRepository(database.connection),
  renderer = new LatexTemplateRenderer(),
  templates = new TemplateRegistry(),
  compiler = new LocalLatexCompiler();
const results = [];
try {
  const templateIds = [
    ...new Set(templates.list().filter((item) => item.atsOptimized).map((item) => item.id)),
  ];
  for (const id of templateIds) {
    for (const language of ["pt-BR", "en"]) {
      const template = templates.get(id),
        work = await mkdtemp(path.join(tmpdir(), "career-benchmark-")),
        out = path.join(dataDir, "resume-template-benchmarks", id, language);
      await mkdir(out, { recursive: true });
      const tex = path.join(work, "resume.tex");
      await writeFile(
        tex,
        renderer.render(fixture(language), { template }).source,
        "utf8",
      );
      const compiled = await compiler.compile({
        sourcePath: tex,
        outputDir: out,
        workDir: work,
      });
      if (!compiled.ok)
        throw Object.assign(
          new Error(`Falha ${id}/${language}: ${compiled.errorCode}`),
          compiled,
        );
      const extracted = await extract(compiled.pdfPath),
        text = String(extracted.text || ""),
        expected =
          language === "en"
            ? ["Professional Experience", "Technical Skills", "Education"]
            : ["Experiencia Profissional", "Competencias Tecnicas", "Formacao"],
        detected = expected.filter((item) =>
          text
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .toLowerCase()
            .includes(
              item
                .normalize("NFD")
                .replace(/\p{Diacritic}/gu, "")
                .toLowerCase(),
            ),
        ),
        missingFacts = [
          "Candidate Example",
          "Example Labs",
          "Linux",
          "2024",
        ].filter((item) => !text.includes(item)),
        parseability = evaluateResumeParseability({
          text,
          sections: {
            experience: text,
            education: text,
            skills: text,
            projects: text,
            languages: text,
          },
          extraction: { method: "pdf-text" },
        }),
        pdf = await readFile(compiled.pdfPath),
        result = repository.save({
          templateId: id,
          templateVersion: template.version,
          language,
          compiler: "tectonic",
          compilerVersion: compiled.compilerVersion || "",
          parseabilityScore: parseability.score,
          pageCount: Number(extracted.pages || extracted.pageCount || 0),
          missingFacts,
          detectedSections: detected,
          characterChecks: {
            utf8Text: Boolean(text),
            specialCharacters: /[áéíóúãõç]/i.test(text) || language === "en",
          },
          pdfHash: createHash("sha256").update(pdf).digest("hex"),
        });
      results.push({ ...result, pdfPath: compiled.pdfPath });
      await rm(work, { recursive: true, force: true });
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, results }, null, 2) + "\n");
} finally {
  database.close();
}
