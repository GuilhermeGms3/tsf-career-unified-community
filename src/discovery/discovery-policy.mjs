export class DiscoveryPolicy{
  constructor({maxProviders=8,maxJobsPerProvider=50,maxRequestsPerProvider=4,timeoutMs=10000,retries=2,staleAfterHours=72}={}){Object.assign(this,{maxProviders,maxJobsPerProvider,maxRequestsPerProvider,timeoutMs,retries,staleAfterHours});}
  constrain(input={}){return {...input,limit:Math.max(1,Math.min(Number(input.limit)||this.maxJobsPerProvider,this.maxJobsPerProvider)),providers:(input.providers||[]).slice(0,this.maxProviders)};}
}
