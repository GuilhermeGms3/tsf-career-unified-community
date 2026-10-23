const list = value => String(value || "").split(",").map(item=>item.trim().toLowerCase()).filter(Boolean);
const denied = (code,status=403) => Object.assign(new Error("Acesso privado Tailscale necessario."),{code,status});

export function trustedWebConfig(env=process.env) {
  const enabled=env.CAREER_WEB_TRUST_PROXY === "true";
  if(!enabled)return {enabled:false};
  let origin;try{origin=new URL(env.CAREER_PUBLIC_URL);}catch{throw denied("WEB_PROXY_NOT_CONFIGURED",503);}
  const allowedUsers=list(env.CAREER_WEB_ALLOWED_TAILSCALE_USERS),proxyAddresses=list(env.CAREER_WEB_PROXY_ADDRESSES);
  if(origin.protocol!=="https:"||!origin.hostname.endsWith(".ts.net")||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=="/"||!allowedUsers.length||!proxyAddresses.length)
    throw denied("WEB_PROXY_NOT_CONFIGURED",503);
  return {enabled,origin:origin.origin,host:origin.host,allowedUsers,proxyAddresses};
}

export function authorizeWebRequest(req,config) {
  if(!config.enabled)return;
  const remote=String(req.socket?.remoteAddress||"").replace(/^::ffff:/,"").toLowerCase();
  if(!config.proxyAddresses.includes(remote))throw denied("WEB_PROXY_REQUIRED");
  if(String(req.headers.host||"").toLowerCase()!==config.host)throw denied("WEB_HOST_REQUIRED");
  const login=String(req.headers["tailscale-user-login"]||"").trim().toLowerCase();
  if(!login)throw denied("TAILSCALE_IDENTITY_REQUIRED",401);
  if(!config.allowedUsers.includes(login))throw denied("TAILSCALE_IDENTITY_FORBIDDEN");
}

export function isTrustedWebRequest(req,url,env=process.env) {
  const config=trustedWebConfig(env);
  if(!config.enabled||url.origin!==config.origin)return false;
  authorizeWebRequest(req,config);
  return true;
}
