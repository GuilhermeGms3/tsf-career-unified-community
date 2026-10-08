import { BaseRepository, parseJson } from "./base-repository.mjs";

export class SearchScheduleRepository extends BaseRepository {
  constructor(connection) {
    super(connection, {
      table: "search_schedules",
      columns: ["id", "name", "enabled", "next_run_at", "last_run_at", "payload_json", "created_at", "updated_at"],
      toRow: (item) => ({ id: item.id, name: item.name || "Monitor", enabled: item.enabled === false ? 0 : 1, next_run_at: item.nextRunAt || null, last_run_at: item.lastRunAt || null, payload_json: JSON.stringify(item), created_at: item.createdAt, updated_at: item.updatedAt }),
      fromRow: (row) => ({ ...parseJson(row.payload_json, {}), id: row.id, name: row.name, enabled: Boolean(row.enabled), nextRunAt: row.next_run_at || "", lastRunAt: row.last_run_at || "", createdAt: row.created_at, updatedAt: row.updated_at })
    });
  }
}
