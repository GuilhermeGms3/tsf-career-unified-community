import {createHmac,timingSafeEqual} from "node:crypto";

export const CAREER_WEBHOOK_MAX_SKEW_MS=300000;
export function signCareerWebhook({timestamp,rawBody,secret}){if(!secret)throw Object.assign(new Error("Segredo HMAC ausente."),{code:"WEBHOOK_SECRET_MISSING"});return `sha256=${createHmac("sha256",secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;}
export function verifyCareerWebhook({timestamp,rawBody,signature,secret,now=Date.now()}){const parsed=Date.parse(timestamp);if(!Number.isFinite(parsed)||Math.abs(now-parsed)>CAREER_WEBHOOK_MAX_SKEW_MS)throw Object.assign(new Error("Timestamp expirado."),{code:"WEBHOOK_TIMESTAMP_EXPIRED"});const expected=Buffer.from(signCareerWebhook({timestamp,rawBody,secret}).slice(7),"hex"),received=Buffer.from(String(signature||"").replace(/^sha256=/,""),"hex");if(expected.length!==received.length||!timingSafeEqual(expected,received))throw Object.assign(new Error("Assinatura invalida."),{code:"WEBHOOK_SIGNATURE_INVALID"});return true;}
