import { LlmProvider } from "./llm-provider.mjs";
import { approvedLlmEndpoint } from "../../security/llm-endpoint-policy.mjs";

function localEndpoint(value) {
  return approvedLlmEndpoint(String(value || "http://127.0.0.1:1234/v1"));
}

async function request(fetchImpl, url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, redirect:"error", signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error(`Servidor local respondeu ${response.status}.`), { code: "PROVIDER_ERROR", status: response.status });
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw Object.assign(new Error("Servidor local excedeu o timeout."), { code: "PROVIDER_TIMEOUT" });
    if (!error.code) error.code = "PROVIDER_OFFLINE";
    throw error;
  } finally { clearTimeout(timer); }
}

export class OpenAICompatibleLocalProvider extends LlmProvider {
  static type = "openai-compatible-local";
  constructor({ baseUrl, defaultModel = "", timeoutMs = 30000, ttlSeconds = 0, fetchImpl = globalThis.fetch } = {}) { super(); this.baseUrl = localEndpoint(baseUrl); this.defaultModel = defaultModel; this.timeoutMs = timeoutMs; this.ttlSeconds = Math.max(0, Number(ttlSeconds) || 0); this.fetch = fetchImpl; }
  async generateStructured(prompt, { model = this.defaultModel, schema, timeoutMs = this.timeoutMs, temperature = .1, contextLimit = 4096, maxTokens: requestedMaxTokens, reasoningEffort = "" } = {}) {
    if (!model) throw Object.assign(new Error("Modelo local não configurado."), { code: "MODEL_NOT_CONFIGURED" });
    const maxTokens = Math.max(256, Math.min(1600, Number(requestedMaxTokens) || Math.floor(Number(contextLimit || 4096) * .38))),
      started = Date.now(), data = await request(this.fetch, `${this.baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, temperature, max_tokens: maxTokens, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}), ...(this.ttlSeconds ? { ttl: this.ttlSeconds } : {}), messages: [{ role: "user", content: String(prompt) }], response_format: { type: "json_schema", json_schema: { name: "semantic_result", strict: true, schema } } }) }, timeoutMs);
    return { text: String(data.choices?.[0]?.message?.content || "").trim(), model: data.model || model, latencyMs: Date.now() - started, metrics: { usage: data.usage || {} } };
  }
  async generate(prompt, options = {}) { return this.generateStructured(prompt, { ...options, schema: options.schema || { type: "object" } }); }
  async listModels() { const data = await request(this.fetch, `${this.baseUrl}/models`, {}, 5000); return (data.data || []).map((item) => ({ name: item.id, installed: true })); }
  async health() { const started = Date.now(); try { const models = await this.listModels(); return { status: models.length ? "HEALTHY" : "DEGRADED", ok: true, endpoint: this.baseUrl, models: models.map((item) => item.name), latencyMs: Date.now() - started, reason: models.length ? "" : "NO_MODELS" }; } catch (error) { return { status: "OFFLINE", ok: false, endpoint: this.baseUrl, models: [], latencyMs: Date.now() - started, error: error.message, code: error.code }; } }
  async modelInfo(model) { return { model, local: true }; }
}

function lmStudioEndpoint(value) {
  const url = new URL(String(value || "http://127.0.0.1:1234/v1"));
  if (url.pathname === "/") url.pathname = "/v1";
  return url.toString().replace(/\/$/, "");
}

export class LMStudioProvider extends OpenAICompatibleLocalProvider {
  static type = "lm-studio";
  constructor(options = {}) {
    super({ ...options, baseUrl: lmStudioEndpoint(options.baseUrl), ttlSeconds: options.ttlSeconds ?? 300 });
    this.nativeBaseUrl = `${new URL(this.baseUrl).origin}/api/v1`;
    this.activeRequests = 0;
    this.unloadTimer = null;
  }
  async generateStructured(prompt, options = {}) {
    this.activeRequests += 1;
    if (this.unloadTimer) clearTimeout(this.unloadTimer);
    this.unloadTimer = null;
    const model = options.model || this.defaultModel;
    try {
      return await super.generateStructured(prompt, {
        ...options,
        reasoningEffort: options.reasoningEffort || "none",
      });
    } finally {
      this.activeRequests -= 1;
      if (this.activeRequests === 0) this.scheduleUnload(model);
    }
  }
  async listModels() {
    const data = await request(this.fetch, `${this.nativeBaseUrl}/models`, {}, 5000);
    return (data.models || []).map((item) => {
      const loadedInstance = item.loaded_instances?.[0];
      return {
        name: item.key,
        installed: true,
        loaded: Boolean(loadedInstance),
        size: Number(item.size_bytes) || 0,
        details: {
          parameter_size: item.params_string || "",
          context_length: Number(loadedInstance?.config?.context_length || item.max_context_length) || 0,
        },
      };
    });
  }
  scheduleUnload(model) {
    if (!model || !this.ttlSeconds) return;
    this.unloadTimer = setTimeout(() => {
      this.unloadTimer = null;
      if (this.activeRequests === 0) void this.unload(model).catch(() => {});
    }, this.ttlSeconds * 1000);
    this.unloadTimer.unref?.();
  }
  async unload(model) {
    if (!model) return;
    await request(this.fetch, `${this.nativeBaseUrl}/models/unload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instance_id: model }) }, 10000);
  }
}
