import { snapshotHash } from "../application/submission-snapshot.mjs";
import { buildResumeSourceEvidence } from "../resume/resume-source-evidence.mjs";
import { publicUrl } from "../security/public-url-policy.mjs";
import {SKILL_DEFINITIONS} from "../matching/constants.mjs";

export const DELAYED_QUESTION_TASK="APPLICATION_QUESTION_TIMEOUT";
export function selectQuestionModel(models,configured="") {
  if(configured)return models.some(model=>model.name===configured)?configured:"";
  const matches=models.filter(model=>/qwen3[-/_ ]4b[-/_ ].*2507/i.test(model.name));
  return matches.length===1?matches[0].name:"";
}
const terminal=new Set(["CANCELLED","SUBMITTED","SUBMITTING","SUBMISSION_UNCERTAIN"]);
const normalize=value=>String(value||"").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/\s+/g," ").trim();

// Free prose remains a draft. Only a literal excerpt of the approved base may
// bypass another review, under a separate, explicit policy.
export function extractiveAnswerAllowed(question,result,evidence) {
  if(question.sensitive||question.consentType||question.answerCategory!=="FACT"||
    !["PROFESSIONAL.SKILL_EXPERIENCE","PROFESSIONAL.EXPERIENCE_SUMMARY"].includes(question.semanticKey)||
    !["text","textarea"].includes(question.fieldType)||result?.evidenceStatus!=="VALID"||result?.meta?.fallback||!result?.generated)return false;
  const text=normalize(result.draft),ids=result.evidenceIds||[];
  const mentions=(value,alias)=>` ${value.replace(/[^a-z0-9]+/g," ")} `.includes(` ${normalize(alias).replace(/[^a-z0-9]+/g," ")} `);
  const requestedSkills=SKILL_DEFINITIONS.filter(skill=>skill.aliases.some(alias=>mentions(normalize(question.label),alias)));
  if(requestedSkills.some(skill=>!skill.aliases.some(alias=>mentions(text,alias))))return false;
  return text.length>=20&&text.length<=1200&&ids.length>0&&ids.every(id=>evidence.some(e=>e.id===id))&&
    evidence.some(e=>ids.includes(e.id)&&normalize(e.text).includes(text));
}

export class DelayedQuestionService {
  constructor({store,approvalGateway,drafterProvider,routing,modelProvider,researchProvider=null,clock=()=>Date.now()}={}) {
    Object.assign(this,{store,approvalGateway,drafterProvider,routing,modelProvider,researchProvider,clock});
  }
  schedule(request) {
    const policy=this.store.questionFallbackPolicy.get();
    if(!policy.enabled||request?.status!=="AWAITING_ANSWER"||!request.sentAt)return null;
    const application=this.store.applications.findById(request.applicationId);
    if(!application||terminal.has(application.status)||this.routing(application).route!=="AUTO_APPLY")return null;
    const question=this.store.applicationQuestions.forApplication(application.id).find(q=>q.id===request.questionId);
    if(!question?.fingerprint)return null;
    const dueAt=new Date(Date.parse(request.sentAt)+policy.waitMinutes*60000).toISOString();
    return this.store.intelligenceJobs.enqueue(DELAYED_QUESTION_TASK,{
      applicationId:application.id,questionId:question.id,requestId:request.id,sentAt:request.sentAt,dueAt,
      fingerprint:question.fingerprint,snapshotHash:this.store.applicationDecisionService.snapshot(application),
      baseHash:snapshotHash(this.store.resumes.findById(application.resumeId)),
    },{availableAt:dueAt,once:true});
  }
  context(payload) {
    const application=this.store.applications.findById(payload.applicationId),request=this.store.whatsappQuestions.findById(payload.requestId),policy=this.store.questionFallbackPolicy.get();
    if(!policy.enabled||!application||terminal.has(application.status)||request?.status!=="AWAITING_ANSWER"||request.sentAt!==payload.sentAt||request.applicationId!==application.id||request.questionId!==payload.questionId)return null;
    if(!Number.isFinite(Date.parse(payload.dueAt))||this.clock()<Date.parse(payload.dueAt)||this.store.applicationDecisionService.snapshot(application)!==payload.snapshotHash||this.routing(application).route!=="AUTO_APPLY")return null;
    if(snapshotHash(this.store.resumes.findById(application.resumeId))!==payload.baseHash)return null;
    const question=this.store.applicationQuestions.forApplication(application.id).find(q=>q.id===payload.questionId);
    if(!question?.required||question.answerStatus!=="USER_REQUIRED"||question.fingerprint!==payload.fingerprint)return null;
    return {application,question,request,policy,payload};
  }
  async execute(payload) {
    let context=this.context(payload);
    if(!context)return {status:"SKIPPED",reason:"QUESTION_CONTEXT_CHANGED"};
    const {application,question,policy}=context;
    if(question.sensitive||question.consentType||!["text","textarea"].includes(question.fieldType)||
      /^(IDENTITY|CONTACT|LOCATION|COMPENSATION|WORK_AUTHORIZATION|PREFERENCES|CONSENT|DEMOGRAPHIC)\.|^APPLICATION\.(NOTICE_PERIOD|START_DATE)/.test(question.semanticKey||""))
      return this.pending(context,"HUMAN_ONLY");
    const resume=this.store.resumes.findById(application.resumeId),baseId=this.store.database.getMetadata("default_resume_id","");
    if(!resume||resume.id!==baseId||resume.resumeKind!=="BASE")return this.pending(context,"APPROVED_BASE_REQUIRED");
    const evidence=buildResumeSourceEvidence(resume).filter(e=>["experience","experiences","projects","document"].includes(e.sourceSection));
    if(!evidence.length)return this.pending(context,"NO_VERIFIED_EVIDENCE");
    let result;
    try {
      const model=await this.modelProvider(policy.model);
      if(!model)return this.pending(context,"QUESTION_MODEL_NOT_AVAILABLE");
      const job=this.store.jobs.findById(application.jobId),research=await this.research(job,policy,application.id);
      result=await this.drafterProvider().draft({question:{label:question.label,description:question.description,type:question.fieldType},job,evidence,model,extractive:policy.autoFillEnabled,research});
    } catch(error) { return this.pending(context,error.code||"QUESTION_LLM_UNAVAILABLE"); }
    context=this.context(payload);
    if(!context)return {status:"SKIPPED",reason:"QUESTION_CONTEXT_CHANGED"};
    if(!result?.generated||result.evidenceStatus!=="VALID"||result.meta?.fallback||String(result.draft||"").trim().length<12)
      return this.pending(context,"EMPTY_OR_UNSUPPORTED_DRAFT");
    if(!context.policy.autoFillEnabled||!extractiveAnswerAllowed(question,result,evidence)) {
      const generated=this.store.generatedContent.create({applicationId:application.id,questionId:question.id,contentType:"ANSWER_DRAFT",state:"REVIEW_REQUIRED",draft:result.draft,evidenceIds:result.evidenceIds,promptVersion:result.promptVersion,schemaVersion:result.schemaVersion});
      this.store.whatsappQuestions.connection.prepare("UPDATE whatsapp_question_requests SET generated_content_id=? WHERE id=? AND status='AWAITING_ANSWER'").run(generated.id,context.request.id);
      const updatedRequest=this.store.whatsappQuestions.findById(context.request.id);
      await this.notify(context,this.approvalGateway.questionMessage(updatedRequest,application,question));
      return {status:"REVIEW_REQUIRED",generatedContentId:generated.id};
    }
    try {
      const saved=this.store.applicationDecisionService.answer({applicationId:application.id,questionId:question.id,resumeVersionId:application.resumeVersionId,fingerprint:question.fingerprint,answer:result.draft,
        actor:"system:question-timeout-policy",channel:"PLATFORM",source:"LLM_EXTRACTIVE",idempotencyKey:`question-timeout:${snapshotHash(payload)}`,
        saveAnswer:({answer})=>{
          const answered=this.store.applicationQuestions.answer(application.id,question.id,answer,{source:"LLM_EXTRACTIVE",reusable:false});
          this.store.applications.recordEvent(application.id,"APPLICATION_ANSWER_AUTOFILLED",{questionId:question.id,source:"LLM_EXTRACTIVE",evidenceIds:result.evidenceIds,model:result.meta?.model||""});
          return answered;
        }});
      await this.notify(context,`O prazo de espera terminou. A pergunta ${context.request.commandToken} foi preenchida com um trecho literal da BASE 01. O AutoApply so retoma com autorizacao vigente; envio e recibo continuam sujeitos aos gates do portal.`);
      return {...saved,source:"LLM_EXTRACTIVE"};
    } catch(error) { return this.pending(context,error.code||"QUESTION_ANSWER_NOT_APPLIED"); }
  }
  async research(job,policy,applicationId) {
    if(!policy.researchEnabled||!this.researchProvider)return [];
    try {
      const results=await this.researchProvider.search(`${String(job?.company||"").slice(0,120)} ${String(job?.title||"").slice(0,120)}`,{count:3});
      return results.slice(0,3).flatMap(item=>{try{return [{title:item.title,url:publicUrl(item.url).toString(),excerpt:String(item.excerpt||"").slice(0,500),trust:"UNTRUSTED_COMPANY_CONTEXT_NOT_CANDIDATE_EVIDENCE"}];}catch{return [];}});
    }catch(error){this.store.applications.recordEvent(applicationId,"QUESTION_RESEARCH_UNAVAILABLE",{code:error.code||"PUBLIC_WEB_UNAVAILABLE"});return [];}
  }
  async pending(context,reason) {
    if(!this.context(context.payload))return {status:"SKIPPED",reason:"QUESTION_CONTEXT_CHANGED"};
    this.store.applications.recordEvent(context.application.id,"APPLICATION_QUESTION_TIMEOUT_PENDING",{questionId:context.question.id,reason});
    const explanation={HUMAN_ONLY:"Ela exige sua decisao pessoal.",QUESTION_MODEL_NOT_AVAILABLE:"O modelo configurado nao esta disponivel na LLM.",NO_VERIFIED_EVIDENCE:"Nao ha um trecho factual adequado da BASE 01.",APPROVED_BASE_REQUIRED:"A base profissional aprovada nao esta disponivel.",PROVIDER_OFFLINE:"A LLM do PC esta indisponivel.",ECONNREFUSED:"A LLM do PC esta indisponivel.",PROVIDER_TIMEOUT:"A LLM excedeu o prazo da resposta."}[reason]||"A IA nao conseguiu produzir uma resposta automatica verificavel.";
    await this.notify(context,`A pergunta ${context.request.commandToken} continua pendente. ${explanation} Responda com RESPONDER ${context.request.commandToken} sua resposta. Nenhuma candidatura foi enviada por esta etapa.`);
    return {status:"WAITING_USER",reason};
  }
  async notify(context,message) {
    try { await this.approvalGateway.sendAcknowledgement(context.application.id,context.request,message); }
    catch(error) { this.store.applications.recordEvent(context.application.id,"QUESTION_TIMEOUT_NOTIFICATION_FAILED",{code:error.code||"NOTIFICATION_FAILED"}); }
  }
}
