import {spawnSync} from "node:child_process";
import {readFile,readdir} from "node:fs/promises";

const [adapter,registry,fixtures]=await Promise.all([readFile(new URL("../src/automation/ats/gupy/gupy-adapter.mjs",import.meta.url),"utf8"),readFile(new URL("../src/automation/ats/adapter-registry.mjs",import.meta.url),"utf8"),readdir(new URL("../tests/fixtures/ats/",import.meta.url))]);
for(const name of ["gupy-simple.html","gupy-multi-step.html","gupy-login-required.html","gupy-sensitive.html","gupy-captcha.html","gupy-dom-changed.html","gupy-confirmation.html"])if(!fixtures.includes(name))throw new Error(`Fixture Gupy ausente: ${name}`);
if(!/GUPY_SUBMIT_NOT_HOMOLOGATED/.test(adapter)||!/READY_TO_SUBMIT_MANUAL/.test(registry))throw new Error("Capability Gupy deve continuar conservadora e sem submit externo.");
const result=spawnSync(process.execPath,["--test","--test-concurrency=1","tests/gupy-adapter-v1.test.mjs"],{stdio:"inherit",cwd:process.cwd()});
if(result.status!==0)process.exit(result.status||1);
console.log("GUPY V1 VALID: detect/inspect/fill/validate e handoffs; submit externo não homologado.");
