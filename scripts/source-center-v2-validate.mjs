import { readFile } from "node:fs/promises";
import { sourceOnboardingRegistry,ONBOARDING_TYPES,CONNECTION_STATUSES } from "../src/discovery/source-center/source-onboarding-registry.mjs";

const required=["brave-public-web","greenhouse","lever","ashby","smartrecruiters","workable","whatsapp","gupy","vagas","catho","infojobs"],items=sourceOnboardingRegistry.list(),ids=new Set(items.map(item=>item.providerId));
for(const id of required)if(!ids.has(id))throw new Error(`Fonte obrigatória ausente: ${id}`);
if(ids.size!==items.length)throw new Error("Provider duplicado no SourceOnboardingRegistry.");
for(const item of items){if(!ONBOARDING_TYPES.includes(item.onboardingType))throw new Error(`Onboarding inválido: ${item.providerId}`);if(!String(item.officialDocsUrl||"").startsWith("https://"))throw new Error(`URL oficial inválida: ${item.providerId}`);const publicDto=sourceOnboardingRegistry.publicItem(item,{});if(!CONNECTION_STATUSES.includes(publicDto.status))throw new Error(`Status inválido: ${item.providerId}`);}
const migration=await readFile(new URL("../db/migrations/017_source_connection_center_v2.sql",import.meta.url),"utf8");
if(/secret|ciphertext|api_key_value/i.test(migration))throw new Error("Migration não pode armazenar segredo ou ciphertext.");
console.log(`SOURCE CENTER V2 VALID: ${items.length} fontes, onboarding e status canônicos, migration metadata-only.`);
