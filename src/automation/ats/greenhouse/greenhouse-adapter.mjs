import { GenericAdapter } from "../generic/generic-adapter.mjs";
import { GreenhouseSchemaResolver } from "./greenhouse-schema-resolver.mjs";
import { captureSubmissionConfirmation, waitForSubmissionConfirmation } from "../../submission-confirmation.mjs";

export class GreenhouseAdapter extends GenericAdapter {
  static type="greenhouse"; static version="greenhouse-adapter-v2.1";
  constructor(){super();this.schemaResolver=new GreenhouseSchemaResolver();}
  async inspectApplicationForm(page,context={}){let inspected;try{inspected=await super.inspectApplicationForm(page);}catch(error){if(error.code!=="FORM_NOT_FOUND")throw error;inspected={fields:[],submitVisible:false};}const schema=await this.schemaResolver.resolve({page,fields:inspected.fields,metadata:context.metadata,job:context.job});return {...inspected,schema,fields:schema.fields};}
  async findSubmitBoundary(page){const candidates=page.locator("form button[type='submit'], form input[type='submit'], form button:not([type])"),count=await candidates.count(),matching=[];for(let index=0;index<count;index++){const candidate=candidates.nth(index);if(!await candidate.isVisible().catch(()=>false))continue;const label=String(await candidate.getAttribute("value")||await candidate.textContent()||"").trim();if(/submit application|enviar candidatura|enviar inscri[cç][aã]o|apply now|candidatar/i.test(label))matching.push(candidate);}if(matching.length!==1)throw Object.assign(new Error(matching.length?"Boundary final Greenhouse ambígua.":"Boundary final Greenhouse não encontrada."),{code:matching.length?"GREENHOUSE_SUBMIT_BOUNDARY_AMBIGUOUS":"GREENHOUSE_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});return matching[0];}
  async submit(page,{onActionTriggered=async()=>{},confirmationTimeoutMs=10000}={}){
    const boundary=await this.findSubmitBoundary(page),baseline=await captureSubmissionConfirmation(page);
    await onActionTriggered();
    try{await boundary.click();}catch(error){throw Object.assign(new Error("Falha ao acionar o boundary final Greenhouse."),{code:"GREENHOUSE_SUBMIT_CLICK_FAILED",phase:"POST_ACTION",cause:error});}
    return waitForSubmissionConfirmation(page,{baseline,provider:"greenhouse",timeoutMs:confirmationTimeoutMs});
  }
}
