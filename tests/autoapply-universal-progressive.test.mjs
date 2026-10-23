import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";
import { submitHomologation, FORM_ENGINE_VERSION } from "../src/automation/ats/submit-homologation.mjs";
import { reusableFormAnswer, reusableApplicationLibraryAnswer } from "../src/application/answer-reuse-policy.mjs";
import { CandidateKnowledgeBase } from "../src/application/candidate-knowledge-base.mjs";
import { GenericAdapter } from "../src/automation/ats/generic/generic-adapter.mjs";
import { questionFingerprint } from "../src/application/question-semantics.mjs";
import { ApplicationEngine } from "../src/automation/application-engine.mjs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";

test("evidencia historica nao autoriza automaticamente nenhum provider",()=>{
  const registry=new AdapterRegistry();
  for(const capability of registry.listCapabilities())assert.equal(capability.externalSubmitVerified,false,capability.atsType);
  const nerdin=registry.describe("nerdin");
  assert.equal(nerdin.canSubmit,true);
  assert.deepEqual(nerdin.homologation.evidence,[]);
  assert.equal(nerdin.homologation.status,"NOT_VERIFIED");
  nerdin.homologation.evidence.push({status:"APPROVED"});
  assert.deepEqual(registry.describe("nerdin").homologation.evidence,[]);
  assert.equal(registry.describe("nerdin").externalSubmitVerified,false);
});

test("homologacao exige versao, cenario, prazo, recibo e aprovacao operacional",()=>{
  const record={provider:"fixture",adapterVersion:"v1",formEngineVersion:FORM_ENGINE_VERSION,scenario:"public-form",status:"APPROVED",result:"EXTERNALLY_CONFIRMED",observedAt:"2026-01-01",validUntil:"2026-12-01",receiptReference:"synthetic-receipt",evidenceReference:"synthetic-evidence"};
  const check=(change={},context={})=>submitHomologation("fixture","v1",{scenario:"public-form",now:Date.parse("2026-10-23"),records:[{...record,...change}],...context}).automaticSubmitEligible;
  assert.equal(check(),true);
  for(const change of [{adapterVersion:"v0"},{formEngineVersion:"old"},{scenario:"another"},{status:"REVOKED"},{result:"FIXTURE_PASS"},{receiptReference:""},{evidenceReference:""},{validUntil:"invalid"},{validUntil:"2026-01-02"},{observedAt:"2027-01-01"}])assert.equal(check(change),false);
  assert.equal(check({},{scenario:""}),false);
});

const field={semanticKey:"PROFESSIONAL.ENGLISH_LEVEL",type:"select-one",fingerprint:"current",answerCategory:"FACT",confidence:1,required:true};
const answer={...field,answerType:"select-one",source:"USER_CONFIRMED",verified:true,reusable:true,answerValue:"B2",scope:{}};
test("resposta exige fingerprint, tipo, origem humana, validade e escopo compativeis",()=>{
  assert.equal(reusableFormAnswer(field,[answer]),answer);
  for(const change of [{fingerprint:"old"},{answerType:"text"},{source:"LLM_DRAFT"},{verified:false},{reusable:false},{scope:{expiresAt:"2000-01-01"}},{scope:{expiresAt:"bad"}},{scope:{jobId:"another"}},{scope:{applicationId:"another"}}])assert.equal(reusableFormAnswer(field,[{...answer,...change}]),null);
  assert.equal(CandidateKnowledgeBase.fromFacts([],[answer]).get(field.semanticKey),null);
  assert.equal(new GenericAdapter().mapFields({fields:[field]},CandidateKnowledgeBase.fromFacts([],[answer]))[0].answer,"B2");
});
test("salario, disponibilidade, consentimento e declaracoes exigem resposta da candidatura",()=>{
  for(const semanticKey of ["COMPENSATION.EXPECTED_SALARY","APPLICATION.NOTICE_PERIOD","CONSENT.TERMS","WORK_AUTHORIZATION.AUTHORIZED","DEMOGRAPHIC.SENSITIVE"]){
    const specific={...field,semanticKey};assert.equal(reusableFormAnswer(specific,[{...answer,semanticKey}]),null);
    const knowledge=new CandidateKnowledgeBase([{key:semanticKey,value:"yes",verified:true,verificationStatus:"USER_CONFIRMED",reusePolicy:"REUSABLE"}]);
    assert.equal(new GenericAdapter().mapFields({fields:[specific]},knowledge)[0].answerStatus,"USER_REQUIRED");
  }
});
test("biblioteca Gupy exige origem, tipo e escopo e nao reutiliza campos protegidos",()=>{
  const field={type:"text",category:"EXPERIENCE"},answer={value:"confirmed",provenance:"USER_CONFIRMED",scope:{provider:"GUPY",type:"text"}};
  assert.equal(reusableApplicationLibraryAnswer(field,answer),true);
  for(const flags of [{explicitOnly:true},{sensitive:true},{category:"CONSENT"},{normalizedSemanticType:"APPLICATION.MOTIVATION"}])assert.equal(reusableApplicationLibraryAnswer({...field,...flags},answer),false);
  for(const scope of [{provider:"GUPY",type:"select-one"},{provider:"OTHER",type:"text"},{provider:"GUPY",type:"text",expiresAt:"2000-01-01"}])assert.equal(reusableApplicationLibraryAnswer(field,{...answer,scope}),false);
});
test("resposta humana negativa nao e confundida com resposta ausente",()=>{
  const field={externalKey:"q",semanticKey:"CUSTOM.QUESTION",fingerprint:"synthetic-negative",type:"radio-group",confidence:0,required:true,options:[{value:"false",label:"No"}]};
  const question={...field,answerStatus:"KNOWN",answerSource:"USER_CONFIRMED",answerValue:false};
  const mapped=new GenericAdapter().mapFields({fields:[field]},new CandidateKnowledgeBase(),[question]);
  assert.equal(mapped[0].answerStatus,"KNOWN");assert.equal(mapped[0].answer,"false");
});
test("experiencia em stacks distintas nao compartilha fingerprint",()=>{
  const fp=label=>questionFingerprint({ats:"fixture",semanticKey:"PROFESSIONAL.SKILL_EXPERIENCE",label,type:"text"});
  assert.notEqual(fp("Experiencia com Java"),fp("Experiencia com Python"));
  const optionFp=value=>questionFingerprint({semanticKey:"PROFESSIONAL.ENGLISH_LEVEL",type:"select-one",options:[{label:"Intermediate",value}]});
  assert.notEqual(optionFp("B1"),optionFp("B2"));
});

test("combobox seleciona somente opcao exata e nao executa submit",async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<label for="city">Cidade</label><input id="city" role="combobox" aria-controls="cities" required><div id="cities" role="listbox"><div role="option" onclick="document.getElementById(\'city\').value=this.textContent">Brasilia</div></div><button type="submit" onclick="window.sent=true">Enviar</button>');
    const adapter=new GenericAdapter(),inspected=await adapter.inspectApplicationForm(page);
    assert.equal(inspected.fields[0].type,"combobox");
    const mapped=adapter.mapFields(inspected,CandidateKnowledgeBase.fromProfile({personal:{city:"Brasilia"}}));
    assert.equal((await adapter.fill(page,mapped))[0].status,"FILLED");
    assert.equal(await page.locator("#city").inputValue(),"Brasilia");
    assert.equal(await page.evaluate(()=>Boolean(window.sent)),false);
    const bad=adapter.mapFields(inspected,CandidateKnowledgeBase.fromProfile({personal:{city:"Lisboa"}}));
    assert.equal(bad[0].answerStatus,"USER_REQUIRED");
  }finally{await browser.close();}
});

test("frame externo nao recebe fatos; frame substituido falha sem fallback na pagina",async()=>{
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.route("**/*",route=>route.fulfill({contentType:"text/html",body:route.request().url().includes("other.test")?'<input aria-label="Email" type="email">':'<input aria-label="Email" type="email"><iframe src="https://other.test/form"></iframe>'}));
    await page.goto("https://careers.test/form");await page.frames()[1].waitForLoadState();
    const adapter=new GenericAdapter(),inspected=await adapter.inspectApplicationForm(page);
    assert.equal(inspected.fields.length,1);
    assert.equal(inspected.blockedFrames[0].reason,"CROSS_ORIGIN_FORM");
    const mapped=adapter.mapFields(inspected,CandidateKnowledgeBase.fromProfile({personal:{email:"candidate@example.test"}}));
    mapped[0].frameIndex=1;
    const audit=await adapter.fill(page,mapped);assert.equal(audit[0].code,"FORM_FRAME_CHANGED");
    assert.equal(await page.locator("input").inputValue(),"");
  }finally{await browser.close();}
});

test("todos os adapters assistidos compartilham controles sem ganhar submit",async()=>{
  const registry=new AdapterRegistry(),browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage();await page.setContent('<label for="email">Email</label><input type="email" id="email" required>');
    for(const capability of registry.listCapabilities().filter(item=>item.level==="ASSISTED_FILL"&&item.atsType!=="workday")){
      const adapter=registry.get(capability.atsType),inspected=await adapter.inspectApplicationForm(page);
      const mapped=adapter.mapFields(inspected,CandidateKnowledgeBase.fromProfile({personal:{email:"candidate@example.test"}}));
      assert.equal((await adapter.fill(page,mapped))[0].status,"FILLED",capability.atsType);
      assert.equal(capability.canSubmit,false,capability.atsType);
      await page.locator("input").fill("");
    }
  }finally{await browser.close();}
});

for(const scenario of ["unknown","known","failed-fill"])test(`engine trata ${scenario} sem falso pronto e fecha navegador`,async()=>{
  const known=scenario==="known",failedFill=scenario==="failed-fill";
  const browser=await chromium.launch({headless:true}),dataDir=await mkdtemp(path.join(os.tmpdir(),"universal-form-"));
  try{
    await mkdir(path.join(dataDir,"resumes"));const storedPath=path.join(dataDir,"resumes","synthetic.txt");await writeFile(storedPath,"Synthetic resume");
    const page=await browser.newPage();page.setDefaultTimeout(500);await page.route("**/*",route=>route.fulfill({contentType:"text/html",body:`<label for="email">Email</label><input id="email" type="email" required ${failedFill?'readonly value="candidate@example.test"':''} oninput="if(!document.getElementById('extra'))this.insertAdjacentHTML('afterend','<label for=extra>${known?"Cidade":"Informe o codigo do projeto"}</label><input id=extra required>')">`}));
    const application={id:"fixture-app",jobId:"fixture-job",status:"QUEUED"},plan={selectedResumeId:"fixture-base",atsType:"generic"},events=[],attempts=new Map();let questions=[],inspection,finalized;
    const knowledge=CandidateKnowledgeBase.fromProfile({personal:{email:"candidate@example.test",...(known?{city:"Brasilia"}:{})}});
    const store={
      applications:{findById:()=>application,recordEvent:(_id,type,metadata)=>events.push({type,metadata})},
      applicationPlans:{forApplication:()=>plan,save:value=>Object.assign(plan,value)},
      applicationService:{transitionApplication:(_id,status)=>{application.status=status;}},
      jobs:{findById:()=>({id:application.jobId,url:"https://careers.test/form"})},
      resumes:{findById:()=>({id:"fixture-base",storedPath})},
      applicationAttempts:{nextNumber:()=>1,upsert:value=>{attempts.set(value.id,value);return value;},findById:id=>attempts.get(id)},
      candidateFacts:{syncProfile:()=>{},active:()=>knowledge.all(),markUsed:()=>{}},
      candidateAnswers:{reusable:()=>[]},
      applicationQuestions:{forApplication:()=>questions,sync:(_id,fields)=>{questions=fields;}},
      applicationInspections:{latest:()=>inspection,create:value=>{inspection={id:"fixture-inspection",...value};return inspection;},updateOutcome:(_id,value)=>Object.assign(inspection,value)},
    };
    const manager={headless:false,resume:()=>null,open:async(_app,attemptId)=>({page,attemptId}),screenshot:async()=>{},stopTrace:async()=>{},finalize:async(_session,options)=>{finalized=options;await page.close();},status:()=>({status:"CLOSED"})};
    const engine=new ApplicationEngine({store,dataDir,profileProvider:async()=>({}),browserManager:manager});
    engine.preflight={evaluate:async()=>({status:"READY"})};
    if(failedFill){
      await assert.rejects(engine.run({applicationId:application.id,mode:"FILL_ONLY"}),{code:"FIELD_TIMEOUT"});
      assert.equal(application.status,"RETRYABLE");assert.equal(finalized.keepOpen,false);assert.equal(page.isClosed(),true);
      assert.ok(!events.some(event=>event.type==="READY_TO_SUBMIT"));return;
    }
    const result=await engine.run({applicationId:application.id,mode:"FILL_ONLY"});
    assert.equal(result.application.status,"WAITING_USER");assert.equal(result.attempt.errorCode,known?"FORM_CHANGED_REVIEW_REQUIRED":"REQUIRED_FIELD_UNKNOWN");
    assert.ok(questions.some(field=>field.externalKey==="extra"&&field.required&&field.answerStatus===(known?"KNOWN":"USER_REQUIRED")));
    assert.ok(events.some(event=>event.type==="FORM_CHANGED_AFTER_FILL"));assert.equal(finalized.keepOpen,false);assert.equal(page.isClosed(),true);
  }finally{await browser.close();await rm(dataDir,{recursive:true,force:true});}
});

test("snapshot completo retira pergunta obsoleta da fila sem apagar historico; parcial nao retira",async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"question-snapshot-"));const store=await new UnifiedStateStore({dataDir}).initialize();
  try{
    const now=new Date().toISOString();store.jobs.upsert({id:"j",title:"Synthetic",url:"https://careers.test/1",createdAt:now,updatedAt:now});
    store.resumes.upsert({id:"r",title:"Synthetic base",text:"Synthetic",createdAt:now,updatedAt:now});
    store.applications.create({id:"a",jobId:"j",resumeId:"r",status:"PLANNED",createdAt:now,updatedAt:now});
    const field={externalKey:"q",fingerprint:"v1",label:"Synthetic question",type:"text",required:true,answerStatus:"USER_REQUIRED"};
    const [question]=store.applicationQuestions.sync("a",[field]);
    const request=store.whatsappQuestions.prepare({applicationId:"a",questionId:question.id,commandToken:"PERG-SYNTHETIC",targetHash:"synthetic"});store.whatsappQuestions.markSent(request.id);
    store.applicationQuestions.sync("a",[]);assert.equal(store.applicationQuestions.forApplication("a")[0].required,true);
    store.applicationQuestions.sync("a",[],{complete:true});
    const retired=store.applicationQuestions.forApplication("a")[0];assert.equal(retired.id,question.id);assert.equal(retired.required,false);
    assert.equal(store.whatsappQuestions.findById(request.id).status,"DEFERRED");
    store.applicationQuestions.sync("a",[field],{complete:true});assert.equal(store.applicationQuestions.forApplication("a")[0].answerStatus,"USER_REQUIRED");
    store.applicationQuestions.answer("a",question.id,"confirmed");
    store.applicationQuestions.sync("a",[],{complete:true});store.applicationQuestions.sync("a",[field],{complete:true});
    assert.equal(store.applicationQuestions.forApplication("a")[0].answerValue,"confirmed");
    assert.equal(store.applicationQuestions.forApplication("a")[0].answerStatus,"KNOWN");
    assert.equal(store.database.connection.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    assert.equal(store.database.connection.prepare("PRAGMA foreign_key_check").all().length,0);
  }finally{store.close();await rm(dataDir,{recursive:true,force:true});}
});
