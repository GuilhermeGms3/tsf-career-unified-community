import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib";
import { resolvePublicTarget } from "./public-url-policy.mjs";

// Public discovery GET transport: keep Host/SNI/certificate checks while the
// socket resolver receives only the exact addresses already approved here.
export function createPinnedPublicFetch({resolveTarget=resolvePublicTarget,requestImpl=null}={}){
return async function pinnedPublicFetch(value,{headers={},signal,method="GET"}={}){
  if(method!=="GET")throw Object.assign(new Error("Metodo nao permitido no transporte publico."),{code:"PUBLIC_FETCH_METHOD_NOT_ALLOWED"});
  const {url,addresses}=await resolveTarget(value);
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const requestHeaders=new Headers(headers);
    requestHeaders.set("accept-encoding","identity");
    requestHeaders.set("host",url.host);
    const request=(requestImpl||(url.protocol==="https:"?httpsRequest:httpRequest))(url,{
      method,headers:Object.fromEntries(requestHeaders),signal,autoSelectFamily:true,
      lookup:(_hostname,options,callback)=>options?.all?callback(null,addresses):callback(null,addresses[0].address,addresses[0].family),
    },response=>{
      const responseHeaders=new Headers();
      for(const [key,value] of Object.entries(response.headers)){
        if(value===undefined)continue;
        for(const item of Array.isArray(value)?value:[value])responseHeaders.append(key,item);
      }
      const status=response.statusCode;
      if(status===204||status===304){response.resume();resolve(new Response(null,{status,headers:responseHeaders}));return;}
      const decoder=({gzip:createGunzip,deflate:createInflate,br:createBrotliDecompress})[responseHeaders.get("content-encoding")?.toLowerCase()];
      let body=response;
      if(decoder){
        body=decoder();response.on("error",error=>body.destroy(error));
        body.on("close",()=>response.destroy());response.pipe(body);
        responseHeaders.delete("content-encoding");responseHeaders.delete("content-length");
      }
      try{resolve(new Response(Readable.toWeb(body),{status,headers:responseHeaders}));}
      catch(error){response.destroy();reject(error);}
    });
    request.on("error",reject);request.end();
  });
};
}

export const pinnedPublicFetch=createPinnedPublicFetch();
