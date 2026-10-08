import {requireLocalJsonMutation} from "../local-mutation-guard.mjs";
export function createApplicationBatchRoutes({service,readJson,json,sendError}){
  return async(req,res,url)=>{
    if(!url.pathname.startsWith("/api/application-batches")&&!url.pathname.startsWith("/api/application-drafts"))return false;
    try{
      requireLocalJsonMutation(req,url);
      if(url.pathname==="/api/application-batches/policy"){
        if(req.method==="GET"){json(res,{ok:true,mode:service.policyMode()});return true;}
        if(req.method==="POST"){const input=await readJson(req);service.setPolicyMode(input.mode);json(res,{ok:true,mode:service.policyMode()});return true;}
      }
      if(url.pathname==="/api/application-batches/auto-prepare"&&req.method==="POST"){await readJson(req);json(res,{ok:true,batch:await service.prepareEligible()},202);return true;}
      if(url.pathname==="/api/application-batches"){
        if(req.method==="GET"){json(res,{ok:true,batches:service.list(),policyMode:service.policyMode(),submissionEnabled:service.submissionEnabled,telemetry:service.telemetry});return true;}
        if(req.method==="POST"){json(res,{ok:true,batch:await service.create(await readJson(req))},202);return true;}
      }
      const batch=url.pathname.match(/^\/api\/application-batches\/([^/]+)$/);
      if(batch&&req.method==="GET"){json(res,{ok:true,batch:service.get(decodeURIComponent(batch[1]))});return true;}
      const action=url.pathname.match(/^\/api\/application-drafts\/([^/]+)\/(answer|prepare|submit|cancel)$/);
      if(action&&req.method==="POST"){
        const input=await readJson(req),id=decodeURIComponent(action[1]);
        if(action[2]==="answer")service.answer(id,input);
        else if(action[2]==="prepare")service.queue(id,input.mode);
        else if(action[2]==="cancel")service.cancel(id);
        else await service.submit(id,input);
        json(res,{ok:true},202);return true;
      }
      return false;
    }catch(error){sendError(res,error,{status:error.status||400,code:error.code||"APPLICATION_BATCH_FAILED",message:error.code||"APPLICATION_BATCH_FAILED"});return true;}
  };
}
