import { createHash } from "node:crypto";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HubDatabase } from "../db/database.mjs";
import { RawSqliteReader, inspectWal } from "./lib/sqlite-forensics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function sha256(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

async function metadata(filePath) {
  const info = await stat(filePath);
  return { path: path.relative(root, filePath).replaceAll("\\", "/"), bytes: info.size, sha256: await sha256(filePath) };
}

function serializeRaw(value) {
  if (Buffer.isBuffer(value)) return { type: "base64", value: value.toString("base64") };
  return value;
}

async function structuredStateSummary(unifiedPath, profilePath, preparationPath, resumesDir) {
  const unified = JSON.parse(await readFile(unifiedPath, "utf8"));
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  const preparation = JSON.parse(await readFile(preparationPath, "utf8"));
  const resumeFiles = [];
  const walk = async (directory) => {
    const { readdir } = await import("node:fs/promises");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target);
      else {
        const info = await stat(target);
        resumeFiles.push({ path: path.relative(root, target).replaceAll("\\", "/"), bytes: info.size });
      }
    }
  };
  await walk(resumesDir);
  return {
    unifiedState: {
      jobs: unified.jobs?.length ?? 0,
      resumes: unified.resumes?.length ?? 0,
      applications: unified.applications?.length ?? 0,
      analyses: unified.analyses?.length ?? 0,
      searchSchedules: unified.searchSchedules?.length ?? 0,
      alerts: unified.alerts?.length ?? 0,
      searchHistory: unified.searchHistory?.length ?? 0,
      generations: unified.generations?.length ?? 0,
      consideredAsFallback: true
    },
    profile: { topLevelSections: Object.keys(profile), consideredAsStructuredState: true },
    preparation: { jobs: preparation.jobs?.length ?? 0, sources: preparation.sources?.length ?? 0 },
    resumeArtifacts: { files: resumeFiles.length, totalBytes: resumeFiles.reduce((sum, file) => sum + file.bytes, 0), inventory: resumeFiles }
  };
}

const sourceDb = path.resolve(root, argument("source-db", "data/recovery-backup-20260824-query-planner/career-hub.sqlite"));
const sourceWal = path.resolve(root, argument("source-wal", "data/recovery-backup-20260824-query-planner/career-hub.sqlite-wal"));
const sourceShm = path.resolve(root, argument("source-shm", "data/recovery-backup-20260824-query-planner/career-hub.sqlite-shm"));
const candidate = path.resolve(root, argument("candidate", "data/recovery-forensic-20260824/career-hub.candidate.sqlite"));
const manifestPath = path.resolve(root, argument("manifest", "data/recovery-forensic-20260824/recovery-manifest.json"));
const rejectsPath = path.resolve(root, argument("rejects", "data/recovery-forensic-20260824/rejected-raw-rows.jsonl"));
const runtimeDb = path.resolve(root, "data/career-hub.sqlite");

for (const protectedPath of [sourceDb, sourceWal, sourceShm, runtimeDb]) {
  if (candidate === protectedPath || manifestPath === protectedPath || rejectsPath === protectedPath) {
    throw new Error(`Destino de recovery colide com artefato protegido: ${protectedPath}`);
  }
}
await mkdir(path.dirname(candidate), { recursive: true });
const candidateHandle = await open(candidate, "wx").catch((error) => {
  if (error.code === "EEXIST") throw new Error(`Candidato ja existe; nenhum arquivo foi sobrescrito: ${candidate}`);
  throw error;
});
await candidateHandle.close();

const sourceBefore = {
  database: await metadata(sourceDb),
  wal: await metadata(sourceWal),
  shm: await metadata(sourceShm)
};
const walInspection = inspectWal(await readFile(sourceWal));
const reader = await RawSqliteReader.openWithWal(sourceDb, sourceWal);
const rawSchema = reader.readSchema();
const rawTables = new Map(rawSchema.entries.filter((entry) => entry.type === "table").map((entry) => [entry.name, entry]));

const database = new HubDatabase(candidate);
await database.initialize();
const connection = database.connection;
const currentTables = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
const tableReports = new Map();
const rejects = [];

connection.exec("PRAGMA foreign_keys=OFF");
for (const table of [...currentTables].reverse()) {
  if (table !== "schema_migrations") connection.exec(`DELETE FROM ${quoteIdentifier(table)}`);
}

connection.exec("BEGIN IMMEDIATE");
try {
  for (const table of currentTables) {
    if (table === "schema_migrations") {
      tableReports.set(table, { status: "RECONSTRUCTED", source: "CURRENT_MIGRATIONS", recovered: 0, imported: 20, rejected: 0, reason: "Historico de migrations reconstruido pelas migrations atuais." });
      continue;
    }
    const entry = rawTables.get(table);
    if (!entry) continue;
    const recovered = reader.readTable(Number(entry.rootPage));
    const columns = connection.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
    let imported = 0;
    const defaultedColumns = new Set();
    for (const row of recovered.rows) {
      try {
        if (row.values.length > columns.length) throw new Error(`ROW_HAS_${row.values.length}_VALUES_SCHEMA_HAS_${columns.length}`);
        const values = [...row.values];
        for (let index = 0; index < values.length; index += 1) {
          if (values[index] === null && columns[index].pk && String(columns[index].type).toUpperCase() === "INTEGER") values[index] = row.rowid;
        }
        for (let index = values.length; index < columns.length; index += 1) defaultedColumns.add(columns[index].name);
        const selectedColumns = columns.slice(0, values.length);
        const placeholders = selectedColumns.map(() => "?").join(",");
        connection.prepare(`INSERT INTO ${quoteIdentifier(table)}(${selectedColumns.map((column) => quoteIdentifier(column.name)).join(",")}) VALUES(${placeholders})`).run(...values);
        imported += 1;
      } catch (error) {
        rejects.push({ source: "CORRUPTED_SQLITE_RAW_BTREE", table, rowid: row.rowid, reason: error.message, rawValues: row.values.map(serializeRaw) });
      }
    }
    tableReports.set(table, {
      status: recovered.errors.length || rejects.some((reject) => reject.table === table) ? "UNKNOWN" : "RECOVERED",
      source: "CORRUPTED_SQLITE_RAW_BTREE",
      rootPage: entry.rootPage,
      recovered: recovered.rows.length,
      imported,
      rejected: rejects.filter((reject) => reject.table === table).length,
      btreeErrors: recovered.errors,
      defaultedColumns: [...defaultedColumns]
    });
  }
  connection.exec("COMMIT");
} catch (error) {
  connection.exec("ROLLBACK");
  throw error;
}

const migration18 = await readFile(path.join(root, "db/migrations/018_candidate_knowledge_v3.sql"), "utf8");
const backfillOffset = migration18.indexOf("INSERT OR IGNORE INTO career_entities");
if (backfillOffset < 0) throw new Error("Backfill deterministico da migration 018 nao localizado.");
connection.exec(migration18.slice(backfillOffset));

for (const table of currentTables) {
  if (tableReports.has(table)) continue;
  const count = Number(connection.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count);
  const reconstructed = ["career_entities", "knowledge_evidence"].includes(table);
  tableReports.set(table, {
    status: reconstructed ? "RECONSTRUCTED" : "DEFAULTED",
    source: reconstructed ? "MIGRATION_018_BACKFILL_FROM_RECOVERED_CANDIDATE_FACTS" : "CURRENT_SCHEMA_NO_COMPATIBLE_PERSISTED_ROWS",
    recovered: 0,
    imported: count,
    rejected: 0,
    reason: reconstructed
      ? "Registros derivados exclusivamente pelo backfill versionado da migration 018."
      : "Tabela criada pelo schema atual; nenhuma linha compativel foi localizada nas fontes persistidas."
  });
}

connection.exec("PRAGMA foreign_keys=ON");
const foreignKeyViolations = connection.prepare("PRAGMA foreign_key_check").all();
const jsonViolations = [];
for (const table of currentTables) {
  const jsonColumns = connection.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().filter((column) => column.name.endsWith("_json"));
  for (const column of jsonColumns) {
    const rows = connection.prepare(`SELECT rowid AS recovery_rowid, ${quoteIdentifier(column.name)} AS value FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier(column.name)} IS NOT NULL`).all();
    for (const row of rows) {
      try { JSON.parse(row.value); } catch { jsonViolations.push({ table, column: column.name, rowid: row.recovery_rowid }); }
    }
  }
}
const integrity = connection.prepare("PRAGMA integrity_check").all();
const quickCheck = connection.prepare("PRAGMA quick_check").all();
const migrationRows = connection.prepare("SELECT version,name FROM schema_migrations ORDER BY version").all();
const counts = Object.fromEntries(currentTables.map((table) => [table, Number(connection.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`).get().count)]));
const structuredStates = await structuredStateSummary(
  path.join(root, "data/unified-state.json"),
  path.join(root, "data/profile.json"),
  path.join(root, "data/preparation.json"),
  path.join(root, "data/resumes")
);
const sourceAfter = {
  database: await metadata(sourceDb),
  wal: await metadata(sourceWal),
  shm: await metadata(sourceShm)
};
const protectedArtifactsUnchanged = Object.keys(sourceBefore).every((key) => sourceBefore[key].sha256 === sourceAfter[key].sha256);
const validationPassed = integrity.length === 1
  && integrity[0].integrity_check === "ok"
  && quickCheck.length === 1
  && quickCheck[0].quick_check === "ok"
  && foreignKeyViolations.length === 0
  && jsonViolations.length === 0
  && migrationRows.length === 20
  && rejects.length === 0
  && protectedArtifactsUnchanged;

connection.exec("PRAGMA wal_checkpoint(TRUNCATE)");
database.close();
await writeFile(rejectsPath, rejects.map((reject) => JSON.stringify(reject)).join("\n") + (rejects.length ? "\n" : ""), { flag: "wx" });
const candidateMetadata = await metadata(candidate);
const manifest = {
  formatVersion: 1,
  createdAt: new Date().toISOString(),
  policy: {
    sourcePriority: ["CORRUPTED_SQLITE_AND_VALID_WAL_PREFIX", "STRUCTURED_PROJECT_STATES", "UNIFIED_STATE_JSON_FALLBACK"],
    submissionEnabled: false,
    runtimePromoted: false,
    statuses: ["RECOVERED", "RECONSTRUCTED", "DEFAULTED", "LOST", "UNKNOWN"]
  },
  protectedArtifacts: { before: sourceBefore, after: sourceAfter, unchanged: protectedArtifactsUnchanged },
  sourceForensics: {
    sqlite: { pageSize: reader.pageSize, physicalPageCount: reader.physicalPageCount, declaredPageCount: reader.declaredPageCount, schemaRows: rawSchema.rows.length, schemaErrors: rawSchema.errors },
    wal: { ...walInspection, appliedFrames: reader.walRecovery.appliedFrames, recoveryBoundary: "LAST_CHECKSUM_VALID_COMMIT" }
  },
  structuredStates,
  candidate: candidateMetadata,
  tables: Object.fromEntries([...tableReports.entries()].sort(([left], [right]) => left.localeCompare(right))),
  domains: {
    searchIntentV7: { status: counts.search_intents > 0 ? "RECOVERED" : "UNKNOWN", counts: { profiles: counts.job_hunt_profiles, intents: counts.search_intents, expandedQueries: counts.expanded_queries } },
    queryPlannerV2: { status: "RECOVERED", counts: { states: counts.discovery_query_planner_state }, note: "Estado vazio recuperado; cursor/round sera validado em clone antes da promocao e criado pelo pipeline normal na Round 4." },
    profiles: { status: "RECOVERED", count: counts.job_hunt_profiles },
    resumes: { status: "RECOVERED", counts: { resumes: counts.resumes, versions: counts.resume_versions, artifacts: counts.resume_artifacts } },
    jobs: { status: "RECOVERED", count: counts.jobs },
    requirementsEvidence: { status: "RECOVERED", counts: { requirements: counts.job_requirements, analysisItems: counts.ats_analysis_items, knowledgeEvidence: counts.knowledge_evidence } },
    applications: { status: "RECOVERED", counts: { applications: counts.applications, attempts: counts.application_attempts, submissionAttempts: counts.submission_attempts } },
    atsAnalysis: { status: "RECOVERED", count: counts.ats_analyses },
    schedulesAlerts: { status: "RECOVERED", counts: { schedules: counts.search_schedules, alerts: counts.alerts, huntRuns: counts.job_hunt_runs } },
    candidateKnowledgeV3: { status: "RECONSTRUCTED", counts: { entities: counts.career_entities, evidence: counts.knowledge_evidence, claims: counts.evidence_claims, gaps: counts.evidence_gaps }, note: "Backfill versionado da migration 018 aplicado sobre candidate_facts recuperados." }
  },
  validations: {
    passed: validationPassed,
    migrations: migrationRows,
    integrity,
    quickCheck,
    foreignKeyViolations,
    jsonViolations,
    rejects: rejects.length,
    counts
  }
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ validationPassed, candidate: candidateMetadata, manifest: path.relative(root, manifestPath), rejects: rejects.length, keyCounts: manifest.domains, wal: walInspection }, null, 2));
if (!validationPassed) process.exitCode = 2;
