import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {once} from "node:events";
import path from "node:path";
import {chromium} from "playwright";
import {createApplicationBatchRoutes} from "../server/routes/application-batch-routes.mjs";

test("new application routes reject cross-origin, non-JSON and rebinding hosts",async()=>{
  let writes=0,code;
  const handler=createApplicationBatchRoutes({service:{create:async()=>{writes++;return {};}},readJson:async()=>({}),json:()=>{},sendError:(res,error)=>{code=error.code;}});
  for(const [host,headers] of [["localhost",{"content-type":"text/plain"}],["localhost",{"content-type":"application/json",origin:"https://evil.test"}],["evil.test",{"content-type":"application/json"}]]){await handler({method:"POST",headers:{...headers,host}},null,new URL(`http://${host}/api/application-batches`));assert.ok(code);}
  assert.equal(writes,0);await handler({method:"POST",headers:{host:"localhost","content-type":"application/json",origin:"http://localhost"}},null,new URL("http://localhost/api/application-batches"));assert.equal(writes,1);
});
test("Application Batch mutation updates live mounted route, protects submit, and fits mobile",async()=>{
  const publicRoot=path.resolve("public"),server=createServer(async(req,res)=>{const pathname=new URL(req.url,"http://fixture").pathname;if(pathname.startsWith("/application-batches")){res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/styles/resume-batch.css"><main id="fixture"></main>');return;}const file=path.resolve(publicRoot,`.${pathname}`);if(!file.startsWith(publicRoot+path.sep)){res.writeHead(404);res.end();return;}try{res.setHeader("Content-Type",pathname.endsWith(".js")?"text/javascript":"text/css");res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
  server.listen(0,"127.0.0.1");await once(server,"listening");const browser=await chromium.launch();
  try{for(const width of [390,768,1366]){
    const page=await browser.newPage({viewport:{width,height:900}});let answers=0,submits=0;
    const batch={id:"fixture",status:"REVIEW_REQUIRED",policyMode:"OFF",submissionEnabled:false,items:[{id:"draft-1",title:"Backend Jr",company:"Fixture",applicationProvider:"GUPY",resumeVersionId:"resume-version-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",status:"WAITING_USER",fields:[{fieldId:"salary",label:"Pretensão salarial",type:"text",required:true,category:"SALARY_EXPECTATION",options:[],answerState:"WAITING_USER"}]}]};
    await page.route("**/api/**",async route=>{const pathname=new URL(route.request().url()).pathname;if(pathname.endsWith(".js"))return route.continue();if(pathname.endsWith("/answer")){answers++;const body=route.request().postDataJSON();assert.equal(body.saveForFuture,true);batch.items[0].fields[0].answerState="ANSWERED_CONFIDENT";batch.items[0].fields[0].answerProvenance={source:"USER_CONFIRMED"};}if(pathname.endsWith("/submit"))submits++;await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,batch})});});
    await page.goto(`http://127.0.0.1:${server.address().port}/application-batches/fixture`);
    await page.evaluate(async()=>{const {renderApplicationBatches}=await import("/features/application-batches/page.js");const root=document.querySelector("#fixture"),staging=root.cloneNode(false);await renderApplicationBatches({root:staging,route:{id:"fixture",name:"application-batch"}});root.replaceWith(staging);});
    assert.equal(await page.getByRole("button",{name:"Enviar candidaturas selecionadas e aprovadas"}).isEnabled(),false);
    await page.getByRole("textbox").fill("4000");await page.getByLabel("Salvar esta resposta para candidaturas futuras").check();await page.getByRole("button",{name:"Confirmar resposta"}).click();await page.getByText(/1\/1 respostas resolvidas/).waitFor();assert.equal(answers,1);assert.equal(submits,0);assert.equal(await page.locator("#fixture").evaluate(el=>el.isConnected),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);await page.close();
  }}finally{await browser.close();server.close();await once(server,"close");}
});
