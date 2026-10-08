import {parseGreenhouseIdentity} from "./greenhouse-identity.mjs";

const GREENHOUSE_HOSTS=new Set(["boards.greenhouse.io","job-boards.greenhouse.io"]),LOCAL_HOSTS=new Set(["127.0.0.1","localhost","::1","[::1]"]);

export function validateGreenhouseSubmissionTarget(value,{expectedIdentity={},allowLocalFixture=false}={}){
  let url;try{url=new URL(value);}catch{throw Object.assign(new Error("Target Greenhouse inválido."),{code:"GREENHOUSE_TARGET_INVALID"});}
  if(url.username||url.password)throw Object.assign(new Error("Target não pode conter credenciais."),{code:"GREENHOUSE_TARGET_CREDENTIALS_NOT_ALLOWED"});
  const local=LOCAL_HOSTS.has(url.hostname.toLowerCase());
  if(local){if(!allowLocalFixture||url.protocol!=="http:")throw Object.assign(new Error("Target local não permitido neste runtime."),{code:"GREENHOUSE_TARGET_LOCAL_NOT_ALLOWED"});return {url:url.href,identity:expectedIdentity,localFixture:true};}
  if(url.protocol!=="https:"||!GREENHOUSE_HOSTS.has(url.hostname.toLowerCase()))throw Object.assign(new Error("Controlled Submit aceita somente host Greenhouse oficial em HTTPS."),{code:"GREENHOUSE_TARGET_HOST_NOT_ALLOWED"});
  const parsed=parseGreenhouseIdentity(url.href);if(!parsed.boardToken||!parsed.jobPostId)throw Object.assign(new Error("Identidade Greenhouse incompleta no target."),{code:"GREENHOUSE_TARGET_IDENTITY_MISSING"});
  if(expectedIdentity.boardToken&&String(expectedIdentity.boardToken).toLowerCase()!==String(parsed.boardToken).toLowerCase())throw Object.assign(new Error("Board Greenhouse diverge do target persistido."),{code:"GREENHOUSE_TARGET_IDENTITY_MISMATCH"});
  if(expectedIdentity.jobPostId&&String(expectedIdentity.jobPostId)!==String(parsed.jobPostId))throw Object.assign(new Error("Job Greenhouse diverge do target persistido."),{code:"GREENHOUSE_TARGET_IDENTITY_MISMATCH"});
  return {url:url.href,identity:parsed,localFixture:false};
}
