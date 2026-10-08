import { BaseRepository, parseJson } from "./base-repository.mjs";

export class AlertRepository extends BaseRepository {
  constructor(connection) {
    super(connection, {
      table: "alerts",
      columns: ["id", "schedule_id", "job_id", "title", "is_read", "payload_json", "created_at"],
      toRow: (item) => ({ id: item.id, schedule_id: item.scheduleId || null, job_id: item.jobId || null, title: item.title || "Nova oportunidade", is_read: item.readAt || item.read ? 1 : 0, payload_json: JSON.stringify(item), created_at: item.createdAt }),
      fromRow: (row) => ({ ...parseJson(row.payload_json, {}), id: row.id, scheduleId: row.schedule_id || "", jobId: row.job_id || "", title: row.title, read: Boolean(row.is_read), createdAt: row.created_at })
    });
  }
}
