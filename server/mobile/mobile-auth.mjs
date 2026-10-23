import { AppError } from "../errors.mjs";

const splitList = (value = "") =>
  String(value)
    .split(",")
    .map((item) => item.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean);

const normalizeAddress = (value = "") =>
  String(value).replace(/^::ffff:/, "").toLocaleLowerCase("en-US");

export function mobileGatewayConfig(env = process.env) {
  return {
    enabled: /^(1|true|yes)$/i.test(String(env.MOBILE_GATEWAY_ENABLED || "")),
    host: String(env.MOBILE_GATEWAY_HOST || "127.0.0.1"),
    port: Math.max(1, Math.min(65535, Number(env.MOBILE_GATEWAY_PORT) || 7125)),
    trustProxy: /^(1|true|yes)$/i.test(
      String(env.MOBILE_GATEWAY_TRUST_PROXY || ""),
    ),
    allowedUsers: splitList(env.MOBILE_GATEWAY_ALLOWED_TAILSCALE_USERS),
    proxyAddresses: splitList(env.MOBILE_GATEWAY_PROXY_ADDRESSES || env.CAREER_WEB_PROXY_ADDRESSES),
    requiredCapability: String(
      env.MOBILE_GATEWAY_REQUIRED_CAPABILITY || "",
    ).trim(),
  };
}

function hasCapability(header, requiredCapability) {
  if (!requiredCapability) return true;
  try {
    const capabilities = JSON.parse(String(header || "{}"));
    return Object.prototype.hasOwnProperty.call(
      capabilities,
      requiredCapability,
    );
  } catch {
    return false;
  }
}

export function authenticateMobileRequest(req, config) {
  const remoteAddress = normalizeAddress(req.socket?.remoteAddress);
  const isLoopback = ["127.0.0.1", "::1"].includes(remoteAddress);
  if (config.trustProxy ? !config.proxyAddresses?.includes(remoteAddress) : !isLoopback)
    throw new AppError("O gateway móvel aceita apenas o proxy local configurado.", {
      status: 403,
      code: "MOBILE_GATEWAY_PROXY_REQUIRED",
    });

  if (!config.allowedUsers.length)
    throw new AppError("A allowlist do gateway móvel ainda não foi configurada.", {
      status: 503,
      code: "MOBILE_GATEWAY_NOT_CONFIGURED",
    });

  const login = String(req.headers["tailscale-user-login"] || "")
    .trim()
    .toLocaleLowerCase("en-US");
  if (!login)
    throw new AppError("Identidade Tailscale ausente.", {
      status: 401,
      code: "TAILSCALE_IDENTITY_REQUIRED",
    });
  if (!config.allowedUsers.includes(login))
    throw new AppError("Esta identidade Tailscale não pode controlar o TSF.", {
      status: 403,
      code: "TAILSCALE_IDENTITY_FORBIDDEN",
    });
  if (
    !hasCapability(
      req.headers["tailscale-app-capabilities"],
      config.requiredCapability,
    )
  )
    throw new AppError("A permissão móvel exigida não foi concedida.", {
      status: 403,
      code: "TAILSCALE_CAPABILITY_REQUIRED",
    });

  return {
    login,
    displayName: String(req.headers["tailscale-user-name"] || login).slice(
      0,
      160,
    ),
  };
}
