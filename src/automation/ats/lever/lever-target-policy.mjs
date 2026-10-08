const LEVER_HOSTS=new Set(["jobs.lever.co","jobs.eu.lever.co"]);
const LOCAL_HOSTS=new Set(["127.0.0.1","localhost","::1","[::1]"]);
const SAFE_ID=/^[a-zA-Z0-9_-]+$/;

export function parseLeverIdentity(value){
  try{
    const url=new URL(value),parts=url.pathname.split("/").filter(Boolean),site=parts[0]||"",postingId=parts[1]||"";
    if(!LEVER_HOSTS.has(url.hostname.toLowerCase())||!SAFE_ID.test(site)||!SAFE_ID.test(postingId)||parts.length>3||(parts[2]&&parts[2]!=="apply"))return {};
    const region=url.hostname.toLowerCase()==="jobs.eu.lever.co"?"eu":"global";
    return {site,postingId,region,canonicalUrl:`https://${url.hostname.toLowerCase()}/${site}/${postingId}`,applyUrl:`https://${url.hostname.toLowerCase()}/${site}/${postingId}/apply`};
  }catch{return {};}
}

export function validateLeverSubmissionTarget(value,{expectedIdentity={},allowLocalFixture=false}={}){
  let url;try{url=new URL(value);}catch{throw Object.assign(new Error("Target Lever inválido."),{code:"LEVER_TARGET_INVALID"});}
  if(url.username||url.password)throw Object.assign(new Error("Target não pode conter credenciais."),{code:"LEVER_TARGET_CREDENTIALS_NOT_ALLOWED"});
  const local=LOCAL_HOSTS.has(url.hostname.toLowerCase());
  if(local){if(!allowLocalFixture||url.protocol!=="http:")throw Object.assign(new Error("Target local não permitido neste runtime."),{code:"LEVER_TARGET_LOCAL_NOT_ALLOWED"});return {url:url.href,identity:expectedIdentity,localFixture:true};}
  const identity=parseLeverIdentity(url.href);
  if(url.protocol!=="https:"||!LEVER_HOSTS.has(url.hostname.toLowerCase()))throw Object.assign(new Error("Controlled Submit aceita somente host Lever oficial em HTTPS."),{code:"LEVER_TARGET_HOST_NOT_ALLOWED"});
  if(!identity.site||!identity.postingId)throw Object.assign(new Error("Identidade Lever incompleta no target."),{code:"LEVER_TARGET_IDENTITY_MISSING"});
  if(expectedIdentity.site&&String(expectedIdentity.site).toLowerCase()!==identity.site.toLowerCase())throw Object.assign(new Error("Site Lever diverge do target persistido."),{code:"LEVER_TARGET_IDENTITY_MISMATCH"});
  if(expectedIdentity.postingId&&String(expectedIdentity.postingId)!==identity.postingId)throw Object.assign(new Error("Posting Lever diverge do target persistido."),{code:"LEVER_TARGET_IDENTITY_MISMATCH"});
  return {url:identity.applyUrl,identity,localFixture:false};
}
