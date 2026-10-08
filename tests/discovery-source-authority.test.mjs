import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { DiscoveryService } from "../src/discovery/discovery-service.mjs";
import { JobSpyProvider } from "../src/discovery/providers/jobspy-provider.mjs";
import { ProviderRegistry } from "../src/discovery/provider-registry.mjs";
import {
  SOURCE_OPERATIONAL_STATES,
  SOURCE_SURFACES,
  TECHNICAL_DISCOVERY_PROVIDERS,
  operationalStatusFromObservation,
  projectSourceSurface,
  sourceSurface,
  sourceSurfacesForProvider,
} from "../src/discovery/source-authority.mjs";

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "source-authority-"));
  let store = await new UnifiedStateStore({ dataDir }).initialize();
  return {
    get store() { return store; },
    restart: async () => { store.close(); store = await new UnifiedStateStore({ dataDir }).initialize(); },
    close: async () => { store.close(); await rm(dataDir, { recursive: true, force: true }); },
  };
}

test("catalogo canonico separa providers tecnicos e superficies JobSpy", () => {
  assert.equal(TECHNICAL_DISCOVERY_PROVIDERS.length, 18);
  assert.deepEqual(sourceSurfacesForProvider("jobspy").map((item) => item.id), [
    "jobspy:linkedin", "jobspy:indeed", "jobspy:glassdoor", "jobspy:google",
  ]);
  assert.ok(SOURCE_SURFACES.every((item) => ["id", "provider_id", "display_name", "type", "discovery_mode", "status", "enabled", "supports_global_search", "requires_known_board", "requires_authentication", "supports_pagination", "configuration_state"].every((key) => key in item)));
  assert.ok(SOURCE_OPERATIONAL_STATES.includes("OPERATIONAL_REAL"));
  assert.equal(projectSourceSurface(sourceSurface("greenhouse"), { targetCount: 0 }).status, "NOT_CONFIGURED");
  assert.equal(projectSourceSurface(sourceSurface("linkedin-posts")).status, "MANUAL_ONLY");
  assert.equal(projectSourceSurface(sourceSurface("ciee")).status, "NOT_IMPLEMENTED");
});

test("OPERATIONAL_REAL exige consulta real recente com resultado valido", () => {
  const finishedAt = new Date().toISOString();
  assert.equal(operationalStatusFromObservation({ realQuery: true, status: "SUCCESS", validCount: 1, finishedAt }), "OPERATIONAL_REAL");
  assert.equal(operationalStatusFromObservation({ realQuery: true, status: "SUCCESS", validCount: 0, finishedAt }), "SUCCESS_EMPTY");
  assert.equal(operationalStatusFromObservation({ realQuery: true, status: "RATE_LIMITED", validCount: 0, finishedAt, errorCode: "HTTP_429" }), "BLOCKED");
  assert.equal(operationalStatusFromObservation({ realQuery: false, status: "HEALTHY", validCount: 10, finishedAt }), "UNKNOWN");
});

test("telemetria JobSpy preserva contagem individual por surface", () => {
  const recorded = [];
  const service = new DiscoveryService({
    registry: {},
    repositories: {},
    jobRepository: {},
    sourceHealthRepository: { record: (item) => (recorded.push(item), item) },
  });
  service.recordSourceHealth({
    runId: "run-jobspy",
    input: { query: "NOC", location: "Brasilia", limit: 10 },
    reports: [{
      provider: "jobspy",
      status: "DEGRADED",
      count: 17,
      sites: [
        { site: "linkedin", status: "SUCCESS", rawResults: 10, acceptedResults: 10 },
        { site: "indeed", status: "SUCCESS", rawResults: 7, acceptedResults: 7 },
      ],
    }, {
      provider: "greenhouse",
      status: "HEALTHY",
      count: 10,
      candidates: 0,
    }],
    outcomes: new Map([
      ["jobspy:linkedin", { valid: 10, newCount: 10, duplicates: 0, sampleUrls: [], publishedAt: [] }],
      ["jobspy:indeed", { valid: 7, newCount: 7, duplicates: 0, sampleUrls: [], publishedAt: [] }],
      ["greenhouse", { valid: 10, newCount: 10, duplicates: 0, sampleUrls: [], publishedAt: [] }],
    ]),
  });
  assert.deepEqual(recorded.map((item) => item.rawCount), [10, 7, 10]);
  assert.deepEqual(recorded.map((item) => item.parsedCount), [10, 7, 10]);
});

test("discovery persiste historico independente por portal e sobrevive a reinicio", async () => {
  const f = await fixture();
  try {
    const provider = new JobSpyProvider({ searchClient: async () => ({
      jobs: [{ externalId: "indeed:42", source: "indeed", title: "NOC Junior", company: "Acme", location: "Brasilia, DF", url: "https://example.test/jobs/42", datePosted: "2026-09-20" }],
      sourceReports: [
        { site: "indeed", status: "SUCCESS", rawResults: 1, acceptedResults: 1, pagesScanned: 1, durationMs: 12 },
        { site: "linkedin", status: "RATE_LIMITED", rawResults: 0, acceptedResults: 0, pagesScanned: 1, durationMs: 8, errorCode: "HTTP_429" },
        { site: "glassdoor", status: "NO_RESULTS", rawResults: 0, acceptedResults: 0, pagesScanned: 1, durationMs: 5 },
      ],
    }) });
    const service = new DiscoveryService({ registry: new ProviderRegistry([provider]), repositories: f.store.discovery, jobRepository: f.store.jobs, sourceHealthRepository: f.store.discoverySourceHealth });
    const first = await service.discover({ query: "NOC", location: "Brasilia, DF", providers: ["jobspy"], sites: ["indeed", "linkedin", "glassdoor"], limit: 10 });
    assert.equal(f.store.discoverySourceHealth.latest("jobspy:indeed").status, "OPERATIONAL_REAL");
    assert.equal(f.store.discoverySourceHealth.latest("jobspy:indeed").lastNewCount, 1);
    assert.equal(f.store.discoverySourceHealth.latest("jobspy:linkedin").status, "BLOCKED");
    assert.equal(f.store.discoverySourceHealth.latest("jobspy:glassdoor").status, "SUCCESS_EMPTY");
    assert.equal(f.store.discoverySourceHealth.forRun(first.run.id).length, 3);
    await service.discover({ query: "NOC", location: "Brasilia, DF", providers: ["jobspy"], sites: ["indeed", "linkedin", "glassdoor"], limit: 10 });
    assert.equal(f.store.discoverySourceHealth.latest("jobspy:indeed").lastDuplicateCount, 1);
    assert.equal(f.store.discoverySourceHealth.history("jobspy:indeed").length, 2);
    await f.restart();
    assert.equal(f.store.discoverySourceHealth.history("jobspy:indeed").length, 2);
    assert.throws(() => f.store.database.connection.prepare("DELETE FROM discovery_source_health_history").run(), /append-only/);
  } finally { await f.close(); }
});

test("migration e UI expõem autoridade e inspetor sem alterar candidatura", async () => {
  const migration = await readFile(new URL("../db/migrations/032_discovery_source_authority.sql", import.meta.url), "utf8");
  const autopilot = await readFile(new URL("../public/features/autopilot/page.js", import.meta.url), "utf8");
  assert.match(migration, /discovery_source_health_history_no_delete/);
  assert.match(autopilot, /Saúde operacional por fonte/);
  assert.match(autopilot, /Consultas planejadas \/ executadas/);
  assert.doesNotMatch(migration, /applications|submission/i);
});
