import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
const migration=await readFile(new URL("../db/migrations/018_candidate_knowledge_v3.sql",import.meta.url),"utf8");
for(const table of ["career_entities","knowledge_evidence","evidence_claims","experience_enrichment_proposals","evidence_gaps","knowledge_audit_events"])if(!migration.includes(`CREATE TABLE ${table}`))throw new Error(`Tabela V3 ausente: ${table}`);
if(/DROP TABLE|DROP COLUMN|DELETE FROM candidate_facts/i.test(migration))throw new Error("Migration 018 deve permanecer aditiva.");
const result=spawnSync(process.execPath,["--test","--test-concurrency=1","tests/candidate-knowledge-v3.test.mjs","tests/candidate-knowledge-v3-migration.test.mjs","tests/backend-frontend-parity-v3.test.mjs"],{stdio:"inherit",cwd:process.cwd()});
if(result.status!==0)process.exit(result.status||1);
console.log("Candidate Knowledge V3 validation: OK");
