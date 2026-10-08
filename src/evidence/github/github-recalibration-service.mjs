export class GitHubRecalibrationService {
  constructor({store,matcher,profileProvider,opportunities}){Object.assign(this,{store,matcher,profileProvider,opportunities});}
  async run(){
    const jobs=this.store.jobs.all();if(jobs.length>2000)throw Object.assign(new Error("Recalibração local limitada a 2000 vagas por operação."),{status:400});
    const profile=await this.profileProvider(),latest=new Map();for(const analysis of this.store.analyses.all())if(!latest.has(analysis.jobId)||analysis.updatedAt>latest.get(analysis.jobId).updatedAt)latest.set(analysis.jobId,analysis);
    const countNotIndexed=()=>[...latest.values()].flatMap(analysis=>this.store.analysisItems.forAnalysis(analysis.id)).filter(item=>item.resolution?.reason==="NOT_INDEXED").length;
    const distribution=async()=>{const values={};for(const item of await this.opportunities.list()){const key=item.decision?.disposition||"UNKNOWN";values[key]=(values[key]||0)+1;}return values;};
    const before={notIndexed:countNotIndexed(),decisions:await distribution()};
    for(const job of jobs){const previous=latest.get(job.id),resume=previous?.resumeId?this.store.resumes.findById(previous.resumeId):null,analysis=this.matcher({job,resume:resume||undefined,profile});this.store.database.transaction(()=>{this.store.analyses.upsert(analysis);this.store.jobRequirements.syncForJob(job.id,analysis.requirements||[]);this.store.analysisItems.syncForAnalysis(analysis.id,analysis.items||[]);});latest.set(job.id,analysis);}
    this.opportunities.invalidate();return {jobs:jobs.length,before,after:{notIndexed:countNotIndexed(),decisions:await distribution()},externalRequests:0,thresholdsChanged:false};
  }
}
