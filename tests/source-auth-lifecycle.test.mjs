import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {UnifiedStateStore} from '../server/unified-state-store.mjs';
import {SourceAuthService} from '../src/source-connections/source-auth-service.mjs';
import {parseAuthHandoff,runSourceAuth} from '../scripts/source-auth-runner.mjs';

async function fixture(fn){
  const dir=await mkdtemp(path.join(os.tmpdir(),'gupy-lifecycle-')),store=await new UnifiedStateStore({dataDir:dir}).initialize();
  let time=Date.now();const secrets=new Map(),auth=new SourceAuthService({store,clock:()=>time,vault:{put:async(k,v)=>secrets.set(k,v),get:k=>secrets.get(k),remove:async k=>secrets.delete(k)},connections:{},verifySession:async()=>true});
  for(const [id,company,tenant]of [['finx','Fin-X','finxapp'],['fcamara','FCamara','fcamara']])store.jobs.upsert({id,title:'Vaga de teste',company,description:'Fixture',url:`https://${tenant}.gupy.io/jobs/42`,createdAt:new Date(time).toISOString(),updatedAt:new Date(time).toISOString()});
  try{await fn({auth,store,advance:ms=>time+=ms});}finally{store.close();await rm(dir,{recursive:true,force:true});}
}
const start=async auth=>{const r=await auth.begin('gupy',{jobId:'finx'});return {r,ticket:auth.issueTicket(r.id)};};
test('Gupy account connection needs no company; contextual targets remain distinct',()=>fixture(async({auth})=>{
  const account=await auth.begin('gupy');
  assert.equal(account.tenant,'gupy.io');assert.equal(account.loginUrl,'https://login.gupy.io/candidates/signin');assert.equal(account.jobId,'');
  assert.equal(auth.gupyContext().request.id,account.id);assert.equal(auth.gupyContext().selectionRequired,true);assert.equal(auth.gupyContext().targets.length,2);
  auth.update(account.id,'AUTH_FAILED',{...auth.request(account.id).payload,failureCode:'BROWSER_CLOSED'});
  const finx=await auth.begin('gupy',{jobId:'finx'});assert.equal(finx.tenant,'finxapp.gupy.io');
  assert.equal(auth.gupyContext().request.id,account.id);assert.equal(auth.gupyContext('finx').request.id,finx.id);
  auth.update(finx.id,'AUTH_FAILED',{...auth.request(finx.id).payload,failureCode:'BROWSER_CLOSED'});
  assert.equal((await auth.begin('gupy',{jobId:'fcamara'})).tenant,'fcamara.gupy.io');
}));
test('request creation is launch pending, never auth in progress; refresh restores same request without ticket',()=>fixture(async({auth,store})=>{
  const {r,ticket}=await start(auth);assert.equal(r.status,'LAUNCH_PENDING');assert.equal(auth.status('gupy').status,'LAUNCH_PENDING');
  const restored=auth.gupyContext('finx').request;assert.equal(restored.id,r.id);assert.equal(restored.jobId,'finx');assert.equal(restored.claimedAt,null);
  assert.ok(!JSON.stringify(restored).includes(ticket));assert.equal(store.database.connection.prepare('SELECT COUNT(*) n FROM source_auth_requests').get().n,1);
  assert.equal((await auth.begin('gupy',{jobId:'finx'})).id,r.id);assert.throws(()=>auth.issueTicket(r.id));
}));
test('claim and browser opened are separate positive acknowledgements with heartbeat metadata',()=>fixture(async({auth,advance})=>{
  const {r,ticket}=await start(auth);auth.claim(r.id,ticket);assert.equal((await auth.poll(r.id)).status,'AUTH_IN_PROGRESS');
  assert.throws(()=>auth.claim(r.id,ticket));assert.ok(auth.request(r.id).payload.claimedAt);
  auth.runnerEvent(r.id,ticket,{event:'BROWSER_OPENED'});assert.equal((await auth.poll(r.id)).status,'USER_ACTION_REQUIRED');
  advance(10000);auth.runnerEvent(r.id,ticket,{event:'HEARTBEAT'});assert.ok(auth.gupyContext('finx').request.lastHeartbeat);
}));
test('repeated forced clicks preserve the pending request and its original one-time ticket',()=>fixture(async({auth,store})=>{
  const {r,ticket}=await start(auth);
  for(let i=0;i<20;i++){
    const repeated=await auth.begin('gupy',{jobId:'finx',force:true});
    assert.equal(repeated.id,r.id);assert.equal(repeated.canLaunch,false);
  }
  assert.equal(store.database.connection.prepare('SELECT COUNT(*) n FROM source_auth_requests').get().n,1);
  auth.claim(r.id,ticket);
  assert.equal((await auth.begin('gupy',{jobId:'finx',force:true})).id,r.id);
  for(const code of ['CLAIM_FAILED','NODE_NOT_FOUND','RUNNER_START_FAILED','PROTOCOL_HANDLER_FAILED']){
    assert.throws(()=>auth.runnerEvent(r.id,ticket,{event:'FAILED',code}),error=>error.status===409);
  }
  assert.equal((await auth.poll(r.id)).status,'AUTH_IN_PROGRESS');
  auth.runnerEvent(r.id,ticket,{event:'BROWSER_OPENED'});
  assert.equal((await auth.poll(r.id)).status,'USER_ACTION_REQUIRED');
}));
test('runner failure is sanitized, terminal and retry creates new request',()=>fixture(async({auth})=>{
  const {r,ticket}=await start(auth);auth.runnerEvent(r.id,ticket,{event:'FAILED',code:'NODE_NOT_FOUND',password:'must-not-persist'});
  assert.equal((await auth.poll(r.id)).status,'AUTH_LAUNCH_FAILED');assert.equal(auth.request(r.id).payload.failureCode,'NODE_NOT_FOUND');
  assert.ok(!JSON.stringify(auth.request(r.id)).includes('must-not-persist'));assert.throws(()=>auth.claim(r.id,ticket));
  assert.notEqual((await auth.begin('gupy',{jobId:'finx',force:true})).id,r.id);
}));
test('launch timeout, runner loss, expiration and stale callbacks do not leave permanent progress',()=>fixture(async({auth,advance})=>{
  let {r,ticket}=await start(auth);advance(21000);assert.equal((await auth.poll(r.id)).status,'AUTH_LAUNCH_FAILED');assert.equal(auth.request(r.id).payload.failureCode,'LAUNCH_NOT_ACKNOWLEDGED');
  ({r,ticket}=await start(auth));auth.claim(r.id,ticket);advance(31000);assert.equal((await auth.poll(r.id)).status,'AUTH_LAUNCH_FAILED');
  ({r,ticket}=await start(auth));auth.claim(r.id,ticket);auth.runnerEvent(r.id,ticket,{event:'BROWSER_OPENED'});advance(31000);assert.equal((await auth.poll(r.id)).status,'AUTH_FAILED');
  ({r,ticket}=await start(auth));advance(600001);assert.equal((await auth.poll(r.id)).status,'AUTH_REQUEST_EXPIRED');assert.throws(()=>auth.claim(r.id,ticket));
  assert.notEqual((await auth.begin('gupy',{jobId:'finx'})).id,r.id);
}));
test('session validation is visible and stale completion after failure cannot activate session',()=>fixture(async({auth,store})=>{
  const {r,ticket}=await start(auth);auth.claim(r.id,ticket);auth.runnerEvent(r.id,ticket,{event:'BROWSER_OPENED'});
  let finish;auth.verifySession=()=>new Promise(resolve=>finish=resolve);
  const completing=auth.completeSession(r.id,ticket,{cookies:[],origins:[]});assert.equal((await auth.poll(r.id)).status,'SESSION_VALIDATING');
  auth.runnerEvent(r.id,ticket,{event:'FAILED',code:'SESSION_VALIDATION_FAILED'});finish(true);await assert.rejects(completing);
  assert.equal(store.database.connection.prepare('SELECT COUNT(*) n FROM provider_sessions').get().n,0);
}));
test('only opened, positively verified owned session becomes active',()=>fixture(async({auth})=>{
  const {r,ticket}=await start(auth);auth.claim(r.id,ticket);await assert.rejects(auth.completeSession(r.id,ticket,{cookies:[],origins:[]}));
  auth.runnerEvent(r.id,ticket,{event:'BROWSER_OPENED'});await auth.completeSession(r.id,ticket,{cookies:[],origins:[]});
  assert.equal(auth.status('gupy','finxapp.gupy.io').status,'SESSION_ACTIVE');assert.equal(auth.status('gupy','fcamara.gupy.io').status,'SESSION_ACTIVE');assert.equal(auth.status('gupy').scope,'ACCOUNT');
}));
const handoff='career-unified-auth://auth?id=source-auth-11111111-1111-1111-1111-111111111111&ticket='+'a'.repeat(64)+'&port=7123';
test('restoring completed request does not claim an expired or removed session is active',()=>fixture(async({auth,store})=>{
  const {r,ticket}=await start(auth);auth.claim(r.id,ticket);auth.runnerEvent(r.id,ticket,{event:'BROWSER_OPENED'});
  await auth.completeSession(r.id,ticket,{cookies:[],origins:[]});
  store.database.connection.prepare("UPDATE provider_sessions SET expires_at='2000-01-01' WHERE tenant='gupy.io'").run();
  assert.equal(auth.gupyContext('finx').request.status,'SESSION_EXPIRED');
  assert.notEqual(auth.status('gupy','finxapp.gupy.io').status,'SESSION_ACTIVE');
}));
test('unclaimed heartbeat/open and nonallowlisted failure cannot advance a request',()=>fixture(async({auth})=>{
  const {r,ticket}=await start(auth);
  for(const input of [{event:'HEARTBEAT'},{event:'BROWSER_OPENED'},{event:'FAILED',code:'private error'}])assert.throws(()=>auth.runnerEvent(r.id,ticket,input));
  assert.equal((await auth.poll(r.id)).status,'LAUNCH_PENDING');
}));
test('runner protocol rejects extra arguments, invalid ports and foreign schemes',()=>{
  assert.equal(parseAuthHandoff(handoff).port,'7123');
  for(const value of [handoff+'&port=1234',handoff+'&cmd=run',handoff+'#fragment',handoff.replace('7123','000'),handoff.replace('7123','99999'),handoff.replace('career-unified-auth','https')])assert.throws(()=>parseAuthHandoff(value));
});
test('runner reports missing Chromium to backend without raw exception or credentials',async()=>{
  const calls=[];const result=await runSourceAuth(handoff,{fetchImpl:async(url,options)=>{calls.push({action:url.split('/').pop(),body:JSON.parse(options.body)});return {ok:true,json:async()=>({loginUrl:'https://finxapp.gupy.io/candidates/signin',expiresAt:new Date(Date.now()+60000).toISOString()})};},loadChromium:async()=>{throw Error('private diagnostic');}});
  assert.equal(result.failureCode,'CHROMIUM_NOT_FOUND');assert.deepEqual(calls.map(x=>x.action),['claim','event']);assert.deepEqual(calls[1].body,{event:'FAILED',code:'CHROMIUM_NOT_FOUND'});assert.ok(!JSON.stringify(calls).includes('private diagnostic'));
});
test('runner uses isolated managed Chrome and follows a replacement Gupy page',async()=>{
  const calls=[],launches=[];
  let originalClosed=false;
  const original={isClosed:()=>originalClosed,goto:async()=>{originalClosed=true;},url:()=> 'about:blank',locator:()=>({count:async()=>0}),getByRole:()=>({count:async()=>0})};
  const authenticated={isClosed:()=>false,url:()=> 'https://finxapp.gupy.io/candidates',locator:()=>({count:async()=>0}),getByRole:()=>({count:async()=>1})};
  const state={cookies:[{name:'session',value:'fixture-session',domain:'.gupy.io',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'},{name:'analytics',value:'discard-me',domain:'.gupy.io',path:'/',expires:-1,httpOnly:false,secure:false,sameSite:'Lax'}],origins:[]};
  const context={pages:()=>originalClosed?[original,authenticated]:[original],storageState:async()=>state};
  const chromium={};
  const result=await runSourceAuth(handoff,{loadChromium:async()=>chromium,launchBrowser:async({directory,chromium:loaded})=>{launches.push({directory,loaded});return {context,close:async()=>{}};},wait:async()=>{},fetchImpl:async(url,options)=>{
    const action=url.split('/').pop(),body=JSON.parse(options.body);calls.push({action,body});
    return {ok:true,json:async()=>action==='claim'?{loginUrl:'https://finxapp.gupy.io/candidates/signin',expiresAt:new Date(Date.now()+60000).toISOString()}: {status:'OK'}};
  }});
  assert.equal(result.status,'SESSION_ACTIVE');assert.equal(launches.length,1);assert.equal(launches[0].loaded,chromium);
  assert.match(path.basename(launches[0].directory),/^career-owned-auth-/);assert.deepEqual(calls.map(x=>x.action),['claim','event','event','complete']);
  assert.equal(calls.at(-1).body.state.cookies[0].value,'fixture-session');assert.equal(calls.at(-1).body.state.cookies.length,1);
});
