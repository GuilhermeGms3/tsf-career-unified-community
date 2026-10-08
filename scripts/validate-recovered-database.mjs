import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { JobHuntService } from "../src/automation/job-hunt-service.mjs";

const source = process.argv[2];
if (!source) throw new Error("Uso: node scripts/validate-recovered-database.mjs <candidate.sqlite>");
assert.notEqual(String(process.env.CAREER_SUBMISSION_ENABLED).toLowerCase(), "true", "CAREER_SUBMISSION_ENABLED deve permanecer false");

const directory = await mkdtemp(path.join(os.tmpdir(), "career-recovery-validation-"));
const clone = path.join(directory, "career-hub.sqlite");
await copyFile(path.resolve(source), clone);
const store = await new UnifiedStateStore({ dataDir: directory, legacyStatePath: path.join(directory, "absent-legacy-state.json") }).initialize();
try {
  const connection = store.database.connection;
  assert.deepEqual(connection.prepare("PRAGMA integrity_check").all().map((row) => row.integrity_check), ["ok"]);
  assert.equal(connection.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(connection.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count, 20);
  const profileRows = connection.prepare("SELECT id,enabled,search_intent_version,job_families_json,query_budget_json FROM job_hunt_profiles").all();
  assert.equal(profileRows.length, 1);
  const profileRow = profileRows[0];
  const families = JSON.parse(profileRow.job_families_json);
  const budget = JSON.parse(profileRow.query_budget_json);
  assert.equal(profileRow.search_intent_version, 7);
  assert.equal(profileRow.enabled, 0);
  assert.equal(budget.maxRequests, 1);
  assert.ok(families.length >= 2);
  assert.equal(connection.prepare("SELECT COUNT(*) AS count FROM search_intents WHERE profile_id=? AND version=7").get(profileRow.id).count, 1);
  assert.equal(connection.prepare("SELECT COUNT(*) AS count FROM discovery_query_planner_state").get().count, 0);

  const discoveryCalls = [];
  const service = new JobHuntService({
    store,
    discoveryService: {
      discover: async (input) => {
        discoveryCalls.push(input);
        return {
          run: { id: `recovery-validation-${discoveryCalls.length}` },
          jobs: [],
          discoveredCount: 0,
          newCount: 0,
          duplicateCount: 0,
          closedCount: 0,
          sourceReports: [{ provider: input.providers?.[0] ?? "validation", status: "HEALTHY" }],
          ok: true
        };
      }
    },
    matcher: () => null,
    profileProvider: async () => ({})
  });
  const first = await service.run(profileRow.id);
  const second = await service.run(profileRow.id);
  const state = store.discoveryQueryPlannerState.get(profileRow.id);
  assert.equal(discoveryCalls.length, 2, "maxRequests=1 deve limitar cada rodada a uma requisicao");
  assert.equal(first.requestCount, 1);
  assert.equal(second.requestCount, 1);
  assert.equal(first.report.expandedQueryDetails.length, 1);
  assert.equal(second.report.expandedQueryDetails.length, 1);
  assert.notEqual(first.report.expandedQueryDetails[0].familyId, second.report.expandedQueryDetails[0].familyId);
  assert.equal(state.round, 2);
  assert.equal(state.familyCursor, 2);
  assert.equal(store.jobHuntProfiles.findById(profileRow.id).enabled, false);

  console.log(JSON.stringify({
    passed: true,
    migrations: 20,
    integrity: "ok",
    foreignKeys: "ok",
    searchIntentVersion: 7,
    profileEnabled: false,
    configuredBudget: { maxQueries: budget.maxQueries, maxRequests: budget.maxRequests },
    planner: {
      initialStates: 0,
      validationCloneRound: state.round,
      validationCloneCursor: state.familyCursor,
      firstFamily: first.report.expandedQueryDetails[0].familyId,
      secondFamily: second.report.expandedQueryDetails[0].familyId,
      requestsPerRound: [first.requestCount, second.requestCount]
    }
  }, null, 2));
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true });
}
