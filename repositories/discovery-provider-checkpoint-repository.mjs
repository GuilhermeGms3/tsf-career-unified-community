import { parseJson } from "./base-repository.mjs";

const now = () => new Date().toISOString();

export class DiscoveryProviderCheckpointRepository {
  constructor(connection, database) {
    this.connection = connection;
    this.database = database;
  }

  get(providerId, scopeKey) {
    const row = this.connection.prepare(
      "SELECT * FROM discovery_provider_checkpoints WHERE provider_id=? AND scope_key=?",
    ).get(providerId, scopeKey);
    return row ? this.map(row) : null;
  }

  processed(providerId, scopeKey) {
    return new Map(this.connection.prepare(`
      SELECT item_key,fingerprint
      FROM discovery_provider_checkpoint_items
      WHERE provider_id=? AND scope_key=?
    `).all(providerId, scopeKey).map((row) => [row.item_key, row.fingerprint]));
  }

  commit(item = {}) {
    const providerId = String(item.providerId || "").trim();
    const scopeKey = String(item.scopeKey || "").trim();
    if (!providerId || !scopeKey) throw new TypeError("Checkpoint exige providerId e scopeKey.");
    const timestamp = now();
    this.database.transaction(() => {
      this.connection.prepare(`
        INSERT INTO discovery_provider_checkpoints(
          provider_id,scope_key,cursor,cycle,state_json,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(provider_id,scope_key) DO UPDATE SET
          cursor=excluded.cursor,
          cycle=excluded.cycle,
          state_json=excluded.state_json,
          updated_at=excluded.updated_at
      `).run(
        providerId,
        scopeKey,
        Math.max(0, Number(item.cursor || 0)),
        Math.max(0, Number(item.cycle || 0)),
        JSON.stringify(item.state || {}),
        timestamp,
        timestamp,
      );
      const upsert = this.connection.prepare(`
        INSERT INTO discovery_provider_checkpoint_items(
          provider_id,scope_key,item_key,fingerprint,processed_at
        ) VALUES(?,?,?,?,?)
        ON CONFLICT(provider_id,scope_key,item_key) DO UPDATE SET
          fingerprint=excluded.fingerprint,
          processed_at=excluded.processed_at
      `);
      for (const processed of item.processedItems || []) {
        const itemKey = String(processed.itemKey || "").trim();
        const fingerprint = String(processed.fingerprint || "").trim();
        if (itemKey && fingerprint)
          upsert.run(providerId, scopeKey, itemKey, fingerprint, timestamp);
      }
    });
    return this.get(providerId, scopeKey);
  }

  map(row) {
    return {
      providerId: row.provider_id,
      scopeKey: row.scope_key,
      cursor: row.cursor,
      cycle: row.cycle,
      state: parseJson(row.state_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
