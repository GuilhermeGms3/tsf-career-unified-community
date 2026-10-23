import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,mkdir,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {DatabaseSync} from "node:sqlite";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {HubDatabase} from "../db/database.mjs";
import {runtimeOperationPolicy} from "../server/runtime-operation-policy.mjs";
import {trustedWebConfig,authorizeWebRequest} from "../server/trusted-web-access.mjs";
import {authServerOrigin,runSourceAuth} from "../scripts/source-auth-runner.mjs";
import {createConnectionsObservabilityRoutes} from "../server/routes/connections-observability-routes.mjs";
import {requireLocalJsonMutation} from "../server/local-mutation-guard.mjs";
import {rebaseDeploymentPaths} from "../scripts/rebase-deployment-paths.mjs";

test("maintenance refuses unsafe flags, blocks mutations/webhooks, allows explicit vault handoff",()=>{
  assert.throws(()=>runtimeOperationPolicy({CAREER_OPERATION_MODE:"maintenace"}));
  assert.throws(()=>runtimeOperationPolicy({CAREER_OPERATION_MODE:"maintenance",CAREER_SUBMISSION_ENABLED:"true"}));
  const p=runtimeOperationPolicy({CAREER_OPERATION_MODE:"maintenance",CAREER_SUBMISSION_ENABLED:"false"});
  assert.equal(p.backgroundEnabled,false);
  for(const url of ["/api/run","/api/autopilot/run","/api/discovery-v4/webhooks/evolution","/api/intelligence/jobs","/api/connections/github/sync"])
    assert.equal(p.allowRequest("POST",url),false,url);
  assert.equal(p.allowRequest("POST","/api/vaults/gupy/connect"),true);
  assert.equal(p.allowRequest("GET","/api/vaults"),true);
});

test("private proxy requires exact host, source address and identity",()=>{
  const c=trustedWebConfig({CAREER_WEB_TRUST_PROXY:"true",CAREER_PUBLIC_URL:"https://server.test.ts.net",CAREER_WEB_ALLOWED_TAILSCALE_USERS:"owner@example.test",CAREER_WEB_PROXY_ADDRESSES:"172.20.0.1"});
  const req={headers:{host:c.host,"tailscale-user-login":"owner@example.test"},socket:{remoteAddress:"::ffff:172.20.0.1"}};
  assert.doesNotThrow(()=>authorizeWebRequest(req,c));
  for(const bad of [{...req,socket:{remoteAddress:"100.80.1.2"}},{...req,headers:{...req.headers,host:"evil.ts.net"}},{...req,headers:{host:c.host}},{...req,headers:{...req.headers,"tailscale-user-login":"other@example.test"}}])assert.throws(()=>authorizeWebRequest(bad,c));
  assert.equal(authServerOrigin("443","https://server.test.ts.net"),"https://server.test.ts.net");
  assert.throws(()=>authServerOrigin("443","http://server.test.ts.net"));
  assert.throws(()=>authServerOrigin("443","https://server.test.ts.net@evil.test"));
  assert.throws(()=>authServerOrigin("7123","https://server.test.ts.net"));
});

test("remote auth uses only operator-configured HTTPS origin; untrusted origin and redirects remain rejected",async()=>{
  const handoff=`career-unified-auth://auth?id=source-auth-12345678-1234-1234-1234-123456789abc&ticket=${'a'.repeat(64)}&port=443`;
  const urls=[];
  const result=await runSourceAuth(handoff,{serverOrigin:'https://server.test.ts.net',fetchImpl:async(url,options)=>{urls.push(url);assert.equal(options.redirect,'error');return {ok:true,json:async()=>({provider:'gupy',loginUrl:'https://login.gupy.io/candidates/signin',expiresAt:new Date(Date.now()+10000).toISOString()})};},loadChromium:async()=>{throw Error('fixture-no-browser');}});
  assert.equal(result.status,'AUTH_FAILED');
  assert.ok(urls.length>=2);assert.ok(urls.every(u=>u.startsWith('https://server.test.ts.net/api/connections/handoff/')));
});

test("vault HTTPS handoff advertises 443 and maintains JSON/origin/identity guards",async()=>{
  const names=['CAREER_WEB_TRUST_PROXY','CAREER_PUBLIC_URL','CAREER_WEB_ALLOWED_TAILSCALE_USERS','CAREER_WEB_PROXY_ADDRESSES'];
  const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{CAREER_WEB_TRUST_PROXY:'true',CAREER_PUBLIC_URL:'https://server.test.ts.net',CAREER_WEB_ALLOWED_TAILSCALE_USERS:'owner@example.test',CAREER_WEB_PROXY_ADDRESSES:'172.20.0.1'});
  try{
    const url=new URL('https://server.test.ts.net/api/vaults/gupy/connect');
    const req={method:'POST',socket:{remoteAddress:'172.20.0.1',localPort:7123},headers:{host:url.host,origin:url.origin,'tailscale-user-login':'owner@example.test','content-type':'application/json','sec-fetch-site':'same-origin'}};
    let response;
    const route=createConnectionsObservabilityRoutes({auth:{begin:async()=>({id:'fixture',canLaunch:true}),issueTicket:()=> 'a'.repeat(64)},readJson:async()=>({}),json:(_res,body)=>{response=body;},sendError:(_res,error)=>{throw error;}});
    await route(req,{setHeader(){}},url);
    assert.ok(response.launchUrl.endsWith('&port=443'));
    assert.throws(()=>requireLocalJsonMutation({...req,headers:{...req.headers,origin:'https://evil.test'}},url),{code:'SAME_ORIGIN_REQUIRED'});
    assert.throws(()=>requireLocalJsonMutation({...req,headers:{...req.headers,'tailscale-user-login':''}},url),{code:'TAILSCALE_IDENTITY_REQUIRED'});
  }finally{for(const k of names){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});

test("maintenance never creates missing DB, migrates old schema, imports changed legacy or recovers persisted jobs",async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"maintenance-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  await assert.rejects(new HubDatabase(path.join(dir,"absent.sqlite"),{migrate:false}).initialize(),{code:"PERSISTENT_DATABASE_MISSING"});
  let store=await new UnifiedStateStore({dataDir:dir}).initialize();
  store.database.connection.prepare("INSERT INTO intelligence_jobs(id,task,status,payload_json,available_at,created_at,updated_at) VALUES('pending','BENCHMARK','RUNNING','{}','2000-01-01','2000-01-01','2000-01-01')").run();
  store.close();
  await writeFile(path.join(dir,"unified-state.json"),JSON.stringify({jobs:[{id:"must-not-import",title:"Old JSON"}]}));
  store=await new UnifiedStateStore({dataDir:dir,startupEffects:false}).initialize();
  assert.equal(store.jobs.findById("must-not-import"),null);
  assert.equal(store.intelligenceJobs.findById("pending").status,"RUNNING");store.close();
  const db=new DatabaseSync(path.join(dir,"career-hub.sqlite"));db.exec("DELETE FROM schema_migrations WHERE version=59");db.close();
  await assert.rejects(new UnifiedStateStore({dataDir:dir,startupEffects:false}).initialize(),{code:"DATABASE_MIGRATION_REQUIRED"});
  const check=new DatabaseSync(path.join(dir,"career-hub.sqlite"),{readOnly:true});assert.equal(check.prepare("SELECT max(version) v FROM schema_migrations").get().v,58);check.close();
});

test("path rebasing is explicit, copy-only, validates files and preserves original DB",async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"rebase-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=await new UnifiedStateStore({dataDir:dir}).initialize();
  store.resumes.upsert({id:"base",title:"BASE 01",text:"Fixture",storedPath:"D:\\TSF\\career-unified\\data\\resumes\\base.pdf",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});store.close();
  await mkdir(path.join(dir,"resumes"));await writeFile(path.join(dir,"resumes/base.pdf"),"%PDF-fixture");
  const db=path.join(dir,"career-hub.sqlite"),original=await readFile(db);
  assert.equal((await rebaseDeploymentPaths(db,dir)).changedPaths,1);assert.deepEqual(await readFile(db),original);
  const result=await rebaseDeploymentPaths(db,dir,{apply:true});assert.equal(result.changedPaths,1);assert.equal(result.integrity,"ok");
  const check=new DatabaseSync(db,{readOnly:true});assert.equal(check.prepare("SELECT stored_path FROM resumes WHERE id='base'").get().stored_path,"/app/data/resumes/base.pdf");check.close();
});

for(const mode of ['maintenance','manual'])test(`real ${mode} HTTP process leaves historical work untouched and rejects automated requests`,async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"maintenance-http-"));
  const store=await new UnifiedStateStore({dataDir:dir}).initialize();
  store.database.connection.prepare("INSERT INTO intelligence_jobs(id,task,status,payload_json,available_at,created_at,updated_at) VALUES('historical','BENCHMARK','RUNNING','{}','2000-01-01','2000-01-01','2000-01-01')").run();store.close();
  const seed=new DatabaseSync(path.join(dir,'career-hub.sqlite'));seed.prepare("INSERT INTO intelligence_jobs(id,task,status,payload_json,available_at,created_at,updated_at) VALUES('old-queued','BENCHMARK','QUEUED','{}','2000-01-01','2000-01-01','2000-01-01')").run();seed.close();
  const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const mobileListener=createServer();await new Promise(resolve=>mobileListener.listen(0,'127.0.0.1',resolve));const mobilePort=mobileListener.address().port;await new Promise(resolve=>mobileListener.close(resolve));
  assert.notEqual(port,mobilePort);
  const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,HUB_DATA_DIR:dir,HUB_HOST:'127.0.0.1',HUB_PORT:String(port),CAREER_OPERATION_MODE:mode,CAREER_SUBMISSION_ENABLED:'false',CAREER_WEB_TRUST_PROXY:'false',MOBILE_GATEWAY_ENABLED:'true',MOBILE_GATEWAY_HOST:'127.0.0.1',MOBILE_GATEWAY_PORT:String(mobilePort),MOBILE_GATEWAY_TRUST_PROXY:'false',MOBILE_GATEWAY_ALLOWED_TAILSCALE_USERS:'operator@example.test',CAREER_CREDENTIAL_KEY_PATH:path.join(dir,'fixture.key'),CAREER_CREDENTIAL_MASTER_KEY:''},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}await rm(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<100;i++){if(child.exitCode!==null)assert.fail(output);try{const r=await fetch(base+'/api/runtime');if(r.ok){const runtime=await r.json();assert.equal(runtime.mode,mode);assert.equal(runtime.backgroundEnabled,false);assert.equal(runtime.workersEnabled,mode==='manual');ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(ready,true,output);
  for(const route of ['/api/run','/api/intelligence/jobs','/api/discovery-v4/webhooks/evolution']){
    const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,423,route);
  }
  assert.equal((await fetch(base+'/api/vaults')).status,200);
  const mobile=`http://127.0.0.1:${mobilePort}/api/mobile/v1`,headers={'tailscale-user-login':'operator@example.test','content-type':'application/json'};
  assert.equal((await fetch(mobile+'/health')).status,401);
  const health=await fetch(mobile+'/health',{headers});assert.equal(health.status,200);assert.equal((await health.json()).readOnly,mode==='maintenance');
  assert.equal((await fetch(mobile+'/today',{headers})).status,200);
  for(const route of ['/hunts','/applications/missing/actions','/applications/missing/questions']){
    const response=await fetch(mobile+route,{method:'POST',headers,body:'{}'});assert.equal(response.status,mode==='maintenance'?423:400);
  }
  assert.equal((await fetch(mobile+'/opportunities/missing/feedback',{method:'PUT',headers,body:'{}'})).status,mode==='maintenance'?423:400);
  if(mode==='manual'){
    const writer=new DatabaseSync(path.join(dir,'career-hub.sqlite')),at=new Date().toISOString();
    writer.prepare("INSERT INTO intelligence_jobs(id,task,status,payload_json,available_at,created_at,updated_at) VALUES('fresh','SYNTHETIC_UNKNOWN','QUEUED','{}',?,?,?)").run(at,at,at);
    let executed=false;for(let i=0;i<30;i++){if(writer.prepare("SELECT status FROM intelligence_jobs WHERE id='fresh'").get().status==='FAILED'){executed=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}writer.close();assert.equal(executed,true,'manual worker must execute new work');
  }
  await new Promise(resolve=>setTimeout(resolve,5500));
  const db=new DatabaseSync(path.join(dir,'career-hub.sqlite'),{readOnly:true});assert.equal(db.prepare("SELECT status FROM intelligence_jobs WHERE id='historical'").get().status,'RUNNING');assert.equal(db.prepare("SELECT status FROM intelligence_jobs WHERE id='old-queued'").get().status,'QUEUED');if(mode==='maintenance'){assert.equal(db.prepare('SELECT count(*) n FROM mobile_gateway_requests').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM daily_inbox_snapshots').get().n,0);}db.close();
});
