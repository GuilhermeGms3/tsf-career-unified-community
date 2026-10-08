import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { LatexTemplateRenderer } from "../src/resume/templates/latex-template-renderer.mjs";
import { TemplateRegistry } from "../src/resume/templates/template-registry.mjs";

const fixture = (language) => ({
  language,
  candidate: {
    fullName: "Candidate Example",
    email: "candidate@example.invalid",
    location: "City, Country",
    headline: "Technology Professional",
  },
  summary: {
    text: "Professional with verified experience in technology operations.",
  },
  experiences: [
    {
      title: "Technology Analyst",
      company: "Example Labs",
      startDate: "2024",
      endDate: "Present",
      bullets: [
        { text: "Maintained documented systems and operational procedures." },
      ],
    },
  ],
  education: [
    { institution: "Example Institute", degree: "Technology Degree" },
  ],
  skills: [{ name: "Linux" }, { name: "Networking" }],
  languages: [
    { name: language === "en" ? "English" : "Ingles", level: "Professional" },
  ],
});
const run = (args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn("tectonic", args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, TECTONIC_UNTRUSTED_MODE: "1" },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Tectonic encerrou com codigo ${code}`)),
    );
  });
const root = await mkdtemp(path.join(tmpdir(), "career-tectonic-warm-"));
try {
  const renderer = new LatexTemplateRenderer(),
    registry = new TemplateRegistry(),
    templateIds = [
      ...new Set(
        registry
          .list()
          .filter((item) => item.atsOptimized)
          .map((item) => item.id),
      ),
    ];
  for (const id of templateIds) {
    for (const language of ["pt-BR", "en"]) {
      const dir = path.join(root, `${id}-${language}`);
      await import("node:fs/promises").then((fs) =>
        fs.mkdir(dir, { recursive: true }),
      );
      const source = renderer.render(fixture(language), {
          template: registry.get(id),
        }).source,
        file = path.join(dir, "resume.tex");
      await writeFile(file, source, "utf8");
      await run(["--untrusted", "--keep-logs", "--outdir", dir, file], dir);
      await run(["--untrusted", "--only-cached", "--outdir", dir, file], dir);
    }
  }
  process.stdout.write(
    JSON.stringify({
      status: "READY",
      compiler: "tectonic",
      templates: templateIds.length,
      languages: 2,
    }) + "\n",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
