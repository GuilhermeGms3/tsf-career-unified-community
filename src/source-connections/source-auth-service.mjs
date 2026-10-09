import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {GUPY_ACCOUNT_SCOPE,gupyTenant,validateProviderState,authenticatedProviderPage} from './session-state.mjs';
import {SESSION_PROVIDER_IDS,hostAllowed,sessionProviderById} from './session-provider-registry.mjs';
const now=()=>new Date().toISOString();
const fail=(code,status=409)=>{throw Object.assign(Error(code),{code,status});};
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
const sessionPending=new Set(['AUTH_REQUIRED','LAUNCH_PENDING','AUTH_IN_PROGRESS','USER_ACTION_REQUIRED','SESSION_VALIDATING']);
const managedProviders=new Set(SESSION_PROVIDER_IDS);
const runnerFailures=new Set(['PROTOCOL_HANDLER_FAILED','RUNNER_START_FAILED','NODE_NOT_FOUND','CHROMIUM_NOT_FOUND','CLAIM_FAILED','BROWSER_START_FAILED','BROWSER_NAVIGATION_FAILED','BROWSER_CLOSED','RUNNER_LOST','SESSION_VALIDATION_FAILED']);
export class SourceAuthService {
  constructor({store,vault,connections,githubEvidence,githubClientId=process.env.GITHUB_OAUTH_CLIENT_ID||'',fetchImpl=fetch,verifySession=null,clock=Date.now,launchTimeoutMs=20000,runnerLeaseMs=30000}){
    Object.assign(this,{clock,launchTimeoutMs,runnerLeaseMs});
    Object.assign(this,{store,vault,connections,githubEvidence,githubClientId,fetchImpl});this.db=store.database.connection;this.logs=store.structuredLogs;this.verifySession=verifySession||this.verifyInBrowser.bind(this);this.busy=new Set();
  }
  event(provider,eventCode,request={},extra={}){this.logs.record({category:provider==='github'?'GITHUB_SYNC':'SOURCE_AUTH',provider,eventCode,status:eventCode,correlationId:request.id,operation:request.intent||'AUTH',level:'INFO',...extra});}
  githubDisconnected(){return this.db.prepare("SELECT value FROM app_metadata WHERE key='github_disconnected'").get()?.value==='true';}
  status(provider,tenant=''){
    if(provider==='github')return {status:this.githubDisconnected()?'NOT_CONFIGURED':this.connections.secret('github')||process.env.GITHUB_TOKEN?'CONNECTED':'NOT_CONFIGURED'};
    if(!managedProviders.has(provider))return {status:'NOT_MANAGED'};
    const policy=sessionProviderById(provider),scope=provider==='gupy'?GUPY_ACCOUNT_SCOPE:policy.accountScope;
    const rows=this.db.prepare('SELECT tenant,status,verified_at,expires_at FROM provider_sessions WHERE provider=?').all(provider);
    const sessions=rows.map(r=>({tenant:r.tenant,status:r.status==='SESSION_ACTIVE'&&Date.parse(r.expires_at)<=Date.now()?'SESSION_EXPIRED':r.status,verifiedAt:r.verified_at,expiresAt:r.expires_at}));
    const latest=this.latestSessionRequest(provider),account=sessions.find(s=>s.tenant===scope),selected=sessions.find(s=>s.tenant===tenant),active=account?.status==='SESSION_ACTIVE'?account:selected?.status==='SESSION_ACTIVE'?selected:null;
    return {status:latest&&sessionPending.has(latest.status)?latest.status:active?'SESSION_ACTIVE':account?.status||selected?.status||sessions[0]?.status||latest?.status||'AUTH_REQUIRED',scope:active?.tenant===scope?'ACCOUNT':'PER_HOST',sessions,request:latest?this.publicRequest(latest):null};
  }
  gupyTargets(){
    const targets=new Map();
    for(const job of this.store.jobs.all())try{const tenant=gupyTenant(job.applicationUrl||job.canonicalUrl||job.url);if(!targets.has(tenant))targets.set(tenant,{jobId:job.id,company:job.company||tenant,tenant});}catch{}
    return [...targets.values()].sort((a,b)=>a.company.localeCompare(b.company,'pt-BR'));
  }
  gupyContext(jobId=''){
    const targets=this.gupyTargets();let selected=null;
    if(jobId){const tenant=this.target(jobId),job=this.store.jobs.findById(jobId);selected={jobId,tenant,company:job.company||tenant};}
    const request=this.latestGupyRequest(selected?.tenant||GUPY_ACCOUNT_SCOPE);
    return {targets,selected,request:request?this.publicRequest(request):null,selectionRequired:!selected};
  }
  latestGupyRequest(tenant=''){
    const row=this.db.prepare("SELECT id FROM source_auth_requests WHERE provider='gupy'"+(tenant?' AND tenant=?':'')+' ORDER BY created_at DESC,rowid DESC LIMIT 1').get(...(tenant?[tenant]:[]));
    return row?this.refreshGupyRequest(this.request(row.id)):null;
  }
  latestSessionRequest(provider){
    const row=this.db.prepare('SELECT id FROM source_auth_requests WHERE provider=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(provider);
    return row?this.refreshSessionRequest(this.request(row.id)):null;
  }
  refreshGupyRequest(r){
    return this.refreshSessionRequest(r);
  }
  refreshSessionRequest(r){
    const policy=sessionProviderById(r.provider);if(!policy)return r;
    if(r.status==='SESSION_ACTIVE'){
      const session=this.db.prepare('SELECT status,expires_at FROM provider_sessions WHERE provider=? AND tenant=? LIMIT 1').get(r.provider,policy.accountScope);
      if(!session||session.status!=='SESSION_ACTIVE'||Date.parse(session.expires_at)<=this.clock()){
        this.update(r.id,'SESSION_EXPIRED',{...r.payload,failureCode:'SESSION_EXPIRED'});return this.request(r.id);
      }
    }
    if(!sessionPending.has(r.status))return r;
    const time=this.clock();let status='',failureCode='';
    if(Date.parse(r.expires_at)<=time){status='AUTH_REQUEST_EXPIRED';failureCode='REQUEST_EXPIRED';}
    else if(['AUTH_REQUIRED','LAUNCH_PENDING'].includes(r.status)&&time-Date.parse(r.created_at)>=this.launchTimeoutMs){status='AUTH_LAUNCH_FAILED';failureCode='LAUNCH_NOT_ACKNOWLEDGED';}
    else if(['AUTH_IN_PROGRESS','USER_ACTION_REQUIRED'].includes(r.status)&&time-Date.parse(r.payload.lastHeartbeat||r.payload.claimedAt||r.created_at)>=this.runnerLeaseMs){status=r.payload.browserOpenedAt?'AUTH_FAILED':'AUTH_LAUNCH_FAILED';failureCode='RUNNER_LOST';}
    else if(r.status==='SESSION_VALIDATING'&&time-Date.parse(r.payload.validatingAt)>=45000){status='AUTH_FAILED';failureCode='SESSION_VALIDATION_FAILED';}
    if(status){this.update(r.id,status,{...r.payload,failureCode,lastRunnerEvent:failureCode});this.db.prepare('UPDATE source_auth_requests SET ticket_hash=NULL WHERE id=?').run(r.id);this.event(r.provider,status,r,{level:'WARN',errorCode:failureCode});return this.request(r.id);}
    return r;
  }
  request(id){const row=this.db.prepare('SELECT * FROM source_auth_requests WHERE id=?').get(id);if(!row)fail('AUTH_REQUEST_NOT_FOUND',404);return {...row,payload:JSON.parse(row.payload_json)};}
  update(id,status,payload){this.db.prepare('UPDATE source_auth_requests SET status=?,payload_json=? WHERE id=?').run(status,JSON.stringify(payload||this.request(id).payload),id);}
  publicRequest(r){const managed=managedProviders.has(r.provider);return {id:r.id,provider:r.provider,tenant:r.tenant,intent:r.intent,status:r.status,expiresAt:r.expires_at,loginUrl:r.payload.loginUrl,userCode:r.payload.userCode,authMode:r.payload.mode,nextAction:r.status==='CONNECTED'||r.status==='SESSION_ACTIVE'?'COMPLETE':'USER_ACTION_REQUIRED',...(managed?{purpose:r.payload.purpose||'LOGIN',jobId:r.payload.jobId||'',company:r.payload.company||sessionProviderById(r.provider)?.name||r.tenant,requestedAt:r.created_at,claimedAt:r.payload.claimedAt||null,browserOpenedAt:r.payload.browserOpenedAt||null,lastHeartbeat:r.payload.lastHeartbeat||null,lastRunnerEvent:r.payload.lastRunnerEvent||null,failureCode:r.payload.failureCode||null,launcherState:r.status,canLaunch:r.status==='LAUNCH_PENDING'&&!r.ticket_hash}: {})};}
  target(jobId){if(!jobId)fail('GUPY_TARGET_SELECTION_REQUIRED');const job=this.store.jobs.findById(jobId);if(!job)fail('GUPY_JOB_REQUIRED');try{return gupyTenant(job.applicationUrl||job.canonicalUrl||job.url);}catch{fail('GUPY_JOB_REQUIRED');}}
  async begin(provider,{intent='CONNECT',jobId='',force=false,purpose='LOGIN'}={}){
    if(this.db.prepare("SELECT COUNT(*) n FROM source_auth_requests WHERE created_at>?").get(new Date(Date.now()-600000).toISOString()).n>=12)fail('AUTH_RATE_LIMITED',429);
    if(!(provider==='github'||managedProviders.has(provider))||!['CONNECT','SYNC'].includes(intent)||managedProviders.has(provider)&&intent==='SYNC')fail('AUTH_OPERATION_UNSUPPORTED',400);
    if(provider==='github'&&intent==='SYNC'&&!force&&this.status(provider).status==='CONNECTED'){
      const r={id:`source-sync-${randomUUID()}`,provider,intent};return this.sync(r);
    }
    const policy=sessionProviderById(provider),tenant=provider==='gupy'?(jobId?this.target(jobId):GUPY_ACCOUNT_SCOPE):policy?.accountScope||'';
    if(managedProviders.has(provider)){
      const connected=this.status(provider,tenant);if(!force&&connected.status==='SESSION_ACTIVE')return {provider,tenant,jobId,status:'SESSION_ACTIVE',scope:connected.scope,nextAction:'COMPLETE'};
      const previous=this.latestSessionRequest(provider);
      if(previous&&sessionPending.has(previous.status)){
        // Repeated clicks must not revoke the one-time handoff already sent to the browser.
        return this.publicRequest(previous);
      }
      const id=`source-auth-${randomUUID()}`,created=new Date(this.clock()).toISOString(),expires=new Date(this.clock()+600000).toISOString(),job=jobId?this.store.jobs.findById(jobId):null,loginUrl=provider==='gupy'&&jobId?`https://${tenant}/candidates/signin`:purpose==='CREATE_ACCOUNT'?policy.signupUrl:policy.loginUrl,payload={mode:'LOCAL_RUNNER',loginUrl,purpose:purpose==='CREATE_ACCOUNT'?'CREATE_ACCOUNT':'LOGIN',jobId,company:job?.company||policy.name,lastRunnerEvent:'AUTH_REQUEST_CREATED'};
      this.db.prepare('INSERT INTO source_auth_requests VALUES(?,?,?,?,?,NULL,?,?,?)').run(id,provider,tenant,intent,'LAUNCH_PENDING',JSON.stringify(payload),created,expires);
      this.event(provider,'AUTH_REQUEST_CREATED',{id,intent},{status:'LAUNCH_PENDING'});return this.publicRequest(this.request(id));
    }
    const active=this.db.prepare("SELECT id FROM source_auth_requests WHERE provider=? AND tenant=? AND status IN ('AUTH_REQUIRED','AUTH_IN_PROGRESS') AND expires_at>? LIMIT 1").get(provider,tenant,now());
    if(active){const existing=this.request(active.id);if(intent==='SYNC'&&existing.intent!=='SYNC'){this.db.prepare("UPDATE source_auth_requests SET intent='SYNC' WHERE id=?").run(existing.id);existing.intent='SYNC';}return this.publicRequest(existing);}
    const id=`source-auth-${randomUUID()}`,expires=new Date(Date.now()+600000).toISOString(),payload={mode:provider==='gupy'?'LOCAL_RUNNER':this.githubClientId?'DEVICE_FLOW':'TOKEN',loginUrl:provider==='gupy'?`https://${tenant}/candidates/signin`:this.githubClientId?'https://github.com/login/device':'https://github.com/settings/personal-access-tokens/new'};
    if(provider==='github'&&this.githubClientId){
      const device=await this.githubPost('/login/device/code',{client_id:this.githubClientId,scope:'read:user'});
      if(!device.device_code||!device.user_code)fail('GITHUB_DEVICE_FLOW_UNAVAILABLE');
      await this.vault.put(id,device.device_code);payload.userCode=device.user_code;payload.interval=Math.max(5,Number(device.interval)||5);payload.nextPoll=Date.now()+payload.interval*1000;
    }
    this.db.prepare('INSERT INTO source_auth_requests VALUES(?,?,?,?,?,NULL,?,?,?)').run(id,provider,tenant,intent,'AUTH_REQUIRED',JSON.stringify(payload),now(),expires);
    this.event(provider,'AUTH_REQUIRED',{id,intent});return this.publicRequest(this.request(id));
  }
  async githubPost(path,body){const res=await this.fetchImpl(`https://github.com${path}`,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(15000),redirect:'error'});if(!res.ok)fail('GITHUB_AUTH_UNAVAILABLE',503);return res.json();}
  async poll(id){
    const r=this.request(id);if(r.provider==='gupy')return this.publicRequest(this.refreshGupyRequest(r));if(!['AUTH_REQUIRED','AUTH_IN_PROGRESS'].includes(r.status))return this.publicRequest(r);
    if(Date.parse(r.expires_at)<=Date.now()){this.update(id,'SESSION_EXPIRED');await this.vault.remove(id);return this.publicRequest(this.request(id));}
    if(r.payload.mode!=='DEVICE_FLOW'||Date.now()<r.payload.nextPoll||this.busy.has(id))return this.publicRequest(r);
    this.busy.add(id);
    try{
      r.payload.nextPoll=Date.now()+r.payload.interval*1000;this.update(id,'AUTH_IN_PROGRESS',r.payload);
      const response=await this.githubPost('/login/oauth/access_token',{client_id:this.githubClientId,device_code:this.vault.get(id),grant_type:'urn:ietf:params:oauth:grant-type:device_code'});
      if(response.access_token)return await this.completeToken(id,response.access_token);
      if(response.error==='slow_down'){r.payload.interval+=5;r.payload.nextPoll=Date.now()+r.payload.interval*1000;this.update(id,'AUTH_IN_PROGRESS',r.payload);}
      else if(response.error!=='authorization_pending'){this.update(id,'ERROR');await this.vault.remove(id);this.event('github','GITHUB_AUTH_FAILED',r,{level:'ERROR',errorCode:'GITHUB_AUTH_FAILED'});}
      return this.publicRequest(this.request(id));
    }finally{this.busy.delete(id);}
  }
  async completeToken(id,value){
    const r=this.request(id);if(r.provider!=='github'||!['AUTH_REQUIRED','AUTH_IN_PROGRESS'].includes(r.status)||Date.parse(r.expires_at)<=Date.now())fail('AUTH_REQUEST_EXPIRED');
    await this.connections.connect('github',value);this.store.database.setMetadata('github_disconnected','false');this.update(id,'CONNECTED');await this.vault.remove(id);this.event('github','CONNECTED',r);this.logs.resolve('github',['GITHUB_AUTH_FAILED']);
    if(r.intent==='SYNC')return this.sync(r);return this.publicRequest(this.request(id));
  }
  async sync(r){
    this.event('github','GITHUB_SYNC_STARTED',r);const start=Date.now();
    try{const result=await this.githubEvidence.sync();this.event('github','GITHUB_SYNC_COMPLETED',r,{durationMs:Date.now()-start,status:result.status||'READY'});return {id:r.id,status:result.status||'READY',intent:'SYNC',nextAction:'COMPLETE'};}
    catch(error){this.event('github','GITHUB_SYNC_FAILED',r,{level:'ERROR',errorCode:error.code||'GITHUB_SYNC_FAILED',durationMs:Date.now()-start});if([401,403].includes(error.status))return this.begin('github',{intent:'SYNC',force:true});throw Object.assign(Error('GITHUB_SYNC_FAILED'),{code:'GITHUB_SYNC_FAILED',status:502});}
  }
  issueTicket(id){const r=this.refreshSessionRequest(this.request(id));if(!managedProviders.has(r.provider)||r.status!=='LAUNCH_PENDING'||r.ticket_hash)fail('AUTH_REQUEST_EXPIRED');const ticket=randomBytes(32).toString('hex');this.db.prepare('UPDATE source_auth_requests SET ticket_hash=? WHERE id=?').run(hash(ticket),id);return ticket;}
  authorize(id,ticket,status){const r=this.refreshSessionRequest(this.request(id));if(!managedProviders.has(r.provider)||!ticket||r.ticket_hash!==hash(ticket)||!(Array.isArray(status)?status:[status]).includes(r.status)||Date.parse(r.expires_at)<=this.clock())fail('AUTH_HANDOFF_INVALID',403);return r;}
  claim(id,ticket){const r=this.authorize(id,ticket,'LAUNCH_PENDING'),at=new Date(this.clock()).toISOString();this.update(id,'AUTH_IN_PROGRESS',{...r.payload,claimedAt:at,lastHeartbeat:at,lastRunnerEvent:'RUNNER_CLAIMED'});this.event(r.provider,'RUNNER_CLAIMED',r,{status:'AUTH_IN_PROGRESS'});return {provider:r.provider,tenant:r.tenant,loginUrl:r.payload.loginUrl,expiresAt:r.expires_at};}
  runnerEvent(id,ticket,input={}){
    const r=this.authorize(id,ticket,['LAUNCH_PENDING','AUTH_IN_PROGRESS','USER_ACTION_REQUIRED','SESSION_VALIDATING']),at=new Date(this.clock()).toISOString();
    if(input.event==='FAILED'){
      if(!runnerFailures.has(input.code))fail('AUTH_RUNNER_EVENT_INVALID',400);
      // A second launcher that lost the claim cannot cancel the runner that owns it.
      if(r.payload.claimedAt&&['CLAIM_FAILED','NODE_NOT_FOUND','RUNNER_START_FAILED','PROTOCOL_HANDLER_FAILED'].includes(input.code))fail('AUTH_RUNNER_EVENT_INVALID',409);
      const status=r.payload.browserOpenedAt?'AUTH_FAILED':'AUTH_LAUNCH_FAILED';this.update(id,status,{...r.payload,failureCode:input.code,lastRunnerEvent:input.code,lastHeartbeat:at});this.db.prepare('UPDATE source_auth_requests SET ticket_hash=NULL WHERE id=?').run(id);this.event(r.provider,status,r,{status,level:'WARN',errorCode:input.code});
    }else if(input.event==='BROWSER_OPENED'&&r.status==='AUTH_IN_PROGRESS'){
      this.update(id,'USER_ACTION_REQUIRED',{...r.payload,browserOpenedAt:at,lastHeartbeat:at,lastRunnerEvent:'BROWSER_OPENED'});this.event(r.provider,'BROWSER_OPENED',r,{status:'USER_ACTION_REQUIRED'});
    }else if(input.event==='HEARTBEAT'&&['AUTH_IN_PROGRESS','USER_ACTION_REQUIRED'].includes(r.status))this.update(id,r.status,{...r.payload,lastHeartbeat:at,lastRunnerEvent:'HEARTBEAT'});
    else fail('AUTH_RUNNER_EVENT_INVALID',409);
    return this.publicRequest(this.request(id));
  }
  async completeSession(id,ticket,state){
    const r=this.authorize(id,ticket,'USER_ACTION_REQUIRED');if(this.busy.has(id))fail('AUTH_COMPLETION_IN_PROGRESS');this.busy.add(id);
    try{
      const policy=sessionProviderById(r.provider),safe=validateProviderState(state,r.provider);this.update(id,'SESSION_VALIDATING',{...r.payload,validatingAt:new Date(this.clock()).toISOString()});this.event(r.provider,'SESSION_VALIDATING',r,{status:'SESSION_VALIDATING'});
      if(!await this.verifySession(safe,policy.accountScope,r.provider))fail('AUTHENTICATED_STATE_NOT_CONFIRMED');
      this.authorize(id,ticket,'SESSION_VALIDATING');const ref=`session-${randomUUID()}`,previous=this.db.prepare('SELECT credential_ref FROM provider_sessions WHERE provider=? AND tenant=?').get(r.provider,policy.accountScope);
      await this.vault.put(ref,JSON.stringify(safe));
      try{this.authorize(id,ticket,'SESSION_VALIDATING');}catch(error){await this.vault.remove(ref);throw error;}
      this.db.prepare("INSERT INTO provider_sessions VALUES(?,?,'SESSION_ACTIVE',?,?,?) ON CONFLICT(provider,tenant) DO UPDATE SET status=excluded.status,credential_ref=excluded.credential_ref,verified_at=excluded.verified_at,expires_at=excluded.expires_at").run(r.provider,policy.accountScope,ref,now(),new Date(Date.now()+policy.sessionHours*3600000).toISOString());
      if(previous?.credential_ref)await this.vault.remove(previous.credential_ref);
      this.update(id,'SESSION_ACTIVE');this.db.prepare('UPDATE source_auth_requests SET ticket_hash=NULL WHERE id=?').run(id);this.event(r.provider,'SESSION_ACTIVE',r);this.logs.resolve(r.provider,['SESSION_EXPIRED','AUTH_REQUIRED']);
      await this.onAuthenticated?.(r.provider,r.tenant);return {status:'SESSION_ACTIVE',scope:'ACCOUNT',provider:r.provider};
    }catch(error){const current=this.request(id);if(current.status==='SESSION_VALIDATING'){this.update(id,'AUTH_FAILED',{...current.payload,failureCode:'SESSION_VALIDATION_FAILED'});this.db.prepare('UPDATE source_auth_requests SET ticket_hash=NULL WHERE id=?').run(id);this.event(r.provider,'AUTH_FAILED',r,{level:'WARN',errorCode:'SESSION_VALIDATION_FAILED'});}throw error;}finally{this.busy.delete(id);}
  }
  storageState(provider,tenant){const policy=sessionProviderById(provider);if(!policy)return undefined;const r=this.db.prepare('SELECT * FROM provider_sessions WHERE provider=? AND tenant=? LIMIT 1').get(provider,policy.accountScope);if(!r||r.status!=='SESSION_ACTIVE')return undefined;if(Date.parse(r.expires_at)<=Date.now()){this.expire(provider,r.tenant);return undefined;}return validateProviderState(JSON.parse(this.vault.get(r.credential_ref)),provider);}
  expire(provider,tenant){const policy=sessionProviderById(provider),scope=policy?.accountScope||tenant;const changed=this.db.prepare("UPDATE provider_sessions SET status='SESSION_EXPIRED' WHERE provider=? AND tenant=? AND status='SESSION_ACTIVE'").run(provider,scope).changes;this.event(provider,changed?'SESSION_EXPIRED':'AUTH_REQUIRED',{}, {level:'WARN',errorCode:changed?'SESSION_EXPIRED':'AUTH_REQUIRED'});}
  async check(provider){
    if(provider==='github'){if(this.status(provider).status!=='CONNECTED')return this.status(provider);await this.connections.validateCredential('github',this.connections.secret('github')||process.env.GITHUB_TOKEN);return this.status(provider);}
    if(!managedProviders.has(provider))fail('AUTH_OPERATION_UNSUPPORTED',400);
    for(const r of this.db.prepare("SELECT tenant FROM provider_sessions WHERE provider=? AND status='SESSION_ACTIVE'").all(provider)){
      const state=this.storageState(provider,r.tenant);if(state&&!await this.verifySession(state,r.tenant,provider))this.expire(provider,r.tenant);
    }return this.status(provider);
  }
  async disconnect(provider){
    if(!(provider==='github'||managedProviders.has(provider)))fail('AUTH_OPERATION_UNSUPPORTED',400);
    this.db.prepare("UPDATE source_auth_requests SET status='CANCELLED',ticket_hash=NULL WHERE provider=?").run(provider);
    for(const r of this.db.prepare('SELECT credential_ref FROM provider_sessions WHERE provider=?').all(provider))await this.vault.remove(r.credential_ref);
    this.db.prepare('DELETE FROM provider_sessions WHERE provider=?').run(provider);
    for(const r of this.db.prepare('SELECT id FROM source_auth_requests WHERE provider=?').all(provider))await this.vault.remove(r.id);
    this.db.prepare("UPDATE source_auth_requests SET status='CANCELLED',ticket_hash=NULL WHERE provider=?").run(provider);
    if(provider==='github'){await this.connections.remove(provider);this.store.database.setMetadata('github_disconnected','true');}
    this.event(provider,'DISCONNECTED');await this.onDisconnected?.(provider);return {status:'AUTH_REQUIRED'};
  }
  async verifyInBrowser(state,tenant,providerId='gupy'){const policy=sessionProviderById(providerId);if(!policy)return false;const {chromium}=await import('playwright');const browser=await chromium.launch({headless:true});try{const context=await browser.newContext({storageState:state});const page=await context.newPage();await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(request.isNavigationRequest()&&request.frame()===page.mainFrame()&&(url.protocol!=='https:'||!hostAllowed(policy,url.hostname)))return route.abort();return route.continue();});const verificationUrl=providerId==='gupy'?'https://portal.gupy.io/my/applications':policy.loginUrl;await page.goto(verificationUrl,{waitUntil:'domcontentloaded',timeout:15000});return await authenticatedProviderPage(page,providerId);}finally{await browser.close();}}
}
