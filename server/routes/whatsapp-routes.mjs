import {requireLocalJsonMutation} from "../local-mutation-guard.mjs";

export function createWhatsappRoutes({service,approvalGateway={publicConfiguration:()=>({configured:false}),publicRequest:value=>value},store,readJson,json,sendError,publicIntegrationSettings}){
  const check=async target=>{try{const response=await fetch(target,{signal:AbortSignal.timeout(2000)});return {online:response.ok,httpStatus:response.status};}catch(error){return {online:false,errorCode:error.name==="TimeoutError"?"TIMEOUT":"OFFLINE"};}};
  return async function whatsappRoutes(req,res,url){
    if(url.pathname==="/api/whatsapp/status"&&req.method==="GET"){const status=await service.status(),inbound=await service.webhookStatus(),settings=publicIntegrationSettings(store.integrationSettings.get()),n8nUrl=String(process.env.N8N_INTERNAL_URL||"http://127.0.0.1:5678").replace(/\/$/,"");json(res,{ok:true,...status,n8n:{configured:settings.configured,enabled:settings.enabled,...await check(`${n8nUrl}/healthz`)},webhook:{...inbound,configured:inbound.status==="CONFIGURED"},dispatcher:{enabled:settings.enabled,scope:"OPTIONAL_JOB_ALERTS"},approvalGateway:approvalGateway.publicConfiguration()});return true;}
    if(url.pathname==="/api/whatsapp/approvals/latest"&&req.method==="GET"){json(res,{ok:true,request:approvalGateway.publicRequest(store.whatsappApprovals.latest())});return true;}
    if(url.pathname==="/api/whatsapp/questions/active"&&req.method==="GET"){const applicationId=String(url.searchParams.get("applicationId")||"").slice(0,200);json(res,{ok:true,request:applicationId?approvalGateway.publicQuestionRequest(store.whatsappQuestions.active(applicationId)):null});return true;}
    try{
      if(url.pathname==="/api/whatsapp/approvals/prepare"&&req.method==="POST"){requireLocalJsonMutation(req,url);const input=await readJson(req),result=approvalGateway.prepare(input);json(res,{ok:true,request:approvalGateway.publicRequest(result.request),application:result.application,message:result.message},201);return true;}
      const approvalSend=url.pathname.match(/^\/api\/whatsapp\/approvals\/([^/]+)\/send$/);if(approvalSend&&req.method==="POST"){requireLocalJsonMutation(req,url);const input=await readJson(req),result=await approvalGateway.send(decodeURIComponent(approvalSend[1]),String(input.confirmation||""));json(res,{ok:true,request:approvalGateway.publicRequest(result.request),sent:result.sent});return true;}
      if(url.pathname==="/api/whatsapp/instance"&&req.method==="POST"){json(res,{ok:true,...await service.ensureInstance()},201);return true;}
      if(url.pathname==="/api/whatsapp/connect"&&req.method==="POST"){json(res,{ok:true,...await service.connect()});return true;}
      if(url.pathname==="/api/whatsapp/connection-state"&&req.method==="GET"){json(res,{ok:true,whatsapp:await service.connectionState()});return true;}
      if(url.pathname==="/api/whatsapp/test-message"&&req.method==="POST"){json(res,{ok:true,result:await service.sendTest()});return true;}
      const match=url.pathname.match(/^\/api\/whatsapp\/(logout|instance)$/);if(match&&req.method==="DELETE"){const body=await readJson(req),action=match[1]==="logout"?"logout":"delete";json(res,{ok:true,result:await service.dangerousAction(action,body.confirmation)});return true;}
    }catch(error){sendError(res,error,{status:error.status||400,code:error.code||"WHATSAPP_CONNECTION_FAILED",message:error.message});return true;}
    return false;
  };
}
