import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { DiscoveryService } from "../src/discovery/discovery-service.mjs";

test("persistência de discovery libera o loop sem quebrar ingestão síncrona nem dedup", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "discovery-cooperative-"));
  const store = await new UnifiedStateStore({ dataDir }).initialize();
  try {
    const service = new DiscoveryService({ registry: {}, repositories: store.discovery, jobRepository: store.jobs });
    const rawJobs = Array.from({ length: 12 }, (_, i) => ({ provider: "nerdin", providerJobId: String(i), title: `Infraestrutura ${i}`, company: "Empresa", sourceUrl: `https://example.test/jobs/${i}`, canonicalUrl: `https://example.test/jobs/${i}` }));
    const input = { providers: ["nerdin"], query: "infraestrutura" };
    let yielded = false;
    const nextTick = new Promise(resolve => setImmediate(() => { yielded = true; resolve(); }));
    const result = await service.finishRunCooperatively({ input, run: store.discovery.startRun(input, ["nerdin"]), rawJobs, reports: [], successfulBoards: [], recordSourceHealth: false });
    assert.equal(yielded, true);
    assert.equal(result.newCount, 12);
    await nextTick;
    const repeated = service.ingestResolvedJobs(rawJobs, { source: "nerdin", recordSourceHealth: false });
    assert.equal(typeof repeated.then, "undefined");
    assert.equal(repeated.duplicateCount, 12);
    assert.equal(store.jobs.all().length, 12);
  } finally { store.close(); await rm(dataDir, { recursive: true, force: true }); }
});
