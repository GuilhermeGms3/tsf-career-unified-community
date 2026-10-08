import {spawnSync} from "node:child_process";

const files=["tests/controlled-submit-v2-1.test.mjs","tests/lever-controlled-submit.test.mjs","tests/nerdin-controlled-submit.test.mjs","tests/application-v2.test.mjs","tests/application-v2-migration.test.mjs","tests/application-v2-parity.test.mjs"];
const result=spawnSync(process.execPath,["--test","--test-concurrency=1",...files],{stdio:"inherit",env:{...process.env,NODE_ENV:"test",CAREER_SUBMISSION_ENABLED:"true"}});
if(result.status!==0)process.exit(result.status||1);
console.log(JSON.stringify({status:"PASS",scope:"controlled-submit-v2.1",externalSubmit:false}));
