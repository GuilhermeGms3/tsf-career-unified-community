const safeMessage=(status)=>status===401||status===403?"Evolution recusou a credencial.":status===404?"Instância não encontrada.":status===429?"Evolution limitou temporariamente as requisições.":`Evolution respondeu HTTP ${status}.`;

import {rememberOutboundText} from "./outbound-message-guard.mjs";

export class EvolutionClient{
  constructor({baseUrl=process.env.EVOLUTION_INTERNAL_URL||"http://evolution-api:8080",apiKey=process.env.EVOLUTION_API_KEY||"",fetchImpl=fetch,timeoutMs=8000}={}){this.baseUrl=String(baseUrl).replace(/\/$/,"");this.apiKey=String(apiKey);this.fetchImpl=fetchImpl;this.timeoutMs=Math.max(1000,Math.min(30000,Number(timeoutMs)||8000));}
  configured(){return Boolean(this.apiKey&&this.baseUrl);}
  async request(path,{method="GET",body,authenticated=true,timeoutMs=this.timeoutMs}={}){if(authenticated&&!this.apiKey)throw Object.assign(new Error("EVOLUTION_API_KEY não configurada."),{code:"EVOLUTION_NOT_CONFIGURED",status:503});const requestTimeoutMs=Math.max(1000,Math.min(120000,Number(timeoutMs)||this.timeoutMs)),response=await this.fetchImpl(`${this.baseUrl}${path}`,{method,signal:AbortSignal.timeout(requestTimeoutMs),headers:{accept:"application/json",...(body?{"content-type":"application/json"}:{}),...(authenticated?{apikey:this.apiKey}:{})},body:body?JSON.stringify(body):undefined});let data={};try{data=await response.json();}catch{}if(!response.ok)throw Object.assign(new Error(safeMessage(response.status)),{code:response.status===401||response.status===403?"EVOLUTION_UNAUTHORIZED":response.status===404?"EVOLUTION_INSTANCE_NOT_FOUND":response.status===429?"EVOLUTION_RATE_LIMITED":"EVOLUTION_REQUEST_FAILED",status:response.status});return data;}
  health(){return this.request("/",{authenticated:false});}
  fetchInstances(instanceName=""){return this.request(`/instance/fetchInstances${instanceName?`?instanceName=${encodeURIComponent(instanceName)}`:""}`);}
  createInstance(instanceName){return this.request("/instance/create",{method:"POST",body:{instanceName,integration:"WHATSAPP-BAILEYS",qrcode:true}});}
  connect(instanceName){return this.request(`/instance/connect/${encodeURIComponent(instanceName)}`);}
  connectionState(instanceName){return this.request(`/instance/connectionState/${encodeURIComponent(instanceName)}`);}
  fetchAllGroups(instanceName){return this.request(`/group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,{timeoutMs:60000});}
  findWebhook(instanceName){return this.request(`/webhook/find/${encodeURIComponent(instanceName)}`);}
  setWebhook(instanceName,webhook){return this.request(`/webhook/set/${encodeURIComponent(instanceName)}`,{method:"POST",body:{webhook}});}
  sendText(instanceName,number,text){rememberOutboundText(instanceName,text);return this.request(`/message/sendText/${encodeURIComponent(instanceName)}`,{method:"POST",body:{number,text}});}
  sendMedia(instanceName,number,media){return this.request(`/message/sendMedia/${encodeURIComponent(instanceName)}`,{method:"POST",body:{number,...media},timeoutMs:30000});}
  logout(instanceName){return this.request(`/instance/logout/${encodeURIComponent(instanceName)}`,{method:"DELETE"});}
  deleteInstance(instanceName){return this.request(`/instance/delete/${encodeURIComponent(instanceName)}`,{method:"DELETE"});}
}
