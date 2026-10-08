export function createAtsRoutes({ recalculationService, readJson, json, sendError }) {
  return async function atsRoutes(req, res, url) {
    if (url.pathname !== "/api/ats/recalculate" || req.method !== "POST") return false;
    try {
      const input = await readJson(req);
      json(res, { ok: true, report: await recalculationService.run({ limit: input.limit }) });
    } catch (error) {
      sendError(res, error, { status: error.status || 400, code: error.code || "ATS_RECALCULATION_FAILED", message: error.message });
    }
    return true;
  };
}
