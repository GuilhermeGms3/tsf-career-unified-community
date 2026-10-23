import {HostedAtsAdapter} from "../hosted/hosted-ats-adapter.mjs";
import {captureSubmissionConfirmation,waitForSubmissionConfirmation} from "../../submission-confirmation.mjs";

export class SmartRecruitersAdapter extends HostedAtsAdapter{
  static type="smartrecruiters";static version="smartrecruiters-adapter-v1";
  constructor(){super("smartrecruiters",SmartRecruitersAdapter.version);}
  async exposeForm(page){
    if(await page.locator("input[type='email'], input[type='file']").count())return;
    const trigger=page.getByRole("button",{name:/apply|candidatar|inscreva-se|estou interessado/i}).or(page.getByRole("link",{name:/apply|candidatar|inscreva-se|estou interessado/i})).first();
    await trigger.waitFor({state:"visible",timeout:5000}).catch(()=>{});
    if(await trigger.count()&&await trigger.isVisible().catch(()=>false)){await trigger.click();await page.waitForLoadState("domcontentloaded").catch(()=>{});await page.locator("input[type='email'],input[type='file']").first().waitFor({state:"attached",timeout:10000}).catch(()=>{});}
  }
  async inspectApplicationForm(page,context){await this.exposeForm(page);return super.inspectApplicationForm(page,context);}
  async findSubmitBoundary(page,{requireEnabled=true}={}){
    const candidates=page.locator("form button[type='submit'], form input[type='submit'], button[data-test*='submit'], button[data-testid*='submit']"),matching=[];
    for(let index=0;index<await candidates.count();index++){const candidate=candidates.nth(index);if(!await candidate.isVisible().catch(()=>false)||requireEnabled&&await candidate.isDisabled().catch(()=>true))continue;const label=String(await candidate.getAttribute("value")||await candidate.textContent()||"").trim();if(/submit application|send application|enviar candidatura|enviar inscri[cç][aã]o|finalizar candidatura/i.test(label))matching.push(candidate);}
    if(matching.length!==1)throw Object.assign(new Error(matching.length?"Boundary final SmartRecruiters ambígua.":"Boundary final SmartRecruiters não encontrada."),{code:matching.length?"SMARTRECRUITERS_SUBMIT_BOUNDARY_AMBIGUOUS":"SMARTRECRUITERS_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});
    return matching[0];
  }
  async submit(page,{onActionTriggered=async()=>{},confirmationTimeoutMs=10000}={}){
    const boundary=await this.findSubmitBoundary(page),baseline=await captureSubmissionConfirmation(page);await onActionTriggered();
    try{await boundary.click();}catch(error){throw Object.assign(new Error("Falha ao acionar o boundary final SmartRecruiters."),{code:"SMARTRECRUITERS_SUBMIT_CLICK_FAILED",phase:"POST_ACTION",cause:error});}
    return waitForSubmissionConfirmation(page,{baseline,provider:this.type,timeoutMs:confirmationTimeoutMs});
  }
}
