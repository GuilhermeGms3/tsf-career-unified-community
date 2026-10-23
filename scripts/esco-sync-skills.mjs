// Baixa as skills da ESCO pela API publica da Comissao Europeia e grava um extrato compacto PT/EN.
// Uso: node scripts/esco-sync-skills.mjs [--cache=<pasta>] [--version=v1.2.1] [--out=<arquivo>] [--delay-ms=400]
// Fonte: ESCO (European Skills, Competences, Qualifications and Occupations), (c) Uniao Europeia.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const arg = (name, fallback) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = arg("version", "v1.2.1");
const cacheDir = path.resolve(arg("cache", path.join(root, "tmp", "esco", version)));
const out = path.resolve(arg("out", path.join(root, "src", "matching", "esco", "esco-skills.json")));
const delayMs = Number(arg("delay-ms", 400));
const pageSize = 100;
const apiBase = "https://ec.europa.eu/esco/api/search";
const TYPE_CODES = { skill: "S", knowledge: "K" };
const REUSE_CODES = { transversal: "T", "cross-sector": "C", "sector-specific": "R", "occupation-specific": "O" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pageFile = (page) => path.join(cacheDir, `page-${String(page).padStart(4, "0")}.json`);
const label = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "");
const code = (uris, codes) => codes[String(uris?.[0] || "").split("/").pop()] || "";

async function fetchPage(page) {
  // A API usa offset como indice da pagina, nao como posicao do item.
  const url = `${apiBase}?type=skill&language=pt&full=false&limit=${pageSize}&offset=${page}&selectedVersion=${version}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body?._embedded?.results) || !Number.isFinite(body.total)) throw new Error("Resposta sem resultados");
      return body;
    } catch (error) {
      if (attempt >= 4) throw Object.assign(new Error(`Pagina ${page}: ${error.message}`), { code: "ESCO_PAGE_FAILED" });
      await sleep(delayMs * attempt * 3);
    }
  }
}

async function download() {
  await mkdir(cacheDir, { recursive: true });
  let total = null;
  for (let page = 0; total === null || page * pageSize < total; page++) {
    if (existsSync(pageFile(page))) {
      total ??= JSON.parse(await readFile(pageFile(page), "utf8")).total;
      continue;
    }
    const body = await fetchPage(page);
    total = body.total;
    await writeFile(pageFile(page), JSON.stringify(body));
    process.stderr.write(`pagina ${page + 1}/${Math.ceil(total / pageSize)}\n`);
    await sleep(delayMs);
  }
  return total;
}

async function build(total) {
  const byId = new Map();
  for (const name of (await readdir(cacheDir)).filter((file) => /^page-\d{4}\.json$/.test(file)).sort()) {
    for (const item of JSON.parse(await readFile(path.join(cacheDir, name), "utf8"))._embedded.results) {
      const id = String(item?.uri || "").split("/").pop();
      const pt = label(item?.preferredLabel?.pt), en = label(item?.preferredLabel?.en);
      if (!UUID.test(id) || (!pt && !en)) continue;
      byId.set(id, [id, pt, en, code(item.hasSkillType, TYPE_CODES), code(item.hasReuseLevel, REUSE_CODES)]);
    }
  }
  if (byId.size < total * 0.98) throw Object.assign(new Error(`Extrato incompleto: ${byId.size} de ${total} skills.`), { code: "ESCO_INCOMPLETE" });
  const skills = [...byId.values()].sort((left, right) => (left[1] || left[2]).localeCompare(right[1] || right[2], "pt"));
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify({
    source: "ESCO - European Skills, Competences, Qualifications and Occupations (https://esco.ec.europa.eu)",
    attribution: "(c) Uniao Europeia. Extrato dos rotulos preferidos PT/EN gerado por scripts/esco-sync-skills.mjs.",
    version,
    generatedAt: new Date().toISOString(),
    columns: ["id", "pt", "en", "type", "reuse"],
    codes: { type: { S: "skill/competence", K: "knowledge" }, reuse: { T: "transversal", C: "cross-sector", R: "sector-specific", O: "occupation-specific" } },
    count: skills.length,
    skills
  })}\n`);
  return skills.length;
}

try {
  const total = await download();
  const count = await build(total);
  console.log(JSON.stringify({ status: "PASS", version, total, written: count, out: path.relative(root, out) }));
} catch (error) {
  console.error(JSON.stringify({ status: "FAIL", code: error.code || "ESCO_SYNC_FAILED", error: error.message }));
  process.exitCode = 1;
}
