const checkedAt = () => new Date().toISOString();
async function probe(url, { timeoutMs = 2000 } = {}) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { online: response.ok, httpStatus: response.status };
  } catch (error) {
    return {
      online: false,
      errorCode: error.name === "TimeoutError" ? "TIMEOUT" : "OFFLINE",
    };
  }
}
export class RuntimeCapabilityService {
  constructor({
    discoveryV4,
    evolutionService,
    providerTestService,
    intelligenceStatus,
    careerEngineUrl,
    n8nUrl = process.env.N8N_INTERNAL_URL || "http://127.0.0.1:5678",
    integrationSettings,
  } = {}) {
    Object.assign(this, {
      discoveryV4,
      evolutionService,
      providerTestService,
      intelligenceStatus,
      careerEngineUrl,
      n8nUrl,
      integrationSettings,
    });
  }
  async diagnose() {
    const statePromise =
      typeof this.evolutionService.connectionState === "function"
        ? this.evolutionService
            .connectionState()
            .catch((error) => ({
              connectionState: "ERROR",
              errorCode: error.code || "EVOLUTION_STATE_FAILED",
            }))
        : Promise.resolve({
            connectionState: "UNKNOWN",
            instanceExists: false,
          });
    const [engine, n8n, evolution, intelligence, evolutionWebhook, whatsappState] =
        await Promise.all([
          probe(`${this.careerEngineUrl}/health`),
          probe(`${String(this.n8nUrl).replace(/\/$/, "")}/healthz`),
          probe(this.evolutionService.client.baseUrl),
          this.intelligenceStatus(),
          this.evolutionService.webhookStatus(),
          statePromise,
        ]),
      settings = this.integrationSettings.get(),
      capabilities = this.discoveryV4.capabilities(),
      providers = this.providerTestService.list(),
      evolutionConfigured = Boolean(
        this.evolutionService.publicConfiguration().configured,
      ),
      connected = whatsappState.connectionState === "CONNECTED",
      n8nHmacConfigured = Boolean(
        settings?.secretEnvName && process.env[settings.secretEnvName],
      ),
      workflowTargetConfigured = Boolean(settings?.webhookUrl),
      workflowEnabled = Boolean(settings?.enabled),
      targetConfigured = Boolean(
        this.evolutionService.publicConfiguration().targetConfigured,
      );
    return {
      checkedAt: checkedAt(),
      components: {
        discovery: {
          status: "ONLINE",
          sourceClasses: capabilities.sourceClasses,
        },
        careerEngine: {
          status: engine.online ? "ONLINE" : "OFFLINE",
          ...engine,
        },
        ollama: {
          status: intelligence.status || intelligence.providerHealth?.status || "UNKNOWN",
          provider: intelligence.provider || intelligence.settings?.provider || "ollama",
          configured: Boolean(intelligence.settings || intelligence.providerHealth),
          hardwareProfile:
            intelligence.hardware?.memoryProfile ||
            intelligence.hardware?.profile ||
            intelligence.settings?.hardwareProfile ||
            "UNKNOWN",
          contextBudget: intelligence.contextBudget || intelligence.settings?.contextBudget || null,
          concurrency:
            (intelligence.hardware?.memoryProfile || intelligence.hardware?.profile || intelligence.settings?.hardwareProfile) ===
            "LOW_VRAM"
              ? 1
              : null,
          optional: true,
        },
        n8n: {
          status:
            n8n.online &&
            workflowTargetConfigured &&
            workflowEnabled &&
            n8nHmacConfigured
              ? "ONLINE_CONFIGURED"
              : n8n.online
                ? "ONLINE_CONFIG_INCOMPLETE"
                : "OFFLINE",
          ...n8n,
          containerOnline: n8n.online,
          workflowBundled: true,
          workflowExists: "UNKNOWN",
          workflowActive: workflowEnabled ? "DECLARED_BY_HUB" : "NOT_CONFIRMED",
          webhookTargetConfigured: workflowTargetConfigured,
          hmacConfigured: n8nHmacConfigured,
          evolutionOutboundReady: connected && targetConfigured,
        },
        evolution: {
          status: evolution.online ? "ONLINE" : "OFFLINE",
          ...evolution,
          webhook: evolutionWebhook,
        },
        whatsapp: {
          status: connected
            ? "CONNECTED"
            : whatsappState.instanceExists === false
              ? "PAIRING_REQUIRED"
              : "DISCONNECTED",
          connectionState: whatsappState.connectionState,
          inboundWebhookStatus: evolutionWebhook.status,
          webhookSecretConfigured: evolutionWebhook.secretConfigured,
          outboundReady: connected && targetConfigured,
          inboundReady: connected && evolutionWebhook.status === "CONFIGURED",
        },
        publicWeb: {
          status:
            capabilities.sourceClasses.find(
              (item) => item.sourceClass === "PUBLIC_WEB",
            )?.status || "UNKNOWN",
        },
        providers: {
          status: providers.some((item) => item.setupStatus === "READY")
            ? "PARTIAL_OR_READY"
            : "CONFIG_REQUIRED",
          items: providers.map((item) => ({
            providerId: item.providerId,
            setupStatus: item.setupStatus,
          })),
        },
      },
    };
  }
}
