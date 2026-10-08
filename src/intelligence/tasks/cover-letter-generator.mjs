import { TASK_TYPES } from "../runtime/task-types.mjs";
import { EvidenceGuard } from "../validation/evidence-guard.mjs";
export class CoverLetterGenerator{
  constructor(service,{guard=new EvidenceGuard()}={}){this.service=service;this.guard=guard;}
  async generate({requested=false,job,evidence=[],preferences={}}){if(!requested||!this.service.policies.coverLetterEnabled)return {draft:"",evidenceIds:[],requiresReview:true,state:"DRAFT",skipped:true};const response=await this.service.execute(TASK_TYPES.COVER_LETTER,{job:{title:job?.title||"",company:job?.company||"",description:String(job?.description||"").slice(0,4000)},evidence:evidence.map(({id,text,type})=>({id,text,type})),preferences},{fallback:{draft:"",evidenceIds:[],requiresReview:true}});const guard=this.guard.validateText(response.result.draft,evidence,response.result.evidenceIds);return {...response.result,requiresReview:true,state:"REVIEW_REQUIRED",evidenceStatus:guard.status,unsupportedClaims:guard.unsupportedClaims,promptVersion:response.meta.promptVersion,schemaVersion:response.meta.schemaVersion,meta:response.meta};}
}
