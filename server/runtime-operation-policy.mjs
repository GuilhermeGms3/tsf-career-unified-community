const sessionAction = /^\/api\/(?:vaults\/[a-z0-9-]+\/(?:connect|create|check|disconnect)|connections\/gupy\/(?:connect|check|disconnect)|connections\/handoff\/source-auth-[a-f0-9-]{36}\/(?:claim|event|complete))$/;

export function runtimeOperationPolicy(env = process.env) {
  const mode = String(env.CAREER_OPERATION_MODE || "normal");
  if (!["normal", "maintenance", "manual"].includes(mode))
    throw Object.assign(new Error("Modo operacional invalido."), {code:"RUNTIME_MODE_INVALID"});
  const maintenance = mode === "maintenance";
  const manual = mode === "manual";
  if (maintenance && String(env.CAREER_SUBMISSION_ENABLED).toLowerCase() !== "false")
    throw Object.assign(new Error("Manutencao exige CAREER_SUBMISSION_ENABLED=false."), {code:"MAINTENANCE_SUBMISSION_FLAG_REQUIRED"});
  return Object.freeze({
    mode, maintenance, manual, backgroundEnabled: mode === "normal",
    workersEnabled: !maintenance,
    queueSince: manual ? new Date().toISOString() : "",
    allowRequest(method, pathname) {
      if (mode === "normal") return true;
      if (["GET", "HEAD", "OPTIONS"].includes(method))
        return pathname !== "/api/intelligence/skill-gaps" && pathname !== "/api/preparation/library";
      return method === "POST" && sessionAction.test(pathname);
    },
  });
}
