import {requireLocalJsonMutation} from "../local-mutation-guard.mjs";
import {discoveryRecovery} from "../../src/discovery/discovery-recovery.mjs";
import {submissionRuntimeEnabled} from "../../src/application/submission-runtime-policy.mjs";

export function summarizeJobHuntRun(run={}){
  const {report,discoveryRunIds,...summary}=run;
  if (run.sourceRecovery?.length) summary.sourceRecovery = run.sourceRecovery.slice(0, 20).map(source => ({
    provider: source.provider, status: source.status, called: source.called,
    skippedRequests: source.skippedRequests || 0,
    alternativesExhausted: Boolean(source.alternativesExhausted),
    strategyAttempts: (source.strategyAttempts || []).slice(-4),
    recovery: source.recovery || discoveryRecovery(source.errors?.[0]?.errorCode, source.status),
    sites: [...new Map((source.sites || []).map(site => [site.site || site.source, {
      site: site.site || site.source, status: site.status, errorCode: site.errorCode,
      recovery: site.recovery || discoveryRecovery(site.errorCode, site.status),
    }])).values()],
  }));
  return summary;
}

export function createAutopilotRoutes({store,jobHuntService,readJson,json,sendError,publicIntegrationSettings}){
  return async function autopilotRoutes(req,res,url){
    if(url.pathname==="/api/auto-apply/question-fallback"&&req.method==="GET"){
      json(res,{ok:true,policy:store.questionFallbackPolicy.get()});return true;
    }
    if(url.pathname==="/api/auto-apply/question-fallback"&&req.method==="PUT"){
      try{requireLocalJsonMutation(req,url);json(res,{ok:true,policy:store.questionFallbackPolicy.save(await readJson(req))});}
      catch(error){sendError(res,error,{status:400,code:error.code||"QUESTION_FALLBACK_POLICY_INVALID",message:error.message});}return true;
    }
    if(url.pathname==="/api/auto-apply/policy"&&req.method==="GET"){
      json(res,{ok:true,policy:store.autoApplyPolicy.get(),questionFallbackPolicy:store.questionFallbackPolicy.get()});
      return true;
    }
    if(url.pathname==="/api/auto-apply/policy"&&req.method==="PUT"){
      try{requireLocalJsonMutation(req,url);json(res,{ok:true,policy:store.autoApplyPolicy.save(await readJson(req))});}
      catch(error){sendError(res,error,{status:400,code:error.code||"AUTO_APPLY_POLICY_INVALID",message:error.message});}
      return true;
    }
    if(url.pathname==="/api/job-hunt/capabilities"&&req.method==="GET"){
      const policy=store.autoApplyPolicy.get(),controlledSubmit=submissionRuntimeEnabled();
      json(res,{ok:true,sources:["indeed","linkedin","glassdoor","google","greenhouse","lever","ashby","smartrecruiters","workable","gupy","iel","programathor","solides","recrutei","nerdin","remotar","monitored_companies"],workModels:["REMOTE","HYBRID","ONSITE"],seniorities:["INTERNSHIP","JUNIOR","MID","SENIOR"],massHunt:true,canPrepareResume:true,autoSubmit:policy.enabled&&controlledSubmit,controlledSubmit,autoApplyPolicy:policy});
      return true;
    }
    if(url.pathname==="/api/job-hunt/profiles"&&req.method==="GET"){
      json(res,{ok:true,profiles:jobHuntService.listProfiles()});
      return true;
    }
    if(url.pathname==="/api/job-hunt/profiles"&&req.method==="POST"){
      try{json(res,{ok:true,profile:jobHuntService.saveProfile(await readJson(req))},201);}
      catch(error){sendError(res,error,{status:400,code:error.code||"JOB_HUNT_PROFILE_INVALID",message:error.message});}
      return true;
    }
    if(url.pathname==="/api/job-hunt/test-search"&&req.method==="POST"){
      try{json(res,{ok:true,result:await jobHuntService.testSearch(await readJson(req))});}
      catch(error){sendError(res,error,{status:400,code:error.code||"JOB_HUNT_TEST_FAILED",message:error.message});}
      return true;
    }
    const match=url.pathname.match(/^\/api\/job-hunt\/profiles\/([^/]+)(?:\/(run))?$/);
    if(match){
      const profileId=decodeURIComponent(match[1]),action=match[2]||"";
      try{
        if(!action&&req.method==="PUT"){json(res,{ok:true,profile:jobHuntService.saveProfile(await readJson(req),profileId)});return true;}
        if(!action&&req.method==="DELETE"){json(res,{ok:jobHuntService.removeProfile(profileId)});return true;}
        if(action==="run"&&req.method==="POST"){const run=jobHuntService.queue(profileId,{triggerType:"MANUAL"});json(res,{ok:true,run,runId:run.id||"",status:run.status||"RUNNING"},202);return true;}
      }catch(error){sendError(res,error,{status:error.status||400,code:error.code||"JOB_HUNT_ACTION_FAILED",message:error.message});return true;}
    }
    if(url.pathname==="/api/job-hunt/runs"&&req.method==="GET"){
      const profileId=String(url.searchParams.get("profileId")||"");
      const status=String(url.searchParams.get("status")||"").toUpperCase();
      const limit=Math.min(100,Math.max(1,Number(url.searchParams.get("limit")||100)));
      const detail=String(url.searchParams.get("detail")||"full").toLowerCase();
      const selected=store.jobHuntRuns.list(profileId,{limit,status,summary:detail==="summary"});
      const runs=detail==="summary"?selected.map(summarizeJobHuntRun):selected;
      json(res,{ok:true,runs,availabilityRuns:store.dailyRefreshRuns?.list?.(limit)||[],alerts:detail==="summary"?[]:store.jobAlerts.list({profileId})});
      return true;
    }
    const runMatch=url.pathname.match(/^\/api\/job-hunt\/runs\/([^/]+)(?:\/(pause|source))?$/);
    if(runMatch&&req.method==="POST"&&runMatch[2]==="source"){
      try{requireLocalJsonMutation(req,url);const input=await readJson(req),run=jobHuntService.queueSource(decodeURIComponent(runMatch[1]),input.source);json(res,{ok:true,run,runId:run.id,status:run.status,reused:Boolean(run.reused)},202);}
      catch(error){sendError(res,error,{status:error.status||400,code:error.code||"JOB_HUNT_SOURCE_FAILED",message:error.message});}
      return true;
    }
    if(runMatch&&req.method==="POST"&&runMatch[2]==="pause"){
      try{const run=jobHuntService.pause(decodeURIComponent(runMatch[1]));json(res,{ok:true,run});}
      catch(error){sendError(res,error,{status:error.status||400,code:error.code||"JOB_HUNT_PAUSE_FAILED",message:error.message});}
      return true;
    }
    if(runMatch&&req.method==="GET"&&!runMatch[2]){
      const run=store.jobHuntRuns.findById(decodeURIComponent(runMatch[1]));
      if(!run){sendError(res,Object.assign(new Error("Execução não encontrada."),{status:404}),{status:404,code:"JOB_HUNT_RUN_NOT_FOUND",message:"Execução não encontrada."});return true;}
      json(res,{ok:true,run,logs:store.structuredLogs?.list?.({runId:run.id,limit:100})||[]});
      return true;
    }
    if(url.pathname==="/api/automation/status"&&req.method==="GET"){
      const settings=publicIntegrationSettings(store.integrationSettings.get());
      const check=async target=>{try{const response=await fetch(target,{signal:AbortSignal.timeout(2000)});return {reachable:response.ok,httpStatus:response.status};}catch(error){return {reachable:false,errorCode:error.name==="TimeoutError"?"TIMEOUT":"OFFLINE"};}};
      const n8nUrl=String(process.env.N8N_INTERNAL_URL||"http://127.0.0.1:5678").replace(/\/$/,"");
      json(res,{ok:true,n8n:{configured:settings.configured,enabled:settings.enabled,...await check(`${n8nUrl}/healthz`)},whatsapp:{configured:Boolean(process.env.EVOLUTION_INSTANCE_NAME&&process.env.CAREER_WHATSAPP_TARGET),deliveryManagedBy:"N8N_EVOLUTION",credentialsVisibleToApp:false},profiles:jobHuntService.listProfiles(),recentRuns:store.jobHuntRuns.list().slice(0,20),recentAutomationRuns:store.automationRuns.list().slice(0,20)});
      return true;
    }
    return false;
  };
}
