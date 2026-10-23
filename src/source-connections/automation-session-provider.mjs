import {applicationProvider} from "../discovery/source-attribution.mjs";
import {hostAllowed,sessionProviderById} from "./session-provider-registry.mjs";

export function createAutomationSessionProvider(auth){
  return async(provider,url)=>{
    const policy=sessionProviderById(provider);
    if(!policy)return undefined;
    let target;try{target=new URL(url);}catch{return undefined;}
    if(target.protocol!=="https:"||target.username||target.password||!hostAllowed(policy,target.hostname)||applicationProvider(url).toLowerCase()!==provider)return undefined;
    // SourceAuth validates expiry and decrypts only this provider's scoped state.
    return auth.storageState(provider,target.hostname);
  };
}
