import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { DatabaseOwnerLease } from "./database-owner-lease.mjs";

const defaultMigrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export class HubDatabase {
  constructor(filePath, { migrationsDir = defaultMigrationsDir, ownerLease = false } = {}) {
    this.filePath = filePath;
    this.migrationsDir = migrationsDir;
    this.connection = null;
    this.transactionDepth = 0;
    this.ownerLease = ownerLease ? new DatabaseOwnerLease(filePath) : null;
    this.shutdownHandler = null;
  }

  installShutdownHandlers() {
    if (!this.ownerLease || this.shutdownHandler) return;
    this.shutdownHandler = () => {
      try { this.close(); } finally { process.exit(0); }
    };
    process.once("SIGINT", this.shutdownHandler);
    process.once("SIGTERM", this.shutdownHandler);
  }

  async initialize() {
    this.ownerLease?.acquire();
    try {
      this.connection = new DatabaseSync(this.filePath);
      this.connection.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.connection.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const files = (await readdir(this.migrationsDir))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort((left, right) => left.localeCompare(right));
    const applied = new Set(this.connection.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
    for (const name of files) {
      const version = Number(name.split("_", 1)[0]);
      if (applied.has(version)) continue;
      const sql = await readFile(path.join(this.migrationsDir, name), "utf8");
      const rebuildsReferencedTable=sql.startsWith("-- MIGRATION_FOREIGN_KEYS_OFF");
      if(rebuildsReferencedTable)this.connection.exec("PRAGMA foreign_keys = OFF");
      try{
        this.transaction(() => {
          this.connection.exec(sql);
          this.connection.prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
            .run(version, name, new Date().toISOString());
        });
      }finally{if(rebuildsReferencedTable)this.connection.exec("PRAGMA foreign_keys = ON");}
      if(rebuildsReferencedTable){const violations=this.connection.prepare("PRAGMA foreign_key_check").all();if(violations.length)throw new Error(`Migration ${name} deixou ${violations.length} violação(ões) de chave estrangeira.`);}
    }
      this.installShutdownHandlers();
      return this;
    } catch (error) {
      this.connection?.close();
      this.connection = null;
      this.ownerLease?.release();
      throw error;
    }
  }

  transaction(callback) {
    const nested = this.transactionDepth > 0;
    const savepoint = `hub_nested_${this.transactionDepth}`;
    this.connection.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = callback();
      this.transactionDepth -= 1;
      this.connection.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
      return result;
    } catch (error) {
      this.transactionDepth -= 1;
      this.connection.exec(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}` : "ROLLBACK");
      if (nested) this.connection.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  setMetadata(key, value) {
    this.connection.prepare(`
      INSERT INTO app_metadata(key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value), new Date().toISOString());
  }

  getMetadata(key, fallback = "") {
    return this.connection
      .prepare("SELECT value FROM app_metadata WHERE key = ?")
      .get(key)?.value ?? fallback;
  }

  close() {
    if (this.shutdownHandler) {
      process.removeListener("SIGINT", this.shutdownHandler);
      process.removeListener("SIGTERM", this.shutdownHandler);
      this.shutdownHandler = null;
    }
    this.connection?.close();
    this.connection = null;
    this.ownerLease?.release();
  }
}
