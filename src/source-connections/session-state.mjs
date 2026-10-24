import {hostAllowed,sessionProviderById} from './session-provider-registry.mjs';

export const GUPY_ACCOUNT_SCOPE='gupy.io';
const gupyAccountHosts=new Set(['login.gupy.io','portal.gupy.io']);
// Senha nunca entra no cofre. Tokens de SPA ficam: sao credencial de sessao como os cookies, cifrados no cofre.
const forbiddenStorageKey=/password|senha|passwd|pwd/i;
const keepStorage=items=>(items||[]).filter(value=>typeof value.name==='string'&&typeof value.value==='string'&&!forbiddenStorageKey.test(value.name)).map(({name,value})=>({name,value}));

// Cookie do proprio portal: dominio declarado (catho.com.br, .catho.com.br) ou cookie de host exato
// (www.catho.com.br) de um host oficial do Cofre. Sufixo publico (.com.br) nunca e host oficial.
export function providerOwnsCookieDomain(provider,domain){
  const value=String(domain||'').toLowerCase();
  return provider.cookieDomains.includes(value)||Boolean(value.replace(/^\./,''))&&hostAllowed(provider,value.replace(/^\./,''));
}
export function gupyTenant(value){
  try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^[a-z0-9-]+\.gupy\.io$/.test(u.hostname))return u.hostname;}catch{}
  throw Object.assign(Error('GUPY_TARGET_REQUIRED'),{code:'GUPY_TARGET_REQUIRED',status:400});
}
const validCookieShape=c=>typeof c.name==='string'&&typeof c.value==='string'&&c.name.length<=256&&c.value.length<=16000&&Boolean(c.secure)&&['Strict','Lax','None'].includes(c.sameSite)&&typeof c.path==='string'&&c.path.startsWith('/');
const safeCookie=c=>{if(!validCookieShape(c))throw Object.assign(Error('SESSION_COOKIE_INVALID'),{code:'SESSION_COOKIE_INVALID'});return {name:c.name,value:c.value,domain:c.domain,path:c.path,expires:Number(c.expires)||-1,httpOnly:Boolean(c.httpOnly),secure:true,sameSite:c.sameSite};};
const httpsHost=origin=>{try{const u=new URL(origin);return u.protocol==='https:'?u.hostname:'';}catch{return '';}};
// Escopo de conta Gupy: cookies de gupy.io e de host exato em login/portal.gupy.io, localStorage de qualquer
// origem https do Gupy. Escopo de empresa: so o host da empresa.
const gupyRules=tenant=>{
  const domains=tenant===GUPY_ACCOUNT_SCOPE?['.gupy.io','gupy.io',...gupyAccountHosts]:[tenant,`.${tenant}`,'.gupy.io','gupy.io'];
  return {cookie:c=>domains.includes(c.domain),origin:o=>tenant===GUPY_ACCOUNT_SCOPE?/(^|\.)gupy\.io$/.test(httpsHost(o.origin)):httpsHost(o.origin)===tenant};
};
const providerRules=provider=>provider.id==='gupy'?gupyRules(GUPY_ACCOUNT_SCOPE):{cookie:c=>providerOwnsCookieDomain(provider,c.domain),origin:o=>{const host=httpsHost(o.origin);return Boolean(host)&&hostAllowed(provider,host);}};

// Recorte do estado do navegador ao que pertence ao portal. O runner usa isto antes de enviar ao Hub,
// com as mesmas regras da validacao, para os dois nunca discordarem.
export function ownedProviderState(state,providerId){
  const provider=sessionProviderById(providerId);
  if(!provider)throw Object.assign(Error('SESSION_PROVIDER_UNSUPPORTED'),{code:'SESSION_PROVIDER_UNSUPPORTED',status:400});
  const rules=providerRules(provider);
  return {cookies:(state?.cookies||[]).filter(c=>rules.cookie(c)&&validCookieShape(c)),origins:(state?.origins||[]).filter(rules.origin)};
}

function validateScopedState(state,rules){
  if(!state||!Array.isArray(state.cookies)||!Array.isArray(state.origins)||JSON.stringify(state).length>512000)throw Object.assign(Error('SESSION_STATE_INVALID'),{code:'SESSION_STATE_INVALID'});
  const cookies=state.cookies.filter(rules.cookie).map(safeCookie);
  const origins=state.origins.filter(rules.origin).map(o=>({origin:o.origin,localStorage:keepStorage(o.localStorage)}));
  if(cookies.length!==state.cookies.length||origins.length!==state.origins.length)throw Object.assign(Error('SESSION_PROVIDER_ISOLATION'),{code:'SESSION_PROVIDER_ISOLATION'});
  return {cookies,origins};
}

export function validateOwnedState(state,tenant){
  if(tenant!==GUPY_ACCOUNT_SCOPE)gupyTenant(`https://${tenant}`);
  // Only state produced by our dedicated runner, scoped to the selected Gupy host.
  return validateScopedState(state,gupyRules(tenant));
}

export function validateProviderState(state,providerId){
  const provider=sessionProviderById(providerId);
  if(!provider)throw Object.assign(Error('SESSION_PROVIDER_UNSUPPORTED'),{code:'SESSION_PROVIDER_UNSUPPORTED',status:400});
  return validateScopedState(state,providerRules(provider));
}

export async function authenticatedProviderPage(page,providerId){
  const provider=sessionProviderById(providerId);
  if(!provider)return false;
  let url;try{url=new URL(page.url());}catch{return false;}
  if(provider.id==='gupy')return await authenticatedGupyAccountPage(page)||(/^[a-z0-9-]+\.gupy\.io$/.test(url.hostname)&&await authenticatedGupyPage(page,url.hostname));
  if(url.protocol!=='https:'||!hostAllowed(provider,url.hostname)||/login|signin|sign-in|signup|sign-up|cadastro|register|auth/i.test(url.pathname))return false;
  if(await page.locator('input[type="password"]:visible').count())return false;
  if(await page.getByRole('button',{name:/^(sair|logout|log out)$/i}).count()||await page.getByRole('link',{name:/^(sair|logout|log out)$/i}).count())return true;
  if(provider.authenticatedPaths.some(pattern=>pattern.test(page.url())))return true;
  for(const pattern of provider.authenticatedText){const matches=page.getByText(pattern);for(let index=0;index<await matches.count();index++)if(await matches.nth(index).isVisible())return true;}
  return false;
}
export async function authenticatedGupyPage(page,tenant){
  let u;try{u=new URL(page.url());}catch{return false;}
  if(u.hostname!==tenant||u.protocol!=='https:'||/signin|login|sign-up/.test(u.pathname))return false;
  if(await page.locator('input[type="password"]:visible').count())return false;
  // Positive UI evidence is required. Absence of the password form is insufficient.
  return await page.getByRole('button',{name:/^(sair|sair da conta|logout|log out)$/i}).count()>0||await page.getByRole('link',{name:/^(sair|sair da conta|logout|log out)$/i}).count()>0;
}
export async function authenticatedGupyAccountPage(page){
  let u;try{u=new URL(page.url());}catch{return false;}
  if(u.protocol!=='https:'||!gupyAccountHosts.has(u.hostname)||/signin|login|sign-up/.test(u.pathname))return false;
  if(await page.locator('input[type="password"]:visible').count())return false;
  if(await page.getByRole('button',{name:/^(sair|sair da conta|logout|log out)$/i}).count()||await page.getByRole('link',{name:/^(sair|sair da conta|logout|log out)$/i}).count())return true;
  return u.hostname==='portal.gupy.io'&&u.pathname==='/my/applications'&&await page.getByText(/Minhas candidaturas/i).count()>0;
}
