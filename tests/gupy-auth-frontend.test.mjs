import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {chromium} from 'playwright';
import {connectionCapabilities} from '../src/source-connections/provider-readiness.mjs';

test('Gupy visible mounted UI restores tenant, pending, claim, failure and expiry without new requests',async()=>{
  const rootPath=path.resolve('public');
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://fixture').pathname;
    if(pathname==='/connections'){
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/components.css"><link rel="stylesheet" href="/styles/connections-observability.css"><main id="fixture"></main><script type="module">const {renderConnections}=await import("/features/connections/page.js");await renderConnections({root:document.querySelector("#fixture")});</script>');return;
    }
    const file=path.resolve(rootPath,`.${pathname}`);
    if(!file.startsWith(rootPath+path.sep)){res.writeHead(404).end();return;}
    try{res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(file));}catch{res.writeHead(404).end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const browser=await chromium.launch();
  try{for(const width of [390,768,1366]){
    const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const targets=[{jobId:'finx',company:'Fin-X',tenant:'finxapp.gupy.io'},{jobId:'fcamara',company:'FCamara',tenant:'fcamara.gupy.io'}];
    let request=null,connectGate=null,releaseConnect,failPoll=false,failConnect=false;const connects=[];
    const sources=connectionCapabilities().filter(s=>s.providerId==='gupy').map(s=>({...s,authentication:'AUTH_REQUIRED',health:'READY',session:{status:'AUTH_REQUIRED',scope:'ACCOUNT',sessions:[]},canAuthenticate:true}));
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url());if(url.pathname.endsWith('.js'))return route.continue();
      let response={};
      if(url.pathname==='/api/connections')response={sources,gupyContext:{targets,selected:targets.find(t=>t.jobId===url.searchParams.get('jobId'))||null,request:request?{...request,launchUrl:undefined}:null}};
      else if(url.pathname==='/api/connections/gupy/connect'){
        const body=route.request().postDataJSON();connects.push(body);
        if(connectGate)await connectGate;
        if(failConnect){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'AUTH_LAUNCH_FAILED'})});return;}
        request={jobId:body.jobId||'',company:body.jobId?'Fin-X':'Conta Gupy',tenant:body.jobId?'finxapp.gupy.io':'gupy.io',id:'fixture-'+connects.length,provider:'gupy',status:'LAUNCH_PENDING',expiresAt:new Date(Date.now()+600000).toISOString()};response=request;
        response={...request,launchUrl:'#fixture-handoff'};
      }else if(url.pathname.endsWith('/poll')){
        if(failPoll){failPoll=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'AUTH_HANDOFF_INVALID'})});return;}
        response=request;
      }
      else throw Error('Unexpected API call '+url.pathname);
      await route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
    });
    const base=`http://127.0.0.1:${server.address().port}/connections`;
    await page.goto(base);
    const connect=page.locator('[data-gupy-card] [data-action="connect"]');
    assert.equal(await page.getByRole('link',{name:/Acessar minha conta Gupy/}).count(),0);
    assert.equal(await connect.innerText(),'Conectar conta Gupy');
    assert.equal(await page.getByText('Integração disponível',{exact:true}).count(),1);
    assert.equal(await page.getByText('Disponível para analisar e preparar candidaturas',{exact:true}).count(),1);
    assert.match(await page.locator('[data-gupy-card]').innerText(),/janela separada e protegida/);
    assert.equal(await page.getByRole('button',{name:'Verificar sessão',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Desconectar',exact:true}).count(),0);
    assert.equal(await page.getByText('Ainda não verificada',{exact:true}).first().isVisible(),false);
    assert.equal(await page.locator('[data-selected-auth]').innerText(),'Escolha a empresa da candidatura');
    const style=await page.locator('[data-gupy-card]').evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderTopWidth,padding:s.paddingTop,background:s.backgroundColor};});
    assert.equal(style.border,'1px');assert.ok(parseFloat(style.padding)>=16);assert.equal(style.background,'rgb(255, 255, 255)');
    connectGate=new Promise(resolve=>releaseConnect=resolve);
    const started=page.waitForRequest(r=>r.url().endsWith('/api/connections/gupy/connect'));
    await page.getByRole('button',{name:'Conectar conta Gupy',exact:true}).click();
    await started;
    assert.equal(await connect.isDisabled(),true);assert.equal(await connect.innerText(),'Abrindo…');
    assert.equal(await connect.locator('.connection-spinner').count(),1);
    assert.match(await page.locator('[data-gupy-feedback]').innerText(),/Abrindo/);
    await connect.evaluate(el=>{for(let i=0;i<7;i++)el.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
    assert.equal(connects.length,1);
    releaseConnect();connectGate=null;
    await page.getByText('Aguardando abertura da janela de autenticação',{exact:true}).first().waitFor();
    assert.deepEqual(connects,[{jobId:''}]);
    assert.equal(await connect.isDisabled(),true);assert.equal(await page.locator('[data-auth-retry]').count(),0);
    assert.equal(await page.locator('[data-gupy-target]').isDisabled(),true);
    assert.equal(await page.locator('[data-gupy-card] [data-auth-panel]').count(),1);
    const authorize=page.locator('[data-authorize-launch]');
    assert.equal(await authorize.getAttribute('href'),'#fixture-handoff');
    await authorize.click();assert.equal(await authorize.getAttribute('aria-disabled'),'true');assert.equal(connects.length,1);
    if(process.env.CONNECTIONS_VISUAL_DIR){await mkdir(process.env.CONNECTIONS_VISUAL_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.CONNECTIONS_VISUAL_DIR,'gupy-opening-'+width+'.png'),fullPage:true});}
    assert.doesNotMatch(await page.locator('[data-auth-status]').innerText(),/Autenticação em andamento|AUTH_REQUIRED|LAUNCH_PENDING/);
    await page.reload();await page.locator('[data-auth-status]').waitFor();assert.equal(connects.length,1);
    assert.equal(await connect.isDisabled(),true);assert.equal(await page.locator('[data-authorize-launch]').count(),0);
    failPoll=true;
    await page.locator('[data-auth-status]').filter({hasText:'Esta autorização de abertura não é mais válida.'}).waitFor();
    assert.equal(await connect.isDisabled(),true);assert.equal(connects.length,1);
    request={...request,status:'AUTH_IN_PROGRESS',claimedAt:new Date().toISOString()};
    await page.getByText('Autenticação em andamento',{exact:true}).waitFor();
    request={...request,status:'USER_ACTION_REQUIRED',browserOpenedAt:new Date().toISOString()};
    await page.getByText('Conclua a autenticação na janela da Gupy',{exact:true}).waitFor();
    assert.equal(await connect.innerText(),'Aguardando você…');assert.equal(await connect.isDisabled(),true);
    assert.equal(await page.locator('[data-auth-status]').evaluate(el=>el.isConnected),true);
    request={...request,status:'AUTH_FAILED',failureCode:'RUNNER_LOST'};
    await page.getByText('Perdemos a comunicação com a janela de autenticação.',{exact:true}).waitFor();
    assert.equal(await connect.isDisabled(),false);
    await page.reload();await page.getByRole('button',{name:'Tentar novamente',exact:true}).waitFor();assert.equal(connects.length,1);
    await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
    await page.getByText('Aguardando abertura da janela de autenticação',{exact:true}).first().waitFor();assert.equal(connects.length,2);
    request={...request,status:'AUTH_REQUEST_EXPIRED',failureCode:'REQUEST_EXPIRED'};
    await page.reload();await page.getByText('Sua tentativa de autenticação expirou',{exact:true}).waitFor();assert.equal(connects.length,2);
    await page.getByText('Ver como resolver',{exact:true}).click();
    assert.match(await page.locator('[data-auth-recovery]').innerText(),/Alternativa independente do link/);
    assert.match(await page.locator('[data-auth-recovery]').innerText(),/HKCU:\\Software\\Classes/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    assert.equal(await page.locator('[data-gupy-target]').inputValue(),'');assert.deepEqual(errors,[]);
    failConnect=true;
    await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
    await page.locator('[data-gupy-feedback] p').waitFor();
    assert.equal(await connect.isDisabled(),false);assert.equal(await connect.innerText(),'Conectar conta Gupy');
    failConnect=false;
    await connect.click();await page.locator('[data-auth-status]').filter({hasText:'Aguardando abertura'}).waitFor();
    request={...request,status:'SESSION_ACTIVE'};
    sources[0].authentication='SESSION_ACTIVE';sources[0].session={status:'SESSION_ACTIVE',scope:'ACCOUNT',sessions:[{tenant:'gupy.io',status:'SESSION_ACTIVE'}]};
    await page.locator('[data-account-status]').filter({hasText:'Conta Gupy conectada'}).waitFor();
    assert.equal(await page.locator('[data-action="connect"]').count(),0);assert.equal(await page.getByRole('button',{name:'Verificar sessão',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Desconectar',exact:true}).count(),1);assert.equal(await page.locator('[data-auth-retry]').count(),0);
    assert.equal(await page.locator('[data-auth-recovery]').count(),0);
    assert.equal(await page.locator('[data-auth-panel]').evaluate(el=>el.isConnected),true);
    await page.close();
  }}finally{await browser.close();server.close();await once(server,'close');}
});
