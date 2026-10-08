import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chromium } from "playwright";
import { CandidateKnowledgeBase } from "../application/candidate-knowledge-base.mjs";
import { AdapterRegistry } from "./ats/adapter-registry.mjs";
import { AtsDetector } from "./ats/ats-detector.mjs";
import { validateAutomationUrl } from "./automation-validation.mjs";

function sanitizedUrl(value){const url=new URL(value);for(const key of [...url.searchParams.keys()])if(/token|auth|key|email|session|cookie/i.test(key))url.searchParams.set(key,"[redacted]");url.hash="";return url.toString();}
const privateIp=(ip)=>ip==="::1"||ip.startsWith("fe80:")||ip.startsWith("fc")||ip.startsWith("fd")||/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(ip);
async function assertPublicUrl(value){const url=new URL(value);if(url.hostname==="localhost"||url.hostname.endsWith(".local"))throw Object.assign(new Error("LIVE_INSPECT aceita somente destinos publicos."),{code:"PRIVATE_INSPECTION_TARGET"});const addresses=isIP(url.hostname)?[{address:url.hostname}]:await lookup(url.hostname,{all:true});if(addresses.some(item=>privateIp(item.address)))throw Object.assign(new Error("LIVE_INSPECT bloqueou um destino de rede privada."),{code:"PRIVATE_INSPECTION_TARGET"});}

export class LiveInspector {
  constructor({headless=true,publicOnly=false}={}){this.headless=headless;this.publicOnly=publicOnly;this.detector=new AtsDetector();this.registry=new AdapterRegistry();}
  async inspect(url,{fill=false,profile={},resumePath=""}={}){
    const browser=await chromium.launch({headless:this.headless});const context=await browser.newContext();const page=await context.newPage();
    try{
      const target=validateAutomationUrl(url);if(this.publicOnly){await assertPublicUrl(target);await context.route("**/*",async route=>{try{await assertPublicUrl(route.request().url());await route.continue();}catch{await route.abort("blockedbyclient");}});}await page.goto(target,{waitUntil:"domcontentloaded"});
      const detected=await this.detector.detect(page);const adapter=this.registry.get(detected.type);const inspected=await adapter.inspectApplicationForm(page,{job:{url}});const knowledge=CandidateKnowledgeBase.fromProfile(profile);const mapped=adapter.mapFields(inspected,knowledge);let audit=[];if(fill)audit=await adapter.fill(page,mapped,{resumePath});const schema=inspected.schema||{};
      const structure={fields:mapped.map(({semanticKey,label,type,required,options,multiple,sensitive,confidence})=>({semanticKey,label,type,required,options,multiple,sensitive,confidence}))};
      return {url:sanitizedUrl(page.url()),ats:detected.type,adapterVersion:adapter.constructor.version,variant:schema.variant||"generic",fieldsFound:mapped.length,requiredFields:mapped.filter(x=>x.required).length,knownFields:mapped.filter(x=>["KNOWN","DERIVED"].includes(x.answerStatus)).length,unknownFields:mapped.filter(x=>x.answerStatus==="USER_REQUIRED").length,supported:schema.health!=="UNSUPPORTED",compatibilityConfidence:schema.compatibilityConfidence??detected.confidence,warnings:schema.warnings||[],domSignature:schema.domSignature||"",fillRequested:Boolean(fill),audit:audit.map(({field,status,source,code})=>({field,status,source,code})),structure};
    }finally{await context.close();await browser.close();}
  }
}
