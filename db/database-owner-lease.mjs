import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

function readLease(filePath) {
  try { return JSON.parse(readFileSync(filePath, "utf8")); } catch {
    try {
      return { invalidPayload: true, heartbeatAt: statSync(filePath).mtime.toISOString() };
    } catch { return null; }
  }
}

export class DatabaseOwnerLease {
  constructor(databasePath, { staleAfterMs = 30_000, heartbeatMs = 5_000 } = {}) {
    this.filePath = `${databasePath}.owner.lock`;
    this.staleAfterMs = staleAfterMs;
    this.heartbeatMs = heartbeatMs;
    this.token = randomUUID();
    this.startedAt = new Date().toISOString();
    this.timer = null;
  }

  payload() {
    return {
      token: this.token,
      pid: process.pid,
      hostname: hostname(),
      platform: process.platform,
      startedAt: this.startedAt,
      heartbeatAt: new Date().toISOString()
    };
  }

  writeExclusive() {
    const descriptor = openSync(this.filePath, "wx");
    try { writeFileSync(descriptor, `${JSON.stringify(this.payload())}\n`, "utf8"); } finally { closeSync(descriptor); }
  }

  acquire() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        this.writeExclusive();
        this.timer = setInterval(() => {
          const current = readLease(this.filePath);
          if (current?.token === this.token) writeFileSync(this.filePath, `${JSON.stringify(this.payload())}\n`, "utf8");
        }, this.heartbeatMs);
        this.timer.unref();
        return this;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const current = readLease(this.filePath);
        const heartbeat = Date.parse(current?.heartbeatAt || current?.startedAt || "");
        if (Number.isFinite(heartbeat) && Date.now() - heartbeat <= this.staleAfterMs) {
          const owned = new Error("SQLite runtime ja possui um writer ativo neste dataDir.");
          owned.code = "SQLITE_RUNTIME_ALREADY_OWNED";
          owned.owner = { pid: current.pid, hostname: current.hostname, platform: current.platform, heartbeatAt: current.heartbeatAt };
          throw owned;
        }
        const stalePath = `${this.filePath}.stale-${Date.now()}-${randomUUID()}`;
        try { renameSync(this.filePath, stalePath); } catch (renameError) {
          if (!["ENOENT", "EACCES", "EPERM"].includes(renameError.code)) throw renameError;
        }
      }
    }
    const error = new Error("Nao foi possivel adquirir ownership exclusivo do SQLite runtime.");
    error.code = "SQLITE_RUNTIME_LEASE_FAILED";
    throw error;
  }

  release() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const current = readLease(this.filePath);
    if (current?.token === this.token) {
      try { unlinkSync(this.filePath); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
}
