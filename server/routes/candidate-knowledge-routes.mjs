export function createCandidateKnowledgeRoutes({store,githubEvidenceProvider=null,githubRecalibration=null,readJson,json,sendError}){
  return async function candidateKnowledgeRoutes(req,res,url){
    try{
      if(url.pathname==="/api/candidate-knowledge"&&req.method==="GET"){
        if(url.searchParams.get("format")==="legacy")json(res,{ok:true,facts:store.candidateFacts.all(),answers:store.candidateAnswers.all()});
        else json(res,{ok:true,...store.candidateKnowledge.summary()});
        return true;
      }
      if(url.pathname==="/api/candidate-knowledge/inventory"&&req.method==="GET"){
        json(res,{ok:true,inventory:store.candidateKnowledge.inventory()});return true;
      }
      if(url.pathname==="/api/candidate-knowledge/providers/github"&&req.method==="GET"){
        json(res,{ok:true,provider:githubEvidenceProvider?.evidence()||{status:"NOT_INDEXED",evidence:[],details:{}}});return true;
      }
      if(url.pathname==="/api/candidate-knowledge/providers/github/sync"&&req.method==="POST"){
        if(!githubEvidenceProvider)throw Object.assign(new Error("GitHub Evidence Provider indisponível."),{code:"GITHUB_PROVIDER_UNAVAILABLE",status:503});
        json(res,{ok:true,sync:await githubEvidenceProvider.sync()});return true;
      }
      if(url.pathname==="/api/candidate-knowledge/providers/github/recalculate"&&req.method==="POST"){
        if(!githubRecalibration)throw Object.assign(new Error("Recalibração indisponível."),{status:503});
        json(res,{ok:true,recalibration:await githubRecalibration.run()});return true;
      }
      if(url.pathname==="/api/candidate-knowledge/entities"&&req.method==="POST"){
        json(res,{ok:true,entity:store.candidateKnowledge.saveEntity(await readJson(req))},201);return true;
      }
      const entity=url.pathname.match(/^\/api\/candidate-knowledge\/entities\/([^/]+)$/);
      if(entity&&req.method==="GET"){json(res,{ok:true,entity:store.candidateKnowledge.entityDetail(decodeURIComponent(entity[1]))});return true;}
      if(url.pathname==="/api/candidate-knowledge/enrichment"&&req.method==="POST"){
        json(res,{ok:true,proposal:store.candidateKnowledge.proposeEnrichment(await readJson(req))},201);return true;
      }
      const proposal=url.pathname.match(/^\/api\/candidate-knowledge\/proposals\/([^/]+)\/review$/);
      if(proposal&&req.method==="POST"){json(res,{ok:true,...store.candidateKnowledge.reviewProposal(decodeURIComponent(proposal[1]),await readJson(req))});return true;}
      const skill=url.pathname.match(/^\/api\/candidate-knowledge\/skills\/([^/]+)$/);
      if(skill&&req.method==="GET"){json(res,{ok:true,skill:store.candidateKnowledge.skillDetail(decodeURIComponent(skill[1]))});return true;}
      if(url.pathname==="/api/candidate-knowledge/claims/validate"&&req.method==="POST"){
        json(res,{ok:true,claim:store.candidateKnowledge.validateClaim(await readJson(req))},201);return true;
      }
      if(url.pathname==="/api/candidate-knowledge/gaps"&&req.method==="GET"){
        json(res,{ok:true,gaps:store.candidateKnowledge.gaps(url.searchParams.get("jobId")||null)});return true;
      }
      const gap=url.pathname.match(/^\/api\/candidate-knowledge\/gaps\/([^/]+)\/resolve$/);
      if(gap&&req.method==="POST"){json(res,{ok:true,...store.candidateKnowledge.resolveGap(decodeURIComponent(gap[1]),await readJson(req))});return true;}
      if(url.pathname==="/api/candidate-knowledge/facts"&&req.method==="POST"){
        json(res,{ok:true,fact:store.candidateKnowledge.save(await readJson(req))},201);return true;
      }
      const detail=url.pathname.match(/^\/api\/candidate-knowledge\/facts\/([^/]+)$/);
      if(detail){
        const key=decodeURIComponent(detail[1]);
        if(req.method==="GET"){json(res,{ok:true,fact:store.candidateKnowledge.detail(key)});return true;}
        if(req.method==="PUT"){json(res,{ok:true,fact:store.candidateKnowledge.update(key,await readJson(req))});return true;}
        if(req.method==="DELETE"){json(res,store.candidateFacts.remove(key,{actor:"USER"}));return true;}
      }
      const status=url.pathname.match(/^\/api\/candidate-knowledge\/facts\/([^/]+)\/status$/);
      if(status&&req.method==="POST"){
        const input=await readJson(req);json(res,{ok:true,fact:store.candidateFacts.changeStatus(decodeURIComponent(status[1]),input.status,{actor:"USER"})});return true;
      }
      const answer=url.pathname.match(/^\/api\/candidate-knowledge\/answers\/([^/]+)$/);
      if(answer&&req.method==="PUT"){
        const input=await readJson(req),fingerprint=decodeURIComponent(answer[1]);
        const updated=Object.hasOwn(input,"value")?store.candidateAnswers.updateConfirmed(fingerprint,input):store.candidateAnswers.updatePolicy(fingerprint,input);
        json(res,{ok:true,answer:updated});return true;
      }
    }catch(error){
      sendError(res,error,{status:error.status||400,code:error.code||"CANDIDATE_KNOWLEDGE_ACTION_FAILED",message:error.message});return true;
    }
    return false;
  };
}
