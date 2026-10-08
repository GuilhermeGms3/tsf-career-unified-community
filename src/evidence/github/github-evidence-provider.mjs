import { applyContributionPolicy, detectRepositoryArtifacts, GITHUB_EVIDENCE_VERSION, potentialEvidenceArtifact } from "./repository-evidence-detectors.mjs";
import {randomUUID} from "node:crypto";

const bounded=(items,max)=>items.slice(0,Math.max(1,max));
const relation=(repo,viewer)=>repo.fork?"FORK":repo.owner?.login===viewer?"OWNED":repo.owner?.type==="Organization"?"ORGANIZATION":"CONTRIBUTED";

export class GitHubEvidenceProvider {
  constructor({client,repository,projector,maxRepositories=100,maxFilesPerRepository=250}={}){Object.assign(this,{client,repository,projector});this.maxRepositories=maxRepositories;this.maxFilesPerRepository=maxFilesPerRepository;this.id="github";}
  evidence(){const snapshot=this.repository.latestSnapshot(),rows=this.repository.evidence(),repositories=this.repository.repositories(),indexed=repositories.filter(item=>item.syncStatus==="INDEXED").length,failed=repositories.filter(item=>item.syncStatus==="ERROR").length,status=!repositories.length?"NOT_INDEXED":failed&&indexed?"DEGRADED":failed?"ERROR":indexed?"READY":"NOT_INDEXED";return {status:this.inFlight?"SYNCING":snapshot?.status==="SYNCING"?"ERROR":snapshot?.status||status,evidence:rows.map(item=>({id:item.id,type:"skill",normalizedName:item.technology,source:"github",sourceSection:item.path,text:`Objective ${item.artifactType} artifact`,strength:item.strength,strengthScore:{WEAK:.4,MEDIUM:.65,STRONG:.85,VERY_STRONG:.94}[item.strength],metadata:{provider:"GITHUB",repositoryId:item.provenance.repositoryId,artifactPath:item.path,snapshotSha:item.snapshotSha,detectorId:item.detectorId,private:item.private,contributionRelation:item.contributionRelation}})),details:{repositories:repositories.length,indexed,failed,evidenceItems:rows.length,evidenceFacts:new Set(rows.map(item=>item.technology)).size,lastSyncAt:snapshot?.syncedAt||null,snapshot,technologies:[...new Set(rows.map(item=>item.technology))].sort()}};}
  sync(){if(!this.inFlight)this.inFlight=this.performSync().finally(()=>{this.inFlight=null;});return this.inFlight;}
  async performSync(){
    const started=Date.now(),viewer=await this.client.viewer(),allRepos=await this.client.listRepositories(),repos=bounded(allRepos,this.maxRepositories),syncId=`github-sync-${randomUUID()}`;
    this.repository.startSnapshot(syncId,viewer.id,GITHUB_EVIDENCE_VERSION);
    const summary={syncId,repositoriesDiscovered:allRepos.length,eligibleRepositories:repos.length,indexed:0,noOp:0,failed:0,evidenceItems:0,durationMs:0,truncated:allRepos.length>repos.length};
    for(const remote of repos){
      const providerRepositoryId=String(remote.id),ownerRelation=relation(remote,viewer.login),visibility=remote.private?"PRIVATE":"PUBLIC",current=this.repository.repositoryByProviderId(providerRepositoryId);
      const saved=this.repository.saveRepository({providerRepositoryId,displayName:remote.private?"private-repository":String(remote.name||"repository"),ownerRelation,visibility,isFork:Boolean(remote.fork),defaultBranch:remote.default_branch||"",syncStatus:current?.syncStatus||"NOT_INDEXED",metadata:{archived:Boolean(remote.archived),disabled:Boolean(remote.disabled)}});
      try{
        const head=await this.client.repositoryHead(remote);
        if(saved.syncStatus==="INDEXED"&&saved.headSha===head.sha&&current?.evidenceVersion===GITHUB_EVIDENCE_VERSION){summary.noOp++;this.projector?.project(saved,this.repository.evidence({repositoryId:saved.id}));continue;}
        this.repository.markStatus(providerRepositoryId,"SYNCING");
        const incremental=Boolean(saved.headSha)&&current?.evidenceVersion===GITHUB_EVIDENCE_VERSION,changedPaths=incremental?await this.client.changedPaths(remote,saved.headSha,head.sha):null;
        const treeResult=incremental?null:await this.client.tree(remote,head.sha,{etag:saved.etag});
        const candidates=bounded((incremental?changedPaths.map(path=>({path,size:0})):treeResult.files).filter(potentialEvidenceArtifact),this.maxFilesPerRepository),files=[];
        for(const candidate of candidates){const loaded=await this.client.file(remote,candidate.path,head.sha);if(loaded)files.push(loaded);}
        const attributablePaths=ownerRelation==="OWNED"&&!remote.fork?files.map(file=>file.path):await this.client.attributedPaths(remote,viewer.login);
        const detected=applyContributionPolicy(detectRepositoryArtifacts(files),{ownerRelation,isFork:Boolean(remote.fork),attributablePaths}).map(item=>({...item,private:Boolean(remote.private),firstObservedAt:head.date,latestObservedAt:head.date,provenance:{provider:"GITHUB",repositoryId:providerRepositoryId,artifactPath:item.path,snapshotSha:head.sha,detectorId:item.detectorId,private:Boolean(remote.private),contributionRelation:item.contributionRelation}}));
        const indexed=this.repository.syncEvidence(saved.id,{snapshotSha:head.sha,evidence:detected,changedPaths});
        const updated=this.repository.markStatus(providerRepositoryId,"INDEXED",{headSha:head.sha,etag:treeResult?.etag||saved.etag,metadata:{lastMode:incremental?"INCREMENTAL":"FULL",filesInspected:files.length}});
        this.projector?.project(updated,indexed);summary.indexed++;summary.evidenceItems+=detected.length;
      }catch(error){this.repository.markStatus(providerRepositoryId,"ERROR",{metadata:{code:["GITHUB_RATE_LIMITED","GITHUB_CREDENTIAL_INVALID","GITHUB_TIMEOUT"].includes(error?.code)?error.code:"GITHUB_SYNC_FAILED"}});summary.failed++;if(["GITHUB_RATE_LIMITED","GITHUB_CREDENTIAL_INVALID"].includes(error?.code))break;}
    }
    if(!summary.failed&&!summary.truncated&&allRepos.length<300){this.repository.retireRepositories(new Set(repos.map(repo=>String(repo.id))));for(const repo of this.repository.repositories())this.projector?.project(repo,this.repository.evidence({repositoryId:repo.id}));}
    summary.evidenceItems=this.repository.evidence().length;
    summary.evidenceFacts=new Set(this.repository.evidence().map(item=>item.technology)).size;
    summary.durationMs=Date.now()-started;
    summary.status=summary.failed?(summary.indexed||summary.noOp?"DEGRADED":"ERROR"):"READY";
    this.repository.finishSnapshot(syncId,summary.status,summary);return summary;
  }
}

export { GITHUB_EVIDENCE_VERSION };
