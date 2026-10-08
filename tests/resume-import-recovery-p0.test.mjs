import test from "node:test";
import assert from "node:assert/strict";
import { ResumeSpecBuilder } from "../src/resume/resume-spec-builder.mjs";
import { ResumeDocumentValidator } from "../src/resume/resume-document-validator.mjs";

const resume={id:"resume-fixture",title:"Currículo",sections:{experience:[{title:"Analista",company:"Acme",bullets:["Linux e redes"]}],skills:["Linux","Redes"]},extraction:{contact:{candidateName:{value:"Ana Silva",source:"RESUME_PDF",confidence:.72},email:{value:"ana@example.test",source:"RESUME_PDF",confidence:.99},location:{value:"Brasília, DF",source:"RESUME_PDF",confidence:.9}}}};

test("contato extraído satisfaz ResumeSpec sem sobrescrever perfil verificado",()=>{
  const builder=new ResumeSpecBuilder(),spec=builder.build({resume});
  assert.equal(spec.candidate.fullName,"Ana Silva");
  assert.equal(spec.candidate.email,"ana@example.test");
  assert.equal(spec.candidate.location,"Brasília, DF");
  assert.ok(!new ResumeDocumentValidator().validateSpec(spec).errors.includes("CONTACT_REQUIRED"));
  const verified=builder.build({resume,profile:{personal:{email:"verified@example.test"}}});
  assert.equal(verified.candidate.email,"verified@example.test");
  assert.equal(verified.normalization.contactConflicts[0].field,"email");
  assert.equal(verified.normalization.requiresReview,true);
});

test("currículo sem contato requer revisão sem invalidar a importação",()=>{
  const spec=new ResumeSpecBuilder().build({resume:{...resume,extraction:{contact:{}}}}),validation=new ResumeDocumentValidator().validateSpec(spec);
  assert.ok(validation.errors.includes("CONTACT_REQUIRED"));
  assert.equal(resume.id,"resume-fixture");
});
