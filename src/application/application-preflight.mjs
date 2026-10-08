import { validateAutomationUrl, validateResumeArtifact, validateSelectedResume } from "../automation/automation-validation.mjs";

export class ApplicationPreflight {
  constructor({store,dataDir,registry}){this.store=store;this.dataDir=dataDir;this.registry=registry;}
  async evaluate(applicationId,{mode="FILL_ONLY",allowRunningQueue=false}={}){
    const reasons=[];const application=this.store.applications.findById(applicationId);if(!application)return {status:"BLOCKED",reasons:["APPLICATION_NOT_FOUND"]};
    const job=this.store.jobs.findById(application.jobId);const plan=this.store.applicationPlans.forApplication(applicationId);const analysis=plan?.analysisId?this.store.analyses.findById(plan.analysisId):null;
    if(!job)reasons.push("JOB_NOT_FOUND");else try{validateAutomationUrl(job.applicationUrl||job.canonicalUrl||job.url)}catch{reasons.push("INVALID_JOB_URL")}
    if(!plan)reasons.push("PLAN_NOT_FOUND");if(!analysis)reasons.push("ATS_ANALYSIS_NOT_FOUND");
    if(analysis?.eligibility==="NOT_ELIGIBLE"||plan?.decision==="BLOCKED"||plan?.decision==="SKIP")reasons.push("POLICY_BLOCKED");
    const resume=plan?.selectedResumeId?this.store.resumes.findById(plan.selectedResumeId):null,version=plan?.selectedResumeVersionId?this.store.resumeVersions?.findById(plan.selectedResumeVersionId):null,artifact=version?this.store.resumeArtifacts?.latest(version.id,"PDF"):null;
    if(mode==="FILL_ONLY")try{if(plan?.selectedResumeVersionId)await validateResumeArtifact({version,artifact,dataDir:this.dataDir});else await validateSelectedResume(resume,this.dataDir)}catch(error){reasons.push(error.code||"RESUME_INVALID")}
    const queued=this.store.applicationQueue.forApplication(applicationId);if(queued?.status==="RUNNING"&&!allowRunningQueue)reasons.push("QUEUE_LOCKED");
    const generated=this.store.generatedContent?.forApplication(applicationId)||[];if(generated.some(item=>item.state==="REVIEW_REQUIRED"||item.state==="DRAFT"))reasons.push("GENERATED_CONTENT_REVIEW_REQUIRED");
    const tailoring=job&&resume?this.store.resumeTailoring?.latestFor(job.id,resume.id):null;if(tailoring&&["DRAFT","REVIEW_REQUIRED"].includes(tailoring.state))reasons.push("TAILORED_RESUME_REVIEW_REQUIRED");
    const ats=plan?.atsType||"unknown";if(!this.registry.supports(ats))reasons.push("ATS_UNSUPPORTED");
    const blocked=reasons.some(x=>["APPLICATION_NOT_FOUND","JOB_NOT_FOUND","INVALID_JOB_URL","PLAN_NOT_FOUND","ATS_ANALYSIS_NOT_FOUND","POLICY_BLOCKED","RESUME_PATH_NOT_ALLOWED","RESUME_FILE_MISSING","RESUME_FILE_NOT_ALLOWED","RESUME_FILE_TOO_LARGE","RESUME_VERSION_MISSING","RESUME_VERSION_NOT_READY","RESUME_ARTIFACT_MISSING","RESUME_ARTIFACT_PATH_NOT_ALLOWED","RESUME_ARTIFACT_TYPE_INVALID","RESUME_ARTIFACT_HASH_MISMATCH","QUEUE_LOCKED"].includes(x));
    const review=reasons.length>0||analysis?.eligibility==="REVIEW_REQUIRED"||plan?.decision==="REVIEW";
    return {status:blocked?"BLOCKED":review?"REVIEW_REQUIRED":"READY",reasons,requiresReviewBeforeFill:reasons.some(x=>["GENERATED_CONTENT_REVIEW_REQUIRED","TAILORED_RESUME_REVIEW_REQUIRED","LOW_CONFIDENCE_SEMANTIC_RESOLUTION"].includes(x)),applicationId,ats,adapterVersion:this.registry.version(ats),resumeVersionId:version?.id||"",resumeArtifactId:artifact?.id||""};
  }
}
