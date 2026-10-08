const ASHBY_HOSTS=new Set(["jobs.ashbyhq.com"]);
const LOCAL_HOSTS=new Set(["127.0.0.1","localhost","::1","[::1]"]);
const SAFE_ID=/^[a-zA-Z0-9_-]+$/;

export function parseAshbyIdentity(value){
  try{
    const url=new URL(value),parts=url.pathname.split("/").filter(Boolean),board=parts[0]||"",postingId=parts[1]||"";
    if(!ASHBY_HOSTS.has(url.hostname.toLowerCase())||!SAFE_ID.test(board)||!SAFE_ID.test(postingId)||parts.length>3||(parts[2]&&!['application','apply'].includes(parts[2])))return {};
    return {board,postingId,canonicalUrl:`https://jobs.ashbyhq.com/${board}/${postingId}`,applyUrl:`https://jobs.ashbyhq.com/${board}/${postingId}/application`};
  }catch{return {};}
}

export function validateAshbySubmissionTarget(value,{expectedIdentity={},allowLocalFixture=false}={}){
  let url;try{url=new URL(value);}catch{throw Object.assign(new Error("Target Ashby inválido."),{code:"ASHBY_TARGET_INVALID"});}
  if(url.username||url.password)throw Object.assign(new Error("Target não pode conter credenciais."),{code:"ASHBY_TARGET_CREDENTIALS_NOT_ALLOWED"});
  const local=LOCAL_HOSTS.has(url.hostname.toLowerCase());
  if(local){if(!allowLocalFixture||url.protocol!=="http:")throw Object.assign(new Error("Target local não permitido neste runtime."),{code:"ASHBY_TARGET_LOCAL_NOT_ALLOWED"});return {url:url.href,identity:expectedIdentity,localFixture:true};}
  const identity=parseAshbyIdentity(url.href);
  if(url.protocol!=="https:"||!ASHBY_HOSTS.has(url.hostname.toLowerCase()))throw Object.assign(new Error("Controlled Submit aceita somente host Ashby oficial em HTTPS."),{code:"ASHBY_TARGET_HOST_NOT_ALLOWED"});
  if(!identity.board||!identity.postingId)throw Object.assign(new Error("Identidade Ashby incompleta no target."),{code:"ASHBY_TARGET_IDENTITY_MISSING"});
  if(expectedIdentity.board&&String(expectedIdentity.board).toLowerCase()!==identity.board.toLowerCase())throw Object.assign(new Error("Board Ashby diverge do target persistido."),{code:"ASHBY_TARGET_IDENTITY_MISMATCH"});
  if(expectedIdentity.postingId&&String(expectedIdentity.postingId)!==identity.postingId)throw Object.assign(new Error("Posting Ashby diverge do target persistido."),{code:"ASHBY_TARGET_IDENTITY_MISMATCH"});
  return {url:identity.applyUrl,identity,localFixture:false};
}
