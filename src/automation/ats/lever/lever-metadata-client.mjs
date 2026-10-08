const API_HOSTS=Object.freeze({global:"api.lever.co",eu:"api.eu.lever.co"});

export class LeverMetadataClient{
  constructor({fetchImpl=globalThis.fetch,timeoutMs=10000,clock=()=>new Date()}={}){Object.assign(this,{fetchImpl,timeoutMs,clock});}
  async checkJob(identity){
    const host=API_HOSTS[identity.region]||API_HOSTS.global,url=`https://${host}/v0/postings/${encodeURIComponent(identity.site)}/${encodeURIComponent(identity.postingId)}`,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const response=await this.fetchImpl(url,{headers:{accept:"application/json"},redirect:"error",signal:controller.signal}),checkedAt=this.clock().toISOString();
      if(response.status===404)return {status:"CLOSED",checkedAt,authority:"lever-public-postings-api",reference:url,code:"LEVER_POSTING_NOT_FOUND"};
      if(!response.ok)return {status:"ERROR",checkedAt,authority:"lever-public-postings-api",reference:url,code:`LEVER_POSTINGS_HTTP_${response.status}`};
      const posting=await response.json();
      if(String(posting?.id||"")!==String(identity.postingId))return {status:"ERROR",checkedAt,authority:"lever-public-postings-api",reference:url,code:"LEVER_POSTING_ID_MISMATCH"};
      return {status:"OPEN",checkedAt,authority:"lever-public-postings-api",reference:url};
    }catch(error){return {status:"ERROR",checkedAt:this.clock().toISOString(),authority:"lever-public-postings-api",reference:url,code:error?.name==="AbortError"?"LEVER_POSTINGS_TIMEOUT":"LEVER_POSTINGS_UNAVAILABLE"};}
    finally{clearTimeout(timer);}
  }
}
