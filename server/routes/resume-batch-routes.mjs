export function createResumeBatchRoutes({ service, exportService, readJson, json, binary, sendError }) {
  return async function resumeBatchRoutes(req, res, url) {
    if (!url.pathname.startsWith("/api/resume-batches")) return false;
    try {
      if (url.pathname === "/api/resume-batches" && req.method === "GET") { json(res, { ok: true, batches: service.list() }); return true; }
      if (url.pathname === "/api/resume-batches" && req.method === "POST") { json(res, { ok: true, batch: service.create(await readJson(req)) }, 201); return true; }
      const route = url.pathname.match(/^\/api\/resume-batches\/([^/]+)(?:\/(compare|selections|tailor|approve|render|retry|cancel|export))?$/);
      if (!route) return false;
      const id = decodeURIComponent(route[1]), action = route[2] || "";
      if (req.method === "GET" && !action) { json(res, { ok: true, batch: service.get(id) }); return true; }
      if (req.method === "GET" && action === "export") { const output = await exportService.build(id); binary(res, output.data, "application/zip", output.fileName); return true; }
      if (req.method !== "POST" || !["compare", "selections", "tailor", "approve", "render", "retry", "cancel"].includes(action)) return false;
      const input = action === "cancel" || action === "compare" ? {} : await readJson(req), batch = action === "compare" ? service.compare(id) : action === "selections" ? service.select(id, input.selections) : action === "tailor" ? service.tailor(id, input.itemIds) : action === "approve" ? service.approve(id, input) : action === "render" ? service.render(id, input.itemIds) : action === "retry" ? service.retry(id, input.itemIds) : service.cancel(id);
      json(res, { ok: true, batch }, 202); return true;
    } catch (error) { sendError(res, error, { status: error.status || 400, code: error.code || "RESUME_BATCH_ACTION_FAILED", message: error.message }); return true; }
  };
}
