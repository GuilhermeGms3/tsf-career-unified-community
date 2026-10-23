import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { AppError } from "../errors.mjs";
import { readJsonBody, sendError, sendJson } from "../http-json.mjs";
import { authenticateMobileRequest } from "./mobile-auth.mjs";
import { MobileIdempotencyStore } from "./mobile-idempotency.mjs";
import { resolveAutomationEntryUrl } from "../../src/automation/automation-validation.mjs";
import { radarOptions, mobileSearchInput, MOBILE_SEARCH_PROFILE, applicationRecovery } from './mobile-radar.mjs';
import {
  projectHunt,
  projectOpportunity,
  projectToday,
  projectNextAction,
  mobileApplicationActions,
} from "./mobile-projections.mjs";

const JSON_LIMIT = 32 * 1024;
const FEEDBACK_DECISIONS = new Set(["APPLY", "REVIEW", "REJECT"]);

export function mobileApplicationPortalUrl(value) {
  try {
    const resolved = resolveAutomationEntryUrl(value), parsed = new URL(resolved);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? resolved : "";
  } catch { return ""; }
}

const json = (res, body, status = 200) => {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  sendJson(res, body, status);
};

const error = (res, caught, fallback = {}) => {
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  sendError(res, caught, {
    status: caught.status || fallback.status || 400,
    code: caught.code || fallback.code || "MOBILE_GATEWAY_REQUEST_FAILED",
    message: fallback.message || caught.message,
  });
};

async function action(store, req, identity, name, execute) {
  const key = store.key(req);
  let claim;
  try {
    claim = store.claim(key, { action: name, userLogin: identity.login });
  } catch (caught) {
    req.resume();
    throw caught;
  }
  if (!claim.owned) {
    req.resume();
    return { ...claim, replayed: true };
  }
  try {
    const { body, status = 200 } = await execute();
    store.complete(key, {
      action: name,
      userLogin: identity.login,
      status,
      body,
    });
    return { body, status, replayed: false };
  } catch (caught) {
    store.release(key, { action: name, userLogin: identity.login });
    throw caught;
  }
}

export function createMobileGateway({
  config,
  readOnly = false,
  operationMode = readOnly ? "maintenance" : "normal",
  sourceReadiness = async () => [],
  store,
  jobHuntService,
  decisionInbox,
  opportunityService,
  experienceService,
  applicationActions = {},
  eventBus = null,
  logger = console,
} = {}) {
  const idempotency = new MobileIdempotencyStore(store.database.connection);
  const profiles = () => jobHuntService.listProfiles();
  const hunt = (run) => projectHunt(run, profiles());
  const subscribers = new Set();
  const publish = (event) => {
    const payload = `event: invalidate\ndata: ${JSON.stringify({ id: event.id, type: event.type, timestamp: event.timestamp })}\n\n`;
    for (const response of subscribers) response.write(payload);
  };
  const eventTypes = ["JOB_HUNT_STARTED", "JOB_HUNT_COMPLETED", "JOB_HUNT_FAILED", "APPLICATION_WAITING_USER", "APPLICATION_READY_TO_SUBMIT", "RESUME_TAILORING_REVIEW_REQUIRED", "RESUME_RENDER_READY"];
  const unsubscribe = eventBus ? eventTypes.map((type) => eventBus.on(type, publish)) : [];

  const server = createServer(async (req, res) => {
    const requestId = `mobile-${randomUUID()}`;
    res.setHeader("x-request-id", requestId);
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (!url.pathname.startsWith("/api/mobile/v1/")) {
      json(res, { ok: false, code: "NOT_FOUND", error: "Rota não encontrada." }, 404);
      return;
    }

    try {
      const identity = authenticateMobileRequest(req, config);
      if (readOnly && req.method !== "GET")
        throw new AppError("Servidor em manutencao: consultas disponiveis; acoes e envios permanecem pausados.", {
          status: 423, code: "MAINTENANCE_MODE",
        });
      if (url.pathname === "/api/mobile/v1/health" && req.method === "GET") {
        json(res, {
          ok: true,
          service: "tsf-career-mobile-gateway",
          apiVersion: 1,
          readOnly,
          operationMode,
          serverTime: new Date().toISOString(),
          identity: { login: identity.login, displayName: identity.displayName },
        });
        return;
      }

      if (url.pathname === "/api/mobile/v1/events" && req.method === "GET") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.write(`event: connected\ndata: ${JSON.stringify({ serverTime: new Date().toISOString() })}\n\n`);
        subscribers.add(res);
        const heartbeat = setInterval(() => res.write(`event: invalidate\ndata: ${JSON.stringify({ type: "SYNC_TICK", timestamp: new Date().toISOString() })}\n\n`), 15_000);
        heartbeat.unref?.();
        req.on("close", () => { clearInterval(heartbeat); subscribers.delete(res); });
        return;
      }

      if (url.pathname === "/api/mobile/v1/today" && req.method === "GET") {
        const active = store.jobHuntRuns.active()[0] || null;
        json(res, {
          ok: true,
          today: projectToday(
            readOnly ? store.dailyInboxSnapshots?.get?.()?.inbox || {} : await decisionInbox.read({ fresh: url.searchParams.get("fresh") === "true" }),
            hunt(active),
          ),
        });
        return;
      }

      if (url.pathname === "/api/mobile/v1/opportunities" && req.method === "GET") {
        const page = await opportunityService.page({
          section: String(url.searchParams.get("section") || "recommended").slice(0, 40),
          offset: Number(url.searchParams.get("offset") || 0),
          limit: Math.min(50, Number(url.searchParams.get("limit") || 20)),
          query: String(url.searchParams.get("query") || "").slice(0, 120),
        });
        json(res, {
          ok: true,
          opportunities: page.opportunities.map(projectOpportunity),
          pagination: page.pagination,
        });
        return;
      }

      const opportunity = url.pathname.match(
        /^\/api\/mobile\/v1\/opportunities\/([^/]+)$/,
      );
      if (opportunity && req.method === "GET") {
        const workspace = await experienceService.opportunityWorkspace(
          decodeURIComponent(opportunity[1]),
        );
        if (!workspace)
          throw new AppError("Oportunidade não encontrada.", {
            status: 404,
            code: "JOB_NOT_FOUND",
          });
        json(res, {
          ok: true,
          opportunity: {
            ...projectOpportunity(workspace),
            description: String(workspace.job?.description || "").slice(0, 12_000),
            requirements: (workspace.requirements || []).slice(0, 80).map((item) => ({
              id: String(item.id || ""),
              name: String(item.name || item.normalizedName || item.text || "").slice(0, 240),
              required: item.required !== false,
              status: String(item.status || ""),
            })),
            nextAction: workspace.nextAction || null,
            resume: workspace.resumeVersion
              ? {
                  id: workspace.resumeVersion.id,
                  status: workspace.resumeVersion.status,
                  templateId: workspace.resumeVersion.templateId,
                }
              : null,
          },
        });
        return;
      }

      const feedback = url.pathname.match(
        /^\/api\/mobile\/v1\/opportunities\/([^/]+)\/feedback$/,
      );
      if (feedback && req.method === "PUT") {
        const result = await action(
          idempotency,
          req,
          identity,
          `opportunity-feedback:${decodeURIComponent(feedback[1])}`,
          async () => {
            const input = await readJsonBody(req, { limit: JSON_LIMIT });
            const userDecision = String(input.userDecision || "").toUpperCase();
            if (!FEEDBACK_DECISIONS.has(userDecision))
              throw new AppError("Decisão de oportunidade inválida.", {
                status: 400,
                code: "OPPORTUNITY_DECISION_INVALID",
              });
            const jobId = decodeURIComponent(feedback[1]);
            if (!store.jobs.findById(jobId))
              throw new AppError("Oportunidade não encontrada.", {
                status: 404,
                code: "JOB_NOT_FOUND",
              });
            const saved = store.jobFeedback.save(jobId, {
              userDecision,
              rejectionReason: String(input.rejectionReason || "").slice(0, 500),
            });
            opportunityService.invalidate();
            decisionInbox.scheduleRebuild?.();
            return { body: { ok: true, feedback: saved } };
          },
        );
        if (result.replayed) res.setHeader("idempotent-replayed", "true");
        json(res, result.body, result.status);
        return;
      }

      if (url.pathname === "/api/mobile/v1/hunts" && req.method === "GET") {
        const limit = Math.min(30, Math.max(1, Number(url.searchParams.get("limit") || 12)));
        json(res, {
          ok: true,
          active: store.jobHuntRuns.active().map(hunt),
          history: store.jobHuntRuns.list().slice(0, limit).map(hunt),
          profiles: profiles().map((profile) => ({
            id: profile.id,
            name: profile.name,
            enabled: profile.enabled,
            nextRunAt: profile.nextRunAt,
          })),
          ...radarOptions(profiles(),await sourceReadiness()),
          operationMode,
        });
        return;
      }

      if (url.pathname === "/api/mobile/v1/hunts" && req.method === "POST") {
        const result = await action(idempotency, req, identity, "hunt-start", async () => {
          const input = await readJsonBody(req, { limit: JSON_LIMIT });
          const available = profiles();
          if(input.search!==undefined){
            if(store.jobHuntRuns.active().some(run=>run.profileId===MOBILE_SEARCH_PROFILE))throw new AppError('Sua busca no celular já está em andamento. Aguarde ou pause antes de mudar os critérios.',{status:409,code:'JOB_HUNT_ALREADY_RUNNING'});
            const existing=available.find(p=>p.id===MOBILE_SEARCH_PROFILE)||available.find(p=>p.enabled)||available[0]||{};
            const criteria=mobileSearchInput(input.search,existing);
            const run=jobHuntService.queueManual(criteria,{profileId:MOBILE_SEARCH_PROFILE});
            return {body:{ok:true,hunt:hunt(run)},status:202};
          }
          if(input.profileId&&!available.some(item=>item.id===input.profileId))throw new AppError('Perfil de busca não encontrado. Atualize o Radar.',{status:404,code:'JOB_HUNT_PROFILE_NOT_FOUND'});
          const profile = available.find((item) => item.id === input.profileId) ||
            available.find((item) => item.enabled) || available[0];
          if (!profile)
            throw new AppError("Crie um perfil de busca antes de iniciar o radar.", {
              status: 409,
              code: "JOB_HUNT_PROFILE_REQUIRED",
            });
          const run = jobHuntService.queue(profile.id, { triggerType: "MOBILE" });
          return { body: { ok: true, hunt: hunt(run) }, status: 202 };
        });
        if (result.replayed) res.setHeader("idempotent-replayed", "true");
        json(res, result.body, result.status);
        return;
      }

      const huntRoute = url.pathname.match(
        /^\/api\/mobile\/v1\/hunts\/([^/]+)(?:\/(pause))?$/,
      );
      if (huntRoute && req.method === "GET" && !huntRoute[2]) {
        const run = store.jobHuntRuns.findById(decodeURIComponent(huntRoute[1]));
        if (!run)
          throw new AppError("Execução não encontrada.", {
            status: 404,
            code: "JOB_HUNT_RUN_NOT_FOUND",
          });
        json(res, { ok: true, hunt: hunt(run) });
        return;
      }
      if (huntRoute && req.method === "POST" && huntRoute[2] === "pause") {
        const runId = decodeURIComponent(huntRoute[1]);
        const result = await action(
          idempotency,
          req,
          identity,
          `hunt-pause:${runId}`,
          async () => ({
            body: { ok: true, hunt: hunt(jobHuntService.pause(runId)) },
          }),
        );
        if (result.replayed) res.setHeader("idempotent-replayed", "true");
        json(res, result.body, result.status);
        return;
      }

      if (url.pathname === "/api/mobile/v1/applications" && req.method === "GET") {
        const applications = experienceService.applications().slice(0, 100).map((item) => ({
          id: item.application.id,
          status: item.application.status,
          updatedAt: item.application.updatedAt,
          title: String(item.job?.title || "Candidatura").slice(0, 180),
          company: String(item.job?.company || "").slice(0, 140),
          pendingQuestions: item.pendingQuestions,
          nextAction: projectNextAction(item.nextAction),
        }));
        json(res, { ok: true, applications });
        return;
      }

      if (url.pathname === "/api/mobile/v1/decisions" && req.method === "GET") {
        const decisions = experienceService.applications().slice(0, 100).map((item) => {
          const questions = store.applicationQuestions.forApplication(item.application.id).filter((question) => question.answerStatus === "USER_REQUIRED");
          const artifacts = item.application.resumeVersionId ? store.resumeArtifacts.forVersion(item.application.resumeVersionId) : [];
          const version = item.application.resumeVersionId ? store.resumeVersions.findById(item.application.resumeVersionId) : null;
          return ({
          id: item.application.id,
          kind: item.pendingQuestions > 0 ? "QUESTION" : item.application.status === "WAITING_USER" ? "HANDOFF" : "APPLICATION",
          status: item.application.status,
          updatedAt: item.application.updatedAt,
          title: String(item.job?.title || "Candidatura").slice(0, 180),
          company: String(item.job?.company || "").slice(0, 140),
          score: item.analysis?.overallScore ?? version?.atsAfter?.overallScore ?? store.applicationPlans?.forApplication(item.application.id)?.matchScore ?? null,
          pendingQuestions: item.pendingQuestions,
          nextAction: projectNextAction(item.nextAction),
          resumeVersionId: item.application.resumeVersionId || "",
          resumePdfAvailable: artifacts.some((artifact) => artifact.artifactType === "PDF" && artifact.status === "READY"),
          questions: questions.slice(0, 10).map((question) => ({ id: question.id, fingerprint:String(question.fingerprint||""), label: String(question.label || "Pergunta do formulário").slice(0, 500), required: question.required !== false, options: (question.options || []).slice(0, 20).map((option) => String(option.label || option.value || option).slice(0, 200)) })),
          actions: mobileApplicationActions(item.application.status),
        });});
        json(res, { ok: true, decisions });
        return;
      }

      const applicationRoute = url.pathname.match(/^\/api\/mobile\/v1\/applications\/([^/]+)(?:\/(actions|questions))?$/);
      if (applicationRoute && req.method === "GET" && !applicationRoute[2]) {
        const applicationId = decodeURIComponent(applicationRoute[1]);
        const item = experienceService.applications().find((entry) => entry.application.id === applicationId);
        if (!item) throw new AppError("Candidatura não encontrada.", { status: 404, code: "APPLICATION_NOT_FOUND" });
        const artifacts = item.application.resumeVersionId ? store.resumeArtifacts.forVersion(item.application.resumeVersionId) : [];
        const version = item.application.resumeVersionId ? store.resumeVersions.findById(item.application.resumeVersionId) : null;
        const portalUrl = mobileApplicationPortalUrl(item.job?.applicationUrl || item.job?.canonicalUrl || item.job?.url);
        json(res, { ok: true, application: {
          id: item.application.id,
          jobId: item.job?.id || "",
          portalUrl,
          recovery:applicationRecovery(store,applicationId),
          status: item.application.status,
          title: String(item.job?.title || "Candidatura").slice(0, 180),
          company: String(item.job?.company || "").slice(0, 140),
          score: item.analysis?.overallScore ?? version?.atsAfter?.overallScore ?? store.applicationPlans?.forApplication(item.application.id)?.matchScore ?? null,
          nextAction: projectNextAction(item.nextAction),
          resumeVersionId: item.application.resumeVersionId || "",
          resumePdfAvailable: artifacts.some((artifact) => artifact.artifactType === "PDF" && artifact.status === "READY"),
          questions: store.applicationQuestions.forApplication(applicationId).filter((question) => question.answerStatus === "USER_REQUIRED").map((question) => ({ id: question.id, fingerprint:String(question.fingerprint||""), label: String(question.label || "Pergunta do formulário").slice(0, 500), required: question.required !== false, options: (question.options || []).slice(0, 20) })),
          events: store.applications.events(applicationId).slice(-30).map((event) => ({ type: event.eventType, at: event.createdAt })),
        } });
        return;
      }
      if (applicationRoute && req.method === "POST" && applicationRoute[2] === "actions") {
        const applicationId = decodeURIComponent(applicationRoute[1]);
        const result = await action(idempotency, req, identity, `application-action:${applicationId}`, async () => {
          const input = await readJsonBody(req, { limit: JSON_LIMIT });
          const name = String(input.action || "").toUpperCase();
          if (!["APPROVE", "ANALYZE", "REQUEST_CHANGE", "REJECT", "RESUME"].includes(name)) throw new AppError("Ação de candidatura inválida.", { status: 400, code: "APPLICATION_ACTION_INVALID" });
          const handler = applicationActions[name.toLowerCase()];
          if (typeof handler !== "function") throw new AppError("Ação ainda não configurada no servidor.", { status: 503, code: "APPLICATION_ACTION_NOT_CONFIGURED" });
          return { body: { ok: true, result: await handler({ applicationId, instruction: String(input.instruction || "").slice(0, 800), resumeVersionId:String(input.resumeVersionId||""), idempotencyKey:String(req.headers["idempotency-key"]||""), identity }) }, status: name === "APPROVE" || name === "RESUME" ? 202 : 200 };
        });
        if (result.replayed) res.setHeader("idempotent-replayed", "true");
        json(res, result.body, result.status);
        return;
      }
      if (applicationRoute && req.method === "POST" && applicationRoute[2] === "questions") {
        const applicationId = decodeURIComponent(applicationRoute[1]);
        const result = await action(idempotency, req, identity, `application-question:${applicationId}`, async () => {
          const input = await readJsonBody(req, { limit: JSON_LIMIT });
          const questionId = String(input.questionId || ""), answer = input.answer;
          if (!questionId || answer === undefined || JSON.stringify(answer).length > 10_000) throw new AppError("Resposta inválida.", { status: 400, code: "APPLICATION_ANSWER_INVALID" });
          if (typeof applicationActions.answer !== "function") throw new AppError("Resposta de formulário não configurada.", { status: 503, code: "APPLICATION_ANSWER_NOT_CONFIGURED" });
          return { body: { ok: true, result: await applicationActions.answer({ applicationId, questionId, answer, resumeVersionId:String(input.resumeVersionId||""), fingerprint:String(input.fingerprint||""), idempotencyKey:String(req.headers["idempotency-key"]||""), identity }) } };
        });
        if (result.replayed) res.setHeader("idempotent-replayed", "true");
        json(res, result.body, result.status);
        return;
      }

      const resumePdfRoute = url.pathname.match(/^\/api\/mobile\/v1\/applications\/([^/]+)\/resume\.pdf$/);
      if (resumePdfRoute && req.method === "GET") {
        const applicationId = decodeURIComponent(resumePdfRoute[1]), application = store.applications.findById(applicationId);
        if (!application?.resumeVersionId) throw new AppError("Currículo da candidatura não encontrado.", { status: 404, code: "APPLICATION_RESUME_NOT_FOUND" });
        const artifact = store.resumeArtifacts.forVersion(application.resumeVersionId).find((item) => item.artifactType === "PDF" && item.status === "READY");
        if (!artifact) throw new AppError("PDF pronto não encontrado.", { status: 404, code: "APPLICATION_RESUME_PDF_NOT_FOUND" });
        const version = store.resumeVersions.findById(application.resumeVersionId);
        if (!version) throw new AppError("Versão do currículo não encontrada.", { status: 404, code: "APPLICATION_RESUME_VERSION_NOT_FOUND" });
        const data = await store.resumeArtifactService.readAllowed(artifact, version.resumeId);
        if (data.length > 10 * 1024 * 1024) throw new AppError("PDF excede o limite móvel.", { status: 413, code: "APPLICATION_RESUME_PDF_TOO_LARGE" });
        res.writeHead(200, { "content-type": "application/pdf", "content-length": data.length, "content-disposition": `inline; filename="curriculo-${applicationId.replace(/[^a-zA-Z0-9_-]/g, "")}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" });
        res.end(data);
        return;
      }

      json(res, { ok: false, code: "NOT_FOUND", error: "Rota não encontrada." }, 404);
    } catch (caught) {
      logger.warn?.("Mobile gateway request failed", {
        requestId,
        code: caught.code || "MOBILE_GATEWAY_REQUEST_FAILED",
        method: req.method,
        path: url.pathname,
      });
      error(res, caught);
    }
  });

  server.on("close", () => { for (const stop of unsubscribe) stop(); for (const response of subscribers) response.end(); subscribers.clear(); });

  return server;
}
