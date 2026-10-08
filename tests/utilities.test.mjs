import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { escapeHtml, safeExternalUrl } from "../public/sanitize.js";
import { attachProcessTimeout } from "../server/external-operations.mjs";
import { atomicWriteJson } from "../server/json-storage.mjs";

test("atomicWriteJson writes formatted JSON and removes temporary files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "atomic-json-test-"));
  const file = path.join(directory, "state.json");
  try {
    await atomicWriteJson(file, { ok: true, nested: { value: 1 } });
    assert.equal(await readFile(file, "utf8"), '{\n  "ok": true,\n  "nested": {\n    "value": 1\n  }\n}\n');
    await atomicWriteJson(file, { ok: true, version: 2 });
    assert.equal(JSON.parse(await readFile(file, "utf8")).version, 2);
    assert.deepEqual(await readdir(directory), ["state.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("frontend sanitization escapes external content and blocks unsafe URLs", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(safeExternalUrl("javascript:alert(1)"), "");
  assert.equal(safeExternalUrl("https://example.com/vaga?q=1&x=2"), "https://example.com/vaga?q=1&amp;x=2");
});

test("external process timeout terminates the running process", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32",
    stdio: "ignore",
    windowsHide: true
  });
  let timedOut = false;
  attachProcessTimeout(child, 50, () => { timedOut = true; });
  await Promise.race([
    once(child, "exit"),
    new Promise((_, reject) => setTimeout(() => reject(new Error("process was not terminated")), 5000))
  ]);
  assert.equal(timedOut, true);
});
