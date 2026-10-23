import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,rm,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { resolveAutomationEntryUrl } from "../src/automation/automation-validation.mjs";
import { detectChallenge } from "../src/automation/application-engine.mjs";
import { NerdinAdapter } from "../src/automation/ats/nerdin/nerdin-adapter.mjs";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {NerdinFinalRevalidator} from "../src/application/nerdin-final-revalidator.mjs";
import {ControlledSubmissionService} from "../src/application/controlled-submission-service.mjs";
import {FinalRevalidatorRouter} from "../src/application/final-revalidator-router.mjs";
import {SubmissionConsentService} from "../src/application/submission-consent-service.mjs";
import {SubmissionPreflight} from "../src/application/submission-preflight.mjs";
import {AdapterSubmissionTransport} from "../src/application/submission-transport.mjs";
import {AdapterRegistry} from "../src/automation/ats/adapter-registry.mjs";
import {parseNerdinIdentity,validateNerdinSubmissionTarget} from "../src/automation/ats/nerdin/nerdin-target-policy.mjs";
import {BrowserManager} from "../src/automation/browser/browser-manager.mjs";

const official="https://www.nerdin.com.br/vaga_emprego/vaga-suporte-98743.php";

test("Nerdin preserva perguntas de etapas futuras e preenche todos os valores confirmados",async()=>{
  const f=await fixture(),browser=await chromium.launch();try{const page=await browser.newPage();await page.goto(`http://127.0.0.1:${f.server.address().port}/apply`);const adapter=new NerdinAdapter(),inspected=await adapter.inspectApplicationForm(page),answers=f.store.applicationQuestions.forApplication(f.applicationId),mapped=adapter.mapFields(inspected,{get:()=>undefined},answers).map(field=>field.semanticKey==="RESUME.FILE"?{...field,answer:"artifact-nerdin",answerStatus:"KNOWN"}:field);
    assert.ok(inspected.fields.find(field=>field.externalKey==="pretensao_salarial").required);
    const artifact=f.store.resumeArtifacts.latest("version-nerdin","PDF"),audit=await adapter.fill(page,mapped,{resumePath:artifact.storagePath});
    assert.deepEqual(audit.filter(entry=>entry.status==="FAILED"||entry.status==="USER_REQUIRED"),[]);
    const validation=await adapter.validate(page,mapped);assert.equal(validation.valid,true,JSON.stringify(validation));
  }finally{await browser.close();await f.close();}
});

test("Nerdin aguarda reload de cookies antes de inspecionar formulario", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let requests = 0;
    await page.route("**/*", async route => {
      requests++;
      const cookies = requests === 1 ? '<button onclick="location.reload()">Rejeitar cookies</button>' : '';
      await route.fulfill({ status: 200, contentType: "text/html", body: form(false) + cookies });
    });
    await page.goto(resolveAutomationEntryUrl(official));
    const inspected = await new NerdinAdapter().inspectApplicationForm(page);
    assert.equal(requests, 2);
    assert.equal(inspected.fields.length, 11);
    assert.equal(inspected.schema.health, "HEALTHY");
  } finally { await browser.close(); }
});

test("entrada Nerdin resolve anuncio para formulario sem mudar identidade ou hosts de outros ATS", () => {
  assert.equal(resolveAutomationEntryUrl(official), "https://www.nerdin.com.br/vaga_candidatura.php?id=98743");
  assert.equal(resolveAutomationEntryUrl("https://jobs.lever.co/acme/job-1"), "https://jobs.lever.co/acme/job-1");
  assert.equal(resolveAutomationEntryUrl("http://127.0.0.1:1234/apply"), "http://127.0.0.1:1234/apply");
  assert.throws(() => resolveAutomationEntryUrl("https://user:password@www.nerdin.com.br/vaga_candidatura.php?id=1"), error => error.code === "NERDIN_TARGET_CREDENTIALS_NOT_ALLOWED");
  assert.throws(() => resolveAutomationEntryUrl("http://www.nerdin.com.br/vaga_candidatura.php?id=1"), error => error.code === "NERDIN_TARGET_HOST_NOT_ALLOWED");
});

test("pagina de entrada Nerdin permite inspecao de onze campos e preserva challenge gate sem POST", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    let posts = 0;
    await page.route("**/*", route => { if (route.request().method() !== "GET") posts++; return route.fulfill({ status: 200, contentType: "text/html", body: form(false) }); });
    await page.goto(resolveAutomationEntryUrl(official));
    assert.equal(await detectChallenge(page), "");
    const inspected = await new NerdinAdapter().inspectApplicationForm(page);
    assert.equal(inspected.fields.length, 11);
    assert.notEqual(inspected.schema.health, "UNSUPPORTED");
    await page.setContent('<div class="g-recaptcha" data-sitekey="fixture">challenge</div>');
    assert.equal(await detectChallenge(page), "CAPTCHA_REQUIRED");
    assert.equal(posts, 0);
  } finally { await browser.close(); }
});
const form=confirm=>`<!doctype html><form id="form-candidatura"><section id="etapa-1"><label for="nome_candidato">Seu Nome*</label><input id="nome_candidato" name="nome_candidato" required><label for="telefone_candidato">Telefone*</label><input id="telefone_candidato" name="telefone_candidato" required><label for="email_candidato">E-mail*</label><input id="email_candidato" name="email_candidato" type="email" required><label for="cidade_candidato">Cidade-UF*</label><input id="cidade_candidato" name="cidade_candidato" required></section><section id="etapa-2" class="d-none"><label for="funcao_candidato">Função*</label><input id="funcao_candidato" name="funcao_candidato" required><label for="nivel_ingles">Nível de Inglês*</label><select id="nivel_ingles" name="nivel_ingles" required><option value="">Escolha</option><option>Basic</option><option>Intermediate</option></select><label for="disponibilidade_inicio_dias">Disponibilidade para Início (Dias)*</label><input id="disponibilidade_inicio_dias" name="disponibilidade_inicio_dias" type="number" required><label for="possui_empresa_aberta">Possui Empresa Aberta (PJ)?</label><select id="possui_empresa_aberta" name="possui_empresa_aberta"><option>Não</option><option>Sim</option></select></section><section id="etapa-3" class="d-none"><label for="pretensao_salarial">Pretensão Salarial CLT (mensal)*</label><input id="pretensao_salarial" name="pretensao_salarial" required><label for="pretensao_salarial_pj">Pretensão Salarial PJ (hora)*</label><input id="pretensao_salarial_pj" name="pretensao_salarial_pj" required><label for="curriculo">Currículo</label><input id="curriculo" name="curriculo" type="file"></section><button id="btn-proximo" type="button">Próximo</button><button id="btn-enviar-candidatura" class="d-none" type="submit">Enviar Candidatura</button></form><style>.d-none{display:none}</style><script>let step=1;const next=document.querySelector('#btn-proximo'),submit=document.querySelector('#btn-enviar-candidatura');next.addEventListener('click',()=>{document.querySelector('#etapa-'+step).classList.add('d-none');step++;document.querySelector('#etapa-'+step).classList.remove('d-none');if(step===3){next.classList.add('d-none');submit.classList.remove('d-none')}});document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();await fetch('/record',{method:'POST'});${confirm?"history.pushState({},'', '/confirmacao');document.body.innerHTML='<main><h1>Candidatura enviada com sucesso</h1></main>';":""}})</script>`;

async function fixture({confirm=true}={}){
  let submitCount=0;const server=createServer((req,res)=>{if(req.url==="/record"&&req.method==="POST"){submitCount++;res.writeHead(204).end();return;}res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(form(confirm));});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const dataDir=await mkdtemp(path.join(os.tmpdir(),"nerdin-controlled-")),store=await new UnifiedStateStore({dataDir}).initialize(),now=new Date().toISOString(),applicationId="application-nerdin",resumeId="resume-nerdin",versionId="version-nerdin",url=`http://127.0.0.1:${server.address().port}/apply`;
  store.jobs.upsert({id:"job-nerdin",title:"Analista de Suporte",company:"Fixture",description:"Suporte",url,applicationUrl:official,canonicalUrl:official,status:"open",lifecycleStatus:"OPEN",createdAt:now,updatedAt:now});store.resumes.upsert({id:resumeId,title:"BASE 01",text:"Suporte",createdAt:now,updatedAt:now});store.applications.create({id:applicationId,jobId:"job-nerdin",resumeId,status:"READY_TO_SUBMIT",createdAt:now,updatedAt:now},{},{allowHistorical:true});store.resumeVersions.create({id:versionId,resumeId,jobId:"job-nerdin",applicationId,templateId:"ATS_STRICT",templateVersion:"ats-strict-v1",language:"pt-BR",status:"READY",contentHash:"nerdin-fixture",resumeSpec:{candidate:{fullName:"Ana Teste",email:"ana@example.test"}},source:"USER",approvedAt:now});store.applications.updateDetails({...store.applications.findById(applicationId),resumeVersionId:versionId});
  const artifactDir=path.join(dataDir,"resumes",resumeId,"versions",versionId),pdf=Buffer.from("%PDF-1.4 nerdin fixture"),pdfPath=path.join(artifactDir,"resume.pdf");await mkdir(artifactDir,{recursive:true});await writeFile(pdfPath,pdf);store.resumeArtifacts.create({id:"artifact-nerdin",resumeVersionId:versionId,artifactType:"PDF",storagePath:pdfPath,contentHash:createHash("sha256").update(pdf).digest("hex"),sizeBytes:pdf.length,mimeType:"application/pdf",status:"READY"});store.applicationPlans.save({applicationId,selectedResumeId:resumeId,selectedResumeVersionId:versionId,atsType:"nerdin",decision:"APPLY",matchScore:95,eligibility:"ELIGIBLE",blockingIssues:[],warnings:[],unknownRequirements:[],policySnapshot:{}});
  const answers={nome_candidato:"Ana Teste",telefone_candidato:"61999999999",email_candidato:"ana@example.test",cidade_candidato:"Brasília-DF",funcao_candidato:"Analista de Suporte",nivel_ingles:"Basic",disponibilidade_inicio_dias:"30",pretensao_salarial:"5000",pretensao_salarial_pj:"40"};store.applicationQuestions.sync(applicationId,Object.entries(answers).map(([externalKey,answer])=>({externalKey,label:externalKey,type:externalKey==="nivel_ingles"?"select-one":"text",required:true,answer,answerStatus:"KNOWN",answerSource:"USER_CONFIRMED",confidence:.99})));
  const registry=new AdapterRegistry(),browserManager=new BrowserManager({allowLocalFixtures:true,dataDir,headless:true,timeout:3000}),specific=new NerdinFinalRevalidator({store,dataDir,registry,browserManager,allowLocalFixtures:true,jobStatusChecker:async()=>({status:"OPEN",checkedAt:new Date().toISOString(),authority:"controlled-local-fixture",reference:"nerdin-fixture"})}),revalidator=new FinalRevalidatorRouter({store,browserManager,revalidators:{nerdin:specific}}),transport=new AdapterSubmissionTransport({registry,revalidator,allowLocalFixtures:true,confirmationTimeoutMs:200}),preflight=new SubmissionPreflight({store,dataDir,registry,revalidator,policy:{submissionEnabled:true}}),consents=new SubmissionConsentService({store}),service=new ControlledSubmissionService({store,preflight,transport});
  return {store,dataDir,server,applicationId,preflight,consents,service,get submitCount(){return submitCount;},close:async()=>{await new Promise(resolve=>server.close(resolve));store.close();await rm(dataDir,{recursive:true,force:true});}};
}

test("policy Nerdin normaliza vaga e bloqueia host não oficial",()=>{const identity=parseNerdinIdentity(official);assert.equal(identity.providerJobId,"98743");assert.equal(identity.applicationUrl,"https://www.nerdin.com.br/vaga_candidatura.php?id=98743");assert.throws(()=>validateNerdinSubmissionTarget("https://example.test/vaga_candidatura.php?id=98743"),error=>error.code==="NERDIN_TARGET_HOST_NOT_ALLOWED");});
test("Nerdin Controlled Submit percorre três etapas, clica uma vez e captura recibo",async()=>{const f=await fixture();try{const preview=await f.preflight.evaluate(f.applicationId,{fresh:true,mode:"PREVIEW"});assert.equal(preview.readyForConsent,true);const granted=f.consents.grant(f.applicationId,preview),result=await f.service.submit({applicationId:f.applicationId,consentToken:granted.token,idempotencyKey:"nerdin-success"});assert.equal(result.attempt.status,"SUBMITTED");assert.equal(f.submitCount,1);assert.match(result.receipt.confirmationText,/sucesso/i);}finally{await f.close();}});
test("Nerdin não repete clique quando a confirmação é incerta",async()=>{const f=await fixture({confirm:false});try{const preview=await f.preflight.evaluate(f.applicationId,{fresh:true,mode:"PREVIEW"}),granted=f.consents.grant(f.applicationId,preview),first=await f.service.submit({applicationId:f.applicationId,consentToken:granted.token,idempotencyKey:"nerdin-uncertain"}),second=await f.service.submit({applicationId:f.applicationId,consentToken:"",idempotencyKey:"nerdin-uncertain"});assert.equal(first.uncertain,true);assert.equal(second.reused,true);assert.equal(f.submitCount,1);}finally{await f.close();}});
