import { LlmProvider } from "./llm-provider.mjs";
export class FakeProvider extends LlmProvider{
  static type="fake";
  constructor({responses={},mode="valid",latencyMs=0,models=["fake-fast","fake-balanced"]}={}){super();this.responses=responses;this.mode=mode;this.latencyMs=latencyMs;this.models=models;this.calls=[];}
  async generate(prompt,options={}){return this.respond(prompt,options);}
  async generateStructured(prompt,options={}){return this.respond(prompt,options);}
  async respond(prompt,options){this.calls.push({prompt,options});if(this.latencyMs)await new Promise(resolve=>setTimeout(resolve,this.latencyMs));if(this.mode==="offline")throw Object.assign(new Error("Fake provider offline."),{code:"PROVIDER_OFFLINE"});if(this.mode==="timeout")throw Object.assign(new Error("Fake provider timeout."),{code:"PROVIDER_TIMEOUT"});if(this.mode==="invalid-json")return {text:"not-json",model:options.model||this.models[0],latencyMs:this.latencyMs,metrics:{}};const task=options.task||"default";const value=this.responses[task]??this.responses.default??{};const text=this.mode==="invalid-schema"?JSON.stringify({unexpected:true}):JSON.stringify(typeof value==="function"?value({prompt,options}):value);return {text,model:options.model||this.models[0],latencyMs:this.latencyMs,metrics:{}};}
  async health(){return this.mode==="offline"?{status:"OFFLINE",ok:false,models:[],code:"PROVIDER_OFFLINE"}:{status:this.models.length?"HEALTHY":"DEGRADED",ok:true,models:this.models};}
  async listModels(){if(this.mode==="offline")throw Object.assign(new Error("offline"),{code:"PROVIDER_OFFLINE"});return this.models.map(name=>({name,installed:true,size:0,details:{}}));}
  async modelInfo(model){return {model,capabilities:["structured-output"]};}
}
