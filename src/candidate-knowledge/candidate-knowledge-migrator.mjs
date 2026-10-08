import {AGGREGATE_KNOWLEDGE_KEYS,knowledgeUnitsFromAggregate} from "./candidate-knowledge-normalizer.mjs";

export class CandidateKnowledgeMigrator {
  constructor({repository,database}){this.repository=repository;this.database=database;}
  migrateLegacyAggregates(){
    const report={aggregatesFound:0,aggregatesConverted:0,unitsCreated:0,unitsExisting:0,emptyAggregates:0};
    this.database.transaction(()=>{
      for(const key of AGGREGATE_KNOWLEDGE_KEYS){
        const legacy=this.repository.find(key,{includeInactive:true});
        if(!legacy)continue;report.aggregatesFound+=1;
        if(legacy.lifecycleStatus==="LEGACY_READ_ONLY"){report.aggregatesConverted+=1;continue;}
        const units=knowledgeUnitsFromAggregate(legacy);
        if(!units.length)report.emptyAggregates+=1;
        for(const unit of units){
          const exists=this.repository.find(unit.key,{includeInactive:true});
          if(exists){report.unitsExisting+=1;continue;}
          this.repository.save(unit,{actor:"MIGRATION_012"});report.unitsCreated+=1;
        }
        this.repository.changeStatus(key,"LEGACY_READ_ONLY",{actor:"MIGRATION_012"});report.aggregatesConverted+=1;
      }
    });
    return report;
  }
}
