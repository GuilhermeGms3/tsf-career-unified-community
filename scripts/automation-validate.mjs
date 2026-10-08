import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {providerSetupCatalog,PROVIDER_SETUP_STATES} from "../src/discovery/provider-setup-catalog.mjs";
import {signCareerWebhook,verifyCareerWebhook} from "../src/integrations/career-webhook-contract.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=target=>readFile(path.join(root,target),"utf8");
const [compose,envExample,rawWorkflow,migration]=await Promise.all([read("compose.yaml"),read(".env.example"),read("automation/n8n/workflows/career-whatsapp-alerts.json"),read("db/migrations/009_automation_job_hunt_and_source_setup.sql")]);
const workflow=JSON.parse(rawWorkflow),types=new Set(workflow.nodes.map(node=>node.type)),secret="validation-only-secret",timestamp=new Date().toISOString(),rawBody=JSON.stringify({eventId:"validation-event",type:"INTEGRATION_TEST",timestamp,data:{}}),signature=signCareerWebhook({timestamp,rawBody,secret});
verifyCareerWebhook({timestamp,rawBody,signature,secret});
assert.match(compose,/n8nio\/n8n:2\.34\.6/);assert.match(compose,/evolution-api:v2\.3\.7/);assert.doesNotMatch(compose,/(n8n|evolution-api):latest/);assert.match(compose,/profiles: \["automation"\]/);
for(const name of ["CAREER_N8N_WEBHOOK_SECRET","N8N_ENCRYPTION_KEY","EVOLUTION_API_KEY","EVOLUTION_POSTGRES_PASSWORD","EVOLUTION_INSTANCE_NAME","CAREER_WHATSAPP_TARGET"])assert.match(envExample,new RegExp(`^${name}=`,`m`));
for(const type of ["n8n-nodes-base.webhook","n8n-nodes-base.code","n8n-nodes-base.httpRequest","n8n-nodes-base.respondToWebhook"])assert.ok(types.has(type),`Node ausente: ${type}`);
assert.equal(workflow.active,false);assert.doesNotMatch(rawWorkflow,/(?:api[_-]?key|secret)["']?\s*[:=]\s*["'][^"']{12,}/i);assert.match(rawWorkflow,/timingSafeEqual/);assert.match(rawWorkflow,/CAREER_REPLAY_BLOCKED/);
for(const table of ["job_hunt_profiles","job_hunt_runs","job_alerts","provider_configurations","provider_health_history","automation_runs","notification_deliveries"])assert.match(migration,new RegExp(`CREATE TABLE ${table}`));
const ids=providerSetupCatalog.list().map(item=>item.providerId);assert.equal(new Set(ids).size,ids.length);for(const item of providerSetupCatalog.list()){assert.ok(item.officialDocsUrl.startsWith("https://"));assert.ok(PROVIDER_SETUP_STATES.includes(providerSetupCatalog.setupStatus(item.providerId,null)));}
console.log(JSON.stringify({ok:true,n8n:"2.34.6",evolution:"2.3.7",workflowNodes:workflow.nodes.length,providers:ids.length,hmac:true,replayGuard:true},null,2));
