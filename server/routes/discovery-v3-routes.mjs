export function createDiscoveryV3Routes({store,searchIntentService,companyRadarService,providerTestService,readJson,json,sendError}){
  return async function discoveryV3Routes(req,res,url){
    try{
      if(url.pathname==="/api/discovery-v3/job-families"&&req.method==="GET"){json(res,{ok:true,families:searchIntentService.families.list()});return true;}
      if(url.pathname==="/api/discovery-v3/search-intent/preview"&&req.method==="POST"){const body=await readJson(req);json(res,{ok:true,preview:searchIntentService.preview(body.intent||body,body.queryBudget||{})});return true;}
      const intentMatch=url.pathname.match(/^\/api\/discovery-v3\/search-intents\/([^/]+)$/);if(intentMatch&&req.method==="GET"){const profileId=decodeURIComponent(intentMatch[1]),intent=store.searchIntents.forProfile(profileId);json(res,{ok:true,intent,expandedQueries:intent?store.expandedQueries.forIntent(intent.id,intent.version):[]});return true;}
      if(url.pathname==="/api/discovery-v3/company-radar"&&req.method==="GET"){json(res,{ok:true,companies:store.watchlists.all(),boards:store.watchlists.boards()});return true;}
      if(url.pathname==="/api/discovery-v3/company-radar/detect"&&req.method==="POST"){json(res,{ok:true,detection:await companyRadarService.detect(await readJson(req))});return true;}
      if(url.pathname==="/api/discovery-v3/company-radar"&&req.method==="POST"){json(res,{ok:true,company:await companyRadarService.save(await readJson(req))},201);return true;}
      if(url.pathname==="/api/discovery-v3/company-radar/bulk"&&req.method==="POST"){const body=await readJson(req);json(res,{ok:true,results:await companyRadarService.bulk(body.companies||[])});return true;}
      if(url.pathname==="/api/discovery-v3/capabilities"&&req.method==="GET"){json(res,{ok:true,providers:providerTestService.list().map(item=>({providerId:item.providerId,displayName:item.displayName,setupStatus:item.setupStatus,capabilities:item.capabilities}))});return true;}
      if(url.pathname==="/api/discovery-v3/runs"&&req.method==="GET"){json(res,{ok:true,runs:store.jobHuntRuns.list(url.searchParams.get("profileId")||"")});return true;}
      if(url.pathname==="/api/discovery-v3/application-methods"&&req.method==="GET"){json(res,{ok:true,methods:["ATS","EMAIL","WHATSAPP","DIRECT_MESSAGE","EXTERNAL_FORM","CAREER_PAGE","MANUAL","UNKNOWN"],emailSending:false,autoSubmit:false,outreach:false});return true;}
    }catch(error){sendError(res,error,{status:error.status||400,code:error.code||"DISCOVERY_V3_FAILED",message:error.message});return true;}
    return false;
  };
}
