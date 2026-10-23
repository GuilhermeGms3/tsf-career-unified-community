import {resolvePublicTarget} from "../security/public-url-policy.mjs";
import {pinnedPublicFetch} from "../security/pinned-public-fetch.mjs";
export async function assertSafeDiscoveryUrl(value){return (await resolvePublicTarget(value)).url;}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class SafeHttpClient{
  constructor({fetchImpl=pinnedPublicFetch,timeoutMs=10000,maxRedirects=3,retries=2,cacheTtlMs=60000,cacheMaxEntries=64}={}){Object.assign(this,{fetchImpl,timeoutMs,maxRedirects,retries,cacheTtlMs,cacheMaxEntries});this.cache=new Map();}
  async getJson(value,{headers={},cache=true,retries=this.retries}={}){const key=String(value),cached=this.cache.get(key);if(cache&&cached&&cached.expiresAt>Date.now())return cached.value;const result=await this.withRetries(()=>this.request(key,headers),retries);if(cache)this.cache.set(key,{value:result,expiresAt:Date.now()+this.cacheTtlMs});return result;}
  async getText(value,{headers={},cache=true,maxBytes=2000000,retries=this.retries}={}){const key=`text:${String(value)}`,cached=this.cache.get(key);if(cache&&cached&&cached.expiresAt>Date.now())return cached.value;const result=await this.withRetries(()=>this.request(String(value),{accept:"text/html,application/xhtml+xml,application/xml;q=.9,*/*;q=.8",...headers},"text",maxBytes),retries);if(cache)this.cache.set(key,{value:result,expiresAt:Date.now()+this.cacheTtlMs});return result;}
  async withRetries(work,retries=this.retries){
    for(let attempt=0;;attempt++){
      try{return await work();}
      catch(error){
        if(attempt>=Math.max(0,Math.min(this.retries,Number(retries)||0))||!(error.code==="RATE_LIMITED"||error.status>=500||["AbortError","TimeoutError"].includes(error.name)))throw error;
        const retryAfter=error.retryAfter==null?NaN:Number(error.retryAfter);
        await wait(Number.isFinite(retryAfter)?Math.max(0,Math.min(30000,retryAfter*1000)):Math.min(2000,500*2**attempt));
      }
    }
  }
  async request(value,headers,responseType="json",maxBytes=2000000){
    // One deadline covers redirects AND body streaming, not just response headers.
    const controller=new AbortController();
    let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{
      const error=Object.assign(new Error("A consulta pública excedeu o tempo máximo."),{name:"TimeoutError",code:"ENGINE_TIMEOUT"});
      controller.abort(error);reject(error);
    },this.timeoutMs);});
    const work=async()=>{
      let current=(await assertSafeDiscoveryUrl(value)).toString();
      for(let redirect=0;redirect<=this.maxRedirects;redirect++){
        controller.signal.throwIfAborted();
        const response=await this.fetchImpl(current,{method:"GET",redirect:"manual",signal:controller.signal,headers:{accept:"application/json",...headers},credentials:"omit"});
        if(response.status>=300&&response.status<400){
          const location=response.headers.get("location");
          await response.body?.cancel?.();
          if(!location||redirect===this.maxRedirects)throw Object.assign(new Error("Limite de redirecionamentos excedido."),{code:"REDIRECT_LIMIT"});
          current=(await assertSafeDiscoveryUrl(new URL(location,current))).toString();continue;
        }
        if(!response.ok){
          await response.body?.cancel?.();
          throw Object.assign(new Error(`Provider respondeu HTTP ${response.status}.`),{code:response.status===429?"RATE_LIMITED":`HTTP_${response.status}`,status:response.status,finalUrl:current,retryAfter:response.headers.get("retry-after")});
        }
        const tooLarge=()=>Object.assign(new Error("Resposta pública excede o limite permitido."),{code:"DISCOVERY_RESPONSE_TOO_LARGE"});
        if(Number(response.headers.get("content-length")||0)>maxBytes){await response.body?.cancel?.();throw tooLarge();}
        let text;
        if(response.body?.getReader){
          const reader=response.body.getReader(),chunks=[];
          const cancel=()=>{void reader.cancel().catch(()=>{});};
          controller.signal.addEventListener("abort",cancel,{once:true});
          let bytes=0;
          try{
            while(true){
              const {done,value}=await reader.read();if(done)break;
              bytes+=value.byteLength;
              if(bytes>maxBytes){await reader.cancel();throw tooLarge();}
              chunks.push(Buffer.from(value));
            }
          }finally{controller.signal.removeEventListener("abort",cancel);reader.releaseLock();}
          text=Buffer.concat(chunks).toString("utf8");
        }else text=response.text?await response.text():JSON.stringify(await response.json());
        if(Buffer.byteLength(text,"utf8")>maxBytes)throw tooLarge();
        return {data:responseType==="text"?text:JSON.parse(text),url:current,response};
      }
      throw new Error("Redirecionamento invalido.");
    };
    try{return await Promise.race([work(),deadline]);}
    finally{
      clearTimeout(timer);controller.abort();
      for(const [key,entry] of this.cache)if(entry.expiresAt<=Date.now())this.cache.delete(key);
      while(this.cache.size>=this.cacheMaxEntries&&this.cache.size)this.cache.delete(this.cache.keys().next().value);
    }
  }
}
