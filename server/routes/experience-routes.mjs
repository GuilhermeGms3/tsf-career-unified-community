export function createExperienceRoutes({
  experienceService,
  profileProvider,
  readJson,
  json,
  sendError,
}) {
  return async function experienceRoutes(req, res, url) {
    try {
      const opportunity = url.pathname.match(
        /^\/api\/opportunities\/([^/]+)\/workspace$/,
      );
      if (opportunity && req.method === "GET") {
        const workspace = await experienceService.opportunityWorkspace(
          decodeURIComponent(opportunity[1]),
          { resumeId: String(url.searchParams.get("resumeId") || "").slice(0, 200) },
        );
        json(
          res,
          workspace
            ? { ok: true, workspace }
            : {
                ok: false,
                code: "JOB_NOT_FOUND",
                error: "Oportunidade não encontrada.",
              },
          workspace ? 200 : 404,
        );
        return true;
      }
      if (
        url.pathname === "/api/experience/applications" &&
        req.method === "GET"
      ) {
        const applications = experienceService.applications();
        json(res, {
          ok: true,
          applications,
          funnel: experienceService.applicationFunnel(applications),
        });
        return true;
      }
      if (
        url.pathname === "/api/experience/application-capabilities" &&
        req.method === "GET"
      ) {
        json(res, {
          ok: true,
          capabilities: experienceService.applicationCapabilities(),
        });
        return true;
      }
      const application = url.pathname.match(
        /^\/api\/experience\/applications\/([^/]+)$/,
      );
      if (application && req.method === "GET") {
        const workspace = experienceService.applicationWorkspace(
          decodeURIComponent(application[1]),
          await profileProvider(),
        );
        json(
          res,
          workspace
            ? { ok: true, workspace }
            : {
                ok: false,
                code: "APPLICATION_NOT_FOUND",
                error: "Candidatura não encontrada.",
              },
          workspace ? 200 : 404,
        );
        return true;
      }
      const applicationAction = url.pathname.match(
        /^\/api\/experience\/applications\/([^/]+)\/actions$/,
      );
      if (applicationAction && req.method === "POST") {
        const result = experienceService.recordApplicationAction(
          decodeURIComponent(applicationAction[1]),
          await readJson(req),
        );
        json(res, { ok: true, ...result }, 201);
        return true;
      }
      if (url.pathname === "/api/experience/resumes" && req.method === "GET") {
        json(res, {
          ok: true,
          resumes: experienceService.resumes(),
          defaultResumeId: experienceService.defaultResumeId(),
        });
        return true;
      }
      if (
        url.pathname === "/api/experience/resumes/default" &&
        req.method === "POST"
      ) {
        const input = await readJson(req);
        const result = experienceService.setDefaultResumeId(
          String(input.resumeId || "").slice(0, 200),
        );
        json(res, { ok: true, ...result });
        return true;
      }
    } catch (error) {
      sendError(res, error, {
        status: error.status || 400,
        code: error.code || "EXPERIENCE_READ_MODEL_FAILED",
        message: error.message,
      });
      return true;
    }
    return false;
  };
}
