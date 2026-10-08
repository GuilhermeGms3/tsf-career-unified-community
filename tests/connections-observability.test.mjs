import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {UnifiedStateStore} from '../server/unified-state-store.mjs';
import {CredentialVault} from '../src/discovery/source-center/credential-vault.mjs';
import {SourceAuthService} from '../src/source-connections/source-auth-service.mjs';
import {SourceReadinessService,connectionCapabilities} from '../src/source-connections/provider-readiness.mjs';
import {GUPY_ACCOUNT_SCOPE,validateOwnedState,authenticatedGupyPage,authenticatedGupyAccountPage} from '../src/source-connections/session-state.mjs';
import {ObservabilityService} from '../src/observability/observability-service.mjs';
import {createConnectionsObservabilityRoutes} from '../server/routes/connections-observability-routes.mjs';
import {ApplicationBatchService} from '../src/application/application-batch-service.mjs';
import {BrowserManager} from '../src/automation/browser/browser-manager.mjs';

const state=()=>({cookies:[{name:'owned-session',value:'fixture-session-only',domain:'.gupy.io',path:'/',expires:Date.now()/1000+3600,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]});
async function fixture(){
  const dir=await mkdtemp(path.join(os.tmpdir(),'source-auth-test-'));const store=await new UnifiedStateStore({dataDir:dir}).initialize(),vault=await new CredentialVault({vaultPath:path.join(dir,'vault.json'),keyPath:path.join(dir,'key')}).initialize();let token='',syncs=0,probes=0;
  const connections={secret:()=>token,connect:async(_,value)=>{token=value;},remove:async()=>{token='';},validateCredential:async()=>({valid:true}),list:async()=>[{providerId:'github',syncStatus:'READY',sync:{status:'READY',details:{indexed:2,evidenceFacts:3}}}]};
  const auth=new SourceAuthService({store,vault,connections,githubEvidence:{sync:async()=>{syncs++;return {status:'READY'};}},verifySession:async()=>{probes++;return true;}}),readiness=new SourceReadinessService({connections,auth}),observability=new ObservabilityService({store,readiness});
  store.jobs.upsert({id:'gupy-job',title:'Fixture job',company:'Fixture',description:'Synthetic fixture',url:'https://fixture.gupy.io/jobs/42',applicationUrl:'https://fixture.gupy.io/candidates/jobs/42/apply',status:'open',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  return {dir,store,vault,auth,connections,readiness,observability,get syncs(){return syncs;},get probes(){return probes;},close:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};
}
const withFixture=fn=>async()=>{const f=await fixture();try{await fn(f);}finally{await f.close();}};
test('capability projection includes actual sources, limited LinkedIn and tenant-only Workday',()=>{
  const items=connectionCapabilities();assert.equal(new Set(items.map(i=>i.providerId)).size,items.length);
  for(const id of ['gupy','github','linkedin','indeed','workday','solides','recrutei','programathor','iel','greenhouse','lever','ashby'])assert.ok(items.some(i=>i.providerId===id));
  assert.equal(items.find(i=>i.providerId==='workday').capabilities.APPLICATION_FILL,'SUPPORTED_LIMITED');assert.equal(items.find(i=>i.providerId==='workday').capabilities.CONTROLLED_SUBMIT,'NOT_SUPPORTED');assert.equal(items.find(i=>i.providerId==='linkedin').authMode,'NOT_MANAGED');assert.equal(items.find(i=>i.providerId==='indeed').authMode,'NONE');
});
test('readiness is local, Brave harmless, GitHub evidence survives disconnection',withFixture(async f=>{
  await f.auth.disconnect('github');const sources=await f.readiness.list();assert.equal(f.probes,0);assert.equal(f.syncs,0);assert.equal(sources.find(s=>s.providerId==='brave-public-web').health,'UNKNOWN');assert.equal(sources.find(s=>s.providerId==='brave-public-web').requiredForCoreProduct,false);assert.equal(sources.find(s=>s.providerId==='github').persistedEvidenceAvailable,true);
}));
test('readiness distingue capacidade, configuração, autenticação e disponibilidade sem efeitos externos',async()=>{
  let reads=0,authReads=0;
  const source=async(providerId,snapshot,status='NOT_MANAGED')=>{
    const readiness=new SourceReadinessService({connections:{list:async()=>{reads++;return snapshot?[{providerId,...snapshot}]:[];}},auth:{status:id=>{authReads++;return {status:id===providerId?status:'NOT_MANAGED'};}}});
    return (await readiness.list()).find(item=>item.providerId===providerId);
  };
  const checked={healthStatus:'HEALTHY',checkedAt:'2026-08-28T12:00:00.000Z'};
  const absent=await source('jobspy',null);
  assert.equal(absent.availability,'NOT_CHECKED');assert.equal(absent.health,'UNKNOWN');assert.equal(absent.configuration,'NOT_CHECKED');assert.equal(absent.capabilities.DISCOVERY,'SUPPORTED_LIMITED');
  const available=await source('jobspy',{availabilityStatus:'AVAILABLE',setupType:'NONE',lastTest:checked});
  assert.equal(available.availability,'AVAILABLE');assert.equal(available.health,'READY');assert.equal(available.configuration,'NOT_REQUIRED');assert.equal(available.authentication,'NOT_REQUIRED');
  assert.equal((await source('jobspy',{availabilityStatus:'LIMITED',setupType:'NONE'})).health,'LIMITED');
  assert.equal((await source('jobspy',{availabilityStatus:'UNAVAILABLE',setupType:'NONE'})).health,'UNAVAILABLE');
  const notConfigured=await source('github',{availabilityStatus:'AVAILABLE',setupType:'TOKEN',credentialStatus:'NOT_CONFIGURED',lastTest:checked},'NOT_CONFIGURED');
  assert.equal(notConfigured.configuration,'NOT_CONFIGURED');assert.equal(notConfigured.authentication,'NOT_CONFIGURED');assert.equal(notConfigured.availability,'AVAILABLE');assert.equal(notConfigured.operationalReadiness,'NOT_CONFIGURED');
  const expired=await source('gupy',{availabilityStatus:'AVAILABLE',setupType:'ACCOUNT',lastTest:checked},'SESSION_EXPIRED');
  assert.equal(expired.authentication,'SESSION_EXPIRED');assert.equal(expired.operationalReadiness,'SESSION_EXPIRED');
  const disabled=await source('brave-public-web',{availabilityStatus:'DISABLED'});
  assert.equal(disabled.availability,'DISABLED');assert.equal(disabled.health,'DISABLED');assert.equal(disabled.operationalReadiness,'DISABLED');assert.equal(disabled.requiredForCoreProduct,false);
  const optionalOffline=await source('brave-public-web',{availabilityStatus:'UNAVAILABLE'});
  assert.equal(optionalOffline.availability,'UNAVAILABLE');assert.equal(optionalOffline.health,'UNAVAILABLE');assert.equal(optionalOffline.requiredForCoreProduct,false);
  const active=await source('gupy',{availabilityStatus:'AVAILABLE',setupType:'ACCOUNT',lastTest:checked},'SESSION_ACTIVE');
  assert.equal(active.authentication,'SESSION_ACTIVE');assert.equal(active.health,'READY');assert.equal(active.operationalReadiness,'READY');
  assert.equal(reads,9);assert.ok(authReads>=reads);
});
test('GitHub sync intent survives pending authentication and continues once after token save',withFixture(async f=>{
  const connect=await f.auth.begin('github'),sync=await f.auth.begin('github',{intent:'SYNC'});assert.equal(connect.id,sync.id);assert.equal(sync.intent,'SYNC');assert.equal(f.syncs,0);
  const result=await f.auth.completeToken(sync.id,'fixture-token');assert.equal(result.status,'READY');assert.equal(f.syncs,1);await assert.rejects(f.auth.completeToken(sync.id,'fixture-token'));assert.equal(f.syncs,1);
  await f.auth.begin('github',{intent:'SYNC'});assert.equal(f.syncs,2);
}));
test('GitHub device flow respects pending and slow_down; device secret never appears in DTO',withFixture(async f=>{
  f.auth.githubClientId='fixture-client';let calls=0;f.auth.fetchImpl=async()=>({ok:true,json:async()=>++calls===1?{device_code:'fixture-device-secret',user_code:'ABCD-EFGH',interval:5}:calls===2?{error:'slow_down'}:{access_token:'fixture-device-token'}});
  const r=await f.auth.begin('github',{intent:'SYNC'});assert.equal(r.userCode,'ABCD-EFGH');assert.ok(!JSON.stringify(r).includes('fixture-device-secret'));
  await f.auth.poll(r.id);assert.equal(calls,1);let internal=f.auth.request(r.id);internal.payload.nextPoll=0;f.auth.update(r.id,'AUTH_REQUIRED',internal.payload);await f.auth.poll(r.id);assert.equal(f.auth.request(r.id).payload.interval,10);
  internal=f.auth.request(r.id);internal.payload.nextPoll=0;f.auth.update(r.id,'AUTH_IN_PROGRESS',internal.payload);await f.auth.poll(r.id);assert.equal(f.syncs,1);assert.equal(f.vault.get(r.id),'');
}));
test('Gupy handoff is single use, authenticated account state encrypted and provider isolated',withFixture(async f=>{
  const request=await f.auth.begin('gupy',{jobId:'gupy-job'}),ticket=f.auth.issueTicket(request.id);assert.equal(request.loginUrl,'https://fixture.gupy.io/candidates/signin');assert.throws(()=>f.auth.claim(request.id,'wrong'));
  f.auth.claim(request.id,ticket);f.auth.runnerEvent(request.id,ticket,{event:'BROWSER_OPENED'});assert.throws(()=>f.auth.claim(request.id,ticket));await f.auth.completeSession(request.id,ticket,state());assert.equal(f.auth.status('gupy','fixture.gupy.io').status,'SESSION_ACTIVE');
  assert.equal(f.auth.storageState('github','fixture.gupy.io'),undefined);assert.equal(f.auth.storageState('gupy','other.gupy.io').cookies.length,1);assert.equal(f.auth.storageState('gupy','fixture.gupy.io').cookies.length,1);assert.equal(f.auth.status('gupy').scope,'ACCOUNT');
  assert.equal(f.store.database.connection.prepare("SELECT tenant FROM provider_sessions WHERE provider='gupy'").get().tenant,GUPY_ACCOUNT_SCOPE);
  assert.ok(!(await readFile(f.vault.vaultPath,'utf8')).includes('fixture-session-only'));await assert.rejects(f.auth.completeSession(request.id,ticket,state()));
}));
test('Gupy unconfirmed login cannot become active; expiration preserves draft context',withFixture(async f=>{
  const r=await f.auth.begin('gupy',{jobId:'gupy-job'}),ticket=f.auth.issueTicket(r.id);f.auth.claim(r.id,ticket);f.auth.runnerEvent(r.id,ticket,{event:'BROWSER_OPENED'});f.auth.verifySession=async()=>false;await assert.rejects(f.auth.completeSession(r.id,ticket,state()),/NOT_CONFIRMED/);assert.notEqual(f.auth.status('gupy').status,'SESSION_ACTIVE');
  f.auth.verifySession=async()=>true;const fresh=await f.auth.begin('gupy',{jobId:'gupy-job'}),freshTicket=f.auth.issueTicket(fresh.id);f.auth.claim(fresh.id,freshTicket);f.auth.runnerEvent(fresh.id,freshTicket,{event:'BROWSER_OPENED'});await f.auth.completeSession(fresh.id,freshTicket,state());
  f.store.database.connection.prepare("UPDATE provider_sessions SET expires_at='2000-01-01'").run();assert.equal(f.auth.storageState('gupy','fixture.gupy.io'),undefined);assert.equal(f.auth.status('gupy').status,'SESSION_EXPIRED');
  assert.ok(f.store.structuredLogs.problems().some(p=>p.error_code==='SESSION_EXPIRED'));
  const reconnect=await f.auth.begin('gupy',{jobId:'gupy-job'}),t=f.auth.issueTicket(reconnect.id);f.auth.claim(reconnect.id,t);f.auth.runnerEvent(reconnect.id,t,{event:'BROWSER_OPENED'});await f.auth.completeSession(reconnect.id,t,state());assert.equal(f.store.structuredLogs.problems().find(p=>p.error_code==='SESSION_EXPIRED').status,'RESOLVED');
}));
test('session metadata and encrypted state persist across owner restart',async()=>{
  const f=await fixture();try{const r=await f.auth.begin('gupy',{jobId:'gupy-job'}),t=f.auth.issueTicket(r.id);f.auth.claim(r.id,t);f.auth.runnerEvent(r.id,t,{event:'BROWSER_OPENED'});await f.auth.completeSession(r.id,t,state());f.store.close();f.store=await new UnifiedStateStore({dataDir:f.dir}).initialize();
    const restarted=new SourceAuthService({store:f.store,vault:await new CredentialVault({vaultPath:f.vault.vaultPath,keyPath:f.vault.keyPath}).initialize(),connections:f.connections});assert.equal(restarted.status('gupy').status,'SESSION_ACTIVE');assert.equal(restarted.storageState('gupy','fixture.gupy.io').cookies[0].value,'fixture-session-only');
  }finally{f.store.close();await rm(f.dir,{recursive:true,force:true});}
});
test('disconnect removes session only, invalidates handoffs and preserves job/history',withFixture(async f=>{
  const r=await f.auth.begin('gupy',{jobId:'gupy-job'}),t=f.auth.issueTicket(r.id);f.auth.claim(r.id,t);f.auth.runnerEvent(r.id,t,{event:'BROWSER_OPENED'});await f.auth.completeSession(r.id,t,state());await f.auth.disconnect('gupy');assert.equal(f.auth.storageState('gupy','fixture.gupy.io'),undefined);assert.ok(f.store.jobs.findById('gupy-job'));assert.ok(f.store.structuredLogs.list({provider:'gupy'}).length);assert.throws(()=>f.auth.claim(r.id,t));
}));
test('foreign provider storage is rejected and password keys are discarded',()=>{
  const foreign=state();foreign.cookies[0].domain='.linkedin.com';assert.throws(()=>validateOwnedState(foreign,'fixture.gupy.io'),/ISOLATION/);
  const owned=state();owned.origins=[{origin:'https://fixture.gupy.io',localStorage:[{name:'password',value:'dont-store'},{name:'locale',value:'pt'}]}];assert.equal(validateOwnedState(owned,'fixture.gupy.io').origins[0].localStorage.length,1);
});
test('positive authentication evidence, not missing password, determines session validity',async()=>{
  const page={url:()=> 'https://fixture.gupy.io/candidates',locator:()=>({count:async()=>0}),getByRole:()=>({count:async()=>0})};assert.equal(await authenticatedGupyPage(page,'fixture.gupy.io'),false);page.getByRole=()=>({count:async()=>1});assert.equal(await authenticatedGupyPage(page,'fixture.gupy.io'),true);assert.equal(await authenticatedGupyPage(page,'other.gupy.io'),false);
  const account={url:()=> 'https://portal.gupy.io/my/applications',locator:()=>({count:async()=>0}),getByRole:()=>({count:async()=>0}),getByText:()=>({count:async()=>1})};assert.equal(await authenticatedGupyAccountPage(account),true);account.getByText=()=>({count:async()=>0});assert.equal(await authenticatedGupyAccountPage(account),false);
});
test('Application Batch consumes readiness and injected owned session across two pages without changing lifecycle',withFixture(async f=>{
  const r=await f.auth.begin('gupy',{jobId:'gupy-job'}),t=f.auth.issueTicket(r.id);f.auth.claim(r.id,t);f.auth.runnerEvent(r.id,t,{event:'BROWSER_OPENED'});await f.auth.completeSession(r.id,t,state());let opens=0;
  const browser={sessions:new Map(),resume:()=>null,open:async(id,attempt,options)=>{opens++;assert.equal(options.storageState.cookies[0].value,'fixture-session-only');assert.equal(options.trace,false);return {traceStopped:true,page:{goto:async()=>{}}};}};
  const service=new ApplicationBatchService({store:f.store,dataDir:f.dir,profileProvider:async()=>({}),opportunityService:{},browserManager:browser,sourceAuth:f.auth,sourceReadiness:f.readiness,allowLocalFixtures:true});
  for(const id of ['A','B'])await service.openSession({id,applicationUrl:'https://fixture.gupy.io/candidates/jobs/42/apply'});assert.equal(opens,2);assert.equal(f.readiness.forApplication({applicationUrl:'https://other.gupy.io/jobs/1'}).canFill,true);assert.equal(f.store.applications.all().length,0);
}));
test('BrowserManager actually restores only supplied session in an isolated context',withFixture(async f=>{
  const manager=new BrowserManager({dataDir:f.dir});const session=await manager.open('owned-test','attempt',{storageState:state(),trace:false});try{await session.context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<button>Sair</button>'}));await session.page.goto('https://fixture.gupy.io/candidates');assert.equal((await session.context.cookies('https://fixture.gupy.io'))[0].value,'fixture-session-only');assert.equal((await session.context.cookies('https://linkedin.com')).length,0);assert.equal(session.traceStopped,true);}finally{await manager.close(session,{traceStopped:true});}
}));
test('structured logs preserve cause chain, critical severity and redact before persistence and TXT',withFixture(async f=>{
  f.store.structuredLogs.record({category:'GUPY',provider:'gupy',eventCode:'FILL_FAILED',level:'CRITICAL',errorCode:'FORM_FIELD_NOT_FOUND',correlationId:'correlation-fixture',message:'password=red-secret Bearer red-bearer',metadata:{token:'red-token',cookie:'red-cookie',authorization:'red-auth',password:'red-password',storageState:{cookies:['red-storage']},answers:{salary:'red-salary'},cause:{code:'FORM_FIELD_NOT_FOUND'}}});
  const raw=JSON.stringify(f.store.database.connection.prepare('SELECT * FROM structured_log_events').all());for(const secret of ['red-secret','red-bearer','red-token','red-cookie','red-auth','red-password','red-storage','red-salary'])assert.ok(!raw.includes(secret),secret);
  const txt=await f.observability.exportText({provider:'gupy',level:'CRITICAL'},true);assert.match(txt,/correlation-fixture/);assert.match(txt,/FORM_FIELD_NOT_FOUND/);assert.match(txt,/CRITICAL/);assert.ok(!txt.includes('red-token'));
}));
test('TXT filters exactly by provider, time, level and correlation',withFixture(async f=>{
  f.store.structuredLogs.recordMany([{provider:'gupy',category:'GUPY',event:'EXPECTED',level:'WARN',correlationId:'selected'},{provider:'github',category:'GITHUB',event:'OTHER_SOURCE',level:'WARN'},{provider:'gupy',category:'GUPY',event:'OTHER_LEVEL',level:'INFO'}]);
  const txt=await f.observability.exportText({provider:'gupy',level:'WARN',correlationId:'selected'});assert.match(txt,/EXPECTED/);assert.ok(!txt.includes('OTHER_SOURCE'));assert.ok(!txt.includes('OTHER_LEVEL'));assert.match(txt,/selected/);
}));
test('stable problem aggregation and state transitions preserve occurrences',withFixture(async f=>{
  for(let i=0;i<3;i++)f.store.structuredLogs.record({category:'SOURCE_AUTH',provider:'gupy',event:'EXPIRED',level:'WARN',errorCode:'SESSION_EXPIRED'});
  let [p]=f.store.structuredLogs.problems();assert.equal(p.occurrences,3);f.store.structuredLogs.setProblemStatus(p.id,'ACKNOWLEDGED');f.store.structuredLogs.resolve('gupy',['SESSION_EXPIRED']);assert.equal(f.store.structuredLogs.problems()[0].status,'RESOLVED');
  f.store.structuredLogs.record({category:'SOURCE_AUTH',provider:'gupy',event:'EXPIRED',level:'WARN',errorCode:'SESSION_EXPIRED'});[p]=f.store.structuredLogs.problems();assert.equal(p.status,'OPEN');assert.equal(p.occurrences,4);
}));
test('retention touches only operational logs and never deletes problem history',withFixture(async f=>{
  const logs=f.store.structuredLogs;logs.record({timestamp:'2000-01-01T00:00:00.000Z',category:'SYSTEM',event:'OLD',level:'ERROR',errorCode:'OLD_ERROR'});assert.equal(logs.list({search:'OLD'}).length,0);assert.equal(logs.problems().length,1);assert.ok(f.store.jobs.findById('gupy-job'));
}));
test('new APIs reject cross-origin, non-JSON, rebinding and invalid handoff without invoking writes',async()=>{
  let writes=0,errors=0;const handler=createConnectionsObservabilityRoutes({auth:{begin:()=>{writes++;}},json:()=>{},sendError:()=>{errors++;}});
  for(const [host,headers]of [['localhost',{'content-type':'text/plain'}],['localhost',{'content-type':'application/json',origin:'https://evil.test'}],['evil.test',{'content-type':'application/json'}]])await handler({method:'POST',headers},{setHeader(){}},new URL(`http://${host}/api/connections/gupy/connect`));assert.equal(writes,0);assert.equal(errors,3);
});
test('runner is dedicated and cannot import ordinary browser profiles or credential stores',async()=>{
  const source=await readFile(new URL('../scripts/source-auth-runner.mjs',import.meta.url),'utf8');assert.match(source,/mkdtemp/);assert.match(source,/connectOverCDP/);assert.match(source,/spawnImpl\(chromePath/);assert.doesNotMatch(source,/Chrome\/User Data|Edge\/User Data|Login Data|keytar|CryptUnprotectData/);
});
test('Docker runtime resolves the Chromium installed during image build',async()=>{
  const source=await readFile(new URL('../Dockerfile',import.meta.url),'utf8');
  assert.match(source,/ENV PLAYWRIGHT_BROWSERS_PATH=\/ms-playwright\s+RUN npx playwright install --with-deps chromium/);
});
