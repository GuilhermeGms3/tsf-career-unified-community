import {parseNerdinIdentity} from "./nerdin-target-policy.mjs";

export class NerdinMetadataClient{
  constructor({fetchImpl=globalThis.fetch,timeoutMs=10000,clock=()=>new Date()}={}){Object.assign(this,{fetchImpl,timeoutMs,clock});}
  async checkPage(page,identity,response){
    if(new URL(page.url()).protocol!=="https:")return null;
    const observed=parseNerdinIdentity(page.url());
    if(!response?.ok()||!observed.providerJobId||observed.providerJobId!==identity.providerJobId)return null;
    const text=await page.locator("body").innerText();
    if(/vaga n[aã]o encontrada|n[aã]o aceita mais candidaturas|vaga (?:foi )?encerrada/i.test(text))return {status:"CLOSED",checkedAt:this.clock().toISOString(),authority:"nerdin-public-browser-form",reference:identity.applicationUrl,code:"NERDIN_JOB_CLOSED"};
    if(await page.locator("#form-candidatura [name='nome_candidato']").count()!==1||await page.locator("#form-candidatura [name='curriculo']").count()!==1)return null;
    return {status:"OPEN",checkedAt:this.clock().toISOString(),authority:"nerdin-public-browser-form",reference:identity.applicationUrl};
  }
  async checkJob(identity){const url=identity.applicationUrl||identity.canonicalUrl,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);try{const response=await this.fetchImpl(url,{headers:{accept:"text/html"},redirect:"error",signal:controller.signal}),checkedAt=this.clock().toISOString();if(response.status===404||response.status===410)return {status:"CLOSED",checkedAt,authority:"nerdin-public-application-form",reference:url,code:`NERDIN_JOB_HTTP_${response.status}`};if(!response.ok)return {status:"ERROR",checkedAt,authority:"nerdin-public-application-form",reference:url,code:`NERDIN_JOB_HTTP_${response.status}`};const html=await response.text();if(/vaga n[aã]o encontrada|n[aã]o aceita mais candidaturas|vaga (?:foi )?encerrada/i.test(html))return {status:"CLOSED",checkedAt,authority:"nerdin-public-application-form",reference:url,code:"NERDIN_JOB_CLOSED"};if(!/id=["']form-candidatura["']|name=["']csrf_token["']/i.test(html))return {status:"ERROR",checkedAt,authority:"nerdin-public-application-form",reference:url,code:"NERDIN_APPLICATION_FORM_NOT_OBSERVED"};return {status:"OPEN",checkedAt,authority:"nerdin-public-application-form",reference:url};}catch(error){return {status:"ERROR",checkedAt:this.clock().toISOString(),authority:"nerdin-public-application-form",reference:url,code:error?.name==="AbortError"?"NERDIN_JOB_TIMEOUT":"NERDIN_JOB_UNAVAILABLE"};}finally{clearTimeout(timer);}}
}
