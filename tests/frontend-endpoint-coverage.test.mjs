import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settings = await readFile(new URL("../public/features/settings/page.js", import.meta.url), "utf8");
const resumes = await readFile(new URL("../public/features/resumes/page.js", import.meta.url), "utf8");
const applications = await readFile(new URL("../public/features/applications/page.js", import.meta.url), "utf8");
const opportunities = await readFile(new URL("../public/features/opportunities/page.js", import.meta.url), "utf8");
const autopilot = await readFile(new URL("../public/features/autopilot/page.js", import.meta.url), "utf8");
const knowledge = await readFile(new URL("../public/features/knowledge/page.js", import.meta.url), "utf8");
const coverage = await readFile(new URL("../docs/backend-frontend-endpoint-coverage.md", import.meta.url), "utf8");

test("contratos operacionais novos possuem consumidor na superficie canonica", () => {
  for (const endpoint of [
    "/api/integrations/n8n",
    "/api/integrations/n8n/test",
    "/api/intelligence/models/refresh",
    "/api/intelligence/benchmark",
    "/api/ats/recalculate",
    "/api/profile/export",
    "/api/unified/sync-legacy",
    "/api/resume-documents/compiler-health",
    "/api/resume-documents/metrics",
  ]) assert.ok(settings.includes(endpoint), `${endpoint} sem consumidor em Configuracoes`);

  for (const endpoint of [
    "/api/resume-archetypes",
    "/api/resume-archetypes/prepare",
    "/api/resume-archetypes/assignments/",
    "/api/resume-documents/templates/benchmarks",
  ]) assert.ok(resumes.includes(endpoint), `${endpoint} sem consumidor em Curriculos`);
});

test("payload da inteligencia segue o contrato endpoint e nao o nome legado", () => {
  assert.match(settings, /name="endpoint"/);
  assert.match(settings, /name="provider"/);
  assert.match(settings, /lm-studio/);
  assert.doesNotMatch(settings, /name="baseUrl"/);
});

test("familias principais continuam ligadas as telas de dominio", () => {
  assert.ok(opportunities.includes("/api/opportunities"));
  assert.ok(opportunities.includes("/api/unified/ats"));
  assert.ok(applications.includes("/api/experience/applications"));
  assert.ok(autopilot.includes("/api/job-hunt/profiles"));
  assert.ok(autopilot.includes("/api/source-center"));
  assert.ok(knowledge.includes("/api/candidate-knowledge/inventory"));
});

test("callbacks e APIs de maquina permanecem classificados, nao viram botoes", () => {
  for (const endpoint of [
    "/api/discovery-v4/webhooks/evolution",
    "/api/connections/handoff/*",
    "/api/automation/resume-documents/jobs",
    "/api/integrations/n8n/dispatch",
  ]) assert.ok(coverage.includes(endpoint), `${endpoint} sem classificacao explicita`);
});
