import {parseAshbyIdentity} from "./ashby-target-policy.mjs";

export class AshbyMetadataClient{
  constructor({fetchImpl=globalThis.fetch,timeoutMs=10000,clock=()=>new Date()}={}){Object.assign(this,{fetchImpl,timeoutMs,clock});}
  async checkJob(identity){
    const url=`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(identity.board)}`,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
    try{
      const response=await this.fetchImpl(url,{headers:{accept:"application/json"},redirect:"error",signal:controller.signal}),checkedAt=this.clock().toISOString();
      if(response.status===404)return {status:"CLOSED",checkedAt,authority:"ashby-public-job-posting-api",reference:url,code:"ASHBY_BOARD_NOT_FOUND"};
      if(!response.ok)return {status:"ERROR",checkedAt,authority:"ashby-public-job-posting-api",reference:url,code:`ASHBY_POSTINGS_HTTP_${response.status}`};
      const payload=await response.json(),jobs=Array.isArray(payload?.jobs)?payload.jobs:[];
      const posting=jobs.find(job=>String(job?.id||"")===String(identity.postingId)||[job?.jobUrl,job?.applyUrl].some(candidate=>parseAshbyIdentity(candidate).postingId===String(identity.postingId)));
      if(!posting)return {status:"CLOSED",checkedAt,authority:"ashby-public-job-posting-api",reference:url,code:"ASHBY_POSTING_NOT_FOUND"};
      if(posting.isListed===false)return {status:"CLOSED",checkedAt,authority:"ashby-public-job-posting-api",reference:url,code:"ASHBY_POSTING_NOT_LISTED"};
      return {status:"OPEN",checkedAt,authority:"ashby-public-job-posting-api",reference:url};
    }catch(error){return {status:"ERROR",checkedAt:this.clock().toISOString(),authority:"ashby-public-job-posting-api",reference:url,code:error?.name==="AbortError"?"ASHBY_POSTINGS_TIMEOUT":"ASHBY_POSTINGS_UNAVAILABLE"};}
    finally{clearTimeout(timer);}
  }
}
