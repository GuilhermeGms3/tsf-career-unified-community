import {createProviderRegistry} from "../src/discovery/provider-catalog.mjs";
import {VERIFIED_COMPANY_TARGETS,RETIRED_COMPANY_TARGETS} from "../src/discovery/company-targets/verified-company-targets.mjs";

const args=new Map(process.argv.slice(2).map(value=>{const [key,...rest]=value.replace(/^--/,"").split("=");return [key,rest.join("=")||true];}));
const apply=args.has("apply"),baseUrl=String(args.get("base-url")||"http://127.0.0.1:7123").replace(/\/$/,""),providerFilter=String(args.get("provider")||"").toLowerCase();
const targets=VERIFIED_COMPANY_TARGETS.filter(item=>!providerFilter||item.provider===providerFilter),registry=createProviderRegistry({searchClient:async()=>({jobs:[]})});

async function api(path,options={}){const response=await fetch(`${baseUrl}${path}`,{...options,headers:{accept:"application/json",...(options.body?{"content-type":"application/json"}:{}),...(options.headers||{})}});if(!response.ok)throw Object.assign(new Error(`Hub respondeu HTTP ${response.status}.`),{code:`HUB_HTTP_${response.status}`});return response.json();}
async function validate(target){const started=Date.now();try{const jobs=await registry.get(target.provider).listCompanyJobs({...target,limit:1});return {...target,status:jobs.length?"VALID":"EMPTY",jobs:jobs.length,latencyMs:Date.now()-started};}catch(error){return {...target,status:"ERROR",jobs:0,latencyMs:Date.now()-started,errorCode:error.code||"TARGET_VALIDATION_FAILED"};}}
async function pooled(items,concurrency,worker){const results=new Array(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(cursor<items.length){const index=cursor++;results[index]=await worker(items[index]);}}));return results;}

const results=await pooled(targets,4,validate),valid=results.filter(item=>item.status==="VALID"),empty=results.filter(item=>item.status==="EMPTY"),errors=results.filter(item=>item.status==="ERROR"),applied=[],retired=[];
if(apply){
  for(const target of valid){const response=await api("/api/source-center/companies/monitor",{method:"POST",body:JSON.stringify({name:target.company,careerUrl:target.careerUrl,priority:target.priority||70,active:true})});applied.push({provider:target.provider,organizationKey:target.organizationKey,id:response.company?.id||""});}
  const current=(await api("/api/source-center/companies")).companies||[];
  for(const stale of RETIRED_COMPANY_TARGETS){const target=current.find(item=>item.provider===stale.provider&&item.organizationKey===stale.organizationKey&&item.enabled);if(!target?.id)continue;await api(`/api/source-center/companies/boards/${encodeURIComponent(target.id)}/active`,{method:"PATCH",body:JSON.stringify({active:false})});retired.push({...stale,boardId:target.id});}
}
const summary={ok:errors.length===0,mode:apply?"APPLY":"VALIDATE_ONLY",catalog:targets.length,validated:valid.length,empty:empty.length,errors:errors.length,applied:applied.length,retired:retired.length,byProvider:Object.fromEntries([...new Set(targets.map(item=>item.provider))].map(provider=>[provider,{catalog:targets.filter(item=>item.provider===provider).length,valid:valid.filter(item=>item.provider===provider).length,empty:empty.filter(item=>item.provider===provider).length,errors:errors.filter(item=>item.provider===provider).length}])),results,retiredTargets:retired};
process.stdout.write(`${JSON.stringify(summary,null,2)}\n`);
if(errors.length)process.exitCode=1;
