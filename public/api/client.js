import {cachePolicyFor,invalidateForMutation,queryCache} from "../app/query-cache.js";
import {humanError} from '../app/presentation.js';

export const apiTimings=[];
globalThis.__careerApiPerformance=apiTimings;
async function request(path,options={}){const started=performance.now(),{cache,staleTime,cacheTime,skipInvalidation,...fetchOptions}=options;try{const response=await fetch(path,{...fetchOptions,headers:{...(fetchOptions.body||!["GET","HEAD"].includes(String(fetchOptions.method||"GET").toUpperCase())?{"content-type":"application/json"}:{}),...(fetchOptions.headers||{})}}),data=await response.json();if(!response.ok){const view=humanError({code:data.code||'API_ERROR'}),error=new Error(view.message+' '+view.nextAction);error.code=view.code;error.status=response.status;error.nextAction=view.nextAction;throw error;}return data;}catch(error){if(error.code)throw error;throw Object.assign(new Error('Não foi possível conectar ao aplicativo. Verifique a conexão e tente novamente.'),{code:'NETWORK_ERROR',cause:error});}finally{apiTimings.push({path:String(path).split("?")[0],method:String(fetchOptions.method||"GET").toUpperCase(),durationMs:Math.round(performance.now()-started),finishedAt:new Date().toISOString()});if(apiTimings.length>100)apiTimings.shift();}}

export async function api(path,options={}){const method=String(options.method||"GET").toUpperCase();if(method!=="GET"){const data=await request(path,options);if(!options.skipInvalidation)invalidateForMutation(path);return data;}if(options.cache===false)return request(path,options);const policy=cachePolicyFor(path);return queryCache.query({key:`GET:${path}`,loader:()=>request(path,options),staleTime:options.staleTime??policy.staleTime,cacheTime:options.cacheTime??policy.cacheTime});}

export {queryCache};
