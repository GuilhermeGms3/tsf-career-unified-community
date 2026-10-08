import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const definitionPattern = /(--[a-zA-Z0-9_-]+)\s*:/g;
const usagePattern = /var\(\s*(--[a-zA-Z0-9_-]+)/g;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(target)));
    else if ([".css", ".html", ".js"].includes(path.extname(entry.name))) files.push(target);
  }
  return files;
}

export async function auditCssTokens(publicDirectory) {
  const defined = new Set();
  const used = new Set();
  for (const file of await sourceFiles(publicDirectory)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(definitionPattern)) defined.add(match[1]);
    for (const match of source.matchAll(usagePattern)) used.add(match[1]);
  }
  return {
    defined: [...defined].sort(),
    used: [...used].sort(),
    undefined: [...used].filter((token) => !defined.has(token)).sort(),
    unused: [...defined].filter((token) => !used.has(token)).sort(),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const publicDirectory = path.resolve(process.cwd(), "public");
  const result = await auditCssTokens(publicDirectory);
  console.log(`CSS tokens: ${result.defined.length} definidos, ${result.used.length} usados.`);
  console.log(`Não utilizados: ${result.unused.join(", ") || "nenhum"}.`);
  if (result.undefined.length) {
    console.error(`Indefinidos: ${result.undefined.join(", ")}.`);
    process.exitCode = 1;
  } else {
    console.log("Indefinidos: nenhum.");
  }
}
