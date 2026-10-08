export const EVIDENCE_PROVIDER_STATUSES=Object.freeze(["READY","NOT_INDEXED","DEGRADED","ERROR"]);

export class EvidenceProviderRegistry {
  constructor(providers=[]){this.providers=[];for(const provider of providers)this.register(provider);}
  register(provider){if(!provider?.id||typeof provider.evidence!=="function")throw new TypeError("Evidence provider must expose id and evidence().");if(this.providers.some(item=>item.id===provider.id))throw new Error(`Duplicate evidence provider: ${provider.id}`);this.providers.push(provider);return this;}
  resolve(context={}){const evidence=[],diagnostics=[];for(const provider of this.providers){try{const result=provider.evidence(context)||{};evidence.push(...(result.evidence||[]));diagnostics.push({provider:provider.id,status:EVIDENCE_PROVIDER_STATUSES.includes(result.status)?result.status:"READY",details:result.details||{}});}catch(error){diagnostics.push({provider:provider.id,status:"ERROR",details:{code:error?.code||"EVIDENCE_PROVIDER_FAILED"}});}}return {evidence,diagnostics};}
}

export class StaticCandidateEvidenceProvider {
  constructor(extractor){this.id="candidate-sources";this.extractor=extractor;}
  evidence(context={}){return {status:"READY",evidence:this.extractor(context.profile||{},context.resume||{},context.knowledgeFacts||[])};}
}
