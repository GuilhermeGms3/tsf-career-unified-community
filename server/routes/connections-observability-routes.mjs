import {requireLocalJsonMutation} from '../local-mutation-guard.mjs';
import {isTrustedWebRequest} from '../trusted-web-access.mjs';
import {sessionProviders} from '../../src/source-connections/session-provider-registry.mjs';
export function createConnectionsObservabilityRoutes({auth,readiness,observability,readJson,json,sendError}){
  return async(req,res,url)=>{
    if(!/^\/api\/(connections|vaults|observability)(\/|$)/.test(url.pathname))return false;
    try{
      requireLocalJsonMutation(req,url);
      if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&!isTrustedWebRequest(req,url))throw Object.assign(Error('LOCAL_HOST_REQUIRED'),{code:'LOCAL_HOST_REQUIRED',status:403});
      if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==url.origin)throw Object.assign(Error('SAME_ORIGIN_REQUIRED'),{code:'SAME_ORIGIN_REQUIRED',status:403});
      if(req.method!=='GET'&&!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw Object.assign(Error('JSON_REQUIRED'),{code:'JSON_REQUIRED',status:415});
      res.setHeader('Cache-Control','no-store');
      if(url.pathname==='/api/connections'&&req.method==='GET'){json(res,{ok:true,sources:(await readiness.list()).filter(source=>!source.sessionManaged&&source.authMode!=='PER_TENANT_SESSION')});return true;}
      if(url.pathname==='/api/vaults'&&req.method==='GET'){
        const readinessById=new Map((await readiness.list()).map(source=>[source.providerId,source]));
        json(res,{ok:true,vaults:sessionProviders().map(provider=>({...provider,status:auth.status(provider.id),capability:readinessById.get(provider.id)||null})),contextual:[{providerId:'workday',displayName:'Workday',scope:'PER_COMPANY',description:'A sessão depende da empresa e será solicitada ao preparar uma candidatura Workday.'}]});return true;
      }
      const provider=url.pathname.match(/^\/api\/connections\/(github|gupy)\/(connect|sync|check|disconnect)$/);
      if(provider&&req.method==='POST'){
        const input=await readJson(req),id=provider[1],action=provider[2];let result;
        if(action==='disconnect')result=await auth.disconnect(id);
        else if(action==='check')result=await auth.check(id);
        else {result=await auth.begin(id,{intent:action==='sync'?'SYNC':'CONNECT',jobId:input.jobId,force:input.force===true});
          if(id==='gupy'&&result.canLaunch){const ticket=auth.issueTicket(result.id);result.launchUrl=`career-unified-auth://auth?id=${result.id}&ticket=${ticket}&port=${url.port||(url.protocol==='https:'?443:80)}`;}
        }
        if(result.id)res.setHeader('X-Correlation-Id',result.id);json(res,{ok:true,...result});return true;
      }
      const vault=url.pathname.match(/^\/api\/vaults\/([a-z0-9-]+)\/(connect|create|check|disconnect)$/);
      if(vault&&req.method==='POST'){
        const input=await readJson(req),id=vault[1],action=vault[2];let result;
        if(action==='disconnect')result=await auth.disconnect(id);
        else if(action==='check')result=await auth.check(id);
        else {result=await auth.begin(id,{intent:'CONNECT',force:input.force===true,purpose:action==='create'?'CREATE_ACCOUNT':'LOGIN'});if(result.canLaunch){const ticket=auth.issueTicket(result.id);result.launchUrl=`career-unified-auth://auth?id=${result.id}&ticket=${ticket}&port=${url.port||(url.protocol==='https:'?443:80)}`;}}
        if(result.id)res.setHeader('X-Correlation-Id',result.id);json(res,{ok:true,...result});return true;
      }
      const request=url.pathname.match(/^\/api\/connections\/requests\/([^/]+)\/(poll|token)$/);
      if(request&&req.method==='POST'){const input=await readJson(req);json(res,{ok:true,...await(request[2]==='poll'?auth.poll(request[1]):auth.completeToken(request[1],input.token))});return true;}
      const handoff=url.pathname.match(/^\/api\/connections\/handoff\/([^/]+)\/(claim|complete|event)$/);
      if(handoff&&req.method==='POST'){
        const input=await readJson(req,{limit:600000}),ticket=String(req.headers.authorization||'').replace(/^Bearer /,'');
        json(res,handoff[2]==='claim'?auth.claim(handoff[1],ticket):handoff[2]==='event'?auth.runnerEvent(handoff[1],ticket,input):await auth.completeSession(handoff[1],ticket,input.state));return true;
      }
      if(url.pathname==='/api/observability'&&req.method==='GET'){json(res,{ok:true,...observability.overview(Object.fromEntries(url.searchParams))});return true;}
      const problem=url.pathname.match(/^\/api\/observability\/problems\/([^/]+)$/);
      if(problem&&req.method==='POST'){const input=await readJson(req);observability.logs.setProblemStatus(problem[1],input.status);json(res,{ok:true});return true;}
      if(url.pathname==='/api/observability/export'&&req.method==='GET'){
        const filters=Object.fromEntries(url.searchParams),full=filters.full==='true';delete filters.full;
        const txt=await observability.exportText(filters,full);res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':`attachment; filename="career-diagnostics-${full?'full':'filtered'}.txt"`,'X-Content-Type-Options':'nosniff'});res.end(txt);return true;
      }
      json(res,{ok:false,code:'NOT_FOUND'},404);return true;
    }catch(error){sendError(res,error,{status:error.status||400,code:error.code||'CONNECTION_OPERATION_FAILED',message:error.code||'CONNECTION_OPERATION_FAILED'});return true;}
  };
}
