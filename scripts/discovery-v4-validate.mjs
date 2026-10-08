import {spawnSync} from "node:child_process";
const files=["tests/discovery-v4.test.mjs"];
const result=spawnSync(process.execPath,["--test","--test-concurrency=1",...files],{stdio:"inherit",cwd:process.cwd()});
if(result.status!==0)process.exit(result.status||1);
console.log("Discovery V4 validation: OK");
