import { createHash } from "node:crypto";
function stable(value){if(Array.isArray(value))return value.map(stable);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));return value;}
export function intelligenceCacheKey({task,promptVersion,schemaVersion,provider,model,input}){return createHash("sha256").update(JSON.stringify(stable({task,promptVersion,schemaVersion,provider,model,input}))).digest("hex");}
export class IntelligenceCache{constructor(repository){this.repository=repository;}get(key){return this.repository?.get(key)?.result??null;}put(item){this.repository?.put(item);return item.result;}}
