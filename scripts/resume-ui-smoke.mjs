import {spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {chromium} from "playwright";

const externalUrl=process.env.RESUME_SMOKE_URL||"";
const dataDir=externalUrl?null:await mkdtemp(path.join(os.tmpdir(),"career-resume-ui-"));
const baseUrl=externalUrl||"http://127.0.0.1:7131";
const screenshotPath=process.env.RESUME_SMOKE_SCREENSHOT||path.join(os.tmpdir(),"resume-document-ui-smoke.png");
const server=externalUrl?null:spawn(process.execPath,["server.mjs"],{cwd:path.resolve(import.meta.dirname,".."),env:{...process.env,HUB_DATA_DIR:dataDir,HUB_PORT:"7131"},stdio:"inherit"});

async function ready(){for(let index=0;index<120;index++){try{if((await fetch(`${baseUrl}/api/resume-documents/templates`)).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw new Error("Servidor de UI smoke nao iniciou.");}

let browser;
try{
  await ready();browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],httpErrors=[];
  page.on("console",message=>{if(message.type()==="error"&&!message.text().startsWith("Failed to load resource"))errors.push(message.text());});
  page.on("pageerror",error=>errors.push(error.message));
  page.on("response",response=>{if(response.status()>=400&&!/\/api\/(engine\/status|intelligence\/status)/.test(response.url()))httpErrors.push({url:response.url(),status:response.status()});});
  await page.goto(baseUrl,{waitUntil:"networkidle"});await page.click('[data-view-target="resumes"]');
  await page.locator("#resume-document-form").waitFor({state:"visible"});
  await page.selectOption("#resume-document-archetype","CLOUD_DEVOPS");
  const desktop={form:await page.locator("#resume-document-form").isVisible(),templates:await page.locator("#resume-document-template option").count(),archetypes:await page.locator("#resume-document-archetype option").count(),selectedArchetype:await page.locator("#resume-document-archetype").inputValue(),compilerHealth:(await page.locator("#resume-compiler-health").textContent())?.trim()||"",overflow:await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)};
  await page.screenshot({path:screenshotPath,fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.reload({waitUntil:"networkidle"});await page.click('[data-view-target="resumes"]');
  const mobile={form:await page.locator("#resume-document-form").isVisible(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)};
  const report={ok:!errors.length&&!httpErrors.length&&desktop.form&&desktop.templates>=5&&desktop.archetypes===5&&desktop.selectedArchetype==="CLOUD_DEVOPS"&&Boolean(desktop.compilerHealth)&&!desktop.overflow&&mobile.form&&!mobile.overflow,errors,httpErrors,desktop,mobile,screenshotPath};
  process.stdout.write(`${JSON.stringify(report,null,2)}\n`);if(!report.ok)process.exitCode=1;
}finally{
  await browser?.close();if(server){server.kill();await new Promise(resolve=>setTimeout(resolve,500));}
  if(dataDir){const resolved=path.resolve(dataDir),tempRoot=path.resolve(os.tmpdir())+path.sep;if(!resolved.startsWith(tempRoot))throw new Error("Diretorio temporario fora do escopo.");await rm(resolved,{recursive:true,force:true});}
}
