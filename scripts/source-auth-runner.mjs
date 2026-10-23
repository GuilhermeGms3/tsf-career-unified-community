import {mkdtemp,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateProviderState,authenticatedProviderPage} from '../src/source-connections/session-state.mjs';
import {sessionProviderById,sessionProviderFromUrl,hostAllowed} from '../src/source-connections/session-provider-registry.mjs';

// This runner only controls its own disposable context. Never reads installed browser profiles.
export function parseAuthHandoff(handoff){
  const u=new URL(handoff);
  if(u.protocol!=='career-unified-auth:'||u.hostname!=='auth'||u.pathname&&u.pathname!=='/'||u.username||u.password)throw Error('AUTH_HANDOFF_INVALID');
  const id=u.searchParams.get('id'),ticket=u.searchParams.get('ticket'),port=u.searchParams.get('port');
  if(!/^source-auth-[0-9a-f-]{36}$/.test(id||'')||!/^\d{2,5}$/.test(port||'')||Number(port)>65535||! /^[a-f0-9]{64}$/.test(ticket||''))throw Error('AUTH_HANDOFF_INVALID');
  if(Number(port)<1||[...u.searchParams.keys()].some(k=>!['id','ticket','port'].includes(k))||[...u.searchParams.keys()].length!==3||u.hash)throw Error('AUTH_HANDOFF_INVALID');
  return {id,ticket,port};
}
function installedChrome(){
  const candidates=process.platform==='win32'?[
    path.join(process.env.PROGRAMFILES||'', 'Google','Chrome','Application','chrome.exe'),
    path.join(process.env.LOCALAPPDATA||'', 'Google','Chrome','Application','chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)']||'', 'Google','Chrome','Application','chrome.exe')
  ]:[process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome'];
  return candidates.find(candidate=>candidate&&existsSync(candidate))||'';
}
async function availablePort(){
  const server=createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
export async function openIsolatedChrome({chromium,directory,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),fetchImpl=fetch,spawnImpl=spawn}={}){
  const chromePath=installedChrome();if(!chromePath)throw Error('CHROMIUM_NOT_FOUND');
  const port=await availablePort();
  const child=spawnImpl(chromePath,[`--user-data-dir=${directory}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1','--no-first-run','--no-default-browser-check','--disable-sync','about:blank'],{stdio:'ignore',windowsHide:false});
  let browser;
  try{
    await new Promise((resolve,reject)=>child.once('spawn',resolve).once('error',reject));
    const endpoint=`http://127.0.0.1:${port}`;
    for(let attempt=0;attempt<100;attempt++){
      if(child.exitCode!==null)throw Error('BROWSER_START_FAILED');
      try{const response=await fetchImpl(`${endpoint}/json/version`,{signal:AbortSignal.timeout(500),redirect:'error'});if(response.ok){browser=await chromium.connectOverCDP(endpoint);break;}}catch{}
      await wait(100);
    }
    if(!browser)throw Error('BROWSER_START_FAILED');
    const context=browser.contexts()[0];if(!context)throw Error('BROWSER_START_FAILED');
    return {context,close:async()=>{
      await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();
      for(let attempt=0;attempt<20&&child.exitCode===null;attempt++)await wait(100);
    }};
  }catch(error){await browser?.close().catch(()=>{});if(child.exitCode===null)child.kill();throw error;}
}
export function authServerOrigin(port,serverOrigin=''){
  if(!serverOrigin)return `http://127.0.0.1:${port}`;
  const url=new URL(serverOrigin);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.ts.net')||url.username||url.password||url.search||url.hash||url.pathname!=='/'||String(url.port||443)!==String(port))throw Error('AUTH_SERVER_ORIGIN_INVALID');
  return url.origin;
}
export async function runSourceAuth(handoff,{serverOrigin='',fetchImpl=fetch,loadChromium=async()=> (await import('playwright')).chromium,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),launchBrowser=openIsolatedChrome}={}){
  const {id,ticket,port}=parseAuthHandoff(handoff);
  const endpoint=`${authServerOrigin(port,serverOrigin)}/api/connections/handoff/${id}`;
  const post=async(action,body)=>{const response=await fetchImpl(`${endpoint}/${action}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${ticket}`},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok)throw Error('AUTH_HANDOFF_FAILED');return response.json();};
  let managed,context,directory,failureCode='CLAIM_FAILED';
  try{
    const request=await post('claim',{}),provider=sessionProviderById(request.provider)||sessionProviderFromUrl(request.loginUrl);
    if(!provider)throw Error('SESSION_PROVIDER_UNSUPPORTED');
    failureCode='CHROMIUM_NOT_FOUND';const chromium=await loadChromium();
    failureCode='BROWSER_START_FAILED';directory=await mkdtemp(path.join(os.tmpdir(),'career-owned-auth-'));
    managed=await launchBrowser({chromium,directory,wait});context=managed.context;
    const page=context.pages()[0]||await context.newPage();
    await post('event',{event:'BROWSER_OPENED'});
    failureCode='BROWSER_NAVIGATION_FAILED';
    // Navigation must finish (or report failure) within the 30-second runner lease.
    await page.goto(request.loginUrl,{waitUntil:'domcontentloaded',timeout:20000});
    let heartbeat=0;failureCode='BROWSER_CLOSED';
    while(Date.now()<Date.parse(request.expiresAt)){
      const pages=context.pages().filter(candidate=>!candidate.isClosed());
      if(!pages.length)break;
      if(Date.now()-heartbeat>=5000){await post('event',{event:'HEARTBEAT'});heartbeat=Date.now();}
      for(const candidate of pages){
        let authenticated=false;
        try{authenticated=await authenticatedProviderPage(candidate,provider.id);}catch{continue;}
        if(authenticated){
          const state=await context.storageState();
          // Provider pages may load third-party state. Never transfer it into the application.
          const owned={cookies:state.cookies.filter(cookie=>provider.cookieDomains.includes(String(cookie.domain||'').toLowerCase())&&cookie.secure&&['Strict','Lax','None'].includes(cookie.sameSite)&&typeof cookie.path==='string'&&cookie.path.startsWith('/')),origins:state.origins.filter(origin=>{try{return hostAllowed(provider,new URL(origin.origin).hostname);}catch{return false;}})};
          failureCode='SESSION_VALIDATION_FAILED';await post('complete',{state:validateProviderState(owned,provider.id)});return {status:'SESSION_ACTIVE'};
        }
      }
      await wait(1500);
    }
    await post('event',{event:'FAILED',code:'BROWSER_CLOSED'}).catch(()=>{});return {status:'AUTH_FAILED'};
  }catch{
    await post('event',{event:'FAILED',code:failureCode}).catch(()=>{});
    return {status:'AUTH_FAILED',failureCode};
  }finally{
    await managed?.close().catch(()=>{});
    const resolved=directory?path.resolve(directory):'',tempRoot=path.resolve(os.tmpdir());
    if(path.dirname(resolved)===tempRoot&&path.basename(resolved).startsWith('career-owned-auth-'))await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const serverOrigin=process.argv[3]==='--server-origin'?process.argv[4]:'';
  runSourceAuth(process.argv[2],{serverOrigin}).then(result=>{if(result.status!=='SESSION_ACTIVE')process.exitCode=1;}).catch(()=>{process.exitCode=1;});
}
