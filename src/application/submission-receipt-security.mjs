const METADATA_ALLOWLIST=new Set(["verificationMethod","confirmationKind","providerStatus","fixtureId","adapterVersion","jobId","screenshotSha256"]);
const LOOPBACK_HOSTS=new Set(["127.0.0.1","localhost","::1","[::1]"]);

export function sanitizeConfirmationUrl(value,{allowLocalHttp=false}={}){
  const raw=String(value||"").trim();if(!raw)return "";
  let url;try{url=new URL(raw);}catch{throw Object.assign(new Error("URL de confirmação inválida."),{code:"RECEIPT_URL_INVALID"});}
  if(url.username||url.password)throw Object.assign(new Error("URL de confirmação não pode conter credenciais."),{code:"RECEIPT_URL_CREDENTIALS_NOT_ALLOWED"});
  if(url.protocol==="https:")return url.href;
  if(url.protocol==="http:"&&allowLocalHttp&&LOOPBACK_HOSTS.has(url.hostname.toLowerCase()))return url.href;
  throw Object.assign(new Error("Scheme da URL de confirmação não permitido."),{code:"RECEIPT_URL_SCHEME_NOT_ALLOWED"});
}

export function sanitizeReceiptMetadata(value={}){
  if(!value||typeof value!=="object"||Array.isArray(value))return {};
  const result={};for(const [key,raw] of Object.entries(value)){if(!METADATA_ALLOWLIST.has(key))continue;const text=String(raw??"").replace(/[\r\n\t]+/g," ").trim().slice(0,160);if(text)result[key]=text;}return result;
}

export function sanitizeReceipt(input={},options={}){
  const externalReference=String(input.externalReference||"").replace(/[\r\n\t]+/g," ").trim().slice(0,200);
  const confirmationText=String(input.confirmationText||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,500);
  const submittedAt=Number.isFinite(Date.parse(input.submittedAt||""))?new Date(input.submittedAt).toISOString():new Date().toISOString();
  return {externalReference,confirmationUrl:sanitizeConfirmationUrl(input.confirmationUrl,options),confirmationText,submittedAt,metadata:sanitizeReceiptMetadata(input.metadata)};
}
