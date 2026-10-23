import {resolvePublicTarget,installPublicBrowserGuard} from "../security/public-url-policy.mjs";
import { chromium } from "playwright";
import { CandidateKnowledgeBase } from "../application/candidate-knowledge-base.mjs";
import { AdapterRegistry } from "./ats/adapter-registry.mjs";
import { AtsDetector } from "./ats/ats-detector.mjs";
import { validateAutomationUrl } from "./automation-validation.mjs";
import { detectChallenge } from "./application-engine.mjs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

function sanitizedUrl(value){const url=new URL(value);for(const key of [...url.searchParams.keys()])if(/token|auth|key|email|session|cookie/i.test(key))url.searchParams.set(key,"[redacted]");url.hash="";return url.toString();}
async function assertPublicUrl(value){try{await resolvePublicTarget(value);}catch(error){throw Object.assign(error,{code:"PRIVATE_INSPECTION_TARGET"});}}

export class LiveInspector {
  constructor({headless=true,publicOnly=false,timeoutMs=15000,evidenceDir=null}={}){this.headless=headless;this.publicOnly=publicOnly;this.evidenceDir=evidenceDir;this.timeoutMs=Math.max(1000,Math.min(30000,Number(timeoutMs)||15000));this.detector=new AtsDetector();this.registry=new AdapterRegistry();}
  async inspect(url,{fill=false,profile={},resumePath=""}={}){
    const browser=await chromium.launch({headless:this.headless});const context=await browser.newContext({serviceWorkers:"block"});const page=await context.newPage();
    page.setDefaultTimeout(this.timeoutMs);page.setDefaultNavigationTimeout(this.timeoutMs);
    try{
      const target=validateAutomationUrl(url);if(this.publicOnly){await assertPublicUrl(target);await installPublicBrowserGuard(context);}const response=await page.goto(target,{waitUntil:"domcontentloaded"});
      const publicText=await page.locator("body").innerText();
      if([404,410].includes(response?.status())||/this position is no longer active|this job is no longer available|vaga (?:foi )?encerrada|n[aã]o aceita mais candidaturas/i.test(publicText))return {url:sanitizedUrl(page.url()),ats:(await this.detector.detect(page)).type,availability:"CLOSED",httpStatus:response?.status(),fieldsFound:0,supported:false};
      const detected=await this.detector.detect(page),challenge=await detectChallenge(page);
      if(challenge)return {url:sanitizedUrl(page.url()),ats:detected.type,challenge,fieldsFound:0,inspectionComplete:false,supported:false,fillRequested:false};
      const adapter=this.registry.get(detected.type);const inspected=await adapter.inspectApplicationForm(page,{job:{url}});const postChallenge=await detectChallenge(page);if(postChallenge)return {url:sanitizedUrl(page.url()),ats:detected.type,challenge:postChallenge,fieldsFound:0,inspectionComplete:false,supported:false,fillRequested:false};const knowledge=CandidateKnowledgeBase.fromProfile(profile);const mapped=adapter.mapFields(inspected,knowledge);let audit=[];if(fill)audit=await adapter.fill(page,mapped,{resumePath});const schema=inspected.schema||{};
      const structure={fields:mapped.map(({semanticKey,label,type,required,options,multiple,sensitive,confidence})=>({semanticKey,label,type,required,options,multiple,sensitive,confidence}))};
      return {url:sanitizedUrl(page.url()),ats:detected.type,adapterVersion:adapter.constructor.version,variant:schema.variant||"generic",fieldsFound:mapped.length,requiredFields:mapped.filter(x=>x.required).length,knownFields:mapped.filter(x=>["KNOWN","DERIVED"].includes(x.answerStatus)).length,unknownFields:mapped.filter(x=>x.answerStatus==="USER_REQUIRED").length,supported:schema.health!=="UNSUPPORTED"&&!inspected.blockedFrames?.length,blockedFrames:inspected.blockedFrames||[],compatibilityConfidence:schema.compatibilityConfidence??detected.confidence,warnings:schema.warnings||[],domSignature:schema.domSignature||"",fillRequested:Boolean(fill),audit:audit.map(({field,status,source,code})=>({field,status,source,code})),structure};
    }finally{
      try{if(this.evidenceDir){await mkdir(this.evidenceDir,{recursive:true});await page.screenshot({path:path.join(this.evidenceDir,"inspection.png"),fullPage:true,timeout:5000,mask:[page.locator("input,textarea,select,[contenteditable='true']")]}).catch(()=>{});}}
      finally{try{await context.close();}finally{await browser.close();}}
    }
  }
}
