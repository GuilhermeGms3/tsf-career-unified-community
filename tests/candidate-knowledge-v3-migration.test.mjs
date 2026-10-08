import assert from "node:assert/strict";
import {copyFile,mkdir,mkdtemp,readdir,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {HubDatabase} from "../db/database.mjs";
import {CandidateFactRepository} from "../repositories/candidate-knowledge-repository.mjs";

const sourceMigrations=path.resolve("db/migrations");

test("migration 018 upgrades schema 17 within current migration chain and preserves facts",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"ck-v3-upgrade-")),migrationsDir=path.join(root,"migrations"),dataDir=path.join(root,"data");
  await mkdir(migrationsDir,{recursive:true});await mkdir(dataDir,{recursive:true});
  const files=(await readdir(sourceMigrations)).filter(name=>/^\d{3}_.*\.sql$/.test(name));
  for(const name of files.filter(name=>Number(name.slice(0,3))<=17))await copyFile(path.join(sourceMigrations,name),path.join(migrationsDir,name));
  const databasePath=path.join(dataDir,"career-hub.sqlite"),legacyDatabase=await new HubDatabase(databasePath,{migrationsDir}).initialize(),legacyFacts=new CandidateFactRepository(legacyDatabase.connection,legacyDatabase);
  legacyFacts.save({key:"experience.legacy",value:{company:"Empresa Legada",role:"Analista",startDate:"2022-01",endDate:"2023-01",responsibilities:["Operação"]},unitType:"WORK_EXPERIENCE",source:"USER_CONFIRMED",sourceType:"CANDIDATE_PROFILE",verificationStatus:"USER_CONFIRMED",reusePolicy:"REUSABLE",confidence:1});
  legacyFacts.save({key:"skill.grafana",value:"Grafana",unitType:"SKILL",source:"USER_CONFIRMED",sourceType:"CANDIDATE_PROFILE",verificationStatus:"USER_CONFIRMED",reusePolicy:"REUSABLE",confidence:1});
  legacyDatabase.close();
  for(const name of files.filter(name=>Number(name.slice(0,3))>=18))await copyFile(path.join(sourceMigrations,name),path.join(migrationsDir,name));
  const store=await new UnifiedStateStore({dataDir,migrationsDir,databasePath}).initialize();
  try{
    assert.equal(store.database.connection.prepare("SELECT MAX(version) version FROM schema_migrations").get().version, 51);
    assert.equal(store.candidateFacts.find("skill.grafana").value,"Grafana");
    const entity=store.careerEvidence.entities().find(item=>item.organization==="Empresa Legada");assert.equal(entity.role,"Analista");
    const legacy=store.careerEvidence.evidence({factKey:"skill.grafana"})[0];assert.equal(legacy.contextType,"LEGACY");assert.equal(legacy.depth,"UNKNOWN");
    assert.deepEqual(store.database.connection.prepare("PRAGMA foreign_key_check").all(),[]);
  }finally{store.close();await rm(root,{recursive:true,force:true});}
});
