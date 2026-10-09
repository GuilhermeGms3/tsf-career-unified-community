import {api} from '../../api/client.js';
import {escapeHtml as e,pageHeader,humanLabel as label,humanError,formatDateTime,pill,technicalDetails} from '../../app/ui.js';
import {onRouteChange,navigate} from '../../app/router.js';
let generation=0,timer;
onRouteChange(()=>{generation++;clearTimeout(timer);});
const post=(path,body={})=>api(path,{method:'POST',body:JSON.stringify(body)});
const pending=new Set(['AUTH_REQUIRED','LAUNCH_PENDING','AUTH_IN_PROGRESS','USER_ACTION_REQUIRED','SESSION_VALIDATING']);
const retryable=new Set(['AUTH_LAUNCH_FAILED','AUTH_FAILED','AUTH_REQUEST_EXPIRED','SESSION_EXPIRED','CANCELLED']);
const showError=(target,error)=>{const view=humanError(error);target.innerHTML=`<p>${e(view.message)} ${e(view.nextAction)}</p>${technicalDetails(view.code)}`;};
const button=(s,action,text)=>`<button class="button" data-provider="${e(s.providerId)}" data-action="${action}">${text}</button>`;
const descriptions={
  workday:'Identifica a página de cada empresa. O preenchimento de candidaturas ainda não está disponível.',
  linkedin:'Busca vagas públicas e permite importar publicações de recrutadores.',
  github:'Conecte seus repositórios para reunir evidências das suas habilidades.',
  jobspy:'Busca gratuita em portais de vagas, com disponibilidade variável por portal.',
  indeed:'Busca de vagas públicas, com cobertura limitada.',
  glassdoor:'Busca de vagas públicas, com cobertura limitada.',
  google:'Busca de vagas públicas, com cobertura limitada.',
  lever:'Consulta vagas publicadas nas páginas das empresas no Lever.',
  ashby:'Consulta vagas publicadas nas páginas das empresas no Ashby.',
  smartrecruiters:'Consulta vagas publicadas nas páginas das empresas no SmartRecruiters.',
  whatsapp:'Abre o gerenciador de grupos existente, sem importar o histórico de conversas.',
  vagas:'A integração direta ainda não está disponível; vagas podem chegar por fontes públicas.',
  catho:'A busca pela conta do candidato ainda não está disponível.',
  iel:'Encontra vagas públicas; a candidatura continua no site do IEL.',
  programathor:'Encontra vagas públicas sem acessar a conta do candidato.',
  solides:'Busca vagas públicas sem utilizar dados ou credenciais do candidato.',
  recrutei:'Encontra vagas públicas sem acessar áreas restritas.',
  eureca:'Ainda não há um catálogo público atual de vagas disponível nesta integração.',
  geekhunter:'Uso manual ou busca pública; a integração direta ainda não foi validada.',
  remotar:'Busca pública direta de vagas remotas; a candidatura abre no ATS de origem.',
  nerdin:'Busca pública de vagas de tecnologia; candidatura continua no site da Nerdin.',
};

function setGupyState(root,state){
  const card=root.querySelector('[data-gupy-card]');
  if(!card)return;
  const busy=state==='STARTING'||pending.has(state);
  card.dataset.busy=String(busy);
  const waiting=state==='USER_ACTION_REQUIRED';
  const text=!busy?'Conectar conta Gupy':waiting?'Aguardando você…':state==='SESSION_VALIDATING'?'Verificando conexão…':'Abrindo…';
  for(const control of card.querySelectorAll('[data-action], [data-gupy-target], [data-auth-retry]')){
    control.disabled=busy;
    if(control.dataset.action==='connect'||control.hasAttribute('data-auth-retry')){
      control.setAttribute('aria-busy',String(busy));
      control.innerHTML=busy?`${waiting?'':'<span class="connection-spinner" aria-hidden="true"></span>'}${text}`:control.hasAttribute('data-auth-retry')?'Tentar novamente':text;
    }
  }
}

export async function renderConnections({root,forceFresh=false}){
  const version=++generation;clearTimeout(timer);
  const jobId=new URLSearchParams(location.search).get('jobId')||'';
  const {sources,gupyContext={targets:[],selected:null,request:null}}=await api('/api/connections'+(jobId?'?jobId='+encodeURIComponent(jobId):''),forceFresh?{cache:false}:{});
  if(version!==generation)return;
  const groups=[['CANDIDATURAS','Candidaturas','Acesso às plataformas e preparação de formulários.'],['EVIDÊNCIAS','Evidências profissionais','Repositórios e informações que comprovam suas habilidades.'],['DESCOBERTA','Busca de vagas','Portais usados para encontrar oportunidades.'],['OUTRAS FONTES','Outras fontes','Recursos complementares e importação manual.']];
  root.innerHTML=`<div class="page connections-page">
    ${pageHeader({eyebrow:'Descoberta',title:'Fontes',description:'Veja de onde as oportunidades são descobertas e a saúde de cada coleta pública. Contas e sessões ficam separadas em Cofres.'})}
    <p class="safety-banner">A busca principal é gratuita. Conectar uma conta não envia candidaturas.</p>
    <div class="button-row"><button class="button" data-refresh>Atualizar estado local</button><a class="button" data-link href="/vaults">Gerenciar cofres</a><a class="button" data-link href="/observability">Registros e diagnóstico</a></div>
    <div role="status" aria-live="polite" data-status></div><div data-general-auth-panel></div>
    ${groups.map(([key,title,description])=>{const items=sources.filter(s=>s.group===key&&!s.optional);return items.length?`<section class="connection-section" aria-label="${title}"><header class="connection-section-heading"><h2>${title}</h2><p>${description}</p></header><div class="connection-grid">${items.map(s=>card(s,gupyContext)).join('')}</div></section>`:'';}).join('')}
    <details class="connection-options"><summary>Provedores opcionais</summary><p>Brave não é necessário para o fluxo principal.</p></details>
  </div>`;
  const status=root.querySelector('[data-status]');
  root.querySelector('[data-refresh]').onclick=()=>renderConnections({root,forceFresh:true}).catch(error=>showError(status,error));
  root.querySelector('[data-gupy-target]')?.addEventListener('change',event=>{if(event.target.value)navigate('/connections?jobId='+encodeURIComponent(event.target.value));});
  const startGupy=async()=>{
    if(root.querySelector('[data-gupy-card]')?.dataset.busy==='true')return;
    const feedback=root.querySelector('[data-gupy-feedback]');
    setGupyState(root,'STARTING');
    feedback.textContent='Abrindo… Aguarde a autorização do navegador para iniciar a janela da Gupy.';
    status.textContent='';
    try{
      const result=await post('/api/connections/gupy/connect',{jobId:gupyContext.selected?.jobId||''});
      if(version!==generation||!root.isConnected)return;
      feedback.textContent='';
      showAuth(root,result,version,startGupy);
      // This is best-effort: browser permission may require the direct user-gesture link below.
      if(result.launchUrl)try{location.href=result.launchUrl;}catch{feedback.textContent='Autorize a abertura usando o botão abaixo. Não é preciso iniciar outra tentativa.';}
    }catch(error){
      if(version!==generation||!root.isConnected)return;
      setGupyState(root,'AUTH_LAUNCH_FAILED');showError(feedback,error);
    }
  };
  for(const control of root.querySelectorAll('[data-action]'))control.onclick=async()=>{
    const provider=control.dataset.provider,action=control.dataset.action;
    if(provider==='gupy'&&action==='connect')return startGupy();
    if(provider==='gupy'&&root.querySelector('[data-gupy-card]')?.dataset.busy==='true')return;
    control.disabled=true;status.textContent='Processando solicitação…';
    try{
      if(action==='disconnect'&&!confirm('Desconectar esta fonte? Histórico, evidências e currículos serão preservados.'))return;
      const result=await post(`/api/connections/${provider}/${action}`,{jobId,force:action==='connect'});
      if(version!==generation||!root.isConnected)return;
      if(result.loginUrl){showAuth(root,result,version,startGupy);status.textContent='Conclua a autorização na página oficial.';window.open(result.loginUrl,'_blank','noopener,noreferrer');}
      else await renderConnections({root,forceFresh:true});
    }catch(error){if(version===generation&&root.isConnected)showError(status,error);}finally{control.disabled=false;}
  };
  if(gupyContext.request&&gupyContext.request.status!=='SESSION_EXPIRED')showAuth(root,gupyContext.request,version,startGupy);
}

function card(s,context){
  const details=s.evidence?.details||{},gupy=s.providerId==='gupy';
  const surfaceDetails=(s.surfaces||[]).map(surface=>{const latest=surface.observation||{};return `<article class="source-surface"><header><strong>${e(surface.display_name)}</strong><span>${e(label(surface.status,'source'))}</span></header><dl class="compact-definition"><div><dt>Última tentativa</dt><dd>${latest.finishedAt?e(formatDateTime(latest.finishedAt)):'Nunca'}</dd></div><div><dt>Último sucesso real</dt><dd>${latest.lastSuccessAt?e(formatDateTime(latest.lastSuccessAt)):'Não comprovado'}</dd></div><div><dt>Válidas / novas</dt><dd>${latest.lastValidCount||0} / ${latest.lastNewCount||0}</dd></div><div><dt>Páginas / limite</dt><dd>${latest.pagesScanned||0} / ${latest.resultsLimit||surface.current_limit||0}</dd></div><div><dt>Falhas consecutivas</dt><dd>${latest.consecutiveFailures||0}</dd></div><div><dt>Erro</dt><dd>${e(latest.lastErrorCode||'Nenhum registrado')}</dd></div></dl></article>`;}).join('');
  const selectedSession=gupy?s.session?.sessions?.find(session=>session.tenant===context.selected?.tenant):null;
  const accountActive=gupy&&s.session?.scope==='ACCOUNT'&&s.session?.status==='SESSION_ACTIVE';
  const accountState=gupy?(accountActive?'Conta Gupy conectada':label(s.authentication||s.session?.status||'AUTH_REQUIRED','auth')):'';
  const authText=gupy?(context.selected?(selectedSession?label(selectedSession.status,'auth'):accountActive?'Conta conectada; acesso desta empresa será verificado ao preparar':'Acesso ainda não verificado'):'Escolha a empresa da candidatura'):label(s.authentication,'source');
  const selector=gupy?`<div class="gupy-options"><div class="gupy-account"><h4>Sua conta Gupy</h4><p>Conecte sua conta em uma janela separada e protegida. Você entra diretamente na Gupy.</p>
    ${accountActive?'<p class="connection-hint" data-account-status>Conta Gupy conectada.</p>':button(s,'connect','Conectar conta Gupy')}
    <div role="status" aria-live="polite" data-gupy-feedback></div><div data-auth-panel></div></div>
    <div class="gupy-assisted"><h4>Preparar candidaturas no aplicativo</h4><p>Depois de conectar sua conta, escolha a empresa da vaga. O acesso será validado antes de qualquer preparação.</p>
    <label>Empresa da candidatura<select data-gupy-target><option value="">Escolha uma empresa</option>${context.targets.map(t=>`<option value="${e(t.jobId)}" ${context.selected?.tenant===t.tenant?'selected':''}>${e(t.company)}</option>`).join('')}</select></label>
    ${context.selected?`<p class="connection-hint" data-tenant-preview>Verificação para <strong>${e(context.selected.company)}</strong> · ${e(context.selected.tenant)}</p>`:'<p class="connection-hint">Escolha a empresa da vaga que deseja preparar.</p>'}
    </div></div>`:'';
  const facts=gupy?`<div><dt>Integração</dt><dd>Disponível para analisar e preparar candidaturas</dd></div><div><dt>Sua conta</dt><dd>${e(accountState)}</dd></div><div><dt>Vaga selecionada</dt><dd data-selected-auth>${e(authText)}</dd></div>`:`<div><dt>Autenticação</dt><dd>${e(authText)} · ${e(label(s.authMode,'source'))}</dd></div><div><dt>Funcionamento</dt><dd>${e(label(s.operationalReadiness||s.health,'connection'))}${s.lastCheck?.checkedAt?` · verificado em ${e(formatDateTime(s.lastCheck.checkedAt))}`:' · ainda não verificado'}</dd></div>`;
  return `<article class="panel connection-card" ${gupy?'data-gupy-card':''}><header class="connection-card-heading"><div class="connection-card-title"><h3>${e(s.displayName)}</h3>${gupy?pill('Integração disponível','success'):''}</div><p>${gupy?'Uma conta Gupy, com acesso e preparação de candidaturas separados.':e(descriptions[s.providerId]||s.description)}</p></header>${selector}
    <dl class="connection-facts">${facts}</dl>
    ${s.providerId==='github'?`<p>Evidências: ${e(label(s.evidence?.status||'NOT_INDEXED','evidence'))} · ${details.indexed||0} repositórios analisados · ${details.evidenceFacts||0} fatos</p><p>Última sincronização: ${details.lastSyncAt?e(formatDateTime(details.lastSyncAt)):'Ainda não realizada'}</p>`:''}${surfaceDetails?`<details class="source-operational"><summary>${gupy?'Descoberta pública de vagas':'Saúde operacional da descoberta'}</summary>${gupy?'<p>A descoberta global da Gupy é separada da conexão. Isso não impede analisar e preparar vagas Gupy já encontradas por outras fontes.</p>':''}<div class="source-surface-list">${surfaceDetails}</div></details>`:''}
    ${s.providerId==='linkedin'?'<p>Publicações de recrutadores: importação manual. Ollama é opcional; o aplicativo não gerencia o acesso à conta LinkedIn.</p>':''}
    <div class="button-row">${s.canAuthenticate?(gupy?(accountActive?`${button(s,'check','Verificar sessão')}${button(s,'disconnect','Desconectar')}`:''):`${s.providerId==='github'?button(s,'sync','Sincronizar'):''}${button(s,'connect','Conectar / Autorizar novamente')}${button(s,'check','Verificar sessão')}${button(s,'disconnect','Desconectar')}`):s.canDiscover?'<a class="button" data-link href="/opportunities?section=discover">Buscar vagas</a>':'<span>Autenticação automática não gerenciada.</span>'}${s.manualCapture?'<a class="button" data-link href="/opportunities">Importar oportunidade</a>':''}</div>
    ${gupy?`<details><summary>Acesso às empresas</summary><p>A conta é compartilhada; cada página de empresa será validada somente quando você preparar uma vaga.</p><ul class="connection-session-list">${context.targets.map(t=>{const session=s.session?.sessions?.find(x=>x.tenant===t.tenant);return `<li><strong>${e(t.company)}</strong><span>${e(session?label(session.status,'auth'):'Será validado ao preparar')}</span></li>`;}).join('')||'<li>Nenhuma empresa disponível nas vagas salvas.</li>'}</ul></details>`:''}
    <details><summary>Recursos disponíveis</summary><dl>${Object.entries(s.capabilities).filter(([,state])=>state!=='NOT_SUPPORTED').map(([key,state])=>`<div><dt>${e(label(key,'source'))}</dt><dd>${e(label(state,'source'))}</dd></div>`).join('')||'<p>Detecção ou uso manual apenas.</p>'}</dl></details>
    ${technicalDetails({configuration:s.configuration,authentication:s.authentication,availability:s.availability,health:s.health,operationalReadiness:s.operationalReadiness,authMode:s.authMode,capabilities:s.capabilities})}</article>`;
}

function recovery(request){
  const command=request.launchUrl?`powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\source-auth-launch.ps1 -Handoff '${request.launchUrl}'`:'';
  return `<details data-auth-recovery><summary>Ver como resolver</summary><p>Se nenhuma janela abriu, a autenticação ainda não começou. Use Chrome ou Edge e autorize a abertura do aplicativo externo quando solicitado.</p><p>Alternativa independente do link: abra o PowerShell na pasta deste projeto e execute o auxiliar diretamente. Não compartilhe o comando temporário.</p>${command?`<label>Comando para iniciar esta tentativa<textarea readonly rows="4" data-auth-command>${e(command)}</textarea></label><button class="button" data-copy-command>Copiar comando</button>`:`<p>${pending.has(request.status)?'Aguarde a conclusão ou o encerramento desta tentativa antes de iniciar outra. O comando temporário não é guardado ao recarregar a página.':'Use Tentar novamente para obter uma nova autorização temporária e o comando desta tentativa.'}</p>`}<p>Verifique a instalação:</p><code>Test-Path 'HKCU:\\Software\\Classes\\career-unified-auth\\shell\\open\\command'</code><p>Para instalar ou reparar, execute explicitamente no PowerShell, na pasta do projeto:</p><code>powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-source-auth.ps1</code><p>Nenhuma instalação é automática. O auxiliar não importa dados de sessão de outros navegadores. A senha, a verificação em duas etapas e a confirmação de que você é uma pessoa ficam sob seu controle.</p></details>`;
}

function showAuth(root,request,version,startGupy){
  clearTimeout(timer);
  const gupy=request.provider==='gupy',panel=root.querySelector(gupy?'[data-auth-panel]':'[data-general-auth-panel]');
  if(!panel)return;
  if(gupy)setGupyState(root,request.status);
  const canOpen=gupy&&request.status==='LAUNCH_PENDING'&&request.launchUrl;
  panel.innerHTML=`<section class="connection-auth ${request.failureCode?'connection-auth-error':''}"><h4>${gupy?`Conexão assistida · ${e(request.company||request.tenant)}`:'Autorizar GitHub'}</h4>
    ${gupy?'':'<p>Conclua a autorização na página oficial. Nunca informe sua senha ao aplicativo.</p>'}
    <p role="status" aria-live="polite" data-auth-status>${e(label(request.status,gupy?'auth':'source'))}</p>
    ${request.failureCode?`<p role="alert">${e(label(request.failureCode,'auth'))}</p>`:''}
    ${canOpen?`<p>Se a janela não apareceu, clique abaixo e permita a abertura do auxiliar no aviso do navegador. Isso continua a mesma tentativa.</p><a class="button primary" data-authorize-launch href="${e(request.launchUrl)}">Autorizar abertura da janela</a>`:''}
    ${gupy?`${retryable.has(request.status)?'<button class="button primary" data-auth-retry>Tentar novamente</button>':''}${pending.has(request.status)||retryable.has(request.status)?recovery({...request,launchUrl:canOpen?request.launchUrl:undefined}):''}`:`<a class="button primary" href="${e(request.loginUrl)}" target="_blank" rel="noopener noreferrer">Abrir autenticação oficial</a>`}
    <p class="connection-hint">Validade da tentativa: ${e(formatDateTime(request.expiresAt))}</p>
    ${request.userCode?`<p>Código de autorização: <strong>${e(request.userCode)}</strong></p>`:''}
    ${request.authMode==='TOKEN'?'<details open><summary>Credencial GitHub somente leitura</summary><p>Crie a credencial na página oficial e autorize apenas os repositórios necessários. Ela será guardada no cofre cifrado.</p><form data-token><label>Credencial GitHub <input type="password" name="token" autocomplete="off" required maxlength="500"></label><button class="button primary">Salvar e continuar</button></form></details>':''}
    ${technicalDetails({requestId:request.id,tenant:request.tenant,status:request.status,requestedAt:request.requestedAt,claimedAt:request.claimedAt,browserOpenedAt:request.browserOpenedAt,lastHeartbeat:request.lastHeartbeat,expiresAt:request.expiresAt,failureCode:request.failureCode})}</section>`;
  panel.querySelector('[data-auth-retry]')?.addEventListener('click',startGupy);
  panel.querySelector('[data-authorize-launch]')?.addEventListener('click',event=>{
    const link=event.currentTarget;
    if(link.getAttribute('aria-disabled')==='true'){event.preventDefault();return;}
    link.setAttribute('aria-disabled','true');
    link.textContent='Autorização solicitada… Confira o aviso do navegador.';
  });
  panel.querySelector('[data-copy-command]')?.addEventListener('click',async event=>{try{await navigator.clipboard.writeText(panel.querySelector('[data-auth-command]').value);event.target.textContent='Comando copiado';}catch{panel.querySelector('[data-auth-command]').focus();panel.querySelector('[data-auth-command]').select();}});
  panel.querySelector('[data-token]')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,control=form.querySelector('button');control.disabled=true;try{await post(`/api/connections/requests/${request.id}/token`,{token:new FormData(form).get('token')});form.reset();if(version===generation&&root.isConnected)await renderConnections({root,forceFresh:true});}catch(error){if(version===generation&&root.isConnected)showError(panel.querySelector('[data-auth-status]'),error);}finally{control.disabled=false;}});
  if(!pending.has(request.status))return;
  const poll=async()=>{
    if(version!==generation||!root.isConnected)return;
    try{
      const result=await post(`/api/connections/requests/${request.id}/poll`);
      if(version!==generation||!root.isConnected)return;
      if(['SESSION_ACTIVE','CONNECTED','READY'].includes(result.status))await renderConnections({root,forceFresh:true});
      else if(result.status!==request.status)showAuth(root,result,version,startGupy);
      else{
        panel.querySelector('[data-auth-status]').textContent=label(request.status,gupy?'auth':'source');
        timer=setTimeout(poll,gupy?2000:5000);
      }
    }catch(error){
      if(version!==generation||!root.isConnected)return;
      showError(panel.querySelector('[data-auth-status]'),error);
      // A network failure does not cancel the pending request or unlock another launch.
      timer=setTimeout(poll,gupy?2000:5000);
    }
  };
  timer=setTimeout(poll,gupy?2000:5000);
}
