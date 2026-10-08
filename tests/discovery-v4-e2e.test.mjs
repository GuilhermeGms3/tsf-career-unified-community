import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";

const publicRoot = path.resolve("public");
let server, baseUrl, browser;
before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://local");
    const deep = /^\/(opportunities|autopilot|settings|connections)(\/|$)/.test(url.pathname);
    const relative = url.pathname === "/" || deep ? "index.html" : url.pathname.slice(1);
    try {
      const data = await readFile(path.join(publicRoot, relative));
      const type = relative.endsWith(".css") ? "text/css" : relative.endsWith(".js") ? "text/javascript" : "text/html";
      res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser.close();
  server.close();
  await once(server, "close");
});

const response = (route, data) => route.fulfill({ status: data?.$status || 200, contentType: "application/json", body: JSON.stringify(data) });
async function mockApi(page, handlers = {}) {
  await page.route(/\/api\//, (route) => {
    if (!["fetch","xhr"].includes(route.request().resourceType())) return route.fallback();
    const key = new URL(route.request().url()).pathname;
    const value = handlers[key];
    return response(route, typeof value === "function" ? value(route) : value || { ok: true });
  });
}

test("Search Composer renderiza disponibilidade, preview e Mass Hunt sem overflow", async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  page.on("requestfailed",request=>errors.push(`${request.url()} ${request.failure()?.errorText}`));
  let previewPayload;
  await mockApi(page, {
    "/api/opportunities": { ok: true, opportunities: [] },
    "/api/discovery-v4/capabilities": { ok: true, jobFamilies:[{id:"BACKEND",label:"Backend",aliases:["Backend Developer"]}],sourceClasses: [
      { sourceClass: "STRUCTURED_ATS", status: "SUPPORTED", operational: true },
      { sourceClass: "PUBLIC_WEB", status: "CONFIG_REQUIRED", operational: false },
      { sourceClass: "INTERNSHIP_PORTAL", status: "SUPPORTED", operational: true },
    ],providers:[
      {providerId:"iel",displayName:"IEL",status:"READY",discoveryMode:"PUBLIC_FEED",defaultSelected:false},
      {providerId:"programathor",displayName:"ProgramaThor",status:"READY",discoveryMode:"PUBLIC_FEED",defaultSelected:false},
      {providerId:"solides",displayName:"Sólides",status:"READY",discoveryMode:"PUBLIC_API",defaultSelected:false},
      {providerId:"recrutei",displayName:"Recrutei",status:"READY",discoveryMode:"PUBLIC_FEED",defaultSelected:false},
    ] },
    "/api/discovery-v4/search/preview": route=>{previewPayload=route.request().postDataJSON();return { ok: true, preview: { structuredQueries: [{ query: "Platform Engineer junior" }], publicWebQueries: ["\"we are hiring\" Platform Engineer Brasil"], availability: [], summary: { requested: 2, operational: 1, configRequired: 1, unsupported: 0 } } };},
  });
  await page.goto(`${baseUrl}/opportunities?section=discover`);
  await page.waitForTimeout(750);
  const massHunt = page.getByRole("button", { name: "Busca em massa" });
  assert.equal(await massHunt.count(), 1);
  await massHunt.click();
  const searchDialog = page.locator("#search-composer");
  await searchDialog.waitFor({ state: "visible" });
  await searchDialog.getByRole("button", { name: "Fechar" }).click();
  await searchDialog.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Capturar sinal manual" }).click();
  const signalDialog = page.locator("#manual-signal-dialog");
  await signalDialog.waitFor({ state: "visible" });
  await signalDialog.getByRole("button", { name: "Fechar" }).click();
  await signalDialog.waitFor({ state: "hidden" });
  const open=page.getByRole("button", { name: "Configurar busca avançada" });
  assert.equal(await open.count(),1,`errors=${errors.join(" | ")} main=${await page.locator("main").innerText()}`);
  await open.click();
  await page.getByRole("link",{name:"Gerenciar fontes e conexões"}).waitFor();
  assert.equal(await page.getByRole("link",{name:"Gerenciar fontes e conexões"}).getAttribute("href"),"/connections");
  assert.equal(await page.locator('[name="providers"]:checked').count(),0);
  await page.getByRole("checkbox",{name:/ProgramaThor/}).check();
  await page.locator('[name="families"][value="BACKEND"]').check();
  await page.getByRole("button", { name: "Pré-visualizar queries" }).click();
  await page.getByText("Platform Engineer junior",{exact:true}).waitFor();
  assert.deepEqual(previewPayload.providers,["programathor"]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll("body *")].filter(el=>el.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(-12).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,text:el.textContent.slice(0,90)})))));
  await page.close();
});

test("Source Center mostra readiness e limitações das fontes brasileiras",async()=>{
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  await mockApi(page,{
    "/api/connections":{ok:true,sources:[
      {providerId:"iel",displayName:"IEL",group:"DESCOBERTA",optional:false,authentication:"NOT_REQUIRED",authMode:"NONE",operationalReadiness:"READY",health:"READY",canDiscover:true,canAuthenticate:false,manualCapture:false,capabilities:{DISCOVERY:"READY"},surfaces:[{display_name:"IEL",status:"OPERATIONAL_REAL",current_limit:30,observation:{lastValidCount:12,lastNewCount:4,pagesScanned:1,resultsLimit:30}}]},
      {providerId:"eureca",displayName:"Eureca",group:"DESCOBERTA",optional:false,authentication:"MANUAL",authMode:"MANUAL",operationalReadiness:"MANUAL_ONLY",health:"MANUAL_ONLY",canDiscover:false,canAuthenticate:false,manualCapture:true,capabilities:{MANUAL_CAPTURE:"READY"},surfaces:[]},
    ],gupyContext:{targets:[],selected:null,request:null}},
  });
  await page.goto(`${baseUrl}/connections`);
  await page.getByRole("heading",{name:"IEL",level:3}).waitFor();
  assert.equal(await page.getByRole("heading",{name:"Eureca",level:3}).count(),1);
  const ielCard=page.locator(".connection-card",{hasText:"IEL"});
  await ielCard.getByText("Saúde operacional da descoberta",{exact:true}).click();
  assert.match(await ielCard.innerText(),/12 \/ 4/);
  assert.equal(await page.getByRole("link",{name:"Buscar vagas"}).count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
  await page.close();
});

test("Autopilot pesquisa, seleciona múltiplos, persiste por JID, renomeia e desmarca", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  let persisted=[];
  const groups=[
    { groupJid: "120363000@g.us", displayName: "Vagas Tech" },
    { groupJid: "120363001@g.us", displayName: "Infra e NOC" },
    { groupJid: "120363002@g.us", displayName: "Eventos" },
  ];
  await mockApi(page, {
    "/api/source-configurations": { ok: true, sources: [] },
    "/api/discovery-v4/community-sources": route=>{if(route.request().method()==="PUT"){persisted=route.request().postDataJSON().sources.map(item=>({...item,provider:"EVOLUTION_WHATSAPP",externalId:item.groupJid}));}return {ok:true,sources:persisted,optIn:true};},
    "/api/whatsapp/status": { ok: true, api:{online:true}, whatsapp: { connectionState: "CONNECTED" } },
    "/api/discovery-v4/evolution-webhook": {ok:true,webhook:{status:"CONFIGURED",messagesUpsertEnabled:true}},
    "/api/discovery-v4/whatsapp/groups": ()=>({ ok: true, groups, participantsIncluded: false }),
  });
  await page.goto(`${baseUrl}/autopilot?section=notifications`);
  await page.waitForTimeout(1000);
  assert.equal(await page.getByText("Grupos do WhatsApp").count(),1,`errors=${errors.join(" | ")} main=${await page.locator("main").innerText()}`);
  assert.equal(await page.getByText("0",{exact:true}).count()>0,true);
  await page.getByRole("button", { name: "Gerenciar grupos monitorados" }).click();
  const dialog=page.locator("#whatsapp-groups-dialog");
  const search=dialog.getByPlaceholder("Pesquisar grupos...");
  await search.waitFor({state:"visible"});
  await search.fill("infra");
  assert.equal(await dialog.locator("[data-community-source]:visible").count(),1);
  await search.fill("");
  const tech=dialog.getByRole("checkbox", { name: /Vagas Tech/ }),infra=dialog.getByRole("checkbox", { name: /Infra e NOC/ });
  assert.equal(await tech.isChecked(),false);
  await tech.check();
  await dialog.getByRole("button",{name:"Salvar grupos monitorados"}).click();
  await page.waitForFunction(()=>!document.querySelector("#whatsapp-groups-dialog [data-save-groups]").disabled);
  assert.equal(persisted.filter(item=>item.enabled).length,1);
  await infra.check();
  await dialog.getByText("Configurar filtros",{exact:true}).nth(1).click();
  await dialog.locator('[data-filter="seniorities"]').nth(1).fill("JUNIOR, INTERNSHIP");
  await dialog.getByRole("button",{name:"Salvar grupos monitorados"}).click();
  await page.waitForFunction(()=>!document.querySelector("#whatsapp-groups-dialog [data-save-groups]").disabled);
  assert.equal(persisted.filter(item=>item.enabled).length,2);
  assert.deepEqual(persisted.find(item=>item.groupJid==="120363001@g.us").filters.seniorities,["JUNIOR","INTERNSHIP"]);
  groups[0].displayName="Vagas Tech Renomeado";
  await page.reload();
  await page.getByRole("button", { name: "Gerenciar grupos monitorados" }).click();
  const renamed=page.locator("#whatsapp-groups-dialog").getByRole("checkbox",{name:/Vagas Tech Renomeado/});
  await renamed.waitFor();
  assert.equal(await renamed.isChecked(),true);
  assert.equal(persisted.find(item=>item.groupJid==="120363000@g.us").externalId,"120363000@g.us");
  await renamed.uncheck();
  await page.locator("#whatsapp-groups-dialog").getByRole("button",{name:"Salvar grupos monitorados"}).click();
  await page.reload();
  await page.getByRole("button", { name: "Gerenciar grupos monitorados" }).click();
  const disabledAfterReload=page.locator("#whatsapp-groups-dialog").getByRole("checkbox",{name:/Vagas Tech Renomeado/});
  await disabledAfterReload.waitFor();
  assert.equal(await disabledAfterReload.isChecked(),false);
  assert.equal(persisted.find(item=>item.groupJid==="120363000@g.us").enabled,false);
  assert.equal(await dialog.getByText(/participantes não carregados/).count() > 0, true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll("body *")].filter(el=>el.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(-12).map(el=>({tag:el.tagName,class:el.className,width:el.getBoundingClientRect().width,text:el.textContent.slice(0,90)})))));
  await page.close();
});

test("WhatsApp Groups cobre erro, desconexão, reconnect e empty",async()=>{
  const errorPage=await browser.newPage();
  await mockApi(errorPage,{"/api/source-configurations":{ok:true,sources:[]},"/api/discovery-v4/community-sources":{ok:true,sources:[]},"/api/whatsapp/status":{ok:true,api:{online:true},whatsapp:{connectionState:"CONNECTED"}},"/api/discovery-v4/whatsapp/groups":{$status:503,ok:false,error:"Evolution temporariamente indisponível"}});
  await errorPage.goto(`${baseUrl}/autopilot?section=notifications`);
  await errorPage.getByRole("button",{name:"Gerenciar grupos monitorados"}).click();
  await errorPage.getByText("Não foi possível carregar os grupos").waitFor();
  assert.match(await errorPage.locator("#whatsapp-groups-dialog .form-status").innerText(),/Erro ao carregar grupos/);
  await errorPage.close();
  let called=0,connectionState="DISCONNECTED";
  const reconnectPage=await browser.newPage();
  await mockApi(reconnectPage,{"/api/source-configurations":{ok:true,sources:[]},"/api/discovery-v4/community-sources":{ok:true,sources:[]},"/api/whatsapp/status":()=>({ok:true,api:{online:true},whatsapp:{connectionState}}),"/api/discovery-v4/whatsapp/groups":()=>{called++;return {ok:true,groups:[]};}});
  await reconnectPage.goto(`${baseUrl}/autopilot?section=notifications`);
  await reconnectPage.getByRole("button",{name:"Gerenciar grupos monitorados"}).click();
  await reconnectPage.locator("#whatsapp-groups-dialog .form-status").getByText(/WhatsApp desconectado/).waitFor();
  assert.equal(called,0);
  connectionState="CONNECTED";
  await reconnectPage.reload();
  await reconnectPage.getByRole("button",{name:"Gerenciar grupos monitorados"}).click();
  await reconnectPage.getByText("Nenhum grupo disponível").waitFor();
  assert.equal(called,1);
  await reconnectPage.close();
});

test("Diagnóstico distingue online de configuração incompleta", async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await mockApi(page, {
    "/api/runtime-diagnostics": { ok: true, components: { discovery: { status: "ONLINE" }, careerEngine: { status: "ONLINE" }, ollama: { status: "OFFLINE" }, n8n: { status: "ONLINE_CONFIG_INCOMPLETE" }, evolution: { status: "ONLINE" }, whatsapp: { status: "CONFIGURED" }, publicWeb: { status: "CONFIG_REQUIRED" }, providers: { status: "PARTIAL_OR_READY" } } },
  });
  await page.goto(`${baseUrl}/settings?section=diagnostics`);
  await page.getByText("Diagnóstico de capacidades").waitFor();
  assert.equal(await page.getByText(/Disponível, mas falta configurar/i).count() > 0, true);
  assert.equal(await page.getByText(/Configuração necessária/i).count() > 0, true);
  await page.close();
});
