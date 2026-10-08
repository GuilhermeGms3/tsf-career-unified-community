const OFFICIAL_HOSTS=new Set(["nerdin.com.br","www.nerdin.com.br"]),LOCAL_HOSTS=new Set(["127.0.0.1","localhost","::1","[::1]"]);

export function parseNerdinIdentity(value){
  try{const url=new URL(value),host=url.hostname.toLowerCase();if(!OFFICIAL_HOSTS.has(host))return {};const applicationId=url.pathname==="/vaga_candidatura.php"?url.searchParams.get("id")||"":"",jobId=url.pathname.startsWith("/vaga_emprego/")?url.pathname.match(/-(\d+)\.php$/i)?.[1]||"":"",providerJobId=applicationId||jobId;if(!/^\d+$/.test(providerJobId))return {};return {providerJobId,canonicalUrl:`https://www.nerdin.com.br/vaga_candidatura.php?id=${providerJobId}`,applicationUrl:`https://www.nerdin.com.br/vaga_candidatura.php?id=${providerJobId}`};}catch{return {};}
}

export function validateNerdinSubmissionTarget(value,{expectedIdentity={},allowLocalFixture=false}={}){
  let url;try{url=new URL(value);}catch{throw Object.assign(new Error("Target Nerdin inválido."),{code:"NERDIN_TARGET_INVALID"});}
  if(url.username||url.password)throw Object.assign(new Error("Target não pode conter credenciais."),{code:"NERDIN_TARGET_CREDENTIALS_NOT_ALLOWED"});
  if(LOCAL_HOSTS.has(url.hostname.toLowerCase())){if(!allowLocalFixture||url.protocol!=="http:")throw Object.assign(new Error("Target local não permitido neste runtime."),{code:"NERDIN_TARGET_LOCAL_NOT_ALLOWED"});return {url:url.href,identity:expectedIdentity,localFixture:true};}
  const identity=parseNerdinIdentity(url.href);if(url.protocol!=="https:"||!OFFICIAL_HOSTS.has(url.hostname.toLowerCase()))throw Object.assign(new Error("Controlled Submit aceita somente host Nerdin oficial em HTTPS."),{code:"NERDIN_TARGET_HOST_NOT_ALLOWED"});if(!identity.providerJobId)throw Object.assign(new Error("Identidade Nerdin incompleta no target."),{code:"NERDIN_TARGET_IDENTITY_MISSING"});if(expectedIdentity.providerJobId&&String(expectedIdentity.providerJobId)!==identity.providerJobId)throw Object.assign(new Error("Identidade Nerdin diverge do target persistido."),{code:"NERDIN_TARGET_IDENTITY_MISMATCH"});return {url:identity.applicationUrl,identity,localFixture:false};
}
