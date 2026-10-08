import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const requiredDocs = [
  "docs/discovery-v4-1-1-preflight.md",
  "docs/discovery-v4-1-1.md",
  "docs/matcher-confidence-and-coverage.md",
];
for (const file of requiredDocs) {
  const text = readFileSync(file, "utf8");
  if (text.length < 200)
    throw new Error(`Documento V4.1.1 ausente ou incompleto: ${file}`);
}
const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", "tests/discovery-v4-1-1.test.mjs"],
  { stdio: "inherit", cwd: process.cwd() },
);
if (result.status !== 0) process.exit(result.status || 1);
console.log("Discovery V4.1.1 validation: OK (21 cenários focados)");
