import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const denied=code=>Object.assign(new Error(code==="PRIVATE_DISCOVERY_TARGET"?"Destino privado bloqueado para automacao publica.":"Navegacao nao permitida para automacao publica."),{code});

function ipv6Number(address){
  let text=address.toLowerCase();
  if(text.includes(".")){
    const cut=text.lastIndexOf(":"),v4=text.slice(cut+1).split(".").map(Number);
    text=text.slice(0,cut+1)+((v4[0]<<8)|v4[1]).toString(16)+":"+((v4[2]<<8)|v4[3]).toString(16);
  }
  const sides=text.split("::"),left=sides[0]?sides[0].split(":"):[],right=sides[1]?sides[1].split(":"):[];
  const parts=sides.length===2?[...left,...Array(8-left.length-right.length).fill("0"),...right]:left;
  return parts.reduce((value,part)=>(value<<16n)|BigInt(`0x${part}`),0n);
}
const prefix=(value,network,bits)=>(value>>BigInt(128-bits))===(ipv6Number(network)>>BigInt(128-bits));

export function isPublicAddress(input){
  const address=String(input).replace(/^\[|\]$/g,"").toLowerCase(),family=isIP(address);
  if(family===4){
    const [a,b,c]=address.split(".").map(Number);
    return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0&&(c===0||c===2)||b===88&&c===99)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
  }
  if(family!==6||address.includes("%"))return false;
  const value=ipv6Number(address);
  if(prefix(value,"::ffff:0:0",96)){
    const low=Number(value&0xffffffffn);return isPublicAddress([low>>>24,(low>>>16)&255,(low>>>8)&255,low&255].join("."));
  }
  return prefix(value,"2000::",3)&&!prefix(value,"2001::",23)&&!prefix(value,"2001:db8::",32)&&!prefix(value,"2002::",16)&&!prefix(value,"3fff::",20);
}

export function publicUrl(value,{allowLocalFixtures=false}={}){
  let url;try{url=new URL(value);}catch{throw denied("UNSAFE_DISCOVERY_URL");}
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw denied("UNSAFE_DISCOVERY_URL");
  const host=url.hostname.replace(/^\[|\]$/g,"").toLowerCase();
  const loopback=host==="localhost"||host==="::1"||host==="127.0.0.1";
  if(allowLocalFixtures&&loopback)return url;
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host==="instance-data"||isIP(host)&&!isPublicAddress(host))throw denied("PRIVATE_DISCOVERY_TARGET");
  if(url.port&&!((url.protocol==="http:"&&url.port==="80")||(url.protocol==="https:"&&url.port==="443")))throw denied("PUBLIC_TARGET_PORT_NOT_ALLOWED");
  return url;
}

export async function resolvePublicTarget(value,{lookupImpl=lookup,allowLocalFixtures=false}={}){
  const url=publicUrl(value,{allowLocalFixtures}),host=url.hostname.replace(/^\[|\]$/g,"").toLowerCase();
  if(allowLocalFixtures&&["localhost","127.0.0.1","::1"].includes(host))return {url,addresses:[{address:host==="localhost"?"127.0.0.1":host,family:host==="::1"?6:4}]};
  let addresses;
  try{addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookupImpl(host,{all:true});}catch{throw denied("PUBLIC_DNS_LOOKUP_FAILED");}
  if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))throw denied("PRIVATE_DISCOVERY_TARGET");
  return {url,addresses};
}

export async function installPublicBrowserGuard(context,{allowLocalFixtures=false,lookupImpl=lookup,onBlocked=()=>{},navigationAllowed=()=>true}={}){
  const validate=async value=>{
    const url=publicUrl(value,{allowLocalFixtures});
    // Explicit fixture mode supports intercepted synthetic hostnames. It is
    // never enabled by the HTTP API or the production composition.
    if(allowLocalFixtures&&!isIP(url.hostname.replace(/^\[|\]$/g,""))&&url.hostname!=="localhost")return;
    await resolvePublicTarget(value,{allowLocalFixtures,lookupImpl});
  };
  const pages=new WeakMap();
  const protect=page=>{
    if(pages.has(page))return pages.get(page);
    const work=(async()=>{
      const session=await context.newCDPSession(page);
      const tree=await session.send("Page.getFrameTree");let mainFrame=tree.frameTree.frame.id;
      await session.send("Page.enable");
      session.on("Page.frameNavigated",event=>{if(!event.frame.parentId)mainFrame=event.frame.id;});
      session.on("Fetch.requestPaused",event=>{
        void (async()=>{
          try{
            await validate(event.request.url);
            if(event.resourceType==="Document"&&event.frameId===mainFrame&&!navigationAllowed(new URL(event.request.url)))throw denied("PUBLIC_NAVIGATION_HOST_NOT_ALLOWED");
          }catch(error){
            onBlocked(error.code||"UNSAFE_DISCOVERY_URL");
            await session.send("Fetch.failRequest",{requestId:event.requestId,errorReason:"BlockedByClient"}).catch(()=>{});return;
          }
          await session.send("Fetch.continueRequest",{requestId:event.requestId}).catch(()=>{});
        })();
      });
      // CDP pauses each redirect hop. A Playwright route handler alone is called
      // only for the first URL of some native redirect chains.
      await session.send("Fetch.enable",{patterns:[{urlPattern:"http://*",requestStage:"Request"},{urlPattern:"https://*",requestStage:"Request"}]});
    })();
    pages.set(page,work);return work;
  };
  if(context.newCDPSession){
    context.on?.("page",page=>{void protect(page).catch(()=>page.close().catch(()=>{}));});
    for(const page of context.pages())await protect(page);
  }else{
    await context.route("**/*",async route=>{
      try{await validate(route.request().url());}
      catch(error){onBlocked(error.code||"UNSAFE_DISCOVERY_URL");await route.abort("blockedbyclient");return;}
      await route.continue();
    });
  }
  if(context.routeWebSocket)await context.routeWebSocket("**/*",socket=>socket.close({code:1008,reason:"Automatic browser network policy"}));
  return {protect};
}
