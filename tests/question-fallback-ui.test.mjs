import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {readFile,mkdtemp,rm,mkdir} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {chromium} from "playwright";

for(const width of [390,1280])test(`politica de perguntas acessivel e sem overflow em ${width}px`,async()=>{
  const publicRoot=path.resolve("public"),temp=await mkdtemp(path.join(os.tmpdir(),"question-ui-"));
  const links=(await readFile(path.join(publicRoot,"index.html"),"utf8")).match(/<link rel="stylesheet"[^>]*>/g).join("");
  const server=createServer(async(req,res)=>{
    if(req.url==="/"){res.setHeader("content-type","text/html; charset=utf-8");res.end(`<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1">${links}</head><body><main id="root" style="max-width:950px;margin:20px auto;padding:16px"></main><script type="module">import {questionFallbackView,bindQuestionFallback} from '/features/autopilot/question-fallback.js';const root=document.querySelector('#root');root.innerHTML=questionFallbackView();bindQuestionFallback(root);</script></body></html>`);return;}
    try{const file=path.resolve(publicRoot,`.${new URL(req.url,"http://localhost").pathname}`);if(!file.startsWith(publicRoot+path.sep))throw new Error("unsafe");res.setHeader("content-type",file.endsWith(".css")?"text/css":"text/javascript");res.end(await readFile(file));}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width,height:1000}});let saved;
    await page.route("**/api/auto-apply/question-fallback",async route=>{saved=route.request().postDataJSON();await route.fulfill({json:{ok:true,policy:saved}});});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const wait=page.getByLabel("Espera pela sua resposta (minutos)");await wait.waitFor();assert.equal(await wait.isDisabled(),true);
    await page.getByLabel("Tentar a IA depois do prazo nas vagas de nota alta").check();await wait.fill("20");
    await page.getByLabel("Permitir trechos literais da BASE 01 sem nova revisao").check();
    await page.getByRole("button",{name:"Salvar espera das perguntas"}).click();await page.locator(".form-status").filter({hasText:"Preferencia salva"}).waitFor();
    assert.equal(saved.waitMinutes,20);assert.equal(saved.enabled,true);assert.equal(saved.autoFillEnabled,true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    const evidenceDir=process.env.TSF_UI_EVIDENCE_DIR||temp;await mkdir(evidenceDir,{recursive:true});await page.screenshot({path:path.join(evidenceDir,`question-fallback-${width}.png`),fullPage:true});
  }finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
});
