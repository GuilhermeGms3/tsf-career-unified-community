export function createDiscoveryV4Routes({
  store,
  service,
  leadPromotionService,
  evolutionService,
  communityService,
  approvalGateway = { ingest: async () => ({ handled: false }) },
  runtimeCapabilities,
  readJson,
  json,
  sendError,
}) {
  const webhookHits = new Map(),
    webhookLimit = 120,
    webhookWindowMs = 60_000;
  const webhookRuntime = { received: 0, lastReceivedAt: null, lastCompletedAt: null, lastOutcome: null, lastErrorCode: null, lastEvent: null, lastMessageShape: null };
  return async function discoveryV4Routes(req, res, url) {
    try {
      if (
        url.pathname === "/api/discovery-v4/capabilities" &&
        req.method === "GET"
      ) {
        json(res, { ok: true, ...service.capabilities() });
        return true;
      }
      if (url.pathname === "/api/runtime-diagnostics" && req.method === "GET") {
        json(res, { ok: true, ...(await runtimeCapabilities.diagnose()) });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/diagnostics" &&
        req.method === "GET"
      ) {
        const profiles = store.jobHuntProfiles.all(),
          latestRun = store.jobHuntRuns.list()[0] || null,
          activeProfile =
            profiles.find((item) => item.enabled) || profiles[0] || null,
          boards = store.watchlists.boards(),
          companies = store.watchlists.all();
        json(res, {
          ok: true,
          activeProfile,
          activeSearchIntent: activeProfile
            ? store.searchIntents.forProfile(activeProfile.id)
            : null,
          latestRun,
          companyRadar: {
            companies: companies.length,
            activeCompanies: companies.filter((item) => item.active !== false)
              .length,
            boards: boards.length,
            enabledBoards: boards.filter((item) => item.enabled !== false)
              .length,
            providers: Object.fromEntries(
              [...new Set(boards.map((item) => item.provider))].map(
                (provider) => [
                  provider,
                  boards.filter((item) => item.provider === provider).length,
                ],
              ),
            ),
            knownLimitation:
              "A descoberta direta exige uma identidade ATS conhecida ou uma página oficial configurada; não existe enumeração universal de empresas.",
          },
        });
        return true;
      }
      const runDetails = url.pathname.match(
        /^\/api\/discovery-v4\/runs\/([^/]+)$/,
      );
      if (runDetails && req.method === "GET") {
        const run = store.jobHuntRuns.findById(
          decodeURIComponent(runDetails[1]),
        );
        if (!run)
          throw Object.assign(new Error("Execução não encontrada."), {
            status: 404,
            code: "DISCOVERY_RUN_NOT_FOUND",
          });
        json(res, { ok: true, run });
        return true;
      }
      if (url.pathname === "/api/logs" && req.method === "GET") {
        json(res, {
          ok: true,
          retention: { days: 30, maxRows: 5000 },
          logs: store.structuredLogs.list({
            level: url.searchParams.get("level") || "",
            category: url.searchParams.get("category") || "",
            provider: url.searchParams.get("provider") || "",
            runId: url.searchParams.get("runId") || "",
            batchRunId: url.searchParams.get("batchRunId") || "",
            batchItemId: url.searchParams.get("batchItemId") || "",
            jobId: url.searchParams.get("jobId") || "",
            resumeId: url.searchParams.get("resumeId") || "",
            from: url.searchParams.get("from") || "",
            to: url.searchParams.get("to") || "",
            search: url.searchParams.get("search") || "",
            limit: url.searchParams.get("limit") || 100,
          }),
        });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/search/preview" &&
        req.method === "POST"
      ) {
        json(res, { ok: true, preview: service.preview(await readJson(req)) });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/search/test" &&
        req.method === "POST"
      ) {
        json(res, {
          ok: true,
          result: await service.run(await readJson(req), "TEST"),
        });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/search/mass" &&
        req.method === "POST"
      ) {
        json(res, { ok: true, ...service.queueMass(await readJson(req)) }, 202);
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/manual-signals" &&
        req.method === "POST"
      ) {
        json(
          res,
          { ok: true, lead: await (service.captureWithClassification?.bind(service)||service.captureManual.bind(service))(await readJson(req)) },
          201,
        );
        return true;
      }
      if (url.pathname === "/api/discovery-v4/leads" && req.method === "GET") {
        json(res, {
          ok: true,
          leads: store.discoveryV4.listLeads(
            url.searchParams.get("status") || "",
          ),
          signals: store.discoveryV4.listSignals(),
        });
        return true;
      }
      const promotion = url.pathname.match(
        /^\/api\/discovery-v4\/leads\/([^/]+)\/promote$/,
      );
      if (promotion && req.method === "POST") {
        json(res, {
          ok: true,
          ...leadPromotionService.promote(decodeURIComponent(promotion[1])),
        });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/community-sources" &&
        req.method === "GET"
      ) {
        json(res, {
          ok: true,
          sources: store.discoveryV4.listCommunitySources(),
          optIn: true,
        });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/community-sources" &&
        req.method === "PUT"
      ) {
        const body = await readJson(req),
          sources = store.discoveryV4.saveCommunitySources(body.sources || []);
        json(res, { ok: true, sources });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/whatsapp/groups" &&
        req.method === "GET"
      ) {
        json(res, {
          ok: true,
          groups: await evolutionService.listGroups(),
          participantsIncluded: false,
        });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/evolution-webhook" &&
        req.method === "GET"
      ) {
        json(res, {
          ok: true,
          webhook: await evolutionService.webhookStatus(),
          runtime: { ...webhookRuntime },
        });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/evolution-webhook/configure" &&
        req.method === "POST"
      ) {
        json(res, {
          ok: true,
          webhook: await evolutionService.configureInboundWebhook(),
        });
        return true;
      }
      if (
        url.pathname === "/api/discovery-v4/webhooks/evolution" &&
        req.method === "POST"
      ) {
        const now = Date.now(),
          client = String(req.socket?.remoteAddress || "unknown"),
          current = webhookHits.get(client);
        if (!current || now - current.startedAt >= webhookWindowMs)
          webhookHits.set(client, { startedAt: now, count: 1 });
        else if (++current.count > webhookLimit)
          throw Object.assign(
            new Error("Limite temporário do webhook excedido."),
            { code: "COMMUNITY_WEBHOOK_RATE_LIMITED", status: 429 },
          );
        const body = await readJson(req);
        const secret = req.headers["x-career-webhook-secret"] || "";
        approvalGateway.verifySecret?.(secret);
        webhookRuntime.received++;
        webhookRuntime.lastReceivedAt = new Date().toISOString();
        const event = String(body.event || "").toUpperCase().replace(/[.-]/g, "_");
        webhookRuntime.lastEvent = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_SET", "SEND_MESSAGE", "CONNECTION_UPDATE"].includes(event) ? event : "OTHER";
        webhookRuntime.lastMessageShape = { array: Array.isArray(body.data), hasKey: Boolean(body.data?.key), hasMessage: Boolean(body.data?.message), hasText: Boolean(body.data?.message?.conversation || body.data?.message?.extendedTextMessage?.text || body.data?.body || body.data?.text) };
        try {
          const approval = await approvalGateway.ingest(body, secret),
            result = approval.handled ? approval : communityService.ingest(body, secret);
          webhookRuntime.lastCompletedAt = new Date().toISOString();
          webhookRuntime.lastOutcome = result.outcome || (result.handled ? "HANDLED" : "IGNORED");
          webhookRuntime.lastErrorCode = null;
          json(res, { ok: true, ...result }, 202);
        } catch (error) {
          webhookRuntime.lastErrorCode = String(error.code || "WEBHOOK_PROCESSING_FAILED").slice(0, 80);
          throw error;
        }
        return true;
      }
    } catch (error) {
      sendError(res, error, {
        status: error.status || 400,
        code: error.code || "DISCOVERY_V4_FAILED",
        message: error.message,
      });
      return true;
    }
    return false;
  };
}
