import {validateResumeArtifact} from "../automation/automation-validation.mjs";
import {detectChallenge} from "../automation/application-engine.mjs";
import {LeverMetadataClient} from "../automation/ats/lever/lever-metadata-client.mjs";
import {parseLeverIdentity,validateLeverSubmissionTarget} from "../automation/ats/lever/lever-target-policy.mjs";
import {buildDomSignature} from "../automation/ats/greenhouse/dom-signature.mjs";
import {formStructureHash,submissionCriticalFields} from "./form-structure-hash.mjs";

const isHumanChallenge=code=>/CAPTCHA|MFA|LOGIN|VERIFICATION|ANTI_BOT/.test(String(code||""));
const reusableQuestionSources=new Set(["CANDIDATE_PROFILE","USER_CONFIRMED","user"]);
const persistedQuestionKnowledge=questions=>({get(semanticKey){const question=questions.find(item=>item.semanticKey===semanticKey&&item.answerStatus==="KNOWN"&&!item.sensitive&&reusableQuestionSources.has(item.answerSource));if(!question)return null;return {key:semanticKey,value:question.answerValue,source:question.answerSource,sourceType:"APPLICATION_QUESTION",verificationStatus:"USER_CONFIRMED",verified:true,reusePolicy:"REUSABLE",lifecycleStatus:"ACTIVE",sensitive:false};}});

export class LeverFinalRevalidator{
  constructor({store,dataDir,registry,browserManager,metadataClient=new LeverMetadataClient(),allowLocalFixtures=false,jobStatusChecker=null,clock=()=>new Date()}={}){Object.assign(this,{store,dataDir,registry,browserManager,metadataClient,allowLocalFixtures,jobStatusChecker,clock});}
  resolve(applicationId){
    const application=this.store.applications.findById(applicationId),job=application?this.store.jobs.findById(application.jobId):null,plan=application?this.store.applicationPlans.forApplication(applicationId):null;
    if(!application||!job||!plan)throw Object.assign(new Error("Candidatura Lever incompleta."),{code:"LEVER_APPLICATION_CONTEXT_MISSING"});
    if(plan.atsType!=="lever")throw Object.assign(new Error("Final revalidation disponível somente para Lever."),{code:"LEVER_ADAPTER_REQUIRED"});
    const candidate=job.applicationUrl||job.canonicalUrl||job.url,parsed=parseLeverIdentity(candidate),targetCandidate=this.allowLocalFixtures&&/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(job.url||"")?job.url:candidate,target=validateLeverSubmissionTarget(targetCandidate,{expectedIdentity:parsed,allowLocalFixture:this.allowLocalFixtures});
    return {application,job,plan,identity:{...parsed,...target.identity},target};
  }
  async checkJob(context){if(this.jobStatusChecker)return this.jobStatusChecker(context);if(context.target.localFixture)return {status:"OPEN",checkedAt:this.clock().toISOString(),authority:"controlled-local-fixture",reference:"local-fixture"};return this.metadataClient.checkJob(context.identity);}
  async inspect(applicationId,{keepSession=false}={}){
    const context=this.resolve(applicationId),jobCheck=await this.checkJob(context);let session;
    try{
      const resumed=this.browserManager.resume(applicationId),resumeAfterChallenge=Boolean(resumed&&isHumanChallenge(resumed.sessionMeta?.reason));session=resumed||await this.browserManager.open(applicationId,`lever-final-preflight-${Date.now()}`);if(!resumeAfterChallenge)await session.page.goto(context.target.url,{waitUntil:"domcontentloaded"});
      const challenge=await detectChallenge(session.page);if(challenge)throw Object.assign(new Error("Verificação humana pendente no target Lever."),{code:challenge});
      const adapter=this.registry.get("lever"),inspected=await adapter.inspectApplicationForm(session.page,{job:context.job}),criticalFields=submissionCriticalFields(inspected.schema.fields),schema={...inspected.schema,domSignature:buildDomSignature(criticalFields,["lever"])},structureHash=formStructureHash(schema.fields,{criticalOnly:true}),report={url:context.target.localFixture?"controlled-local-fixture":context.identity.canonicalUrl,ats:"lever",adapterVersion:adapter.constructor.version,variant:schema.variant,fieldsFound:schema.fields.length,requiredFields:schema.fields.filter(field=>field.required).length,knownFields:0,unknownFields:schema.fields.filter(field=>field.required).length,supported:schema.health!=="UNSUPPORTED",compatibilityConfidence:schema.compatibilityConfidence,warnings:schema.warnings||[],submissionBoundary:await adapter.findSubmitBoundary(session.page,{requireEnabled:false}).then(()=>true).catch(()=>false),fresh:true,formStructureHash:structureHash};
      const inspection=this.store.applicationInspections.create({applicationId,adapterType:"lever",adapterVersion:adapter.constructor.version,detectedVariant:schema.variant,compatibilityConfidence:schema.compatibilityConfidence,health:schema.health,domSignature:schema.domSignature,unsupportedSignals:schema.unsupportedSignals,warnings:schema.warnings,report}),result={context,jobCheck,inspection,adapter,inspected,schema,formStructureHash:structureHash,checkedAt:this.clock().toISOString(),session:keepSession?session:null};
      if(!keepSession){await this.browserManager.close(session);session=null;}return result;
    }catch(error){const enriched=error?.code?error:Object.assign(new Error("Fresh revalidation Lever falhou antes da ação."),{code:"LEVER_FRESH_INSPECTION_FAILED",cause:error});enriched.jobCheck=jobCheck;if(session&&isHumanChallenge(enriched.code)&&!this.browserManager.headless){await this.browserManager.hold(session,{status:enriched.code,adapterType:"lever"}).catch(()=>this.browserManager.close(session).catch(()=>{}));session=null;}if(session)await this.browserManager.close(session).catch(()=>{});throw enriched;}
  }
  async prepareForSubmit(applicationId,{expectedPreflight}={}){
    const live=await this.inspect(applicationId,{keepSession:true});
    try{
      if(live.jobCheck.status!=="OPEN")throw Object.assign(new Error("A vaga Lever não está confirmada como aberta."),{code:"LEVER_JOB_NOT_OPEN",phase:"PRE_ACTION",jobCheck:live.jobCheck});
      if(live.schema.health!=="HEALTHY"||Number(live.schema.compatibilityConfidence)<.8)throw Object.assign(new Error("Inspection Lever fresh não está saudável."),{code:"LEVER_FRESH_INSPECTION_BLOCKED",phase:"PRE_ACTION"});
      if(!live.inspection.report.submissionBoundary)throw Object.assign(new Error("Boundary final Lever ausente."),{code:"LEVER_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});
      if(expectedPreflight?.domSignature&&expectedPreflight.domSignature!==live.schema.domSignature)throw Object.assign(new Error("DOM mudou depois da revisão final."),{code:"PREVIEW_STALE",phase:"PRE_ACTION"});
      if(expectedPreflight?.formStructureHash&&expectedPreflight.formStructureHash!==live.formStructureHash)throw Object.assign(new Error("Estrutura do formulário mudou depois da revisão final."),{code:"PREVIEW_STALE",phase:"PRE_ACTION"});
      const questions=this.store.applicationQuestions.forApplication(applicationId),mapped=live.adapter.mapFields(live.inspected,persistedQuestionKnowledge(questions),questions,[]),version=live.context.application.resumeVersionId?this.store.resumeVersions.findById(live.context.application.resumeVersionId):null,artifact=version?this.store.resumeArtifacts.latest(version.id,"PDF"):null,selected=await validateResumeArtifact({version,artifact,dataDir:this.dataDir}),ready=mapped.map(field=>field.semanticKey==="RESUME.FILE"?{...field,answer:artifact.id,answerStatus:"KNOWN",answerSource:"application_plan"}:field),audit=await live.adapter.fill(live.session.page,ready,{resumePath:selected.path,resumeArtifact:artifact});
      if(audit.some(item=>item.status==="FAILED"||item.status==="USER_REQUIRED"))throw Object.assign(new Error("Preenchimento fresh Lever não ficou completo."),{code:"LEVER_FRESH_FILL_BLOCKED",phase:"PRE_ACTION"});
      const validation=await live.adapter.validate(live.session.page,ready),challenge=await detectChallenge(live.session.page);if(challenge)throw Object.assign(new Error("Challenge humano detectado antes do submit Lever."),{code:challenge,phase:"PRE_ACTION"});if(!validation.valid)throw Object.assign(new Error("Validação fresh do formulário Lever falhou."),{code:"LEVER_FRESH_VALIDATION_FAILED",phase:"PRE_ACTION"});
      return {...live,mapped:ready,validation,selected};
    }catch(error){await this.browserManager.close(live.session).catch(()=>{});throw error;}
  }
}
