import {HostedAtsAdapter} from "../hosted/hosted-ats-adapter.mjs";
export class AshbyAdapter extends HostedAtsAdapter{
  static type="ashby";static version="ashby-adapter-v2";
  constructor(){super("ashby",AshbyAdapter.version);}
  async findSubmitBoundary(page){
    const candidates=page.locator("form[data-testid='application-form'] button[type='submit'], form[data-testid*='application'] button[type='submit'], form[action*='application'] button[type='submit'], form button[type='submit'], form input[type='submit']"),matching=[];
    for(let index=0;index<await candidates.count();index++){
      const candidate=candidates.nth(index);if(!await candidate.isVisible().catch(()=>false)||await candidate.isDisabled().catch(()=>true))continue;
      const label=String(await candidate.getAttribute("value")||await candidate.textContent()||"").trim();
      if(/submit application|send application|apply now|enviar candidatura|enviar inscri[cç][aã]o|candidatar/i.test(label))matching.push(candidate);
    }
    if(matching.length!==1)throw Object.assign(new Error(matching.length?"Boundary final Ashby ambígua.":"Boundary final Ashby não encontrada."),{code:matching.length?"ASHBY_SUBMIT_BOUNDARY_AMBIGUOUS":"ASHBY_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});
    return matching[0];
  }
  async submit(page,{onActionTriggered=async()=>{},confirmationTimeoutMs=10000}={}){
    const boundary=await this.findSubmitBoundary(page),beforeUrl=page.url();await onActionTriggered();
    try{await boundary.click();}catch(error){throw Object.assign(new Error("Falha ao acionar o boundary final Ashby."),{code:"ASHBY_SUBMIT_CLICK_FAILED",phase:"POST_ACTION",cause:error});}
    const success=page.getByText(/application (has been )?(received|submitted)|thank you for applying|successfully applied|candidatura (foi )?enviada|inscri[cç][aã]o (foi )?enviada/i).first();let confirmationKind="";
    try{await Promise.race([success.waitFor({state:"visible",timeout:confirmationTimeoutMs}).then(()=>{confirmationKind="SUCCESS_TEXT";}),page.waitForURL(url=>url.href!==beforeUrl&&/(thank|confirm|application|submitted|success)/i.test(url.pathname+url.search),{timeout:confirmationTimeoutMs}).then(()=>{confirmationKind="CONFIRMATION_URL";})]);}catch{}
    if(!confirmationKind)return {status:"UNCERTAIN",errorCode:"ASHBY_CONFIRMATION_NOT_OBSERVED"};
    const confirmationText=await success.textContent().catch(()=>"");
    return {status:"SUBMITTED",receipt:{confirmationUrl:page.url(),confirmationText:confirmationText||"Ashby application confirmation observed",metadata:{confirmationKind,providerStatus:"SUBMITTED"}}};
  }
}
