import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";

test("impede dois UnifiedStateStore writers no mesmo SQLite runtime", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-owner-lease-"));
  const first = await new UnifiedStateStore({ dataDir }).initialize();
  try {
    await assert.rejects(
      new UnifiedStateStore({ dataDir }).initialize(),
      (error) => error.code === "SQLITE_RUNTIME_ALREADY_OWNED"
    );
    first.close();
    const next = await new UnifiedStateStore({ dataDir }).initialize();
    next.close();
  } finally {
    first.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("SIGTERM fecha o runtime e remove o lease sem aguardar stale timeout", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-owner-sigterm-"));
  const moduleUrl = new URL("../server/unified-state-store.mjs", import.meta.url).href;
  const source = `import { UnifiedStateStore } from ${JSON.stringify(moduleUrl)}; await new UnifiedStateStore({dataDir:process.argv[1]}).initialize(); console.log("READY"); setTimeout(()=>process.emit("SIGTERM"),1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, dataDir], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("subprocesso nao iniciou")), 10_000);
      child.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("READY")) { clearTimeout(timeout); resolve(); }
      });
      child.once("error", reject);
    });
    const leasePath = path.join(dataDir, "career-hub.sqlite.owner.lock");
    assert.equal(existsSync(leasePath), true);
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(existsSync(leasePath), false);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("lease recente com payload parcial permanece bloqueado de forma conservadora", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-owner-partial-"));
  const leasePath = path.join(dataDir, "career-hub.sqlite.owner.lock");
  try {
    await writeFile(leasePath, "{partial", "utf8");
    await assert.rejects(
      new UnifiedStateStore({ dataDir }).initialize(),
      (error) => error.code === "SQLITE_RUNTIME_ALREADY_OWNED"
    );
    assert.equal(existsSync(leasePath), true);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
