import test from "node:test";
import assert from "node:assert/strict";
import { resolveGeographySurfaces } from "../src/discovery/search-intent/geography-surfaces.mjs";
import { DiscoveryQueryPlanner } from "../src/discovery/search-intent/discovery-query-planner.mjs";
import { classifyGeography } from "../src/discovery/relevance/pre-match-plausibility.mjs";
import { JobSpyProvider } from "../src/discovery/providers/jobspy-provider.mjs";
import { mobileSearchInput } from "../server/mobile/mobile-radar.mjs";

test("busca mobile preserva o pais solicitado sem impor Brasil", () => {
  for (const location of ["Portugal", "Brasil", "Lisboa, Portugal"]) {
    const result = mobileSearchInput({ queries: ["Software Engineer"], locations: [location], workModels: ["REMOTE"], seniorities: ["JUNIOR"], sourcePreferences: ["indeed"], prepareResume: false });
    assert.equal(result.locationPolicy.priorities[0].remoteScope, location);
  }
});

const portugalPolicy = {
  priorities: [
    { priority: 1, location: "Lisboa, Portugal", workModel: "HYBRID", accepted: true },
    { priority: 2, location: "Porto, Portugal", workModel: "ONSITE", accepted: true },
    { priority: 3, location: "Portugal", remoteScope: "Portugal", workModel: "REMOTE", accepted: true },
  ],
};

test("edição Community usa Portugal remoto quando nenhuma geografia foi configurada", () => {
  const [surface] = resolveGeographySurfaces();
  assert.equal(surface.id, "REMOTE_PORTUGAL");
  assert.equal(surface.country, "Portugal");
  assert.equal(surface.transportLocation, "Portugal");
});

test("superfícies de Lisboa, Porto e remoto Portugal são preservadas no planner", () => {
  const planner = new DiscoveryQueryPlanner();
  const plan = planner.plan({
    intent: { families: ["BACKEND"], locationPolicy: portugalPolicy },
    candidates: [{ query: "Software Engineer", familyId: "BACKEND", tier: "TIER_1" }],
    budget: { maxQueries: 3, maxRequests: 3 },
  });

  assert.deepEqual(plan.geographySurfaces, ["LOCAL_LISBON", "LOCAL_PORTO", "REMOTE_PORTUGAL"]);
  assert.deepEqual(plan.selected.map((item) => item.country), ["Portugal", "Portugal", "Portugal"]);
  assert.equal(plan.selected[0].transportLocation, "Lisbon, Portugal");
});

test("política portuguesa aceita vagas locais e remotas europeias e rejeita fora da região", () => {
  for (const job of [
    { location: "Lisboa, Portugal", workModel: "HYBRID" },
    { location: "Porto, Portugal", workModel: "ONSITE" },
    { location: "Portugal", country: "Portugal", workModel: "REMOTE", remote: true },
    { location: "Europe", workModel: "REMOTE", remote: true },
  ]) {
    assert.equal(classifyGeography(job, portugalPolicy).accepted, true, job.location);
  }

  for (const job of [
    { location: "Madrid, Spain", country: "Spain", workModel: "ONSITE" },
    { location: "United States", country: "United States", workModel: "REMOTE", remote: true },
  ]) {
    const result = classifyGeography(job, portugalPolicy);
    assert.equal(result.accepted, false, job.location);
    assert.equal(result.geographicMatch.reasonCodes[0], "FOREIGN_LOCATION");
  }
});

test("JobSpy recebe localização portuguesa e descarta resultados estrangeiros", async () => {
  let request;
  const provider = new JobSpyProvider({
    searchClient: async (input) => {
      request = input;
      return {
        jobs: [
          { externalId: "indeed:pt", source: "indeed", title: "Software Engineer", company: "Acme PT", location: "Lisboa, Portugal", country: "Portugal", workModel: "HYBRID", url: "https://example.test/pt" },
          { externalId: "indeed:us", source: "indeed", title: "Software Engineer", company: "Acme US", location: "New York, United States", country: "United States", workModel: "ONSITE", url: "https://example.test/us" },
        ],
        sourceReports: [{ site: "indeed", status: "SUCCESS", rawResults: 2 }],
      };
    },
  });

  const result = await provider.search({
    query: "Software Engineer",
    geographySurface: "LOCAL_LISBON",
    sites: ["indeed"],
  });

  assert.equal(request.location, "Lisbon, Portugal");
  assert.equal(request.country, "Portugal");
  assert.deepEqual(result.jobs.map((item) => item.providerJobId), ["pt"]);
  assert.equal(result.diagnostic.geographyRejectedResults, 1);
});

test("política brasileira continua compatível na edição Community", () => {
  const surfaces = resolveGeographySurfaces({
    priorities: [
      { priority: 1, location: "Brasília, DF", workModel: "HYBRID", accepted: true },
      { priority: 2, location: "Brasil", remoteScope: "Brasil", workModel: "REMOTE", accepted: true },
    ],
  });
  assert.deepEqual(surfaces.map((item) => item.id), ["LOCAL_DF", "REMOTE_BRAZIL"]);
});
