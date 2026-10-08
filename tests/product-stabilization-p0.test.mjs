import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

const load=path=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("GitHub TOKEN usa o fluxo genérico de credencial e expõe sincronização",async()=>{
  const source=await load("public/features/autopilot/page.js");
  assert.match(source,/\["API_KEY","TOKEN"\]\.includes\(source\?\.setupType\|\|source\?\.onboardingType\)/);
  assert.match(source,/GitHub Fine-grained Personal Access Token/);
  assert.match(source,/\/api\/candidate-knowledge\/providers\/github\/sync/);
  assert.match(source,/data-sync-github/);
  assert.doesNotMatch(source,/value="gh[pousr]_/i);
});

test("Configurações mantém somente a integração n8n",async()=>{
  const settings=await load("public/features/settings/page.js");
  assert.match(settings,/api\("\/api\/integrations\/n8n"\)/);
  assert.match(settings,/n8nIntegration\(n8n\)/);
  assert.doesNotMatch(settings,/renderOperationalIntegrations/);
});

test("Hoje prioriza decisões diárias sem repetir o resumo operacional",async()=>{
  const today=await load("public/features/today/page.js");
  assert.match(today,/O que fazer hoje/);
  assert.match(today,/Planejamento da busca/);
  assert.match(today,/Radar semanal de TI/);
  assert.match(today,/taskInboxMarkup/);
  assert.match(today,/searchQueueMarkup/);
  assert.match(today,/triageQueueMarkup/);
  assert.doesNotMatch(today,/today-summary-grid/);
  assert.match(today,/data-refresh-today/);
  assert.match(today,/setInterval\(\(\)=>refresh\(\),120000\)/);
  assert.match(today,/providerId==="github"/);
  assert.doesNotMatch(today,/brave-public-web/);
});

test("Oportunidades recolhe métricas técnicas e comunica estratégia gratuita",async()=>{
  const opportunities=await load("public/features/opportunities/page.js");
  assert.match(opportunities,/progressive-details/);
  assert.match(opportunities,/Ver métricas e critérios/);
  assert.match(opportunities,/Sem dependência paga/);
  assert.match(opportunities,/pago e opcional/);
  assert.match(opportunities,/Verificar vagas ativas/);
  assert.match(opportunities,/Histórico do Mass Hunt/);
  assert.match(opportunities,/Verificações dos anúncios/);
  assert.match(opportunities,/\/api\/opportunities\/verify/);
});

test("histórico explica execução interrompida sem estado técnico desconhecido",async()=>{
  const presentation=await load("public/app/presentation.js");
  assert.match(presentation,/PROCESS_INTERRUPTED:'Interrompida pelo reinício do aplicativo'/);
});

test("sidebar mantém destinos visíveis, agrupados e preserva estado ativo",async()=>{
  const [bootstrap,navigation]=await Promise.all([
    load("public/app/bootstrap.js"),
    load("public/app/navigation.js"),
  ]);
  for(const group of ["Trabalho","Automação","Conhecimento","Sistema"])assert.match(navigation,new RegExp(`label:\\s*"${group}"`));
  assert.match(bootstrap,/nav-group-label/);
  assert.match(bootstrap,/data-nav-path/);
  assert.match(bootstrap,/aria-current/);
  assert.doesNotMatch(bootstrap,/data-nav-group-toggle/);
});
