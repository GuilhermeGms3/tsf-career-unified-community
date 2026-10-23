import {HostedAtsAdapter} from "../hosted/hosted-ats-adapter.mjs";
import {captureSubmissionConfirmation,waitForSubmissionConfirmation} from "../../submission-confirmation.mjs";
import {parseAshbyIdentity} from "./ashby-target-policy.mjs";
export class AshbyAdapter extends HostedAtsAdapter{
  static type="ashby";static version="ashby-adapter-v2";
  constructor(){super("ashby",AshbyAdapter.version);}
  async inspectApplicationForm(page,context){
    const identity=parseAshbyIdentity(page.url());
    if(identity.applyUrl&&new URL(page.url()).pathname!==new URL(identity.applyUrl).pathname)await page.goto(identity.applyUrl,{waitUntil:"domcontentloaded"});
    await page.locator("input[type='email'], input[type='file'], input[autocomplete='name']").first().waitFor({state:"attached",timeout:12000}).catch(()=>{});
    return super.inspectApplicationForm(page,context);
  }
  async findSubmitBoundary(page,{requireEnabled=true}={}){
    const candidates=page.locator("form[data-testid='application-form'] button[type='submit'], form[data-testid*='application'] button[type='submit'], form[action*='application'] button[type='submit'], form button[type='submit'], form input[type='submit']"),matching=[];
    for(let index=0;index<await candidates.count();index++){
      const candidate=candidates.nth(index);if(!await candidate.isVisible().catch(()=>false)||requireEnabled&&await candidate.isDisabled().catch(()=>true))continue;
      const label=String(await candidate.getAttribute("value")||await candidate.textContent()||"").trim();
      if(/submit application|send application|apply now|enviar candidatura|enviar inscri[cç][aã]o|candidatar/i.test(label))matching.push(candidate);
    }
    if(matching.length!==1)throw Object.assign(new Error(matching.length?"Boundary final Ashby ambígua.":"Boundary final Ashby não encontrada."),{code:matching.length?"ASHBY_SUBMIT_BOUNDARY_AMBIGUOUS":"ASHBY_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});
    return matching[0];
  }
  async submit(page,{onActionTriggered=async()=>{},confirmationTimeoutMs=10000}={}){
    const boundary=await this.findSubmitBoundary(page),baseline=await captureSubmissionConfirmation(page);await onActionTriggered();
    try{await boundary.click();}catch(error){throw Object.assign(new Error("Falha ao acionar o boundary final Ashby."),{code:"ASHBY_SUBMIT_CLICK_FAILED",phase:"POST_ACTION",cause:error});}
    return waitForSubmissionConfirmation(page,{baseline,provider:this.type,timeoutMs:confirmationTimeoutMs});
  }
}
