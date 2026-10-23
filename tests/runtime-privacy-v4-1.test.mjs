import test from "node:test";
import assert from "node:assert/strict";
import {EvolutionClient} from "../src/integrations/evolution/evolution-client.mjs";
import {EvolutionConnectionService} from "../src/integrations/evolution/evolution-connection-service.mjs";
import {RuntimeCapabilityService} from "../src/discovery/v4/runtime-capability-service.mjs";
import {createDiscoveryV4Routes} from "../server/routes/discovery-v4-routes.mjs";

test("diagnóstico inbound distingue recebimento, falha e conclusão sem payload", async () => {
  let fail = true;
  const route = createDiscoveryV4Routes({
    evolutionService: { webhookStatus: async () => ({ status: "CONFIGURED" }) },
    approvalGateway: {
      verifySecret(secret) { if (secret !== "private-secret") throw Object.assign(new Error("Recusado"), { code: "UNAUTHORIZED", status: 403 }); },
      async ingest() { if (fail) throw Object.assign(new Error("Falha"), { code: "TEST_PROCESSING_FAILED" }); return { handled: true, outcome: "STATUS" }; },
    },
    readJson: async () => ({ event: "MESSAGES_UPSERT", data: { message: { conversation: "private-observation" } } }),
    json: (res, body, status = 200) => Object.assign(res, { body, status }),
    sendError: (res, error) => Object.assign(res, { status: error.status || 400 }),
  });
  const inbound = new URL("http://app/api/discovery-v4/webhooks/evolution"), diagnostic = new URL("http://app/api/discovery-v4/evolution-webhook");
  const req = { method: "POST", socket: { remoteAddress: "127.0.0.1" }, headers: { "x-career-webhook-secret": "private-secret" } };
  await route(req, {}, inbound);
  const res = {};
  await route({ method: "GET" }, res, diagnostic);
  assert.equal(res.body.runtime.received, 1);
  assert.equal(res.body.runtime.lastErrorCode, "TEST_PROCESSING_FAILED");
  assert.equal(res.body.runtime.lastCompletedAt, null);
  fail = false;
  await route(req, {}, inbound);
  await route({ method: "GET" }, res, diagnostic);
  assert.equal(res.body.runtime.received, 2);
  assert.equal(res.body.runtime.lastOutcome, "STATUS");
  assert.equal(res.body.runtime.lastErrorCode, null);
  assert.ok(res.body.runtime.lastCompletedAt);
  assert.doesNotMatch(JSON.stringify(res.body), /private-secret|private-observation/);
  await route({ ...req, headers: {} }, {}, inbound);
  await route({ method: "GET" }, res, diagnostic);
  assert.equal(res.body.runtime.received, 2);
});

test("webhook Evolution configura endpoint oficial com header secreto sem devolvê-lo",async()=>{let request;const client=new EvolutionClient({baseUrl:"http://evolution.test",apiKey:"api-secret",fetchImpl:async(url,options)=>{request={url:String(url),options};return {ok:true,status:201,json:async()=>options?.method==="POST"?{}:{enabled:true,url:"http://app:7123/api/discovery-v4/webhooks/evolution",events:["MESSAGES_UPSERT"],headers:{"x-career-webhook-secret":"hidden"}}};}}),service=new EvolutionConnectionService({client,webhookSecret:"community-secret"});await service.configureInboundWebhook();assert.match(request.url,/webhook\/find\/career-unified$/);const status=await service.webhookStatus();assert.equal(status.status,"CONFIGURED");assert.equal(JSON.stringify(status).includes("community-secret"),false);assert.equal(JSON.stringify(status).includes("hidden"),false);});
test("sem segredo o webhook permanece NOT_CONFIGURED e configuração falha",async()=>{const service=new EvolutionConnectionService({client:new EvolutionClient({apiKey:""}),webhookSecret:""});assert.equal((await service.webhookStatus()).status,"NOT_CONFIGURED");await assert.rejects(()=>service.configureInboundWebhook(),error=>error.code==="EVOLUTION_WEBHOOK_SECRET_REQUIRED");});
test("rota inbound encaminha payload e segredo ao CommunityDiscoveryService",async()=>{let received;const res={},route=createDiscoveryV4Routes({store:{},service:{},leadPromotionService:{},evolutionService:{},communityService:{ingest:(payload,secret)=>{received={payload,secret};return {accepted:true,outcome:"IGNORED_EVENT"};}},runtimeCapabilities:{},readJson:async()=>({event:"MESSAGES_UPSERT"}),json:(target,body,status=200)=>Object.assign(target,{body,status}),sendError:(target,error)=>Object.assign(target,{body:{ok:false,code:error.code},status:error.status||400})}),handled=await route({method:"POST",socket:{remoteAddress:"127.0.0.1"},headers:{"x-career-webhook-secret":"test-secret"}},res,new URL("http://app/api/discovery-v4/webhooks/evolution"));assert.equal(handled,true);assert.equal(res.status,202);assert.deepEqual(received,{payload:{event:"MESSAGES_UPSERT"},secret:"test-secret"});assert.equal(res.body.outcome,"IGNORED_EVENT");});
test("n8n saudável com workflow inativo fica ONLINE_CONFIG_INCOMPLETE",async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>({ok:true,status:200});try{const service=new RuntimeCapabilityService({discoveryV4:{capabilities:()=>({sourceClasses:[]})},evolutionService:{client:{baseUrl:"http://evolution"},publicConfiguration:()=>({configured:true}),webhookStatus:async()=>({status:"NOT_CONFIGURED",secretConfigured:false})},providerTestService:{list:()=>[]},intelligenceStatus:async()=>({status:"OFFLINE",settings:{hardwareProfile:"LOW_VRAM",contextBudget:2048}}),careerEngineUrl:"http://engine",n8nUrl:"http://n8n",integrationSettings:{get:()=>({enabled:false,webhookUrl:"",secretEnvName:"CAREER_N8N_WEBHOOK_SECRET",configured:false})}}),result=await service.diagnose();assert.equal(result.components.n8n.containerOnline,true);assert.equal(result.components.n8n.status,"ONLINE_CONFIG_INCOMPLETE");assert.equal(result.components.n8n.workflowActive,"NOT_CONFIRMED");assert.equal(result.components.ollama.concurrency,1);}finally{globalThis.fetch=original;}});
