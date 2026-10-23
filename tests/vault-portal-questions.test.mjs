import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {chromium} from "playwright";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {AdapterRegistry} from "../src/automation/ats/adapter-registry.mjs";
import {GenericAdapter} from "../src/automation/ats/generic/generic-adapter.mjs";
import {CandidateKnowledgeBase} from "../src/application/candidate-knowledge-base.mjs";
import {ApplicationQuestionEscalationService} from "../src/automation/application-question-escalation-service.mjs";
import {WhatsappApprovalGateway} from "../src/integrations/evolution/whatsapp-approval-gateway.mjs";
import {SESSION_PROVIDER_IDS} from "../src/source-connections/session-provider-registry.mjs";
import {validateFormAnswer} from "../src/application/form-answer-format.mjs";
import {authenticatedProviderPage} from "../src/source-connections/session-state.mjs";

test("todos os Cofres: pergunta DOM desconhecida chega ao gateway e resposta volta ao campo",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"vault-question-matrix-")),store=await new UnifiedStateStore({dataDir:dir}).initialize(),browser=await chromium.launch();
  const sent=[],gateway=new WhatsappApprovalGateway({store,target:"5511999991234",webhookSecret:"fixture-secret",evolutionService:{instance:"fixture",connectionState:async()=>({connectionState:"CONNECTED"}),client:{sendText:async(...args)=>sent.push(args.at(-1))}}});
  gateway.questionAnswerHandler=({application,question,answer})=>store.answerApplicationQuestion(application.id,question.id,answer,{reusable:false});
  const escalation=new ApplicationQuestionEscalationService({store,approvalGateway:gateway});
  try{
    for(const provider of SESSION_PROVIDER_IDS){
      const page=await browser.newPage(),adapter=new AdapterRegistry().get(provider),now=new Date().toISOString(),id=`matrix-${provider}`;
      try{
        await page.setContent('<form><label for="email">Email</label><input id="email" type="email" required><fieldset><legend>Descreva a solução para o enigma ZXQ-42 desta vaga*</legend><textarea id="custom" required></textarea></fieldset><div style="display:none"><input id="honeypot" required></div><button type="submit">Enviar candidatura</button></form><script>window.clicks=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.clicks++;};</script>');
        store.jobs.upsert({id,title:`Vaga ${provider}`,company:"Synthetic fixture",url:"https://example.test/job",createdAt:now,updatedAt:now});
        store.applications.create({id,jobId:id,status:"WAITING_USER",createdAt:now,updatedAt:now},{},{allowHistorical:true});
        const inspected=await adapter.inspectApplicationForm(page),knowledge=CandidateKnowledgeBase.fromProfile({personal:{email:"fixture@example.test"}}),mapped=adapter.mapFields(inspected,knowledge);
        assert.equal(mapped.find(field=>field.externalKey==="custom").semanticKey,"CUSTOM.QUESTION",provider);
        assert.equal(mapped.find(field=>field.externalKey==="honeypot").required,false,provider);
        store.applicationQuestions.sync(id,mapped);
        const result=await escalation.escalate(id);assert.equal(result.status,"AWAITING_ANSWER",provider);assert.match(sent.at(-1),/enigma ZXQ-42/);
        const reply=await gateway.ingest({event:"messages.upsert",instance:"fixture",data:{key:{id:`reply-${provider}`,remoteJid:"5511999991234@s.whatsapp.net"},message:{conversation:`RESPONDER ${result.request.commandToken} Resposta factual confirmada`}}},"fixture-secret");
        assert.equal(reply.outcome,"ANSWERED",provider);
        const fresh=await adapter.inspectApplicationForm(page),resolved=adapter.mapFields(fresh,knowledge,store.applicationQuestions.forApplication(id));
        await adapter.fill(page,resolved);assert.equal(await page.locator("#custom").inputValue(),"Resposta factual confirmada",provider);
        assert.equal(await page.evaluate(()=>window.clicks),0,provider);
        if(provider!=="gupy")assert.equal(new AdapterRegistry().describe(provider).canSubmit,false,provider);
      }finally{await page.close();}
    }
  }finally{await browser.close();store.close();await rm(dir,{recursive:true,force:true});}
});

test("pergunta vizinha nao contamina semantica e grupo radio preenche a opcao certa",async()=>{
  const browser=await chromium.launch();try{
    const p=await browser.newPage(),adapter=new GenericAdapter();
    await p.setContent('<div><label for="name">Nome completo</label><input id="name"><label for="q">Explique o enigma ZXQ</label><input id="q"><fieldset><legend>Escolha ZXQ</legend><label for="a">Primeira</label><input id="a" name="choice" type="radio" value="A" required><label for="b">Segunda</label><input id="b" name="choice" type="radio" value="B" required></fieldset></div>');
    const inspected=await adapter.inspectApplicationForm(p),q=inspected.fields.find(field=>field.id==="q"),radio=inspected.fields.find(field=>field.type==="radio-group");
    assert.equal(q.semanticKey,"CUSTOM.QUESTION");assert.match(radio.selector,/name=/);
    const mapped=adapter.mapFields(inspected,CandidateKnowledgeBase.fromProfile({}),[{...radio,answerStatus:"KNOWN",answerSource:"USER_CONFIRMED",answerValue:"B"}]);
    await adapter.fill(p,mapped);assert.equal(await p.locator("#b").isChecked(),true);assert.equal(await p.locator("#a").isChecked(),false);
    assert.equal(validateFormAnswer(radio,"Segunda").value,"B");
    assert.equal(validateFormAnswer(radio,"Inventada").valid,false);
    assert.equal(validateFormAnswer({type:"checkbox"},"não").value,false);
    assert.deepEqual(validateFormAnswer({...radio,type:"checkbox-group"},"Primeira | Segunda").value,["A","B"]);
  }finally{await browser.close();}
});

test("pergunta alterada preserva valor antigo mas exige nova confirmacao e invalida token antigo",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"question-drift-")),store=await new UnifiedStateStore({dataDir:dir}).initialize();try{
    const t=new Date().toISOString();store.jobs.upsert({id:"j",title:"Fixture",url:"https://example.test",createdAt:t,updatedAt:t});store.applications.create({id:"a",jobId:"j",status:"PLANNED",createdAt:t,updatedAt:t});
    let [q]=store.applicationQuestions.sync("a",[{externalKey:"shared-id",fingerprint:"old-question",label:"Pergunta anterior",required:true,type:"text"}]);store.answerApplicationQuestion("a",q.id,"Dado antigo");
    const pending=store.whatsappQuestions.prepare({applicationId:"a",questionId:q.id,commandToken:"PERG-123456",targetHash:"fixture"});store.whatsappQuestions.markSent(pending.id);
    [q]=store.applicationQuestions.sync("a",[{externalKey:"shared-id",fingerprint:"new-question",label:"Outra pergunta",required:true,type:"text"}]);
    assert.equal(q.answerValue,"Dado antigo");assert.equal(q.answerStatus,"USER_REQUIRED");assert.equal(store.whatsappQuestions.findById(pending.id).status,"DEFERRED");
    const mapped=new GenericAdapter().mapFields({fields:[{externalKey:"shared-id",fingerprint:"third-question",label:"Mais uma pergunta",required:true,type:"text",semanticKey:"CUSTOM.QUESTION",confidence:0}]},CandidateKnowledgeBase.fromProfile({}),[{...q,answerStatus:"KNOWN"}]);assert.equal(mapped[0].answer,undefined);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});

test("login oculto em anuncio nao e formulario de candidatura reconhecido",async()=>{
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<input aria-label="Buscar vaga"><section hidden><label for="email">Email</label><input id="email" type="email"></section>');const result=await new AdapterRegistry().get("empregare").inspectApplicationForm(page);assert.equal(result.schema.health,"UNSUPPORTED");assert.ok(result.schema.unsupportedSignals.includes("NO_APPLICATION_IDENTITY_FIELDS"));}finally{await browser.close();}
});

test("texto oculto de perfil nao valida sessao EMPREGARE",async()=>{
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.route("**/*",route=>route.fulfill({contentType:"text/html; charset=utf-8",body:'<main>Vaga publica</main><div hidden>Meu currículo</div>'}));await page.goto("https://careers.empregare.com/pt-br/vaga-fixture_1");assert.equal(await authenticatedProviderPage(page,"empregare"),false);await page.locator("div").evaluate(el=>el.hidden=false);assert.equal(await authenticatedProviderPage(page,"empregare"),true);}finally{await browser.close();}
});
