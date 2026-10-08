export function createQualityLabRoutes({ service, readJson, json, sendError }) {
  return async function qualityLabRoutes(req, res, url) {
    if (url.pathname === "/api/quality-lab" && req.method === "GET") {
      try { json(res, { ok: true, ...(await service.list()) }); }
      catch (error) { sendError(res, error, { status: 500, code: error.code || "QUALITY_LAB_READ_FAILED", message: error.message }); }
      return true;
    }
    const match = url.pathname.match(/^\/api\/quality-lab\/([^/]+)\/label$/);
    if (!match || req.method !== "PUT") return false;
    try { json(res, { ok: true, label: await service.save(decodeURIComponent(match[1]), await readJson(req)) }); }
    catch (error) { sendError(res, error, { status: error.status || 400, code: error.code || "QUALITY_LABEL_SAVE_FAILED", message: error.message }); }
    return true;
  };
}
