const localHosts=new Set(["localhost","127.0.0.1","[::1]","host.docker.internal"]);
const invalid=()=>Object.assign(new Error("Endpoint LLM invalido ou nao autorizado. Para o PC via VPN, configure CAREER_LLM_ALLOWED_ORIGINS com a origem exata."),{code:"PROVIDER_MISCONFIGURED"});
const vpnHost=host=>host.endsWith(".ts.net")||/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host);
export function approvedLlmEndpoint(value,{allowedOrigins=process.env.CAREER_LLM_ALLOWED_ORIGINS||""}={}) {
  let url;try{url=new URL(value);}catch{throw invalid();}
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw invalid();
  const allowed=String(allowedOrigins).split(",").map(origin=>origin.trim()).filter(Boolean);
  if(!localHosts.has(url.hostname)&&!(vpnHost(url.hostname)&&allowed.includes(url.origin)))throw invalid();
  return url.toString().replace(/\/$/,"");
}
