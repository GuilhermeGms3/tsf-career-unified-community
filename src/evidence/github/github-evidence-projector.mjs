import { createHash } from "node:crypto";

const labels={"ci-cd":"CI/CD","github-actions":"GitHub Actions","infrastructure-as-code":"Infrastructure as Code",nodejs:"Node.js",gcp:"Google Cloud Platform",aws:"Amazon Web Services",azure:"Microsoft Azure"};
const depth={WEAK:"AWARENESS",MEDIUM:"USED",STRONG:"PRACTICED",VERY_STRONG:"DELIVERED"};
const idFor=value=>`github-knowledge-${createHash("sha256").update(value).digest("hex").slice(0,24)}`;

export class GitHubEvidenceProjector {
  constructor({facts,evidence}){this.facts=facts;this.evidence=evidence;}
  project(repository,indexedEvidence=[]){
    const execute=()=>{
      const sourcePrefix=`${repository.id}:`,activeIds=[];
      const affected=new Set(this.evidence.evidence({active:false}).filter(e=>e.sourceType==="GITHUB_OBJECTIVE"&&e.sourceId.startsWith(sourcePrefix)).map(e=>e.factKey));
      for(const item of indexedEvidence){
        const factKey=`skill.${item.technology}`,label=labels[item.technology]||item.technology.split("-").map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(" "),sourceId=`${sourcePrefix}${item.id}`;
        activeIds.push(sourceId);affected.add(factKey);
        // Persistence owns authority/conflicts; supporting evidence never takes ownership.
        this.facts.save({key:factKey,value:label,rawText:label,unitType:"SKILL",source:"GITHUB",sourceType:"GITHUB",sourceId:repository.id,sourceVersionId:item.snapshotSha,verificationStatus:"SYSTEM_EXTRACTED",reusePolicy:"REUSABLE",lifecycleStatus:"ACTIVE",confidence:item.confidence,provenance:{provider:"GITHUB",repositoryId:repository.providerRepositoryId,private:item.private}},{actor:"GITHUB_SYNC",detectConflict:true});
        this.evidence.saveEvidence({id:idFor(sourceId),factKey,contextType:"OTHER",usageDescription:`Objective ${item.artifactType} artifact`,activities:[],depth:depth[item.strength]||"USED",verificationStatus:"SYSTEM_EXTRACTED",confidence:item.confidence,reusePolicy:"REUSABLE",sourceType:"GITHUB_OBJECTIVE",sourceId,provenance:{provider:"GITHUB",repositoryId:repository.providerRepositoryId,artifactPath:item.path,snapshotSha:item.snapshotSha,detectorId:item.detectorId,strength:item.strength,private:item.private,contributionRelation:item.contributionRelation},lastUsedAt:item.latestObservedAt||null,lifecycleStatus:"ACTIVE"});
      }
      this.evidence.archiveProviderEvidence("GITHUB_OBJECTIVE",sourcePrefix,activeIds);
      for(const key of affected){
        const fact=this.facts.find(key),support=this.evidence.evidence({factKey:key}).filter(e=>!e.negative);
        if(fact?.source==="GITHUB"&&fact.sourceType==="GITHUB"&&fact.verificationStatus==="SYSTEM_EXTRACTED"&&!support.length)
          this.facts.changeStatus(key,"ARCHIVED",{actor:"GITHUB_RECONCILIATION"});
      }
      return {facts:new Set(indexedEvidence.map(item=>item.technology)).size,evidence:activeIds.length};
    };
    return this.facts.database?this.facts.database.transaction(execute):execute();
  }
}
