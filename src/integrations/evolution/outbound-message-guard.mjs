import {createHash} from "node:crypto";

const recent = new Map(), ttl = 15 * 60 * 1000;
const key = (instance, text) => createHash("sha256").update(`${instance}:${String(text).trim()}`).digest("hex");
export function rememberOutboundText(instance, text) {
  const now = Date.now();
  for (const [id, expires] of recent) if (expires <= now) recent.delete(id);
  recent.set(key(instance, text), now + ttl);
  while (recent.size > 1000) recent.delete(recent.keys().next().value);
}
export function isOutboundText(instance, text) {
  return (recent.get(key(instance, text)) || 0) > Date.now();
}
