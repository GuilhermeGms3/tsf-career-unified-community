export class GreenhouseMetadataClient {
  constructor({fetchImpl=fetch,timeout=5000}={}){this.fetchImpl=fetchImpl;this.timeout=timeout;}
  async fetchJob({boardToken,jobPostId}){
    if(!/^[a-zA-Z0-9_-]+$/.test(boardToken||"")||!/^[a-zA-Z0-9_-]+$/.test(jobPostId||""))return null;
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),this.timeout);
    try{const response=await this.fetchImpl(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs/${encodeURIComponent(jobPostId)}?questions=true`,{signal:controller.signal,headers:{accept:"application/json"}});if(!response.ok)return null;const data=await response.json();return {id:String(data.id||jobPostId),title:String(data.title||""),location:String(data.location?.name||""),updatedAt:String(data.updated_at||""),departments:data.departments||[],questions:data.questions||[],source:"greenhouse-public-job-board-api",fetchedAt:new Date().toISOString()};}finally{clearTimeout(timer)}
  }
  async checkJob({boardToken,jobPostId}){
    const checkedAt=new Date().toISOString();if(!/^[a-zA-Z0-9_-]+$/.test(boardToken||"")||!/^[a-zA-Z0-9_-]+$/.test(jobPostId||""))return {status:"UNKNOWN",checkedAt,authority:"greenhouse-public-job-board-api",code:"IDENTITY_INCOMPLETE"};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeout),reference=`greenhouse:${String(boardToken).toLowerCase()}:${jobPostId}`;
    try{const response=await this.fetchImpl(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs/${encodeURIComponent(jobPostId)}`,{signal:controller.signal,headers:{accept:"application/json"}});if(response.ok)return {status:"OPEN",checkedAt,authority:"greenhouse-public-job-board-api",reference};if([404,410].includes(response.status))return {status:"CLOSED",checkedAt,authority:"greenhouse-public-job-board-api",reference};return {status:"UNKNOWN",checkedAt,authority:"greenhouse-public-job-board-api",reference,code:`HTTP_${response.status}`};}catch(error){return {status:"ERROR",checkedAt,authority:"greenhouse-public-job-board-api",reference,code:error?.name==="AbortError"?"TIMEOUT":"NETWORK_ERROR"};}finally{clearTimeout(timer);}
  }
}
