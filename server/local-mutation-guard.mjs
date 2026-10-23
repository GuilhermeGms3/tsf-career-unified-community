import {isTrustedWebRequest} from './trusted-web-access.mjs';
const deny=code=>{throw Object.assign(new Error(code),{code,status:403});};

// A loopback TCP destination alone does not authenticate a browser origin/Host.
export function requireLocalJsonMutation(req,url){
  if(["GET","HEAD","OPTIONS"].includes(req.method))return;
  const host=String(req.headers.host||"");
  if(isTrustedWebRequest(req,url)){
    if(req.headers.origin&&req.headers.origin!==url.origin)deny("SAME_ORIGIN_REQUIRED");
    if(req.headers['sec-fetch-site']&&!["same-origin","none"].includes(req.headers['sec-fetch-site']))deny("SAME_ORIGIN_REQUIRED");
    if(!/^application\/json\s*(?:;|$)/i.test(req.headers['content-type']||''))deny("JSON_CONTENT_TYPE_REQUIRED");
    return;
  }
  if(!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host))deny("LOCAL_HOST_REQUIRED");
  const target=new URL(`${url.protocol}//${host}`),port=Number(target.port||(target.protocol==="https:"?443:80));
  if(!["http:","https:"].includes(target.protocol)||target.origin!==url.origin||port<1||port>65535||
    req.socket?.localPort&&port!==req.socket.localPort)deny("LOCAL_HOST_REQUIRED");
  if(req.headers.origin&&req.headers.origin!==target.origin)deny("SAME_ORIGIN_REQUIRED");
  if(req.headers["sec-fetch-site"]&&!["same-origin","none"].includes(req.headers["sec-fetch-site"]))deny("SAME_ORIGIN_REQUIRED");
  if(!/^application\/json\s*(?:;|$)/i.test(req.headers["content-type"]||""))deny("JSON_CONTENT_TYPE_REQUIRED");
}
