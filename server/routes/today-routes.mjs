export function createTodayRoutes({store,decisionInbox,dailyRefreshService=null,readJson,json,sendError}){
  return async function todayRoutes(req,res,url){
    try{
      if(url.pathname==="/api/today"&&req.method==="GET"){
        const inbox=await decisionInbox.read({fresh:url.searchParams.get("fresh")==="true"});
        json(res,{ok:true,inbox:{...inbox,refreshRun:dailyRefreshService?.status?.()||null}});
        return true;
      }
      if(url.pathname==="/api/today/refresh"&&req.method==="POST"){
        const run=dailyRefreshService.start();
        json(res,{ok:true,run,statusUrl:`/api/today/refresh/${encodeURIComponent(run.id)}`},202);
        return true;
      }
      const refreshMatch=url.pathname.match(/^\/api\/today\/refresh\/([^/]+)$/);
      if(refreshMatch&&req.method==="GET"){
        const run=dailyRefreshService.status(decodeURIComponent(refreshMatch[1]));
        if(!run){sendError(res,Object.assign(new Error("Atualização diária não encontrada."),{status:404}),{status:404,code:"DAILY_REFRESH_NOT_FOUND",message:"Atualização diária não encontrada."});return true;}
        json(res,{ok:true,run});
        return true;
      }
      if(url.pathname==="/api/today/dismiss"&&req.method==="POST"){
        const input=await readJson(req);
        json(res,{ok:true,dismissal:store.decisionDismissals.dismiss(input.itemKey,input.reason)});
        return true;
      }
      if(url.pathname==="/api/today/dismiss"&&req.method==="DELETE"){
        const input=await readJson(req);
        json(res,{ok:store.decisionDismissals.restore(input.itemKey)});
        return true;
      }
      if(url.pathname==="/api/today/review"&&req.method==="POST"){
        json(res,{ok:true,state:store.dailyReviewState.markReviewed()});
        return true;
      }
    }catch(error){
      sendError(res,error,{status:error.status||400,code:error.code||"TODAY_ACTION_FAILED",message:error.message});
      return true;
    }
    return false;
  };
}
