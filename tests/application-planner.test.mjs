import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationPlanner } from "../src/application/application-planner.mjs";
import { PolicyEngine } from "../src/application/policy-engine.mjs";
import { CandidateKnowledgeBase } from "../src/application/candidate-knowledge-base.mjs";

const base=()=>({application:{id:"app-1",jobId:"job-1",resumeId:"resume-1"},job:{id:"job-1",title:"Engineer",company:"Acme",description:"Linux",url:"https://boards.greenhouse.io/acme/jobs/1",status:"open"},analysis:{id:"analysis-1",resumeId:"resume-1",overallScore:87,eligibility:"ELIGIBLE",blockingIssues:[],warnings:[],unknownRequirements:[]},resumes:[{id:"resume-1"}],existingApplications:[],essentialFactsKnown:true});
test("planner decide APPLY para candidato elegivel",()=>assert.equal(new ApplicationPlanner().plan(base()).decision,"APPLY"));
test("planner decide REVIEW para requisito desconhecido",()=>{const x=base();x.analysis.unknownRequirements=[{key:"auth"}];assert.equal(new ApplicationPlanner().plan(x).decision,"REVIEW")});
test("planner decide SKIP sem curriculo",()=>{const x=base();x.resumes=[];assert.equal(new ApplicationPlanner().plan(x).decision,"SKIP")});
test("planner decide BLOCKED com blocker",()=>{const x=base();x.analysis.blockingIssues=[{reason:"required"}];assert.equal(new ApplicationPlanner().plan(x).decision,"BLOCKED")});
test("planner respeita score minimo",()=>{const x=base();x.analysis.overallScore=64;assert.equal(new ApplicationPlanner().plan(x).decision,"SKIP")});
test("planner impede candidatura duplicada",()=>{const x=base();x.existingApplications=[{id:"other",jobId:"job-1",status:"PLANNED",company:"Acme"}];assert.equal(new ApplicationPlanner().plan(x).decision,"SKIP")});
test("planner bloqueia empresa configurada",()=>assert.equal(new ApplicationPlanner({blockedCompanies:["acme"]}).plan(base()).decision,"BLOCKED"));
test("policy snapshot e seguro e exige revisao",()=>{const p=new ApplicationPlanner({requireReviewBeforeSubmit:false}).plan(base());assert.equal(p.policySnapshot.requireReviewBeforeSubmit,true);assert.equal(p.requiresReview,true)});
test("planner detecta Greenhouse somente pelo hostname",()=>assert.equal(new ApplicationPlanner().plan(base()).atsType,"greenhouse"));
test("planner roteia destinos reconhecidos sem depender da fonte de descoberta",()=>{
  const cases=[
    ["https://jobs.smartrecruiters.com/acme/123/engineer","smartrecruiters"],
    ["https://apply.workable.com/acme/j/ABC123/","workable"],
    ["https://www.nerdin.com.br/vaga_emprego/analista-123.php","nerdin"],
    ["https://www.remotar.com.br/job/123","remotar"],
    ["https://www.infojobs.com.br/vaga-de-analista-em-df__123.aspx","infojobs"],
  ];
  for(const [url,expected] of cases){const x=base();x.job.url=url;x.job.applicationUrl=url;assert.equal(new ApplicationPlanner().plan(x).atsType,expected,url);}
});
test("planner não confia em domínio parecido com ATS conhecido",()=>{const x=base();x.job.url="https://nerdin.example/vaga/123";x.job.applicationUrl=x.job.url;assert.equal(new ApplicationPlanner().plan(x).atsType,"unknown");});
test("knowledge base nao inventa fatos ausentes",()=>{const kb=CandidateKnowledgeBase.fromProfile({personal:{fullName:"Ana Silva",email:"a@b.test"}});assert.equal(kb.get("IDENTITY.FIRST_NAME").value,"Ana");assert.equal(kb.get("WORK_AUTHORIZATION.AUTHORIZED"),null)});
test("PolicyEngine centraliza defaults seguros",()=>{const p=new PolicyEngine();assert.equal(p.policy.autoFillEnabled,true);assert.equal(p.policy.unknownCriticalAnswerBehavior,"REVIEW")});
