import {validateResumeArtifact} from "../automation/automation-validation.mjs";
import {detectChallenge} from "../automation/application-engine.mjs";
import {AshbyMetadataClient} from "../automation/ats/ashby/ashby-metadata-client.mjs";
import {parseAshbyIdentity,validateAshbySubmissionTarget} from "../automation/ats/ashby/ashby-target-policy.mjs";
import {formStructureHash} from "./form-structure-hash.mjs";

const isHumanChallenge=code=>/CAPTCHA|MFA|LOGIN|VERIFICATION|ANTI_BOT/.test(String(code||""));

export class AshbyFinalRevalidator{
  constructor({store,dataDir,registry,browserManager,metadataClient=new AshbyMetadataClient(),allowLocalFixtures=false,jobStatusChecker=null,clock=()=>new Date()}={}){Object.assign(this,{store,dataDir,registry,browserManager,metadataClient,allowLocalFixtures,jobStatusChecker,clock});}
  resolve(applicationId){
    const application=this.store.applications.findById(applicationId),job=application?this.store.jobs.findById(application.jobId):null,plan=application?this.store.applicationPlans.forApplication(applicationId):null;
    if(!application||!job||!plan)throw Object.assign(new Error("Candidatura Ashby incompleta."),{code:"ASHBY_APPLICATION_CONTEXT_MISSING"});
    if(plan.atsType!=="ashby")throw Object.assign(new Error("Final revalidation disponível somente para Ashby."),{code:"ASHBY_ADAPTER_REQUIRED"});
    const candidate=job.applicationUrl||job.canonicalUrl||job.url,parsed=parseAshbyIdentity(candidate),targetCandidate=this.allowLocalFixtures&&/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(job.url||"")?job.url:candidate,target=validateAshbySubmissionTarget(targetCandidate,{expectedIdentity:parsed,allowLocalFixture:this.allowLocalFixtures});
    return {application,job,plan,identity:{...parsed,...target.identity},target};
  }
  async checkJob(context){if(this.jobStatusChecker)return this.jobStatusChecker(context);if(context.target.localFixture)return {status:"OPEN",checkedAt:this.clock().toISOString(),authority:"controlled-local-fixture",reference:"local-fixture"};return this.metadataClient.checkJob(context.identity);}
  async inspect(applicationId,{keepSession=false}={}){
    const context=this.resolve(applicationId),jobCheck=await this.checkJob(context);let session;
    try{
      const resumed=this.browserManager.resume(applicationId),resumeAfterChallenge=Boolean(resumed&&isHumanChallenge(resumed.sessionMeta?.reason));session=resumed||await this.browserManager.open(applicationId,`ashby-final-preflight-${Date.now()}`);if(!resumeAfterChallenge)await session.page.goto(context.target.url,{waitUntil:"domcontentloaded"});
      const challenge=await detectChallenge(session.page);if(challenge)throw Object.assign(new Error("Verificação humana pendente no target Ashby."),{code:challenge});
      const adapter=this.registry.get("ashby"),inspected=await adapter.inspectApplicationForm(session.page,{job:context.job}),schema=inspected.schema,structureHash=formStructureHash(schema.fields),report={url:context.target.localFixture?"controlled-local-fixture":context.identity.canonicalUrl,ats:"ashby",adapterVersion:adapter.constructor.version,variant:schema.variant,fieldsFound:schema.fields.length,requiredFields:schema.fields.filter(field=>field.required).length,knownFields:0,unknownFields:schema.fields.filter(field=>field.required).length,supported:schema.health!=="UNSUPPORTED",compatibilityConfidence:schema.compatibilityConfidence,warnings:schema.warnings||[],submissionBoundary:await adapter.findSubmitBoundary(session.page).then(()=>true).catch(()=>false),fresh:true,formStructureHash:structureHash};
      const inspection=this.store.applicationInspections.create({applicationId,adapterType:"ashby",adapterVersion:adapter.constructor.version,detectedVariant:schema.variant,compatibilityConfidence:schema.compatibilityConfidence,health:schema.health,domSignature:schema.domSignature,unsupportedSignals:schema.unsupportedSignals,warnings:schema.warnings,report}),result={context,jobCheck,inspection,adapter,inspected,schema,formStructureHash:structureHash,checkedAt:this.clock().toISOString(),session:keepSession?session:null};
      if(!keepSession){await this.browserManager.close(session);session=null;}return result;
    }catch(error){if(session&&isHumanChallenge(error.code)&&!this.browserManager.headless){await this.browserManager.hold(session,{status:error.code,adapterType:"ashby"}).catch(()=>this.browserManager.close(session).catch(()=>{}));session=null;}if(session)await this.browserManager.close(session).catch(()=>{});throw error;}
  }
  async prepareForSubmit(applicationId,{expectedPreflight}={}){
    const live=await this.inspect(applicationId,{keepSession:true});
    try{
      if(live.jobCheck.status!=="OPEN")throw Object.assign(new Error("A vaga Ashby não está confirmada como aberta."),{code:"ASHBY_JOB_NOT_OPEN",phase:"PRE_ACTION",jobCheck:live.jobCheck});
      if(live.schema.health!=="HEALTHY"||Number(live.schema.compatibilityConfidence)<.8)throw Object.assign(new Error("Inspection Ashby fresh não está saudável."),{code:"ASHBY_FRESH_INSPECTION_BLOCKED",phase:"PRE_ACTION"});
      if(!live.inspection.report.submissionBoundary)throw Object.assign(new Error("Boundary final Ashby ausente."),{code:"ASHBY_SUBMIT_BOUNDARY_MISSING",phase:"PRE_ACTION"});
      if(expectedPreflight?.domSignature&&expectedPreflight.domSignature!==live.schema.domSignature)throw Object.assign(new Error("DOM mudou depois da revisão final."),{code:"PREVIEW_STALE",phase:"PRE_ACTION"});
      if(expectedPreflight?.formStructureHash&&expectedPreflight.formStructureHash!==live.formStructureHash)throw Object.assign(new Error("Estrutura do formulário mudou depois da revisão final."),{code:"PREVIEW_STALE",phase:"PRE_ACTION"});
      const questions=this.store.applicationQuestions.forApplication(applicationId),mapped=live.adapter.mapFields(live.inspected,{get:()=>null},questions,[]),version=live.context.application.resumeVersionId?this.store.resumeVersions.findById(live.context.application.resumeVersionId):null,artifact=version?this.store.resumeArtifacts.latest(version.id,"PDF"):null,selected=await validateResumeArtifact({version,artifact,dataDir:this.dataDir}),ready=mapped.map(field=>field.semanticKey==="RESUME.FILE"?{...field,answer:artifact.id,answerStatus:"KNOWN",answerSource:"application_plan"}:field),audit=await live.adapter.fill(live.session.page,ready,{resumePath:selected.path,resumeArtifact:artifact});
      if(audit.some(item=>item.status==="FAILED"||item.status==="USER_REQUIRED"))throw Object.assign(new Error("Preenchimento fresh Ashby não ficou completo."),{code:"ASHBY_FRESH_FILL_BLOCKED",phase:"PRE_ACTION"});
      const validation=await live.adapter.validate(live.session.page,ready),challenge=await detectChallenge(live.session.page);if(challenge)throw Object.assign(new Error("Challenge humano detectado antes do submit Ashby."),{code:challenge,phase:"PRE_ACTION"});if(!validation.valid)throw Object.assign(new Error("Validação fresh do formulário Ashby falhou."),{code:"ASHBY_FRESH_VALIDATION_FAILED",phase:"PRE_ACTION"});
      return {...live,mapped:ready,validation,selected};
    }catch(error){await this.browserManager.close(live.session).catch(()=>{});throw error;}
  }
}
