import {providerDiagnostic} from "./types.mjs";
export class ProviderRegistry{
  constructor(providers=[]){this.providers=new Map();for(const provider of providers)this.register(provider);}
  register(provider){for(const key of ["id","category","capabilities","health"]){if(provider?.[key]===undefined)throw new TypeError(`Provider sem ${key}`);}if(this.providers.has(provider.id))throw new Error(`Provider duplicado: ${provider.id}`);this.providers.set(provider.id,provider);return this;}
  get(id){return this.providers.get(id)||null;}
  list({category,capability}={}){return [...this.providers.values()].filter(p=>(!category||p.category===category)&&(!capability||p.capabilities.includes(capability)));}
  async diagnostics(){return Promise.all(this.list().map(async provider=>{try{return {id:provider.id,category:provider.category,capabilities:provider.capabilities,...await provider.health()};}catch(error){return {id:provider.id,category:provider.category,capabilities:provider.capabilities,...providerDiagnostic("ERROR",{code:error.code||"PROVIDER_HEALTH_ERROR",message:error.message})};}}));}
}
