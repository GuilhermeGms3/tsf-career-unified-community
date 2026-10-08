import {classifyJobFamily} from "../relevance/pre-match-plausibility.mjs";

export class LinkedInEnrichmentService {
  constructor({client,cache,maxPerSearch=3}){Object.assign(this,{client,cache,maxPerSearch});this.inFlight=new Map();}
  async enrich(jobs,{budgetMs=15000}={}){
    const deadline=Date.now()+budgetMs;
    const metrics={attempts:0,successes:0,timeouts:0,failures:0,cacheHits:0,budgetSkipped:0};
    let used=0;
    for(const job of jobs){
      if(String(job.source).toLowerCase()!=="linkedin")continue;
      const id=String(job.sourceUrl||job.url||"").match(/^https:\/\/(?:www\.)?linkedin\.com\/jobs\/view\/(?:[^/?]*-)?(\d+)(?:[/?]|$)/)?.[1];
      job.provenance={...job.provenance,linkedin:{enrichmentStatus:job.description?"ENRICHED":"ENRICHMENT_PENDING"}};
      if(job.description||!id)continue;
      const key=`linkedin-description-v1:${id}`,cached=this.cache.get(key);
      let details=cached;
      if(cached)metrics.cacheHits++;
      else if(used<this.maxPerSearch&&Date.now()+8000<deadline&&classifyJobFamily(job).primaryJobFamily!=="UNKNOWN"){
        used++;metrics.attempts++;
        if(!this.inFlight.has(key))this.inFlight.set(key,Promise.resolve().then(()=>this.client(id)).finally(()=>this.inFlight.delete(key)));
        try{details=await this.inFlight.get(key);if(details?.status==="ENRICHED"){this.cache.put(key,"ENRICHMENT",details);metrics.successes++;}else if(details?.status==="ENRICHMENT_TIMED_OUT")metrics.timeouts++;else metrics.failures++;}
        catch{details={status:"ENRICHMENT_FAILED"};metrics.failures++;}
      }else metrics.budgetSkipped++;
      if(details){job.description=details.description||job.description;job.applicationUrl=details.applicationUrl||job.applicationUrl;job.canonicalUrl=job.applicationUrl||job.canonicalUrl;job.provenance.linkedin={enrichmentStatus:details.status,cacheHit:Boolean(cached)};}
    }
    return {jobs,metrics};
  }
}
