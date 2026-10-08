import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SourceOnboardingRegistry,sourceOnboardingRegistry,ONBOARDING_TYPES,CONNECTION_STATUSES } from "../src/discovery/source-center/source-onboarding-registry.mjs";
import { CredentialVault } from "../src/discovery/source-center/credential-vault.mjs";
import { SourceConnectionService } from "../src/discovery/source-center/source-connection-service.mjs";
import { CompanyRecommendationService } from "../src/discovery/source-center/company-recommendation-service.mjs";
import { SOURCE_SURFACES } from "../src/discovery/source-authority.mjs";
import { BraveSearchProvider } from "../src/discovery/public-web/brave-search-provider.mjs";

const context=(overrides={})=>({configuration:null,credential:null,runtime:{},...overrides});
for(const [name,item,ctx,expected] of [
  ["NONE pronto",{providerId:"x",onboardingType:"NONE"},context({runtime:{configured:true}}),"READY"],
  ["NONE sem runtime",{providerId:"x",onboardingType:"NONE"},context({runtime:{configured:false}}),"CONFIG_REQUIRED"],
  ["TARGET vazio",{providerId:"x",onboardingType:"TARGET"},context(),"TARGET_REQUIRED"],
  ["TARGET URL",{providerId:"x",onboardingType:"TARGET"},context({configuration:{enabled:true,identity:{careerUrl:"https://example.com/jobs"}}}),"READY"],
  ["TARGET key",{providerId:"x",onboardingType:"TARGET"},context({configuration:{enabled:true,identity:{organizationKey:"acme"}}}),"READY"],
  ["API key ausente",{providerId:"x",onboardingType:"API_KEY"},context(),"CREDENTIAL_REQUIRED"],
  ["API key cofre",{providerId:"x",onboardingType:"API_KEY"},context({credential:{status:"CONNECTED"}}),"CONNECTED"],
  ["API key ambiente",{providerId:"x",onboardingType:"API_KEY"},context({runtime:{configured:true}}),"CONNECTED"],
  ["pairing",{providerId:"x",onboardingType:"PAIRING"},context(),"PAIRING_REQUIRED"],
  ["paired",{providerId:"x",onboardingType:"PAIRING"},context({runtime:{connected:true}}),"CONNECTED"],
  ["oauth",{providerId:"x",onboardingType:"OAUTH"},context(),"ACCOUNT_REQUIRED"],
  ["account",{providerId:"x",onboardingType:"ACCOUNT"},context(),"ACCOUNT_REQUIRED"],
  ["partner",{providerId:"x",onboardingType:"PARTNER"},context(),"PARTNER_REQUIRED"],
  ["manual",{providerId:"x",onboardingType:"MANUAL"},context(),"MANUAL_ONLY"],
  ["unsupported",{providerId:"x",onboardingType:"UNSUPPORTED"},context(),"UNSUPPORTED"],
  ["degraded prevalece",{providerId:"x",onboardingType:"NONE"},context({runtime:{status:"DEGRADED"}}),"DEGRADED"],
  ["error prevalece",{providerId:"x",onboardingType:"NONE"},context({runtime:{status:"ERROR"}}),"ERROR"]
])test(`registry: ${name}`,()=>assert.equal(new SourceOnboardingRegistry([item]).status(item,ctx),expected));

test("registry tem ids únicos e tipos canônicos",()=>{const items=sourceOnboardingRegistry.list();assert.equal(new Set(items.map(item=>item.providerId)).size,items.length);for(const item of items)assert.ok(ONBOARDING_TYPES.includes(item.onboardingType));});
test("registry sempre produz status canônico",()=>{for(const item of sourceOnboardingRegistry.list())assert.ok(CONNECTION_STATUSES.includes(sourceOnboardingRegistry.publicItem(item,{}).status));});
test("modelo distingue fonte pública, credencial, sessão e custo",()=>{
  const greenhouse=sourceOnboardingRegistry.publicItem(sourceOnboardingRegistry.get("greenhouse"),context({configuration:{enabled:true,identity:{organizationKey:"acme"}}}));
  assert.equal(greenhouse.availabilityStatus,"READY");assert.equal(greenhouse.credentialStatus,"NOT_REQUIRED");assert.equal(greenhouse.accountSessionStatus,"NOT_REQUIRED");assert.equal(greenhouse.costClass,"FREE");
  const jobspy=sourceOnboardingRegistry.publicItem(sourceOnboardingRegistry.get("jobspy"),context({runtime:{configured:true}}));
  assert.equal(jobspy.credentialStatus,"NOT_REQUIRED");assert.equal(jobspy.accountSessionStatus,"NOT_MANAGED");
  const brave=sourceOnboardingRegistry.publicItem(sourceOnboardingRegistry.get("brave-public-web"),context());
  assert.equal(brave.status,"OPTIONAL");assert.equal(brave.availabilityStatus,"OPTIONAL");assert.equal(brave.credentialStatus,"NOT_CONFIGURED");assert.equal(brave.costClass,"PAID_OPTIONAL");assert.equal(brave.requiredForCoreProduct,false);
});
test("GitHub diferencia conexão de sincronização",()=>{
  const disconnected=sourceOnboardingRegistry.publicItem(sourceOnboardingRegistry.get("github"),context({sync:{status:"NOT_INDEXED",details:{}}}));
  assert.equal(disconnected.credentialStatus,"NOT_CONFIGURED");assert.equal(disconnected.syncStatus,"NOT_SYNCED");
  const connected=sourceOnboardingRegistry.publicItem(sourceOnboardingRegistry.get("github"),context({credential:{status:"CONNECTED",maskedHint:"abc••••xyz"},sync:{status:"READY",details:{repositories:3,indexed:2,evidenceItems:5}}}));
  assert.equal(connected.credentialStatus,"CONNECTED");assert.equal(connected.syncStatus,"READY");assert.equal(connected.costClass,"FREE");
});
test("DTO público mascara e nunca inclui segredo",()=>{const dto=sourceOnboardingRegistry.publicItem(sourceOnboardingRegistry.get("brave-public-web"),{credential:{credentialRef:"ref",maskedHint:"abc••••xyz",status:"CONNECTED",validatedAt:"now"}});assert.equal(dto.credential.maskedHint,"abc••••xyz");assert.equal(JSON.stringify(dto).includes("super-secret"),false);});
test("URLs oficiais são HTTPS",()=>{for(const item of sourceOnboardingRegistry.list())assert.match(item.officialDocsUrl,/^https:\/\//);});

async function withVault(run){const dir=await mkdtemp(path.join(os.tmpdir(),"source-vault-"));try{return await run(await new CredentialVault({vaultPath:path.join(dir,"vault.json"),keyPath:path.join(dir,"key")}).initialize(),dir);}finally{await rm(dir,{recursive:true,force:true});}}
test("vault cifra e decifra round-trip",()=>withVault(async vault=>{await vault.put("ref","secret-value-123");assert.equal(vault.get("ref"),"secret-value-123");}));
test("vault não persiste plaintext",()=>withVault(async(vault,dir)=>{await vault.put("ref","secret-value-123");assert.equal((await readFile(path.join(dir,"vault.json"),"utf8")).includes("secret-value-123"),false);}));
test("vault mantém key separada do ciphertext",()=>withVault(async(vault,dir)=>{await vault.put("ref","secret-value-123");const body=await readFile(path.join(dir,"vault.json"),"utf8"),key=await readFile(path.join(dir,"key"),"utf8");assert.equal(body.includes(key.trim()),false);}));
test("vault remove segredo",()=>withVault(async vault=>{await vault.put("ref","secret-value-123");assert.equal(await vault.remove("ref"),true);assert.equal(vault.get("ref"),"");}));
test("vault detecta adulteração autenticada",()=>withVault(async(vault,dir)=>{await vault.put("ref","secret-value-123");const file=path.join(dir,"vault.json"),data=JSON.parse(await readFile(file,"utf8"));data.entries.ref.ciphertext=Buffer.from("tampered").toString("base64");await writeFile(file,JSON.stringify(data));const reopened=await new CredentialVault({vaultPath:file,keyPath:path.join(dir,"key")}).initialize();assert.throws(()=>reopened.get("ref"),error=>error.code==="CREDENTIAL_DECRYPT_FAILED");}));

function serviceFixture({status=200}={}){const metadata=new Map(),secrets=new Map(),events=[],githubCalls=[];const brave=new BraveSearchProvider({fetchImpl:async()=>({ok:status>=200&&status<300,status,json:async()=>({web:{results:[]}})})}),githubClient={validateCredential:async credential=>{githubCalls.push(credential);return {valid:true};}};const service=new SourceConnectionService({registry:sourceOnboardingRegistry,credentials:{get:id=>metadata.get(id)||null,save:item=>(metadata.set(item.providerId,item),item),remove:id=>metadata.delete(id)},events:{record:event=>events.push(event)},vault:{put:async(ref,value)=>secrets.set(ref,value),get:ref=>secrets.get(ref)||"",remove:async ref=>secrets.delete(ref)},providerTestService:{list:()=>[],configurations:{get:()=>null}},braveProvider:brave,githubClient,whatsappStatus:async()=>({})});return {service,metadata,secrets,events,githubCalls};}
test("teste válido não salva credencial",async()=>{const f=serviceFixture();const result=await f.service.validateCredential("brave-public-web","valid-secret-123");assert.equal(result.valid,true);assert.equal(f.metadata.size,0);assert.equal(f.secrets.size,0);});
test("GitHub valida token read-only antes de salvar no cofre",async()=>{const f=serviceFixture(),token="github-fixture-token";const result=await f.service.validateCredential("github",token);assert.equal(result.valid,true);assert.deepEqual(f.githubCalls,[token]);assert.equal(f.metadata.size,0);assert.equal(f.secrets.size,0);assert.equal(JSON.stringify(result).includes(token),false);});
test("credencial inválida vira erro seguro",async()=>{const f=serviceFixture({status:401});await assert.rejects(()=>f.service.validateCredential("brave-public-web","bad-secret"),error=>error.code==="CREDENTIAL_INVALID"&&JSON.stringify(error).includes("bad-secret")===false);});
test("credencial curta é rejeitada antes de chamar provider",async()=>{const f=serviceFixture();await assert.rejects(()=>f.service.validateCredential("brave-public-web","short"),error=>error.code==="CREDENTIAL_FORMAT_INVALID");assert.equal(f.events.length,0);});
test("rate limit é distinguido",async()=>{const f=serviceFixture({status:429});await assert.rejects(()=>f.service.validateCredential("brave-public-web","limited-secret"),error=>error.code==="CREDENTIAL_RATE_LIMITED");});
test("provider indisponível é distinguido",async()=>{const f=serviceFixture({status:503});await assert.rejects(()=>f.service.validateCredential("brave-public-web","some-secret"),error=>error.code==="CREDENTIAL_PROVIDER_UNAVAILABLE");});
test("conexão salva só após validação",async()=>{const f=serviceFixture();const result=await f.service.connect("brave-public-web","valid-secret-123");assert.equal(result.status,"CONNECTED");assert.equal(f.metadata.size,1);assert.equal(f.secrets.size,1);assert.equal(JSON.stringify(result).includes("valid-secret-123"),false);});
test("conexão retorna apenas dica mascarada",async()=>{const f=serviceFixture();const result=await f.service.connect("brave-public-web","abcdefghijkl");assert.equal(result.maskedHint,"abc••••jkl");});
test("substituição remove ciphertext anterior",async()=>{const f=serviceFixture();await f.service.connect("brave-public-web","first-secret");await f.service.connect("brave-public-web","second-secret");assert.equal(f.secrets.size,1);assert.equal(f.service.secret("brave-public-web"),"second-secret");});
test("remoção apaga metadata e ciphertext",async()=>{const f=serviceFixture();await f.service.connect("brave-public-web","valid-secret-123");assert.equal(await f.service.remove("brave-public-web"),true);assert.equal(f.metadata.size,0);assert.equal(f.secrets.size,0);});
test("partner não aceita credencial falsa",async()=>{const f=serviceFixture();await assert.rejects(()=>f.service.connect("gupy","secret"),error=>error.code==="CREDENTIAL_ONBOARDING_UNAVAILABLE");});
test("Brave muda capability sem restart",async()=>{let key="";const provider=new BraveSearchProvider({apiKeyProvider:()=>key,fetchImpl:async()=>({ok:true,json:async()=>({web:{results:[]}})})});assert.equal(provider.capability().configured,false);key="runtime-key";assert.equal(provider.capability().configured,true);});
test("listagem não fica bloqueada quando diagnóstico do WhatsApp trava",async()=>{const f=serviceFixture();f.service.whatsappStatus=()=>new Promise(()=>{});f.service.statusTimeoutMs=50;const started=Date.now(),items=await f.service.list(),authorityOnly=new Set(SOURCE_SURFACES.map(item=>item.provider_id).filter(id=>!sourceOnboardingRegistry.get(id)));assert.equal(items.length,sourceOnboardingRegistry.list().length+authorityOnly.size);assert.ok(Date.now()-started<500);assert.equal(items.find(item=>item.providerId==="whatsapp").status,"PAIRING_REQUIRED");for(const id of ["linkedin-posts","ciee","nube","cide"])assert.ok(items.some(item=>item.providerId===id));});
test("listagem inclui estado local do índice GitHub sem expor token",async()=>{const f=serviceFixture();f.service.githubEvidenceProvider={evidence:()=>({status:"READY",details:{repositories:4,indexed:3,failed:1,evidenceItems:12},evidence:[]})};await f.service.connect("github","github-fixture-token");const github=(await f.service.list()).find(item=>item.providerId==="github");assert.equal(github.credentialStatus,"CONNECTED");assert.equal(github.syncStatus,"READY");assert.equal(github.operationalStatus,"OPERATIONAL_REAL");assert.equal(github.sync.details.evidenceItems,12);assert.equal(JSON.stringify(github).includes("github-fixture-token"),false);});
test("listagem GitHub projeta sincronização parcial como degradada",async()=>{const f=serviceFixture();f.service.githubEvidenceProvider={evidence:()=>({status:"DEGRADED",details:{repositories:4,indexed:3,failed:1,evidenceItems:12},evidence:[]})};await f.service.connect("github","github-fixture-token");const github=(await f.service.list()).find(item=>item.providerId==="github");assert.equal(github.status,"CONNECTED");assert.equal(github.syncStatus,"DEGRADED");assert.equal(github.operationalStatus,"DEGRADED");assert.match(github.nextAction,/indexada parcialmente/);});

function recommendationFixture(jobs=[]){const boards=[],watchlists=[];return new CompanyRecommendationService({store:{jobs:{all:()=>jobs},watchlists:{boards:()=>boards,all:()=>watchlists,setActive:()=>null,setBoardEnabled:()=>null},jobHuntProfiles:{all:()=>[]},searchIntents:{forProfile:()=>null}},providerRegistry:{get:()=>null},companyRadar:{detect:async()=>({status:"READY",provider:"ashby",organizationKey:"acme",careerUrl:"https://jobs.ashbyhq.com/acme"}),save:async input=>input},preMatch:{evaluate:job=>({decision:job.decision,reasons:[]})}});}
test("board órfão não aparece ativo e pode ser desabilitado diretamente",()=>{const service=recommendationFixture([]),boards=service.store.watchlists.boards(),calls=[];boards.push({id:"board-orphan",watchlistId:"",provider:"workable",organizationKey:"invalid",enabled:true});service.store.watchlists.setBoardEnabled=(id,active)=>(calls.push({id,active}),{id,enabled:active});assert.equal(service.targets()[0].active,false);assert.deepEqual(service.setBoardActive("board-orphan",false),{id:"board-orphan",enabled:false});assert.deepEqual(calls,[{id:"board-orphan",active:false}]);});
test("ranking pune volume irrelevante",()=>{const jobs=[...Array.from({length:50},(_,i)=>({id:`bad-${i}`,company:"Volume SA",provider:"ashby",decision:"REJECT",url:"https://jobs.ashbyhq.com/volume"})),...Array.from({length:4},(_,i)=>({id:`good-${i}`,company:"Foco SA",provider:"ashby",decision:"PASS",url:"https://jobs.ashbyhq.com/foco"})),{id:"warn",company:"Foco SA",provider:"ashby",decision:"PASS_WITH_WARNINGS",url:"https://jobs.ashbyhq.com/foco"},...Array.from({length:3},(_,i)=>({id:`other-${i}`,company:"Foco SA",provider:"ashby",decision:"REJECT",url:"https://jobs.ashbyhq.com/foco"}))];const items=recommendationFixture(jobs).recommendations().items;assert.equal(items[0].company,"Foco SA");assert.ok(items[0].quality>items[1].quality);});
test("recomendação explica PASS e warnings",()=>{const item=recommendationFixture([{id:"1",company:"Acme",provider:"ashby",decision:"PASS",url:"https://jobs.ashbyhq.com/acme"},{id:"2",company:"Acme",provider:"ashby",decision:"PASS_WITH_WARNINGS",url:"https://jobs.ashbyhq.com/acme"}]).recommendations().items[0];assert.match(item.reason,/2 vaga/);assert.equal(item.counts.PASS,1);assert.equal(item.counts.PASS_WITH_WARNINGS,1);});
test("busca por nome desconhecido pede URL",()=>assert.equal(recommendationFixture([]).searchKnown("Empresa inexistente").status,"NEEDS_URL"));
test("busca curta não consulta diretório inventado",()=>assert.equal(recommendationFixture([]).searchKnown("a").status,"NEEDS_QUERY"));
test("preview possui budget estrito",async()=>{const result=await recommendationFixture([]).previewUrl({company:"Acme",careerUrl:"https://jobs.ashbyhq.com/acme"});assert.deepEqual(result.budget,{requests:0,maxRequests:1,maxJobs:20});});
test("preview usa cache TTL",async()=>{const service=recommendationFixture([]),first=await service.previewUrl({company:"Acme",careerUrl:"https://jobs.ashbyhq.com/acme"}),second=await service.previewUrl({company:"Acme",careerUrl:"https://jobs.ashbyhq.com/acme"});assert.equal(first.cached,false);assert.equal(second.cached,true);});
