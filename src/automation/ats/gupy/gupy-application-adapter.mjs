import {GupyAdapter} from "./gupy-adapter.mjs";
import {parseGupyPage} from "./gupy-page-parser.mjs";
import {parseGupyIdentity} from "./gupy-identity.mjs";
import {fingerprint,normalizeApplicationField,schemaSignature,isResolved} from "../../../application/application-field-schema.mjs";
import {detectChallenge} from "../../application-engine.mjs";

export class GupyApplicationAdapter extends GupyAdapter {
  static version="gupy-application-v3";
  static provider="GUPY";
  identify(value){return parseGupyIdentity(value);}
  async configureSession(session,draft){
    await session.context.route("**/*",async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.protocol!=="https:"||url.port||url.username||url.password||!(url.hostname==="gupy.io"||url.hostname.endsWith(".gupy.io")))return route.abort();
      if(draft.mode==="DRY_RUN"&&!["GET","HEAD"].includes(request.method()))return route.abort();
      return route.continue();
    });
  }
  validatePageTarget(page,draft){
    const identity=this.identify(page.url()),host=new URL(page.url()).hostname;
    if(identity.canonicalUrl===draft.canonicalIdentity)return;
    if(!identity.canonicalUrl&&(host==="gupy.io"||host.endsWith(".gupy.io")))return;
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
  async findBoundary(page){
    const matches=page.getByRole("button",{name:/^(?:enviar candidatura|finalizar candidatura|concluir inscrição|submit application)$/i});
    if(await matches.count()!==1||!await matches.isVisible())throw Object.assign(Error("Boundary final Gupy ausente ou ambígua."),{code:"GUPY_BOUNDARY_UNSAFE"});return matches;
  }
  async findProgression(page){
    const candidates=page.getByRole("button",{name:/^(?:pr[oó]xima etapa|pr[oó]ximo|continuar|avançar|next|continue)$/i});
    const available=[];
    for(let index=0;index<await candidates.count();index++){
      const candidate=candidates.nth(index);
      if(await candidate.isVisible()&&await candidate.isEnabled())available.push(candidate);
    }
    if(available.length!==1)throw Object.assign(Error("Avanço Gupy ausente ou ambíguo."),{code:available.length?"GUPY_STEP_BOUNDARY_AMBIGUOUS":"GUPY_STEP_BOUNDARY_MISSING"});
    return available[0];
  }
  async advance(page,{previousSignature="",timeoutMs=3000}={}){
    const progression=await this.findProgression(page);
    await progression.click();
    if(!previousSignature)return;
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline){
      await page.waitForTimeout(100);
      const current=await this.inspect(page).catch(()=>null);
      if(current&&(current.challenge||current.signature!==previousSignature))return;
    }
    throw Object.assign(Error("A etapa Gupy não mudou após o avanço."),{code:"GUPY_STEP_NOT_ADVANCED"});
  }
  async controlledSubmit(page,{onActionTriggered,confirmationTimeoutMs=5000}){
    const boundary=await this.findBoundary(page),success=page.getByText(/^(?:Candidatura enviada!|Sua candidatura foi enviada com sucesso\.?|Application submitted successfully\.?)$/i);
    if(await success.count())throw Object.assign(Error("Confirmação já existia antes do envio."),{code:"BLOCKED_DUPLICATE"});
    await onActionTriggered();
    try{await boundary.click();await success.first().waitFor({state:"visible",timeout:confirmationTimeoutMs});}
    catch{return {status:"UNCERTAIN",errorCode:"GUPY_CONFIRMATION_NOT_OBSERVED"};}
    const url=new URL(page.url());url.search="";url.hash="";
    return {status:"SUBMITTED",receipt:{confirmationUrl:url.href,confirmationText:"Candidatura enviada",metadata:{confirmationKind:"NEW_VISIBLE_SUCCESS_TEXT",providerStatus:"SUBMITTED"}}};
  }
}
