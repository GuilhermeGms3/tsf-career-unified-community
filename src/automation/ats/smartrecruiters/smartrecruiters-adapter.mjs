import {HostedAtsAdapter} from "../hosted/hosted-ats-adapter.mjs";

export class SmartRecruitersAdapter extends HostedAtsAdapter{
  static type="smartrecruiters";static version="smartrecruiters-adapter-v1";
  constructor(){super("smartrecruiters",SmartRecruitersAdapter.version);}
  async exposeForm(page){
    if(await page.locator("form input:not([type=hidden]), form textarea, form select").count())return;
    const trigger=page.getByRole("button",{name:/apply|candidatar|inscreva-se/i}).or(page.getByRole("link",{name:/apply|candidatar|inscreva-se/i})).first();
    if(await trigger.count()&&await trigger.isVisible().catch(()=>false)){await trigger.click();await page.waitForLoadState("domcontentloaded").catch(()=>{});}
  }
  async inspectApplicationForm(page,context){await this.exposeForm(page);return super.inspectApplicationForm(page,context);}
  async findSubmitBoundary(page){
    const candidates=page.locator("form button[type='submit'], form input[type='submit'], button[data-test*='submit'], button[data-testid*='submit']"),matching=[];
    for(let index=0;index<await candidates.count();index++){const candidate=candidates.nth(index);if(!await candidate.isVisible().catch(()=>false)||await candidate.isDisabled().catch(()=>true))continue;const label=String(await candidate.getAttribute("value")||await candidate.textContent()||"").trim();if(/submit application|send application|enviar candidatura|enviar inscri[cç][aã]o|finalizar candidatura/i.test(label))matching.push(candidate);}
    if(matching.length!==1)throw Object.assign(new Error(matching.length?"Boundary final SmartRecruiters ambígua.":"Boundary final SmartRecruiters não encontrada."),{code:matching.length?"SMARTRECRUITERS_SUBMIT_BOUNDARY_AMBIGUOUS":"SMARTRECRUITERS_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});
    return matching[0];
  }
  async submit(page,{onActionTriggered=async()=>{},confirmationTimeoutMs=10000}={}){
    const boundary=await this.findSubmitBoundary(page),beforeUrl=page.url();await onActionTriggered();
    try{await boundary.click();}catch(error){throw Object.assign(new Error("Falha ao acionar o boundary final SmartRecruiters."),{code:"SMARTRECRUITERS_SUBMIT_CLICK_FAILED",phase:"POST_ACTION",cause:error});}
    const success=page.getByText(/application (has been )?(received|submitted)|thank you for applying|successfully applied|candidatura (foi )?enviada|inscri[cç][aã]o (foi )?enviada/i).first();let confirmationKind="";
    try{await Promise.race([success.waitFor({state:"visible",timeout:confirmationTimeoutMs}).then(()=>{confirmationKind="SUCCESS_TEXT";}),page.waitForURL(url=>url.href!==beforeUrl&&/(thank|confirm|application|submitted|success)/i.test(url.pathname+url.search),{timeout:confirmationTimeoutMs}).then(()=>{confirmationKind="CONFIRMATION_URL";})]);}catch{}
    if(!confirmationKind)return {status:"UNCERTAIN",errorCode:"SMARTRECRUITERS_CONFIRMATION_NOT_OBSERVED"};
    const confirmationText=await success.textContent().catch(()=>"");return {status:"SUBMITTED",receipt:{confirmationUrl:page.url(),confirmationText:confirmationText||"SmartRecruiters application confirmation observed",metadata:{confirmationKind,providerStatus:"SUBMITTED"}}};
  }
}
