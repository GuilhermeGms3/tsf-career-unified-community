import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("P1 Docker keeps the stable Tectonic warm-up layer above changing application source", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  const fixtureCopy = dockerfile.indexOf("COPY docker/tectonic-warm/resume.tex");
  const warm = dockerfile.indexOf("tectonic --untrusted --keep-logs");
  const sourceCopy = dockerfile.indexOf("COPY src ./src");
  const scriptsCopy = dockerfile.indexOf("COPY scripts ./scripts");
  assert.ok(fixtureCopy >= 0 && warm > fixtureCopy);
  assert.ok(sourceCopy > warm && scriptsCopy > warm);
  assert.doesNotMatch(dockerfile.slice(0, sourceCopy), /COPY (?:src|scripts) /);
});
