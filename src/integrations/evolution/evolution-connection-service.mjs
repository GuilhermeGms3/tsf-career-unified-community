const stateMap = {
  open: "CONNECTED",
  connected: "CONNECTED",
  connecting: "CONNECTING",
  close: "DISCONNECTED",
  closed: "DISCONNECTED",
  disconnected: "DISCONNECTED",
  qrcode: "PAIRING_REQUIRED",
  pairing: "PAIRING_REQUIRED",
  created: "PAIRING_REQUIRED",
};
const instanceName = (value) => {
  const result = String(value || "career-unified").trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(result))
    throw Object.assign(new Error("Nome de instância inválido."), {
      code: "EVOLUTION_INSTANCE_INVALID",
    });
  return result;
};
export const maskPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "Não configurado";
  return `${digits.length > 10 ? "+" + digits.slice(0, 2) + " " : ""}** *****-${digits.slice(-4)}`;
};

export class EvolutionConnectionService {
  constructor({
    client,
    metadata = null,
    instance = process.env.EVOLUTION_INSTANCE_NAME || "career-unified",
    target = process.env.CAREER_WHATSAPP_TARGET || "",
    webhookSecret = process.env.CAREER_EVOLUTION_WEBHOOK_SECRET || "",
    webhookUrl = process.env.CAREER_EVOLUTION_WEBHOOK_URL ||
      "http://app:7123/api/discovery-v4/webhooks/evolution",
    managerUrl = process.env.EVOLUTION_MANAGER_URL ||
      "http://127.0.0.1:8081/manager",
  } = {}) {
    Object.assign(this, {
      client,
      metadata,
      target,
      webhookSecret,
      webhookUrl,
      managerUrl,
    });
    this.instance = instanceName(instance);
  }
  publicConfiguration() {
    return {
      configured: this.client.configured(),
      instanceName: this.instance,
      targetConfigured: Boolean(this.target),
      maskedTarget: maskPhone(this.target),
      managerUrl: this.managerUrl,
      credentialsVisibleToBrowser: false,
    };
  }
  async apiStatus() {
    try {
      const health = await this.client.health();
      return {
        online: true,
        version: String(health.version || ""),
        message: "Evolution API online",
      };
    } catch (error) {
      return {
        online: false,
        errorCode:
          error.name === "TimeoutError"
            ? "EVOLUTION_TIMEOUT"
            : error.code || "EVOLUTION_OFFLINE",
        message: "Evolution API indisponível",
      };
    }
  }
  async findInstance() {
    let data;
    try {
      data = await this.client.fetchInstances(this.instance);
    } catch (error) {
      if (error.code === "EVOLUTION_INSTANCE_NOT_FOUND") return null;
      throw error;
    }
    const items = Array.isArray(data)
        ? data
        : Array.isArray(data?.instances)
          ? data.instances
          : [];
    return (
      items.find(
        (item) =>
          String(
            item.name || item.instance?.instanceName || item.instanceName || "",
          ) === this.instance,
      ) || null
    );
  }
  normalizeState(data) {
    const raw = String(
        data?.instance?.state ||
          data?.state ||
          data?.connectionStatus ||
          data?.instance?.connectionStatus ||
          "unknown",
      ).toLowerCase(),
      connectionState = stateMap[raw] || "UNKNOWN",
      number =
        data?.instance?.ownerJid ||
        data?.ownerJid ||
        data?.instance?.number ||
        "",
      result = {
        instanceName: this.instance,
        connectionState,
        maskedNumber: maskPhone(number),
        lastErrorCode: "",
        lastCheckedAt: new Date().toISOString(),
      };
    this.metadata?.save(result);
    return { ...result, rawState: raw };
  }
  async status() {
    const api = await this.apiStatus(),
      configuration = this.publicConfiguration();
    if (!api.online || !configuration.configured)
      return {
        api,
        configuration,
        whatsapp: {
          connectionState: "UNKNOWN",
          instanceExists: false,
          lastCheckedAt: new Date().toISOString(),
        },
      };
    try {
      const found = await this.findInstance();
      if (!found)
        return {
          api,
          configuration,
          whatsapp: {
            connectionState: "DISCONNECTED",
            instanceExists: false,
            lastCheckedAt: new Date().toISOString(),
          },
        };
      return {
        api,
        configuration,
        whatsapp: { ...this.normalizeState(found), instanceExists: true },
      };
    } catch (error) {
      return {
        api,
        configuration,
        whatsapp: {
          connectionState: "ERROR",
          instanceExists: false,
          errorCode: error.code || "EVOLUTION_STATUS_FAILED",
          lastCheckedAt: new Date().toISOString(),
        },
      };
    }
  }
  async ensureInstance() {
    const existing = await this.findInstance();
    if (existing)
      return { created: false, instance: this.normalizeState(existing) };
    const created = await this.client.createInstance(this.instance);
    return { created: true, instance: this.normalizeState(created) };
  }
  async connect() {
    await this.ensureInstance();
    const data = await this.client.connect(this.instance),
      qr = this.extractQr(data);
    return {
      instanceName: this.instance,
      connectionState: qr ? "PAIRING_REQUIRED" : "CONNECTING",
      qr,
      expiresInSeconds: 60,
      generatedAt: new Date().toISOString(),
    };
  }
  extractQr(data = {}) {
    const value = String(
      data.base64 ||
        data.qrcode?.base64 ||
        data.code ||
        data.qrcode?.code ||
        "",
    );
    if (!value) return "";
    const normalized = value.startsWith("data:image/")
      ? value
      : `data:image/png;base64,${value}`;
    if (
      normalized.length > 1500000 ||
      !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(normalized)
    )
      throw Object.assign(new Error("QR inválido retornado pela Evolution."), {
        code: "EVOLUTION_QR_INVALID",
      });
    return normalized;
  }
  async connectionState() {
    try {
      return {
        ...this.normalizeState(
          await this.client.connectionState(this.instance),
        ),
        instanceExists: true,
      };
    } catch (error) {
      if (error.code === "EVOLUTION_INSTANCE_NOT_FOUND")
        return {
          instanceName: this.instance,
          connectionState: "DISCONNECTED",
          instanceExists: false,
          lastCheckedAt: new Date().toISOString(),
        };
      throw error;
    }
  }
  async listGroups() {
    const state = await this.connectionState();
    if (state.connectionState !== "CONNECTED")
      throw Object.assign(new Error("Conecte o WhatsApp para listar grupos."), {
        code: "WHATSAPP_NOT_CONNECTED",
        status: 409,
      });
    const data = await this.client.fetchAllGroups(this.instance),
      items = Array.isArray(data)
        ? data
        : Array.isArray(data?.groups)
          ? data.groups
          : [];
    return items
      .map((item, index) => ({
        groupJid: String(
          item.id || item.jid || item.remoteJid || item.groupJid || "",
        ),
        displayName: String(
          item.subject || item.name || `Grupo ${index + 1}`,
        ).slice(0, 160),
      }))
      .filter((item) => /^\d+@g\.us$/.test(item.groupJid));
  }
  async webhookStatus() {
    if (!this.client.configured())
      return {
        status: "NOT_CONFIGURED",
        enabled: false,
        secretConfigured: Boolean(this.webhookSecret),
        checkedAt: new Date().toISOString(),
      };
    try {
      const data = await this.client.findWebhook(this.instance),
        value = data?.webhook || data || {},
        url = String(value.url || "");
      return {
        status: value.enabled && url ? "CONFIGURED" : "NOT_CONFIGURED",
        enabled: Boolean(value.enabled),
        events: Array.isArray(value.events) ? value.events : [],
        messagesUpsertEnabled:
          Array.isArray(value.events) &&
          value.events.includes("MESSAGES_UPSERT"),
        targetMatches: Boolean(url && url === this.webhookUrl),
        secretConfigured: Boolean(this.webhookSecret),
        customHeaderConfigured: Boolean(
          value.headers &&
            Object.keys(value.headers).some(
              (key) => key.toLowerCase() === "x-career-webhook-secret",
            ),
        ),
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "ERROR",
        enabled: false,
        secretConfigured: Boolean(this.webhookSecret),
        errorCode: error.code || "EVOLUTION_WEBHOOK_STATUS_FAILED",
        checkedAt: new Date().toISOString(),
      };
    }
  }
  async configureInboundWebhook() {
    if (!this.webhookSecret)
      throw Object.assign(
        new Error("CAREER_EVOLUTION_WEBHOOK_SECRET não configurado."),
        { code: "EVOLUTION_WEBHOOK_SECRET_REQUIRED", status: 503 },
      );
    await this.client.setWebhook(this.instance, {
      enabled: true,
      url: this.webhookUrl,
      headers: { "x-career-webhook-secret": this.webhookSecret },
      byEvents: false,
      base64: false,
      events: ["MESSAGES_UPSERT"],
    });
    return this.webhookStatus();
  }
  async sendTest() {
    if (!this.target)
      throw Object.assign(
        new Error("CAREER_WHATSAPP_TARGET não configurado."),
        { code: "WHATSAPP_TARGET_NOT_CONFIGURED" },
      );
    const state = await this.connectionState();
    if (state.connectionState !== "CONNECTED")
      throw Object.assign(
        new Error("Conecte o WhatsApp antes de enviar o teste."),
        { code: "WHATSAPP_NOT_CONNECTED" },
      );
    await this.client.sendText(
      this.instance,
      this.target,
      "Career Unified: integração com WhatsApp funcionando.",
    );
    return {
      sent: true,
      maskedTarget: maskPhone(this.target),
      sentAt: new Date().toISOString(),
    };
  }
  async dangerousAction(action, confirmation) {
    if (confirmation !== this.instance)
      throw Object.assign(new Error("Confirmação da instância não confere."), {
        code: "EVOLUTION_CONFIRMATION_REQUIRED",
      });
    if (action === "logout") await this.client.logout(this.instance);
    else if (action === "delete")
      await this.client.deleteInstance(this.instance);
    else
      throw Object.assign(new Error("Ação não permitida."), {
        code: "EVOLUTION_ACTION_INVALID",
      });
    this.metadata?.save({
      instanceName: this.instance,
      connectionState: "DISCONNECTED",
      maskedNumber: "",
      lastCheckedAt: new Date().toISOString(),
    });
    return { ok: true, action };
  }
}
