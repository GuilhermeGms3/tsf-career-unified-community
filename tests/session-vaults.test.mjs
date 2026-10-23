import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {UnifiedStateStore} from '../server/unified-state-store.mjs';
import {CredentialVault} from '../src/discovery/source-center/credential-vault.mjs';
import {SourceAuthService,effectiveSessionExpiry,privateNetworkDestination} from '../src/source-connections/source-auth-service.mjs';
import {SESSION_PROVIDER_IDS,sessionProviderById} from '../src/source-connections/session-provider-registry.mjs';
import {validateProviderState,authenticatedProviderPage} from '../src/source-connections/session-state.mjs';

const indeedState=()=>({cookies:[{name:'session',value:'indeed-session-secret',domain:'.indeed.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]});
async function fixture(){
  const dir=await mkdtemp(path.join(os.tmpdir(),'session-vaults-')),store=await new UnifiedStateStore({dataDir:dir}).initialize(),vault=await new CredentialVault({vaultPath:path.join(dir,'vault.json'),keyPath:path.join(dir,'key')}).initialize();
  const auth=new SourceAuthService({store,vault,connections:{secret:()=>'',list:async()=>[]},githubEvidence:{},verifySession:async(_state,_scope,provider)=>provider==='indeed'});
  return {dir,store,vault,auth,close:async()=>{store.close();await rm(dir,{recursive:true,force:true});}};
}
const withFixture=fn=>async()=>{const f=await fixture();try{await fn(f);}finally{await f.close();}};

test('registry exposes candidate portals with explicit login and account creation',()=>{
  for(const id of ['gupy','indeed','solides','recrutei','iel','infojobs','catho','vagas','programathor','geekhunter','empregare']){
    const provider=sessionProviderById(id);assert.ok(provider,id);assert.match(provider.loginUrl,/^https:\/\//);assert.match(provider.signupUrl,/^https:\/\//);assert.ok(provider.cookieDomains.length);assert.equal(provider.sessionHours,168);
  }
  assert.equal(new Set(SESSION_PROVIDER_IDS).size,SESSION_PROVIDER_IDS.length);
});

test('generic session lifecycle encrypts state and isolates each provider',withFixture(async({auth,vault})=>{
  const request=await auth.begin('indeed',{purpose:'CREATE_ACCOUNT'});assert.equal(request.purpose,'CREATE_ACCOUNT');assert.equal(request.loginUrl,sessionProviderById('indeed').signupUrl);
  const ticket=auth.issueTicket(request.id);assert.equal(auth.claim(request.id,ticket).provider,'indeed');auth.runnerEvent(request.id,ticket,{event:'BROWSER_OPENED'});
  const completed=await auth.completeSession(request.id,ticket,indeedState());assert.equal(completed.status,'SESSION_ACTIVE');assert.equal(auth.status('indeed').status,'SESSION_ACTIVE');assert.equal(auth.storageState('indeed').cookies[0].value,'indeed-session-secret');assert.equal(auth.storageState('gupy'),undefined);
  assert.ok(!(await readFile(vault.vaultPath,'utf8')).includes('indeed-session-secret'));
  await auth.disconnect('indeed');assert.equal(auth.storageState('indeed'),undefined);
}));

test('EMPREGARE usa o mesmo cofre criptografado sem compartilhar cookies com outros portais',withFixture(async({auth,vault})=>{
  auth.verifySession=async()=>true;
  const request=await auth.begin('empregare'),ticket=auth.issueTicket(request.id);auth.claim(request.id,ticket);auth.runnerEvent(request.id,ticket,{event:'BROWSER_OPENED'});
  const state={cookies:[{...indeedState().cookies[0],domain:'.empregare.com',value:'synthetic-empregare-session'}],origins:[]};
  assert.equal((await auth.completeSession(request.id,ticket,state)).status,'SESSION_ACTIVE');assert.equal(auth.storageState('empregare','careers.empregare.com').cookies[0].domain,'.empregare.com');assert.equal(auth.storageState('indeed'),undefined);assert.ok(!(await readFile(vault.vaultPath,'utf8')).includes('synthetic-empregare-session'));
}));

test('local session expires in seven days or at the earliest persistent cookie',()=>{
  const clock=()=>Date.parse('2026-10-09T12:00:00.000Z');
  assert.equal(effectiveSessionExpiry(indeedState(),168,clock),'2026-10-16T12:00:00.000Z');
  const state=indeedState();state.cookies[0].expires=clock()/1000+3600;
  assert.equal(effectiveSessionExpiry(state,168,clock),'2026-10-09T13:00:00.000Z');
});

test('foreign cookies and secret-like local storage cannot enter a provider vault',()=>{
  assert.throws(()=>validateProviderState({...indeedState(),cookies:[{...indeedState().cookies[0],domain:'.catho.com.br'}]},'indeed'),/ISOLATION/);
  const state={...indeedState(),origins:[{origin:'https://secure.indeed.com',localStorage:[{name:'locale',value:'pt-BR'},{name:'access_token',value:'secret'}]}]};
  assert.deepEqual(validateProviderState(state,'indeed').origins[0].localStorage,[{name:'locale',value:'pt-BR'}]);
});

test('session activation requires positive portal evidence',async()=>{
  const page={url:()=> 'https://www.infojobs.com.br/Candidate/Applications.aspx',locator:()=>({count:async()=>0}),getByRole:()=>({count:async()=>0}),getByText:()=>({count:async()=>0})};
  assert.equal(await authenticatedProviderPage(page,'infojobs'),true);
  page.url=()=> 'https://www.infojobs.com.br/Login.aspx';assert.equal(await authenticatedProviderPage(page,'infojobs'),false);
});

test('credential vault serializes concurrent writes and persists every entry',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'credential-vault-race-'));
  try{
    const options={vaultPath:path.join(dir,'vault.json'),keyPath:path.join(dir,'key')},vault=await new CredentialVault(options).initialize();
    await Promise.all(Array.from({length:40},(_,index)=>vault.put(`entry-${index}`,`secret-${index}`)));
    const reopened=await new CredentialVault(options).initialize();
    for(let index=0;index<40;index++)assert.equal(reopened.get(`entry-${index}`),`secret-${index}`);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('failed vault persistence does not publish an in-memory-only secret',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'credential-vault-rollback-'));
  try{
    const vault=await new CredentialVault({vaultPath:path.join(dir,'vault.json'),keyPath:path.join(dir,'key')}).initialize();
    vault.persist=async()=>{throw Object.assign(new Error('disk failure'),{code:'EIO'});};
    await assert.rejects(vault.put('new-entry','secret'),error=>error.code==='EIO');
    assert.equal(vault.get('new-entry'),'');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('missing session secret expires the database reference predictably',withFixture(async({auth,vault,store})=>{
  const request=await auth.begin('indeed'),ticket=auth.issueTicket(request.id);auth.claim(request.id,ticket);auth.runnerEvent(request.id,ticket,{event:'BROWSER_OPENED'});await auth.completeSession(request.id,ticket,indeedState());
  const row=store.database.connection.prepare("SELECT credential_ref FROM provider_sessions WHERE provider='indeed'").get();
  await vault.remove(row.credential_ref);
  assert.equal(auth.storageState('indeed'),undefined);
  assert.equal(auth.status('indeed').status,'SESSION_EXPIRED');
}));

test('authenticated browser verification blocks local and metadata destinations',()=>{
  for(const url of ['http://127.0.0.1/admin','https://localhost/private','http://169.254.169.254/latest/meta-data','file:///etc/passwd','https://[::1]/'])assert.equal(privateNetworkDestination(url),true,url);
  assert.equal(privateNetworkDestination('https://cdn.indeed.com/app.js'),false);
});
