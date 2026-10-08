import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("roteamento preserva tela atual e descarta navegação obsoleta", async () => {
  const code = await source("../public/app/bootstrap.js");
  assert.doesNotMatch(code, /root\.innerHTML\s*=\s*loading\(\);/);
  assert.match(code, /generation\s*!==\s*navigationGeneration/);
  assert.match(code, /root\.cloneNode\(false\)/);
  assert.match(code, /root\.replaceWith\(staging\)/);
  assert.match(code, /!state\.background\s*\|\|\s*state\.refreshing/);
});

test("Opportunities carrega dados conforme seção", async () => {
  const code = await source("../public/features/opportunities/page.js");
  assert.match(code, /needsCapabilities\s*=\s*section === "discover"/);
  assert.match(code, /needsDiagnostics\s*=\s*section === "diagnostics"/);
  assert.doesNotMatch(code, /timeoutMs:\s*15000/);
});

test("Settings Security não agenda probes de runtime", async () => {
  const code = (await source("../public/features/settings/page.js")).replace(/\s+/g, "");
  assert.match(code, /data:\(\)=>\(\{\}\),security:\(\)=>\(\{\}\)/);
  assert.match(code, /diagnostics:\(\)=>\(\{status:api\("\/api\/intelligence\/status"\),engine:api\("\/api\/engine\/status"\),runtime:api\("\/api\/runtime-diagnostics"/);
  assert.match(code, /dependencyLoaders\[section\]\?\.\(\)/);
});

test("Today usa snapshot local e atualizações explícitas ficam nas superfícies canônicas", async () => {
  const service = await source("../src/discovery/source-center/source-connection-service.mjs"),
    connections = await source("../public/features/connections/page.js"),
    autopilot = await source("../public/features/autopilot/page.js");
  assert.match(service, /refreshLive\?await boundedStatus/);
  assert.match(connections, /api\('\/api\/connections'/);
  assert.match(connections, /forceFresh\?\{cache:false\}/);
  assert.match(autopilot, /\/api\/whatsapp\/connection-state", \{ cache: false \}/);
});

test("boot HTTP não bloqueia na projeção completa de oportunidades", async () => {
  const code = await source("../server.mjs"),
    startup = code.slice(code.indexOf("const opportunityService="), code.indexOf("server.listen("));
  assert.doesNotMatch(startup, /await\s+opportunityService\.list\(\)/);
});
