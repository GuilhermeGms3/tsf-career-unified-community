import { createHash } from "node:crypto";

const clean=(value)=>String(value||"").toLowerCase().replace(/[0-9a-f]{8,}/g,"#").replace(/\d+/g,"#").replace(/[^a-z#_.-]+/g,"").slice(0,80);
export function buildDomSignature(fields=[],signals=[]){const structure=fields.map(f=>({type:f.type,multiple:Boolean(f.multiple),required:Boolean(f.required),name:clean(f.name),semanticKey:f.semanticKey})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));const material=JSON.stringify({signals:[...signals].sort(),structure});return createHash("sha256").update(material).digest("hex");}
