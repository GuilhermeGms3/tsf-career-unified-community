import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { RawSqliteReader } from "../scripts/lib/sqlite-forensics.mjs";

test("le schema e payloads com overflow sem depender do cabecalho page-count", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "career-sqlite-forensics-"));
  const filePath = path.join(directory, "fixture.sqlite");
  try {
    const db = new DatabaseSync(filePath);
    db.exec("PRAGMA journal_mode=DELETE; CREATE TABLE sample(id INTEGER PRIMARY KEY, label TEXT NOT NULL, payload TEXT NOT NULL)");
    db.prepare("INSERT INTO sample(label,payload) VALUES (?,?)").run("alpha", "x".repeat(20_000));
    db.close();

    const reader = await RawSqliteReader.open(filePath);
    const schema = reader.readSchema();
    const table = schema.entries.find((entry) => entry.name === "sample");
    assert.ok(table);
    const recovered = reader.readTable(table.rootPage, { tolerateCorruption: false });
    assert.equal(recovered.rows.length, 1);
    assert.deepEqual(recovered.rows[0].values, [null, "alpha", "x".repeat(20_000)]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sobrepoe somente o ultimo commit checksum-valido do WAL", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "career-sqlite-wal-forensics-"));
  const filePath = path.join(directory, "fixture.sqlite");
  try {
    const db = new DatabaseSync(filePath);
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE sample(id INTEGER PRIMARY KEY, label TEXT NOT NULL); PRAGMA wal_checkpoint(FULL)");
    db.prepare("INSERT INTO sample(label) VALUES (?)").run("from-wal");
    const reader = await RawSqliteReader.openWithWal(filePath, `${filePath}-wal`);
    const table = reader.readSchema().entries.find((entry) => entry.name === "sample");
    assert.ok(table);
    assert.equal(reader.walRecovery.appliedFrames > 0, true);
    assert.deepEqual(reader.readTable(table.rootPage, { tolerateCorruption: false }).rows[0].values, [null, "from-wal"]);
    db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
