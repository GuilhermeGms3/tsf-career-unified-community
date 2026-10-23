import assert from "node:assert/strict";
import test from "node:test";
import {chromium} from "playwright";
import {HostedAtsAdapter} from "../src/automation/ats/hosted/hosted-ats-adapter.mjs";
import {detectChallenge} from "../src/automation/application-engine.mjs";
import {classifyQuestion} from "../src/application/question-semantics.mjs";
import {WorkableAdapter} from "../src/automation/ats/workable/workable-adapter.mjs";
import {TeamtailorAdapter} from "../src/automation/ats/teamtailor/teamtailor-adapter.mjs";
import {AshbyAdapter} from "../src/automation/ats/ashby/ashby-adapter.mjs";
import {SmartRecruitersAdapter} from "../src/automation/ats/smartrecruiters/smartrecruiters-adapter.mjs";
import {formStructureHash} from "../src/application/form-structure-hash.mjs";

test("pergunta customizada gera revisao, confirmacao exata libera schema e mudanca invalida",async()=>{
  const b=await chromium.launch({headless:true});try{
    const p=await b.newPage();await p.setContent('<label for="email">Email</label><input id="email" type="email" required><label for="question">Descreva a resposta para o enigma ZXQ-91</label><textarea id="question" required></textarea>');
    const a=new HostedAtsAdapter("ashby","test"),initial=await a.inspectApplicationForm(p);
    assert.equal(initial.schema.health,"DEGRADED");
    const question=initial.fields.find(f=>f.externalKey==="question");
    const questions=[{...question,answerStatus:"KNOWN",answerSource:"USER_CONFIRMED"}];
    assert.equal((await a.inspectApplicationForm(p,{questions})).schema.health,"HEALTHY");
    await p.locator('label[for="question"]').evaluate(e=>e.textContent="Descreva a resposta para o enigma ZXQ-92");
    assert.equal((await a.inspectApplicationForm(p,{questions})).schema.health,"DEGRADED");
  }finally{await b.close();}
});
test("restricao temporaria SmartRecruiters e challenge, nao formulario vazio",async()=>{
  const b=await chromium.launch({headless:true});try{const p=await b.newPage();await p.setContent('<h1>Access is temporarily restricted</h1>');assert.equal(await detectChallenge(p),"ANTI_BOT_CHALLENGE");}finally{await b.close();}
});
test("perguntas brasileiras de raca e laudo medico sao protegidas",()=>{
  for(const label of ["Você se identifica com qual raça e/ou cor?","Informe o número do CID informado em seu laudo médico."])
    assert.equal(classifyQuestion({label}).sensitive,true);
});
test("Workable reconhece upload por data-ui e ignora ID aleatorio do componente",async()=>{
  const b=await chromium.launch({headless:true});try{const p=await b.newPage(),a=new WorkableAdapter(),hashes=[];
    for(const id of ["random-one","random-two"]){await p.setContent(`<form><input type="email" aria-label="Email" required><label for="${id}">SVGs not supported by this browser.</label><input id="${id}" data-ui="resume" type="file" required></form>`);const r=await a.inspectApplicationForm(p);const field=r.fields.find(f=>f.type==="file");assert.equal(field.semanticKey,"RESUME.FILE");assert.equal(field.externalKey,"resume");hashes.push(formStructureHash(r.fields));}
    assert.equal(hashes[0],hashes[1]);
  }finally{await b.close();}
});
test("Teamtailor reconhece obrigatoriedade em portugues sem atributo required",async()=>{
  const b=await chromium.launch({headless:true});try{const p=await b.newPage();await p.setContent('<form action="/applications"><label for="candidate_email">Email*Obrigatório</label><input id="candidate_email" type="email"></form>');const r=await new TeamtailorAdapter().inspectApplicationForm(p);assert.equal(r.fields[0].required,true);}finally{await b.close();}
});
test("Ashby aguarda formulario carregado assincronamente",async()=>{
  const b=await chromium.launch({headless:true});try{const p=await b.newPage();await p.setContent('<p>Fetching application form</p>');await p.evaluate(()=>setTimeout(()=>document.body.innerHTML='<input type="email" aria-label="Email" required>',100));const r=await new AshbyAdapter().inspectApplicationForm(p);assert.equal(r.fields.length,1);}finally{await b.close();}
});
test("revisao localiza boundary desabilitado mas submit nunca clica antes de estar habilitado",async()=>{
  const b=await chromium.launch({headless:true});try{const p=await b.newPage();await p.setContent('<form action="/applications" data-testid="application-form"><button type="submit" disabled>Submit application</button></form>');
    for(const Adapter of [AshbyAdapter,WorkableAdapter,SmartRecruitersAdapter,TeamtailorAdapter]){const a=new Adapter();assert.ok(await a.findSubmitBoundary(p,{requireEnabled:false}));await assert.rejects(a.findSubmitBoundary(p));let clicked=false;await assert.rejects(a.submit(p,{onActionTriggered:()=>{clicked=true;}}));assert.equal(clicked,false);}
  }finally{await b.close();}
});
