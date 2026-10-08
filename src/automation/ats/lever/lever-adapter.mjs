import {HostedAtsAdapter} from "../hosted/hosted-ats-adapter.mjs";
export class LeverAdapter extends HostedAtsAdapter{
  static type="lever";static version="lever-adapter-v2";
  constructor(){super("lever",LeverAdapter.version);}
  async inspectApplicationForm(page,context={}){
    await page.locator("input[name='name'], input[autocomplete='name']").first().waitFor({state:"attached",timeout:10000});
    return super.inspectApplicationForm(page,context);
  }
  async findSubmitBoundary(page,{requireEnabled=true}={}){
    const candidates=page.locator("form.application-form button, form[data-qa='application-form'] button, form[action*='apply'] button, button#btn-submit, form input[type='submit']"),matching=[];
    for(let index=0;index<await candidates.count();index++){
      const candidate=candidates.nth(index);if(!await candidate.isVisible().catch(()=>false)||requireEnabled&&await candidate.isDisabled().catch(()=>true))continue;
      const label=String(await candidate.getAttribute("value")||await candidate.textContent()||"").trim();
      if(/submit application|send application|enviar candidatura|enviar inscri[cç][aã]o|candidatar/i.test(label))matching.push(candidate);
    }
    if(matching.length!==1)throw Object.assign(new Error(matching.length?"Boundary final Lever ambígua.":"Boundary final Lever não encontrada."),{code:matching.length?"LEVER_SUBMIT_BOUNDARY_AMBIGUOUS":"LEVER_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});
    return matching[0];
  }
  async submit(page,{onActionTriggered=async()=>{},confirmationTimeoutMs=10000}={}){
    const boundary=await this.findSubmitBoundary(page),beforeUrl=page.url();await onActionTriggered();
    try{await boundary.click();}catch(error){throw Object.assign(new Error("Falha ao acionar o boundary final Lever."),{code:"LEVER_SUBMIT_CLICK_FAILED",phase:"POST_ACTION",cause:error});}
    const success=page.getByText(/application (has been )?(received|submitted)|thank you for applying|successfully applied|candidatura (foi )?enviada|inscri[cç][aã]o (foi )?enviada/i).first();let confirmationKind="";
    try{await Promise.race([success.waitFor({state:"visible",timeout:confirmationTimeoutMs}).then(()=>{confirmationKind="SUCCESS_TEXT";}),page.waitForURL(url=>url.href!==beforeUrl&&/(thank|confirm|application|submitted|success)/i.test(url.pathname+url.search),{timeout:confirmationTimeoutMs}).then(()=>{confirmationKind="CONFIRMATION_URL";})]);}catch{}
    if(!confirmationKind)return {status:"UNCERTAIN",errorCode:"LEVER_CONFIRMATION_NOT_OBSERVED"};
    const confirmationText=await success.textContent().catch(()=>"");
    return {status:"SUBMITTED",receipt:{confirmationUrl:page.url(),confirmationText:confirmationText||"Lever application confirmation observed",metadata:{confirmationKind,providerStatus:"SUBMITTED"}}};
  }
}
