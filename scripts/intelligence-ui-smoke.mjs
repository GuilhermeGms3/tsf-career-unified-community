import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "career-intelligence-ui-"));
const artifactsDir = path.join(root, "artifacts");
const port = 17999;
await mkdir(artifactsDir, { recursive: true });

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  windowsHide: true,
  env: {
    ...process.env,
    HUB_HOST: "127.0.0.1",
    HUB_PORT: String(port),
    HUB_DATA_DIR: dataDir,
    LEGACY_ROOT: dataDir,
    OLLAMA_URL: "http://127.0.0.1:9",
    AUTOMATION_HEADLESS: "true"
  },
  stdio: "ignore"
});

let browser;
try {
  let status;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/intelligence/status`);
      if (response.ok) {
        status = await response.json();
        break;
      }
    } catch {
      // O processo ainda esta iniciando.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!status) throw new Error("Servidor de smoke test nao iniciou.");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
  await page.click('[data-view-target="settings"]');
  await page.waitForSelector("#settings-form", { state: "visible" });
  const screenshot = path.join(artifactsDir, "intelligence-settings.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({
    ok: true,
    screenshot,
    status: status.status,
    fallbackDeterministic: status.fallbackDeterministic,
    hardwareProfile: status.hardware?.memoryProfile,
    diagnostics: await page.locator("#intelligence-diagnostics").innerText(),
    consoleErrors
  }, null, 2));
} finally {
  await browser?.close();
  if (!server.killed) {
    server.kill();
    await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  await rm(dataDir, { recursive: true, force: true });
}
