import {api} from '../../api/client.js';
import {escapeHtml as e,pageHeader,formatDateTime,pill,toast} from '../../app/ui.js';
import {onRouteChange} from '../../app/router.js';

let generation=0,timer;
onRouteChange(()=>{generation++;clearTimeout(timer);});
const post=(path,body={})=>api(path,{method:'POST',body:JSON.stringify(body)});
const pending=new Set(['LAUNCH_PENDING','AUTH_IN_PROGRESS','USER_ACTION_REQUIRED','SESSION_VALIDATING']);
const retryable=new Set(['AUTH_LAUNCH_FAILED','AUTH_FAILED','AUTH_REQUEST_EXPIRED','SESSION_EXPIRED','CANCELLED']);
const sessionDuration=hours=>Number(hours)%24===0?`${Number(hours)/24} dias`:`${hours} horas`;
const stateCopy={
  SESSION_ACTIVE:['Sessão ativa','success'],
  LAUNCH_PENDING:['Abrindo navegador','warning'],
  AUTH_IN_PROGRESS:['Iniciando conexão','warning'],
  USER_ACTION_REQUIRED:['Aguardando você','warning'],
  SESSION_VALIDATING:['Validando sessão','warning'],
  SESSION_EXPIRED:['Sessão expirada','danger'],
  AUTH_FAILED:['Conexão não confirmada','danger'],
  AUTH_LAUNCH_FAILED:['Navegador não abriu','danger'],
  AUTH_REQUEST_EXPIRED:['Tentativa expirada','danger'],
  AUTH_REQUIRED:['Não conectado','neutral'],
};
const statePill=status=>{const [text,tone]=stateCopy[status]||['Não conectado','neutral'];return pill(text,tone);};

export async function renderVaults({root,forceFresh=false}){
  const version=++generation;clearTimeout(timer);
  const data=await api('/api/vaults',forceFresh?{cache:false}:{});
  if(version!==generation)return;
  root.innerHTML=`<div class="page vaults-page">
    ${pageHeader({eyebrow:'Sessões protegidas',title:'Cofres',description:'Entre ou crie suas contas em uma janela isolada. O TSF guarda somente a sessão criptografada; senhas, CAPTCHA, MFA e códigos de e-mail ficam com você.'})}
    <section class="vault-summary" aria-label="Resumo dos cofres">
      <div><strong>${data.vaults.filter(item=>item.status.status==='SESSION_ACTIVE').length}</strong><span>sessões ativas</span></div>
      <div><strong>${data.vaults.filter(item=>pending.has(item.status.status)).length}</strong><span>aguardando ação</span></div>
      <div><strong>${data.vaults.filter(item=>item.status.status!=='SESSION_ACTIVE'&&!pending.has(item.status.status)).length}</strong><span>para conectar</span></div>
    </section>
    <div class="vault-toolbar"><p>Conectar uma conta não inicia candidatura nem busca.</p><button class="button" type="button" data-refresh>Atualizar sessões</button></div>
    <div role="status" aria-live="polite" data-vault-feedback></div>
    <section class="vault-grid" aria-label="Portais com sessão própria">${data.vaults.map(vaultCard).join('')}</section>
    ${data.contextual?.length?`<section class="vault-contextual"><h2>Sessões criadas durante a candidatura</h2>${data.contextual.map(item=>`<article><div><h3>${e(item.displayName)}</h3><p>${e(item.description)}</p></div>${pill('Por empresa','neutral')}</article>`).join('')}</section>`:''}
  </div>`;
  const feedback=root.querySelector('[data-vault-feedback]');
  root.querySelector('[data-refresh]').onclick=()=>renderVaults({root,forceFresh:true}).catch(error=>feedback.textContent=error.message);
  for(const control of root.querySelectorAll('[data-vault-action]'))control.onclick=()=>act(root,control,version);
  for(const vault of data.vaults){const request=vault.status.request;if(request&&pending.has(request.status))showRequest(root,request,version);}
}

function vaultCard(item){
  const status=item.status.status||'AUTH_REQUIRED',active=status==='SESSION_ACTIVE',request=pending.has(item.status.request?.status)?item.status.request:null;
  const latest=item.status.sessions?.sort((a,b)=>String(b.verifiedAt||'').localeCompare(String(a.verifiedAt||'')))[0];
  return `<article class="vault-card" data-vault="${e(item.id)}" data-status="${e(status)}">
    <header><div><p class="eyebrow">Conta de candidato</p><h2>${e(item.name)}</h2></div>${statePill(status)}</header>
    <p>${e(item.notes||'Sessão usada somente quando uma candidatura nesse portal exigir autenticação.')}</p>
    <dl><div><dt>Escopo</dt><dd>Uma conta neste portal</dd></div><div><dt>Validade local</dt><dd>${e(sessionDuration(item.sessionHours))}</dd></div><div><dt>Última verificação</dt><dd>${latest?.verifiedAt?e(formatDateTime(latest.verifiedAt)):'Ainda não verificada'}</dd></div></dl>
    <div class="vault-actions">
      ${active?`<button class="button" data-vault-action="check" data-provider="${e(item.id)}">Verificar</button><button class="button danger" data-vault-action="disconnect" data-provider="${e(item.id)}">Desconectar</button>`:`<button class="button primary" data-vault-action="connect" data-provider="${e(item.id)}" ${pending.has(status)?'disabled':''}>Entrar</button><button class="button" data-vault-action="create" data-provider="${e(item.id)}" ${pending.has(status)?'disabled':''}>Criar conta</button>`}
    </div>
    <div data-vault-request>${request?requestView(request):''}</div>
  </article>`;
}

async function act(root,control,version){
  const provider=control.dataset.provider,action=control.dataset.vaultAction,card=control.closest('[data-vault]');
  for(const button of card.querySelectorAll('button'))button.disabled=true;
  try{
    const result=await post(`/api/vaults/${provider}/${action}`,action==='connect'||action==='create'?{force:retryable.has(card.dataset.status)}:{});
    if(version!==generation||!root.isConnected)return;
    if(action==='disconnect'){toast(`${provider} desconectado.`);return renderVaults({root,forceFresh:true});}
    if(action==='check'){toast('Verificação concluída.');return renderVaults({root,forceFresh:true});}
    showRequest(root,result,version);
    if(result.launchUrl)location.href=result.launchUrl;
  }catch(error){root.querySelector('[data-vault-feedback]').textContent=error.message;for(const button of card.querySelectorAll('button'))button.disabled=false;}
}

function requestView(request){
  const canOpen=request.status==='LAUNCH_PENDING'&&request.launchUrl;
  return `<section class="vault-request"><p role="status">${e((stateCopy[request.status]||[request.status])[0])}</p>${request.status==='USER_ACTION_REQUIRED'?'<p>Conclua o cadastro, senha, CAPTCHA, MFA ou confirmação de e-mail na janela do portal. Esta página atualizará sozinha.</p>':''}${canOpen?`<a class="button primary" data-vault-launch href="${e(request.launchUrl)}">Abrir janela protegida</a>`:''}<small>A tentativa expira em ${e(formatDateTime(request.expiresAt))}.</small></section>`;
}

function showRequest(root,request,version){
  clearTimeout(timer);
  const card=root.querySelector(`[data-vault="${CSS.escape(request.provider)}"]`),panel=card?.querySelector('[data-vault-request]');
  if(!panel)return;
  panel.innerHTML=requestView(request);
  panel.querySelector('[data-vault-launch]')?.addEventListener('click',event=>{event.currentTarget.textContent='Abertura solicitada…';event.currentTarget.setAttribute('aria-disabled','true');});
  if(!pending.has(request.status)){if(retryable.has(request.status))renderVaults({root,forceFresh:true});return;}
  timer=setTimeout(async()=>{
    if(version!==generation||!root.isConnected)return;
    try{const result=await post(`/api/connections/requests/${request.id}/poll`);if(['SESSION_ACTIVE','CONNECTED'].includes(result.status)){toast(`${request.company||request.provider} conectado.`);await renderVaults({root,forceFresh:true});}else showRequest(root,result,version);}catch(error){root.querySelector('[data-vault-feedback]').textContent=error.message;timer=setTimeout(()=>showRequest(root,request,version),3000);}
  },2000);
}
