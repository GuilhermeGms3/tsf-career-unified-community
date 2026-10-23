import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeJobHuntProfile } from "../src/automation/job-hunt-policy.mjs";

const source=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("navegação orientada a tarefas preserva áreas existentes sem duplicar a análise manual",async()=>{
  const [navigation,router,bootstrap,opportunities]=await Promise.all([source("public/app/navigation.js"),source("public/app/router.js"),source("public/app/bootstrap.js"),source("public/features/opportunities/page.js")]);
  for(const group of ["Trabalho","Automação","Conhecimento","Sistema"])assert.match(navigation,new RegExp(`label:\\s*"${group}"`));
  for(const label of ["Hoje","Vagas","Candidaturas","Currículos","Meu perfil"])assert.match(navigation,new RegExp(`item\\("${label}"`));
  for(const advanced of ["Fontes","Cofres","Busca automática","Laboratório de qualidade","Observabilidade","Configurações"])assert.match(navigation,new RegExp(advanced));
  assert.doesNotMatch(navigation,/Analisar uma vaga/);
  assert.match(opportunities,/Adicionar vaga por link ou texto/);
  assert.doesNotMatch(navigation,/item\("Currículos em lote",/);
  assert.match(router,/"\/analyze": "analyze-job"/);
  assert.match(bootstrap,/"analyze-job": renderAnalyzeJob/);
});

test("jornadas normais escondem complexidade sem remover controles avançados",async()=>{
  const [opportunities,autopilot,analyze,today]=await Promise.all([source("public/features/opportunities/page.js"),source("public/features/autopilot/page.js"),source("public/features/analyze-job/page.js"),source("public/features/today/page.js")]);
  assert.match(opportunities,/id="manual-discovery"/);
  assert.match(opportunities,/LOCAL_DF/);
  assert.match(opportunities,/REMOTE_BRAZIL/);
  assert.match(opportunities,/Search Composer V4\.1/);
  assert.match(opportunities,/Encontrada via/);
  assert.match(autopilot,/data-autopilot-simple/);
  assert.match(autopilot,/data-toggle-job-automation/);
  assert.match(autopilot,/Ligar automação/);
  assert.match(autopilot,/Pausar automação/);
  assert.match(autopilot,/aria-pressed/);
  assert.match(autopilot,/Configurações avançadas/);
  assert.match(autopilot,/Query Budget avançado/);
  assert.match(autopilot,/data-notification-policy/);
  assert.match(autopilot,/Oportunidade que vale revisar/);
  assert.match(autopilot,/autopilot\?section=notifications#whatsapp-groups/);
  assert.match(analyze,/api\/opportunities\/analyze/);
  assert.match(analyze,/Descrição da vaga/);
  assert.match(today,/NOT_STARTED|product-onboarding/);
  assert.match(today,/data-skip-onboarding/);
});

test("preferências humanas do WhatsApp persistem na política normalizada",()=>{
  const profile=normalizeJobHuntProfile({queries:["DevOps"],locations:["Brasil"],providers:["jobspy"],notificationPolicy:{decisionClasses:["RECOMMENDED","REVIEW"],delivery:["WHATSAPP"],summaryFields:["ROLE","COMPANY","JOB_LINK"]}});
  assert.deepEqual(profile.notificationPolicy.decisionClasses,["RECOMMENDED","REVIEW"]);
  assert.deepEqual(profile.notificationPolicy.delivery,["WHATSAPP"]);
  assert.deepEqual(profile.notificationPolicy.summaryFields,["ROLE","COMPANY","JOB_LINK"]);
});

test("backup v2 usa allowlist e fluxo de inspeção antes da restauração",async()=>{
  const [server,settings,cache]=await Promise.all([source("server.mjs"),source("public/features/settings/page.js"),source("public/app/query-cache.js")]);
  assert.match(server,/PORTABLE_SQLITE_TABLES=Object\.freeze/);
  for(const table of ["job_hunt_profiles","search_intents","candidate_facts","career_entities","knowledge_evidence"])assert.match(server,new RegExp(`\"${table}\"`));
  for(const forbidden of ["source_credentials","credential_vault","integration_secrets","authorization_headers","environment_variables"])assert.match(server,new RegExp(`\"${forbidden}\"`));
  assert.match(settings,/backup\/inspect/);
  assert.match(settings,/data-confirm-restore/);
  assert.match(cache,/pathname==="\/api\/unified\/backup\/restore"/);
  assert.match(cache,/queryCache\.invalidate\(\(\)=>true\)/);
});
