const integer = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

export const DEFAULT_DISCOVERY_TIMEOUT_POLICY = Object.freeze({
  portalDeadlineMs: 30_000,
  engineDeadlineMs: 70_000,
  transportDeadlineMs: 85_000,
});

export function discoveryTimeoutPolicy(environment = process.env) {
  const policy = Object.freeze({
    portalDeadlineMs: integer(
      environment.DISCOVERY_PORTAL_DEADLINE_MS,
      DEFAULT_DISCOVERY_TIMEOUT_POLICY.portalDeadlineMs,
    ),
    engineDeadlineMs: integer(
      environment.DISCOVERY_ENGINE_DEADLINE_MS,
      DEFAULT_DISCOVERY_TIMEOUT_POLICY.engineDeadlineMs,
    ),
    transportDeadlineMs: integer(
      environment.DISCOVERY_TRANSPORT_DEADLINE_MS,
      DEFAULT_DISCOVERY_TIMEOUT_POLICY.transportDeadlineMs,
    ),
  });
  validateDiscoveryTimeoutPolicy(policy);
  return policy;
}

export function validateDiscoveryTimeoutPolicy(policy) {
  const { portalDeadlineMs, engineDeadlineMs, transportDeadlineMs } = policy;
  if (
    !Number.isInteger(portalDeadlineMs) ||
    !Number.isInteger(engineDeadlineMs) ||
    !Number.isInteger(transportDeadlineMs) ||
    portalDeadlineMs < 1_000 ||
    portalDeadlineMs >= engineDeadlineMs ||
    engineDeadlineMs >= transportDeadlineMs
  ) {
    throw Object.assign(
      new Error(
        "Discovery deadlines inválidos: portalDeadlineMs < engineDeadlineMs < transportDeadlineMs é obrigatório.",
      ),
      { code: "DISCOVERY_TIMEOUT_POLICY_INVALID" },
    );
  }
  return policy;
}
