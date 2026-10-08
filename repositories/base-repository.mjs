export function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class BaseRepository {
  constructor(connection, { table, columns, toRow, fromRow }) {
    this.connection = connection;
    this.table = table;
    this.columns = columns;
    this.toRow = toRow;
    this.fromRow = fromRow;
    const placeholders = columns.map(() => "?").join(", ");
    const updates = columns.filter((column) => column !== "id").map((column) => `${column} = excluded.${column}`).join(", ");
    this.upsertStatement = connection.prepare(`
      INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${updates}
    `);
  }

  all() {
    return this.connection.prepare(`SELECT * FROM ${this.table} ORDER BY created_at DESC`).all().map(this.fromRow);
  }

  findById(id) {
    const row = this.connection.prepare(`SELECT * FROM ${this.table} WHERE id = ?`).get(id);
    return row ? this.fromRow(row) : null;
  }

  upsert(item) {
    const row = this.toRow(item);
    this.upsertStatement.run(...this.columns.map((column) => row[column] ?? null));
    return this.findById(item.id);
  }

  insertIfMissing(item) {
    if (this.findById(item.id)) return false;
    this.upsert(item);
    return true;
  }

  importIfNewer(item) {
    const current = this.findById(item.id);
    if (!current) {
      this.upsert(item);
      return "inserted";
    }
    const incomingTime = Date.parse(item.updatedAt || item.createdAt || 0);
    const currentTime = Date.parse(current.updatedAt || current.createdAt || 0);
    if (Number.isFinite(incomingTime) && incomingTime > currentTime) {
      this.upsert(item);
      return "updated";
    }
    return "unchanged";
  }

  sync(items) {
    for (const item of items) this.upsert(item);
    const ids = items.map((item) => item.id);
    if (!ids.length) {
      this.connection.prepare(`DELETE FROM ${this.table}`).run();
      return;
    }
    this.connection.prepare(`DELETE FROM ${this.table} WHERE id NOT IN (${ids.map(() => "?").join(", ")})`).run(...ids);
  }
}
