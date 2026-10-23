import {GupyAdapter} from "./gupy-adapter.mjs";
import {parseGupyPage} from "./gupy-page-parser.mjs";
import {parseGupyIdentity} from "./gupy-identity.mjs";
import {fingerprint,normalizeApplicationField,schemaSignature,isResolved} from "../../../application/application-field-schema.mjs";
import {detectChallenge} from "../../application-engine.mjs";
import {PORTAL_SUBMIT_PROFILES} from "../last-mile/portal-submit-profiles.mjs";
import {advanceStep,findFinalBoundary,findProgression,profileHostAllowed,restrictToProfileHosts,submitWithProfile} from "../last-mile/last-mile-engine.mjs";

// Ultima milha (hosts, avanco, botao final e confirmacao) vem do perfil Gupy do motor compartilhado.
export class GupyApplicationAdapter extends GupyAdapter {
  static version="gupy-application-v3";
  static provider="GUPY";
  // Cenario da homologacao de envio, a partir do rascunho do Application Batch pronto para envio.
  static scenarioOf(draft){return Number(draft?.flow?.stepsVisited||1)>1?"multi-step":"application-form";}
  submitProfile=PORTAL_SUBMIT_PROFILES.gupy;
  identify(value){return parseGupyIdentity(value);}
  async configureSession(session,draft){await restrictToProfileHosts(session.context,this.submitProfile,{mode:draft.mode});}
  validatePageTarget(page,draft){
    const identity=this.identify(page.url());
    if(identity.canonicalUrl===draft.canonicalIdentity)return;
    if(!identity.canonicalUrl&&profileHostAllowed(this.submitProfile,page.url()))return;
    throw Object.assign(Error("GUPY_IDENTITY_MISMATCH"),{code:"GUPY_IDENTITY_MISMATCH"});
  }
  async parsePage(page){return parseGupyPage(page);}
  async inspect(page){
    const metadata=await this.parsePage(page),challenge=await detectChallenge(page),inspected=await this.inspectApplicationForm(page);
    const fields=inspected.fields.map(normalizeApplicationField),stepContext=await page.locator("[aria-current=step], [role=progressbar]").first().evaluate(element=>[element.getAttribute("aria-valuenow")||"",element.textContent||""].join(":").trim()).catch(()=>"");
    const signature=fingerprint([schemaSignature(fields),stepContext]),boundary=await this.findBoundary(page).then(()=>true).catch(()=>false);
    return {metadata,fields,signature,stepContext,challenge:challenge||(inspected.schema.loginRequired?"AUTH_REQUIRED":""),health:!fields.some(f=>!f.hidden)?"UNSUPPORTED":fields.some(f=>!f.hidden&&!f.label)?"DEGRADED":"HEALTHY",boundary,multiStep:inspected.schema.multiStep};
  }
  mapped(fields){return fields.map(f=>({...f,...f.binding,semanticKey:f.normalizedSemanticType,answerStatus:isResolved(f)?"KNOWN":"USER_REQUIRED",answerSource:f.answerProvenance?.source||""}));}
  async fillResolved(page,fields,selected){return this.fill(page,this.mapped(fields),{resumePath:selected.path});}
  async validateResolved(page,fields){
    const result=await this.validate(page,this.mapped(fields));
    // Native checkValidity alone does not prove the intended answer reached the control.
    for(const f of fields.filter(f=>!f.hidden&&isResolved(f))){
      let frame;try{frame=this.frameForField(page,f.binding);}catch{result.invalid.push(f.fieldId);continue;}
      const locator=this.locatorForField(frame,{...f,...f.binding});
      const matches=await locator.evaluateAll((els,field)=>{
        if(!els.length)return false;const el=els[0],answers=Array.isArray(field.answer)?field.answer:[field.answer];
        if(field.type==="file")return el.files?.length===1;
        if(field.type==="checkbox")return el.checked===field.answer;
        if(field.type.includes("group"))return els.filter(e=>e.checked).every(e=>answers.some(a=>String(a)===e.value||String(a)===(e.closest("label")?.textContent||"").trim()))&&els.some(e=>e.checked);
        if(field.type.startsWith("select"))return [...el.selectedOptions].every(o=>answers.some(a=>String(a)===o.value||String(a)===o.textContent.trim()))&&el.selectedOptions.length===answers.length;
        return el.value===String(field.answer);
      },f).catch(()=>false);
      if(!matches)result.invalid.push(f.fieldId);
    }
    result.valid=result.valid&&!result.invalid.length;return result;
  }
  findBoundary(page){return findFinalBoundary(page,this.submitProfile);}
  findProgression(page){return findProgression(page,this.submitProfile);}
  advance(page,{previousSignature="",timeoutMs=3000}={}){return advanceStep(page,this.submitProfile,{inspect:current=>this.inspect(current),previousSignature,timeoutMs});}
  controlledSubmit(page,{onActionTriggered,confirmationTimeoutMs=5000}){return submitWithProfile(page,this.submitProfile,{onActionTriggered,confirmationTimeoutMs});}
}
