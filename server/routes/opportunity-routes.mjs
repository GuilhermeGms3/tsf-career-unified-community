export function createOpportunityRoutes({store,opportunityService,availabilityService,dailyRefreshService=null,decisionInbox=null,readJson,json,sendError}){
  return async function opportunityRoutes(req,res,url){
    try{
      if(url.pathname==="/api/opportunities"&&req.method==="GET"){
        if(url.searchParams.get("view")==="cards"){
          const page=await opportunityService.page({
            section:String(url.searchParams.get("section")||"discover").slice(0,40),
            offset:Number(url.searchParams.get("offset")||0),
            limit:Number(url.searchParams.get("limit")||12),
            query:String(url.searchParams.get("query")||"").slice(0,200),
          });
          json(res,{ok:true,...page});
        }else json(res,{ok:true,opportunities:await opportunityService.summaries()});
        return true;
      }
      if(url.pathname==="/api/opportunities/verify"&&req.method==="POST"){
        if(!dailyRefreshService)throw Object.assign(new Error("Verificação de vagas indisponível."),{status:503,code:"OPPORTUNITY_VERIFICATION_UNAVAILABLE"});
        const run=dailyRefreshService.start({skipSearch:true});
        json(res,{ok:true,run,statusUrl:`/api/opportunities/verify/${encodeURIComponent(run.id)}`},202);
        return true;
      }
      const verificationRun=url.pathname.match(/^\/api\/opportunities\/verify\/([^/]+)$/);
      if(verificationRun&&req.method==="GET"){
        const run=dailyRefreshService?.status(decodeURIComponent(verificationRun[1]));
        if(!run){sendError(res,Object.assign(new Error("Verificação de vagas não encontrada."),{status:404}),{status:404,code:"OPPORTUNITY_VERIFICATION_NOT_FOUND",message:"Verificação de vagas não encontrada."});return true;}
        json(res,{ok:true,run});
        return true;
      }
      const verification=url.pathname.match(/^\/api\/opportunities\/([^/]+)\/verify$/);
      if(verification&&req.method==="POST"){
        const result=await availabilityService.verify(decodeURIComponent(verification[1]));
        opportunityService.invalidate();
        json(res,{ok:true,...result,opportunity:(await opportunityService.list()).find(item=>item.job.id===result.job.id)||null});
        return true;
      }
      const feedback=url.pathname.match(/^\/api\/opportunities\/([^/]+)\/feedback$/);
      if(!feedback)return false;
      const jobId=decodeURIComponent(feedback[1]);
      if(!store.jobs.findById(jobId)){
        json(res,{ok:false,code:"JOB_NOT_FOUND",error:"Vaga não encontrada."},404);
        return true;
      }
      if(req.method==="PUT"){
        const saved=store.jobFeedback.save(jobId,await readJson(req));
        opportunityService.invalidate();
        decisionInbox?.scheduleRebuild?.();
        json(res,{ok:true,feedback:saved,opportunity:(await opportunityService.list()).find(item=>item.job.id===jobId)});
        return true;
      }
      if(req.method==="DELETE"){
        const removed=store.jobFeedback.remove(jobId);
        opportunityService.invalidate();
        decisionInbox?.scheduleRebuild?.();
        json(res,{ok:removed});
        return true;
      }
    }catch(error){
      sendError(res,error,{status:error.status||400,code:error.code||"OPPORTUNITY_ACTION_FAILED",message:error.message});
      return true;
    }
    return false;
  };
}
