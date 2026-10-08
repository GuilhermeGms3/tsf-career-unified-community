import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {chromium} from 'playwright';
import {connectionCapabilities} from '../src/source-connections/provider-readiness.mjs';

test('connections and diagnostics fit three widths; cached reads and live problem mutations work',async()=>{
  const rootPath=path.resolve('public'),server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://fixture').pathname;
    if(['/connections','/observability'].includes(pathname)){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/components.css"><link rel="stylesheet" href="/styles/connections-observability.css"><main id="fixture"></main>');return;}
    const file=path.resolve(rootPath,`.${pathname}`);if(!file.startsWith(rootPath+path.sep)){res.writeHead(404).end();return;}try{res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(file));}catch{res.writeHead(404).end();}
  });server.listen(0,'127.0.0.1');await once(server,'listening');const browser=await chromium.launch();
  try{for(const width of [390,768,1366]){
    const page=await browser.newPage({viewport:{width,height:900}}),requests=[],sources=connectionCapabilities().map(s=>({...s,authentication:s.authMode==='NONE'?'NOT_REQUIRED':s.providerId==='linkedin'?'NOT_MANAGED':'AUTH_REQUIRED',health:'READY',session:{sessions:[]},canAuthenticate:['gupy','github'].includes(s.providerId),canDiscover:s.capabilities.DISCOVERY!=='NOT_SUPPORTED',canFill:false,canSubmit:false}));
    const data={retention:{days:30,maxRows:5000},logs:[{level:'WARN',category:'SOURCE_AUTH',eventCode:'SESSION_EXPIRED',message:'Session expired',timestamp:'2026-08-27',provider:'gupy',correlationId:'trace-1'}],errors:[],executions:[],problems:[{id:'p1',category:'SOURCE_AUTH',provider:'gupy',error_code:'SESSION_EXPIRED',message:'Session expired',severity:'WARN',status:'OPEN',occurrences:3,first_seen:'2026-08-26',last_seen:'2026-08-27',correlation_id:'trace-1'}]};
    await page.route('**/api/**',async route=>{const p=new URL(route.request().url()).pathname;if(p.endsWith('.js'))return route.continue();requests.push({path:p,method:route.request().method()});if(p==='/api/observability/problems/p1')data.problems[0].status=route.request().postDataJSON().status;await route.fulfill({contentType:'application/json',body:JSON.stringify(p==='/api/connections'?{sources}:data)});});
    await page.goto(`http://127.0.0.1:${server.address().port}/connections`);
    await page.evaluate(async()=>{const {renderConnections}=await import('/features/connections/page.js');const root=document.querySelector('#fixture'),staging=root.cloneNode(false);await renderConnections({root:staging});root.replaceWith(staging);});
    assert.equal(await page.getByRole('heading',{name:'Fontes e conexões',exact:true}).count(),1);assert.equal(await page.getByRole('textbox').count(),0);assert.equal(requests.length,1);
    assert.equal(await page.locator('.connection-card').count(),sources.filter(s=>!s.optional).length);
    assert.doesNotMatch(await page.locator('body').innerText(),/\b(tenant|adapter|postings|Job Board|Candidate Knowledge|Discovery|sitemap|JobPosting|feed|cases|token|cookie|login)\b/i);
    if(process.env.CONNECTIONS_VISUAL_DIR){await mkdir(process.env.CONNECTIONS_VISUAL_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.CONNECTIONS_VISUAL_DIR,'sources-'+width+'.png'),fullPage:true});}
    await page.evaluate(async()=>{const {renderConnections}=await import('/features/connections/page.js');await renderConnections({root:document.querySelector('#fixture')});});assert.equal(requests.length,1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.evaluate(async()=>{history.pushState({},'','/observability');const {renderObservability}=await import('/features/observability/page.js');const root=document.querySelector('#fixture'),staging=root.cloneNode(false);await renderObservability({root:staging});root.replaceWith(staging);});
    await page.getByRole('button',{name:'Reconhecer',exact:true}).click();await page.getByText(/Reconhecido/).waitFor();assert.equal(data.problems[0].status,'ACKNOWLEDGED');assert.equal(await page.locator('#fixture').evaluate(el=>el.isConnected),true);
    assert.equal(await page.getByRole('link',{name:'Gerar TXT',exact:true}).getAttribute('href'),'/api/observability/export?');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);await page.close();
  }}finally{await browser.close();server.close();await once(server,'close');}
});
