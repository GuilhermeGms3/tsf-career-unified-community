import {assessAdapterHealth} from "../greenhouse/adapter-health.mjs";
import {buildDomSignature} from "../greenhouse/dom-signature.mjs";
import {HostedAtsAdapter} from "../hosted/hosted-ats-adapter.mjs";
import {captureSubmissionConfirmation,waitForSubmissionConfirmation} from "../../submission-confirmation.mjs";

const semantics={
  nome_candidato:["IDENTITY.FULL_NAME",.99],telefone_candidato:["CONTACT.PHONE",.99],email_candidato:["CONTACT.EMAIL",.99],cidade_candidato:["LOCATION.CITY",.95],funcao_candidato:["APPLICATION.TARGET_ROLE",.95],nivel_ingles:["PROFESSIONAL.ENGLISH_LEVEL",.95],disponibilidade_inicio_dias:["APPLICATION.NOTICE_PERIOD",.95],possui_empresa_aberta:["WORK_ARRANGEMENT.PJ_ENTITY",.95],pretensao_salarial:["COMPENSATION.CLT_EXPECTATION",.98],pretensao_salarial_pj:["COMPENSATION.PJ_HOURLY_EXPECTATION",.98],curriculo:["RESUME.FILE",.99]
};
const stages=[["nome_candidato","telefone_candidato","email_candidato","cidade_candidato"],["funcao_candidato","nivel_ingles","disponibilidade_inicio_dias","possui_empresa_aberta"],["pretensao_salarial","pretensao_salarial_pj","curriculo"]];

export class NerdinAdapter extends HostedAtsAdapter{
  static type="nerdin";static version="nerdin-adapter-v1";
  constructor(){super("nerdin",NerdinAdapter.version);}
  async inspectFormSnapshot(page){
    const inspected=await super.inspectFormSnapshot(page);
    // Only the native allowlist participates in Nerdin's known sequential steps.
    inspected.fields=inspected.fields.map(field=>Object.hasOwn(semantics,field.externalKey)?{...field,hidden:field.type==="hidden",required:field.type!=="hidden"&&(field.declaredRequired??field.required)}:field);
    return inspected;
  }
  async exposeForm(page){
    const acknowledgement=page.locator("#nerdin-seguranca-modal-ack");
    if(await acknowledgement.count()&&await acknowledgement.first().isVisible().catch(()=>false))await acknowledgement.first().click();
    const reject=page.getByRole("button",{name:/rejeitar/i});
    if(await reject.count()&&await reject.first().isVisible().catch(()=>false)){
      const reloaded=page.waitForEvent("domcontentloaded",{timeout:3000}).catch(()=>null);
      await reject.first().click();
      await reloaded;
      await page.waitForLoadState("domcontentloaded");
      if(await page.locator("#form-candidatura").count())await page.locator('#form-candidatura [name="curriculo"]').waitFor({state:"attached",timeout:5000});
    }
  }
  async inspectApplicationForm(page,context){await this.exposeForm(page);const inspected=await super.inspectApplicationForm(page,context),fields=inspected.fields.filter(field=>Object.hasOwn(semantics,field.externalKey)).map(field=>{const [semanticKey,confidence]=semantics[field.externalKey];return {...field,semanticKey,confidence,signals:[...(field.signals||[]),`nerdin-field:${field.externalKey}`],answerStatus:field.required?"USER_REQUIRED":"UNKNOWN",reasonRequired:field.required?"Resposta confirmada não encontrada.":field.reasonRequired};}),unsupportedSignals=fields.length===Object.keys(semantics).length?[]:["NERDIN_FORM_STRUCTURE_INCOMPLETE"],health=assessAdapterHealth({fields,warnings:[],unsupportedSignals}),schema={ats:this.type,variant:"nerdin-native-3-step",fields,warnings:[],domSignature:buildDomSignature(fields,[this.type,"three-step"]),...health};return {...inspected,fields,schema};}
  async fill(page,mapped,options={}){await this.exposeForm(page);const audit=[];for(let index=0;index<stages.length;index++){const keys=new Set(stages[index]),stageFields=mapped.filter(field=>keys.has(field.externalKey)).map(field=>({...field,hidden:field.type==="hidden",required:field.declaredRequired??field.required})),stageAudit=await super.fill(page,stageFields,options);audit.push(...stageAudit);if(stageAudit.some(item=>item.status==="FAILED"||item.status==="USER_REQUIRED")){for(const field of mapped.filter(item=>stages.slice(index+1).flat().includes(item.externalKey)))audit.push({field:field.semanticKey,externalKey:field.externalKey,source:field.answerSource||"",status:field.declaredRequired||field.required?"USER_REQUIRED":"SKIPPED",code:"NERDIN_PREVIOUS_STEP_INCOMPLETE"});break;}if(index<stages.length-1){await page.locator("#btn-proximo").click();await page.locator(`#etapa-${index+2}:not(.d-none)`).waitFor({state:"visible",timeout:5000});}}return audit;}
  async findSubmitBoundary(page){const candidate=page.locator("#form-candidatura #btn-enviar-candidatura");if(await candidate.count()!==1)throw Object.assign(new Error("Boundary final Nerdin não encontrada."),{code:"NERDIN_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});const label=String(await candidate.textContent()||"").trim();if(!/enviar candidatura/i.test(label))throw Object.assign(new Error("Boundary final Nerdin não reconhecida."),{code:"NERDIN_SUBMIT_BOUNDARY_AMBIGUOUS",phase:"PRE_ACTION"});return candidate;}
  async submit(page,{onActionTriggered=async()=>{},confirmationTimeoutMs=10000}={}){
    const boundary=await this.findSubmitBoundary(page);
    if(!await boundary.isVisible().catch(()=>false)||await boundary.isDisabled().catch(()=>true))throw Object.assign(new Error("Boundary final Nerdin indisponível."),{code:"NERDIN_SUBMIT_BOUNDARY_NOT_READY",phase:"PRE_ACTION"});
    const baseline=await captureSubmissionConfirmation(page);await onActionTriggered();
    try{await boundary.click();}catch(error){throw Object.assign(new Error("Falha ao acionar o boundary final Nerdin."),{code:"NERDIN_SUBMIT_CLICK_FAILED",phase:"POST_ACTION",cause:error});}
    return waitForSubmissionConfirmation(page,{baseline,provider:this.type,timeoutMs:confirmationTimeoutMs});
  }
}
