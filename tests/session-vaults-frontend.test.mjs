import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {chromium} from 'playwright';
import {sessionProviders} from '../src/source-connections/session-provider-registry.mjs';

test('Cofres renders account actions and remains usable at mobile and desktop widths',async()=>{
  const rootPath=path.resolve('public'),server=createServer(async(req,res)=>{const pathname=new URL(req.url,'http://fixture').pathname;if(pathname==='/vaults'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/components.css"><link rel="stylesheet" href="/styles/connections-observability.css"><main id="fixture"></main>');return;}try{const file=path.resolve(rootPath,`.${pathname}`);res.setHeader('content-type',pathname.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const browser=await chromium.launch();
  try{for(const width of [390,1366]){const page=await browser.newPage({viewport:{width,height:900}}),requests=[];const vaults=sessionProviders().map(provider=>({...provider,status:{status:provider.id==='gupy'?'SESSION_ACTIVE':'AUTH_REQUIRED',sessions:provider.id==='gupy'?[{verifiedAt:'2026-10-08T12:00:00.000Z'}]:[],request:provider.id==='indeed'?{provider:'indeed',status:'AUTH_FAILED',expiresAt:'2026-10-01T12:00:00.000Z'}:null},capability:null}));await page.route('**/api/**',route=>{if(new URL(route.request().url()).pathname.endsWith('.js'))return route.continue();requests.push(route.request().url());return route.fulfill({contentType:'application/json',body:JSON.stringify({vaults,contextual:[{providerId:'workday',displayName:'Workday',description:'Sessão por empresa.'}]})});});await page.goto(`http://127.0.0.1:${server.address().port}/vaults`);await page.evaluate(async()=>{const {renderVaults}=await import('/features/vaults/page.js');await renderVaults({root:document.querySelector('#fixture')});});assert.equal(await page.getByRole('heading',{name:'Cofres',exact:true}).count(),1);assert.equal(await page.locator('.vault-card').count(),vaults.length);assert.equal(await page.getByRole('button',{name:'Criar conta'}).count(),vaults.length-1);assert.equal(await page.getByRole('button',{name:'Desconectar'}).count(),1);assert.equal(await page.locator('.vault-request').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);assert.equal(requests.length,1);await page.close();}}
  finally{await browser.close();server.close();await once(server,'close');}
});
