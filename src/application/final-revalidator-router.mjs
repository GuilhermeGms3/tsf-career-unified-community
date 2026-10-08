export class FinalRevalidatorRouter{
  constructor({store,browserManager,revalidators={}}={}){Object.assign(this,{store,browserManager,revalidators});}
  providerFor(applicationId){const plan=this.store.applicationPlans.forApplication(applicationId),provider=String(plan?.atsType||"").toLowerCase(),revalidator=this.revalidators[provider];if(!revalidator)throw Object.assign(new Error(`Revalidação final não homologada para ${provider||"unknown"}.`),{code:"FINAL_REVALIDATOR_NOT_AVAILABLE"});return revalidator;}
  resolve(applicationId){return this.providerFor(applicationId).resolve(applicationId);}
  inspect(applicationId,options){return this.providerFor(applicationId).inspect(applicationId,options);}
  prepareForSubmit(applicationId,options){return this.providerFor(applicationId).prepareForSubmit(applicationId,options);}
}
