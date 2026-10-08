import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {CandidateKnowledgeMigrator} from "../src/candidate-knowledge/candidate-knowledge-migrator.mjs";
import {candidateKnowledgeKey,classifyLegacyItem,knowledgeUnitsFromAggregate} from "../src/candidate-knowledge/candidate-knowledge-normalizer.mjs";
import {CandidateKnowledgeBase} from "../src/application/candidate-knowledge-base.mjs";
import {extractCandidateEvidence} from "../src/matching/candidate-evidence-extractor.mjs";

async function withStore(callback){const dataDir=await mkdtemp(path.join(os.tmpdir(),"candidate-knowledge-v2-")),store=await new UnifiedStateStore({dataDir}).initialize();try{await callback(store);}finally{store.close();await rm(dataDir,{recursive:true,force:true});}}
const aggregate=(key,value,overrides={})=>({key,value,source:"USER_CONFIRMED",sourceType:"CANDIDATE_PROFILE",confidence:1,verified:true,verificationStatus:"USER_CONFIRMED",reusePolicy:"REUSABLE",unitType:"APPLICATION_FACT",...overrides});

test("granulariza skills e preserva rawText, confirmação e confiança de extração",()=>{
  const units=knowledgeUnitsFromAggregate(aggregate("PROFILE.SKILLS",[{name:"Microsoft Azure",rawText:"MS Azure",normalizationConfidence:.72},"Docker"]));
  assert.deepEqual(units.map(item=>item.key),["skill.azure","skill.docker"]);assert.equal(units[0].rawText,"MS Azure");assert.equal(units[0].confidence,.72);assert.equal(units[0].verificationStatus,"USER_CONFIRMED");
});

test("aliases seguros deduplicam Azure sem confundir Docker Compose com Docker",()=>{
  assert.equal(candidateKnowledgeKey("SKILL","MS Azure"),"skill.azure");assert.equal(candidateKnowledgeKey("SKILL","Microsoft Azure"),"skill.azure");assert.notEqual(candidateKnowledgeKey("SKILL","Docker"),candidateKnowledgeKey("SKILL","Docker Compose"));
});

test("idioma em certificações é reclassificado somente com regra determinística e revisão",()=>{
  const classified=classifyLegacyItem("PROFILE.CERTIFICATIONS","Alemão básico (A2) - Testizer");assert.equal(classified.unitType,"LANGUAGE");assert.equal(classified.canonical,"german");assert.equal(classified.reviewRequired,true);
});

test("migration legada converte arrays uma vez, mantém vazio e preserva legado read-only",async()=>withStore(async store=>{
  store.candidateFacts.save(aggregate("PROFILE.SKILLS",["Azure","Docker"]));store.candidateFacts.save(aggregate("PROFILE.LANGUAGES",["Inglês B2"]));store.candidateFacts.save(aggregate("PROFILE.CERTIFICATIONS",["CCNA"]));store.candidateFacts.save(aggregate("PROFILE.PROJECTS",[]));
  const migrator=new CandidateKnowledgeMigrator({repository:store.candidateFacts,database:store.database}),first=migrator.migrateLegacyAggregates(),second=migrator.migrateLegacyAggregates();
  assert.equal(first.unitsCreated,4);assert.equal(first.emptyAggregates,1);assert.equal(store.candidateFacts.find("PROFILE.SKILLS",{includeInactive:true}).lifecycleStatus,"LEGACY_READ_ONLY");assert.equal(second.unitsCreated,0);assert.equal(store.candidateFacts.active().some(item=>item.key==="skill.azure"),true);
}));

test("experiência, formação e projeto permanecem unidades estruturadas",()=>{
  const experience={id:"exp-1",company:"Empresa",role:"Analista",responsibilities:["Operação"],technologies:["Linux"]};
  const education={id:"edu-1",institution:"Instituição",course:"Curso"},project={id:"project-1",name:"Projeto",technologies:["Node.js"]};
  assert.deepEqual(knowledgeUnitsFromAggregate(aggregate("PROFILE.EXPERIENCE",[experience]))[0].value,experience);assert.deepEqual(knowledgeUnitsFromAggregate(aggregate("PROFILE.EDUCATION",[education]))[0].value,education);assert.deepEqual(knowledgeUnitsFromAggregate(aggregate("PROFILE.PROJECTS",[project]))[0].value,project);
});

test("projeção do perfil usa as mesmas chaves da migration e arquiva projeção redundante",async()=>withStore(async store=>{
  const experience={id:"exp-1",company:"Empresa",role:"Analista",normalizationConfidence:.72};store.candidateFacts.save(aggregate("PROFILE.EXPERIENCE",[experience]));new CandidateKnowledgeMigrator({repository:store.candidateFacts,database:store.database}).migrateLegacyAggregates();
  store.candidateFacts.save({key:"work-experience.projecao-antiga",value:experience,unitType:"WORK_EXPERIENCE",source:"CANDIDATE_PROFILE",sourceType:"CANDIDATE_PROFILE",verificationStatus:"USER_CONFIRMED",reusePolicy:"REUSABLE"});store.candidateFacts.syncProfile(CandidateKnowledgeBase.fromProfile({resumeData:{experience:[experience]}}).all());
  assert.equal(store.candidateFacts.active({unitType:"WORK_EXPERIENCE"}).length,1);assert.equal(store.candidateKnowledge.summary().sections.find(section=>section.id==="experience").items.length,1);assert.equal(store.candidateFacts.find("work-experience.projecao-antiga",{includeInactive:true}).lifecycleStatus,"ARCHIVED");
}));

test("verification status não altera extraction confidence",async()=>withStore(async store=>{
  const saved=store.candidateFacts.save({key:"skill.linux",value:"Linux",unitType:"SKILL",source:"USER_CONFIRMED",verificationStatus:"USER_CONFIRMED",confidence:.61,reusePolicy:"REUSABLE"});assert.equal(saved.verified,true);assert.equal(saved.verificationStatus,"USER_CONFIRMED");assert.equal(saved.confidence,.61);
}));

test("policy protege sensível e respeita reutilização controlada",async()=>withStore(async store=>{
  const sensitive=store.candidateFacts.save({key:"sensitive.salary",value:"valor",unitType:"SENSITIVE",sensitive:true,verificationStatus:"USER_CONFIRMED",reusePolicy:"REUSABLE"});assert.equal(sensitive.reusable,false);assert.equal(sensitive.reusePolicy,"SENSITIVE_CONFIRM_EACH_TIME");assert.equal(CandidateKnowledgeBase.fromFacts([sensitive]).get(sensitive.key),null);
}));

test("conflito não sobrescreve fato confirmado",async()=>withStore(async store=>{
  store.candidateFacts.save({key:"LOCATION.CITY",value:"Cidade A",unitType:"LOCATION",source:"USER_CONFIRMED",verificationStatus:"USER_CONFIRMED",reusePolicy:"REUSABLE"});const result=store.candidateFacts.save({key:"LOCATION.CITY",value:"Cidade B",unitType:"LOCATION",source:"RESUME_IMPORT",verificationStatus:"SYSTEM_EXTRACTED"},{detectConflict:true});assert.equal(result.value,"Cidade A");assert.equal(store.candidateFacts.conflicts().length,1);
}));

test("uso real atualiza lastUsedAt e rejeição/arquivo preservam auditabilidade",async()=>withStore(async store=>{
  store.candidateFacts.save({key:"skill.linux",value:"Linux",unitType:"SKILL",source:"RESUME_IMPORT",verificationStatus:"IMPORTED_CONFIRMED",reusePolicy:"REUSABLE"});assert.equal(store.candidateFacts.find("skill.linux").lastUsedAt,"");store.candidateFacts.markUsed("skill.linux",{consumer:"MATCHER",contextId:"job-1"});assert.ok(store.candidateFacts.find("skill.linux").lastUsedAt);assert.equal(store.candidateFacts.remove("skill.linux").action,"REJECTED");assert.equal(store.candidateFacts.find("skill.linux"),null);assert.equal(store.candidateFacts.find("skill.linux",{includeInactive:true}).lifecycleStatus,"REJECTED");
}));

test("summary não expõe agregados, IDs internos nem JSON bruto",async()=>withStore(async store=>{
  store.candidateFacts.save(aggregate("PROFILE.SKILLS",[{id:"internal-id",name:"Docker"}]));new CandidateKnowledgeMigrator({repository:store.candidateFacts,database:store.database}).migrateLegacyAggregates();const payload=store.candidateKnowledge.summary(),serialized=JSON.stringify(payload);assert.equal(serialized.includes("PROFILE.SKILLS"),false);assert.equal(serialized.includes("internal-id"),false);assert.equal(payload.sections.find(section=>section.id==="skills").items[0].label,"Docker");
}));

test("evidence extractor consome fatos granulares sem duplicar evidência semântica",()=>{
  const facts=[{key:"skill.docker",value:"Docker",rawText:"Docker",unitType:"SKILL",lifecycleStatus:"ACTIVE",verificationStatus:"USER_CONFIRMED",sensitive:false}],evidence=extractCandidateEvidence({career:{skills:"Docker"}},{},facts).filter(item=>item.normalizedName==="docker");assert.equal(evidence.length,1);
});
