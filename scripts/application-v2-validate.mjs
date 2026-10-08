import {spawnSync} from "node:child_process";
import {readFile} from "node:fs/promises";

const migration=await readFile(new URL("../db/migrations/019_application_engine_v2.sql",import.meta.url),"utf8");
for(const table of ["submission_preflight_evaluations","submission_consents","submission_attempts","submission_locks","submission_receipts"])if(!migration.includes(`CREATE TABLE ${table}`))throw new Error(`Tabela ausente: ${table}`);
if(/DROP TABLE|DROP COLUMN|consent_token\s+(?:TEXT|BLOB)|password|cookie/i.test(migration))throw new Error("Migration 019 deve ser aditiva e não persistir credenciais ou consentimento em texto puro.");
const result=spawnSync(process.execPath,["--test","--test-concurrency=1","tests/application-v2.test.mjs","tests/application-v2-migration.test.mjs","tests/application-v2-parity.test.mjs"],{stdio:"inherit",cwd:process.cwd()});
if(result.status!==0)process.exit(result.status||1);
console.log("APPLICATION ENGINE V2 VALID: preflight, consent, idempotência, receipt, uncertainty, migration e paridade.");
