import {hostAllowed,sessionProviderById} from "../source-connections/session-provider-registry.mjs";

// Deteccao de desafios humanos (CAPTCHA, MFA, login) separada do ApplicationEngine para os adapters
// poderem usar sem import circular. O ApplicationEngine reexporta estas funcoes.

async function hasMaterialChallenge(page,selector,{widget=false}={}){const matches=page.locator(selector),count=await matches.count();for(let index=0;index<count;index++){const candidate=matches.nth(index);if(await candidate.isVisible().catch(()=>false))return true;if(widget&&await candidate.evaluate(element=>{const tag=element.tagName.toLowerCase();if(["input","textarea"].includes(tag)||element.hidden||element.getAttribute("aria-hidden")==="true")return false;const style=getComputedStyle(element);return style.display!=="none"&&style.visibility!=="hidden"&&style.opacity!=="0"&&!element.closest("[hidden],[aria-hidden='true']");}).catch(()=>false))return true;}return false;}

export async function detectChallenge(page){const checks=[
  ["CAPTCHA_REQUIRED","iframe[src*='captcha'], .g-recaptcha, .h-captcha, [data-sitekey]",{widget:true}],["MFA_REQUIRED","input[autocomplete='one-time-code']"],
  ["LOGIN_REQUIRED","input[type=password]"],["EMAIL_VERIFICATION_REQUIRED","text=/verify your email|verifique seu e-mail/i"],
  ["ANTI_BOT_CHALLENGE","text=/unusual traffic|are you a human|checking your browser|access is temporarily restricted|unusual activity from your device/i"]];
  for(const [code,selector,options] of checks)if(await hasMaterialChallenge(page,selector,options))return code;return "";
}

// Com a sessao do Cofre aplicada, parar numa tela de login do proprio portal significa sessao recusada.
export function vaultLoginWall(page,provider){const policy=sessionProviderById(provider);if(!policy)return false;try{const url=new URL(page.url());return url.protocol==="https:"&&hostAllowed(policy,url.hostname)&&(/^(login|auth|accounts?|sso)\./i.test(url.hostname)||/(^|\/)(login|signin|sign-in|entrar|auth)(?=$|[/.])/i.test(url.pathname));}catch{return false;}}
