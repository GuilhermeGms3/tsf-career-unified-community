import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {UnifiedStateStore} from '../server/unified-state-store.mjs';
import {CredentialVault} from '../src/discovery/source-center/credential-vault.mjs';
import {SourceAuthService} from '../src/source-connections/source-auth-service.mjs';
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
  for(const id of ['gupy','indeed','solides','recrutei','iel','infojobs','catho','vagas','programathor','geekhunter']){
    const provider=sessionProviderById(id);assert.ok(provider,id);assert.match(provider.loginUrl,/^https:\/\//);assert.match(provider.signupUrl,/^https:\/\//);assert.ok(provider.cookieDomains.length);
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
