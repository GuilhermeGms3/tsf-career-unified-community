import { requireLocalJsonMutation } from "../local-mutation-guard.mjs";

export function createSubmitHomologationRoutes({ service, readJson, json, sendError }) {
  return async function submitHomologationRoutes(req, res, url) {
    const approve = url.pathname.match(/^\/api\/applications\/([^/]+)\/submit-homologation$/);
    const revoke = url.pathname.match(/^\/api\/submit-homologations\/([^/]+)\/revoke$/);
    if (!(url.pathname === "/api/submit-homologations" && req.method === "GET") && !((approve || revoke) && req.method === "POST")) return false;
    try {
      if (!approve && !revoke) {
        json(res, { ok: true, items: service.list({ provider: url.searchParams.get("provider") || "" }) });
        return true;
      }
      requireLocalJsonMutation(req, url);
      const input = await readJson(req);
      if (approve) {
        const result = service.approve(decodeURIComponent(approve[1]), { externalConfirmation: String(input.externalConfirmation || ""), validDays: input.validDays === undefined ? 30 : Number(input.validDays) });
        json(res, { ok: true, ...result }, result.reused ? 200 : 201);
      } else {
        json(res, { ok: true, homologation: service.revoke(decodeURIComponent(revoke[1]), { reason: String(input.reason || "") }) });
      }
    } catch (error) {
      sendError(res, error, { status: error.status || 400, code: error.code || "SUBMIT_HOMOLOGATION_FAILED", message: error.message });
    }
    return true;
  };
}
