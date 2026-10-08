const secretKey = /authorization|cookie|password|secret|token|ticket|api.?key|credential|storage|profileData|answer|content|html|body|prompt|^text$|email|phone|cpf|address/i;
export function redactText(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/((?:set-cookie|cookie|authorization)\s*:\s*)[^\r\n]+/gi,'$1[REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/(bearer\s+)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/((?:authorization|set-cookie|cookie|password|access_token|refresh_token|token|api[_-]?key|secret)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s"<>]+/g, value => {try {const u=new URL(value);u.username='';u.password='';u.search='';u.hash='';return u.toString();}catch{return '[URL]';}})
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .slice(0, 1000);
}
export function sanitizeStructuredLog(value, depth=0) {
  if(depth>4)return '[TRUNCATED]';
  if(value instanceof Error)return {name:redactText(value.name),code:redactText(value.code||'ERROR'),message:redactText(value.message),cause:value.cause?sanitizeStructuredLog(value.cause,depth+1):undefined};
  if(Array.isArray(value))return value.slice(0,50).map(v=>sanitizeStructuredLog(v,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,80).map(([k,v])=>[redactText(k),secretKey.test(k)?'[REDACTED]':sanitizeStructuredLog(v,depth+1)]));
  return typeof value==='string'?redactText(value):value;
}
