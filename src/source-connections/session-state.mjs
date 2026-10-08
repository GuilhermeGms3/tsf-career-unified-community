export const GUPY_ACCOUNT_SCOPE='gupy.io';
const gupyAccountHosts=new Set(['login.gupy.io','portal.gupy.io']);
export function gupyTenant(value){
  try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^[a-z0-9-]+\.gupy\.io$/.test(u.hostname))return u.hostname;}catch{}
  throw Object.assign(Error('GUPY_TARGET_REQUIRED'),{code:'GUPY_TARGET_REQUIRED',status:400});
}
export function validateOwnedState(state,tenant){
  if(tenant!==GUPY_ACCOUNT_SCOPE)gupyTenant(`https://${tenant}`);
  if(!state||!Array.isArray(state.cookies)||!Array.isArray(state.origins)||JSON.stringify(state).length>512000)throw Object.assign(Error('SESSION_STATE_INVALID'),{code:'SESSION_STATE_INVALID'});
  // Only state produced by our dedicated runner, scoped to the selected Gupy host.
  const allowedDomains=tenant===GUPY_ACCOUNT_SCOPE?['.gupy.io','gupy.io']:[tenant,`.${tenant}`,'.gupy.io','gupy.io'];
  const cookies=state.cookies.filter(c=>allowedDomains.includes(c.domain)).map(c=>{
    if(typeof c.name!=='string'||typeof c.value!=='string'||c.name.length>256||c.value.length>16000||!c.secure||!['Strict','Lax','None'].includes(c.sameSite)||typeof c.path!=='string'||!c.path.startsWith('/'))throw Object.assign(Error('SESSION_COOKIE_INVALID'),{code:'SESSION_COOKIE_INVALID'});
    return {name:c.name,value:c.value,domain:c.domain,path:c.path,expires:Number(c.expires)||-1,httpOnly:Boolean(c.httpOnly),secure:true,sameSite:c.sameSite};
  });
  const origins=tenant===GUPY_ACCOUNT_SCOPE?[]:state.origins.filter(o=>o.origin===`https://${tenant}`).map(o=>({origin:o.origin,localStorage:(o.localStorage||[]).filter(v=>typeof v.name==='string'&&typeof v.value==='string'&&!/password|senha/i.test(v.name)).map(({name,value})=>({name,value}))}));
  if(cookies.length!==state.cookies.length||origins.length!==state.origins.length)throw Object.assign(Error('SESSION_PROVIDER_ISOLATION'),{code:'SESSION_PROVIDER_ISOLATION'});
  return {cookies,origins};
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
