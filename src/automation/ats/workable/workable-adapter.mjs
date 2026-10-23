import {HostedAtsAdapter} from "../hosted/hosted-ats-adapter.mjs";
import {captureSubmissionConfirmation,waitForSubmissionConfirmation} from "../../submission-confirmation.mjs";
import {questionFingerprint} from "../../../application/question-semantics.mjs";

export class WorkableAdapter extends HostedAtsAdapter{
  static type="workable";static version="workable-adapter-v1";
  constructor(){super("workable",WorkableAdapter.version);}
  async inspectFormSnapshot(page){
    const inspected=await super.inspectFormSnapshot(page);
    for(const field of inspected.fields.filter(field=>field.type==="file")){
      const frame=page.frames().find(frame=>frame.url()===field.frameUrl)||page.mainFrame();
      if(await frame.locator(field.selector).getAttribute("data-ui")==="resume"){
        Object.assign(field,{externalKey:"resume",name:"resume",selector:"input[data-ui='resume']",label:"Resume",semanticKey:"RESUME.FILE",confidence:.99});
        field.fingerprint=questionFingerprint({ats:this.type,semanticKey:field.semanticKey,label:field.label,fieldType:field.type,options:field.options});
      }
    }
    return inspected;
  }
  async exposeForm(page){
    const reject=page.getByRole("button",{name:/^decline all$|^reject all$|^rejeitar todos$/i});
    await reject.first().waitFor({state:"visible",timeout:2500}).catch(()=>{});
    if(await reject.count()&&await reject.first().isVisible().catch(()=>false))await reject.first().click();
    if(await page.locator("input[type='email'], input[type='file']").count())return;
    const trigger=page.getByRole("button",{name:/apply|candidatar|inscreva-se/i}).or(page.getByRole("link",{name:/apply|candidatar|inscreva-se/i})).first();
    await trigger.waitFor({state:"visible",timeout:5000}).catch(()=>{});
    if(await trigger.count()&&await trigger.isVisible().catch(()=>false)){await trigger.click();await page.waitForLoadState("domcontentloaded").catch(()=>{});await page.locator("input[type='email'],input[type='file']").first().waitFor({state:"attached",timeout:10000}).catch(()=>{});}
  }
  async inspectApplicationForm(page,context){await this.exposeForm(page);return super.inspectApplicationForm(page,context);}
  async findSubmitBoundary(page,{requireEnabled=true}={}){
    const candidates=page.locator("form button[type='submit'], form input[type='submit'], button[data-ui='submit-application'], button[data-testid*='submit']"),matching=[];
    for(let index=0;index<await candidates.count();index++){const candidate=candidates.nth(index);if(!await candidate.isVisible().catch(()=>false)||requireEnabled&&await candidate.isDisabled().catch(()=>true))continue;const label=String(await candidate.getAttribute("value")||await candidate.textContent()||"").trim();if(/submit application|send application|enviar candidatura|enviar inscri[cç][aã]o|finalizar candidatura/i.test(label))matching.push(candidate);}
    if(matching.length!==1)throw Object.assign(new Error(matching.length?"Boundary final Workable ambígua.":"Boundary final Workable não encontrada."),{code:matching.length?"WORKABLE_SUBMIT_BOUNDARY_AMBIGUOUS":"WORKABLE_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});
    return matching[0];
  }
  async submit(page,{onActionTriggered=async()=>{},confirmationTimeoutMs=10000}={}){
    const boundary=await this.findSubmitBoundary(page),baseline=await captureSubmissionConfirmation(page);await onActionTriggered();
    try{await boundary.click();}catch(error){throw Object.assign(new Error("Falha ao acionar o boundary final Workable."),{code:"WORKABLE_SUBMIT_CLICK_FAILED",phase:"POST_ACTION",cause:error});}
    return waitForSubmissionConfirmation(page,{baseline,provider:this.type,timeoutMs:confirmationTimeoutMs});
  }
}
