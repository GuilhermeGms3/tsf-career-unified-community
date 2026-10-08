import assert from "node:assert/strict";
import test from "node:test";
import {navigation,navigationGroups} from "../public/app/navigation.js";
import {currentRoute} from "../public/app/router.js";

test("navegação agrupada preserva rotas raiz e deep links existentes",()=>{
  assert.deepEqual(navigationGroups.map(group=>group.label),["Trabalho","Automação","Conhecimento","Sistema"]);
  for(const path of ["/","/opportunities","/resumes","/applications","/knowledge","/autopilot","/settings","/connections","/observability"]){
    const route={path,section:""};
    assert.ok(navigation.some(item=>item.matches(route)),`rota ${path} precisa continuar navegável`);
  }
  assert.equal(navigation.some(item=>item.path==="/analyze"),false);
  globalThis.location={pathname:"/analyze",search:""};
  assert.equal(currentRoute().name,"analyze-job");
});

test("grupos preservam todas as abas e usam rótulos de produto",()=>{
  const paths=navigation.map(item=>item.path);
  for(const path of ["/","/opportunities","/applications","/resumes","/knowledge","/autopilot","/connections","/observability","/settings"])assert.ok(paths.includes(path));
  assert.deepEqual(navigationGroups.find(group=>group.label==="Trabalho").items.map(item=>item.label),["Hoje","Vagas","Candidaturas","Currículos"]);
  assert.deepEqual(navigationGroups.find(group=>group.label==="Automação").items.map(item=>item.label),["Busca automática","WhatsApp","Fontes e conexões"]);
  assert.equal(navigationGroups.some(group=>/Discovery|Evidence|Intelligence/.test(group.label)),false);
});

test("estado ativo diferencia query section e mantém detalhe no grupo raiz",()=>{
  const review={path:"/opportunities",section:"review"};
  const vagas=navigation.find(item=>item.label==="Vagas");
  assert.equal(vagas.matches(review),true);
  assert.equal(vagas.matches({path:"/opportunities/job-1",section:""}),true);
  assert.equal(navigation.find(item=>item.label==="Hoje").matches(review),false);
});

test("router inclui section no estado da rota",()=>{
  globalThis.location={pathname:"/settings",search:"?section=security"};
  const route=currentRoute();
  assert.equal(route.name,"settings");
  assert.equal(route.section,"security");
});
