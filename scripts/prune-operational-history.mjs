import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HubDatabase } from "../db/database.mjs";
import { AtsAnalysisRepository } from "../repositories/ats-analysis-repository.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const databasePath = path.join(dataDir, "career-hub.sqlite");
const apply = process.argv.includes("--apply");

if (!apply) {
  console.error("Use --apply para executar a retenção após revisar o backup.");
  process.exitCode = 2;
} else {
  const database = await new HubDatabase(databasePath).initialize();
  try {
    const baseResumeId = database.getMetadata("default_resume_id", "");
    const baseResume = baseResumeId
      ? database.connection
          .prepare("SELECT id, title, resume_kind FROM resumes WHERE id = ?")
          .get(baseResumeId)
      : null;
    if (!baseResume || baseResume.resume_kind !== "BASE")
      throw Object.assign(
        new Error("O currículo base padrão não está definido ou não é BASE."),
        { code: "ATS_RETENTION_BASE_INVALID" },
      );
    const backupDir = path.join(dataDir, "backups");
    await mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const backupPath = path.join(backupDir, `career-hub-before-retention-${stamp}.sqlite`);
    database.connection.exec("PRAGMA wal_checkpoint(FULL)");
    await copyFile(databasePath, backupPath);
    const report = database.transaction(() =>
      new AtsAnalysisRepository(database.connection).pruneOperationalHistory({
        baseResumeId,
      }),
    );
    database.connection.exec("PRAGMA optimize");
    console.log(JSON.stringify({ ok: true, baseResume, backupPath, ...report }, null, 2));
  } finally {
    database.close();
  }
}
