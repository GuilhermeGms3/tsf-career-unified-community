import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { ResumeService } from "../src/resume/resume-service.mjs";
import { ResumeBatchService } from "../src/resume/batch/resume-batch-service.mjs";
import { ResumeComparisonService } from "../src/resume/batch/resume-comparison-service.mjs";
import { BoundedStageWorker } from "../src/resume/batch/bounded-stage-worker.mjs";
import { ResumeSelector } from "../src/intelligence/tasks/resume-selector.mjs";
import { ResumeTailor } from "../src/intelligence/tasks/resume-tailor.mjs";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";
import { LocalLatexCompiler } from "../src/resume/compiler/latex-compiler.mjs";
import { DocumentExportService } from "../src/resume/export/document-export-service.mjs";
import { BatchExportService } from "../src/resume/export/batch-export-service.mjs";

// Synthetic, local-only validation. Never opens the user's runtime database.
const dataDir = await mkdtemp(path.join(os.tmpdir(), "resume-batch-validation-"));
const store = await new UnifiedStateStore({dataDir}).initialize();
const workers = [];
const profile = {personal:{fullName:"Pessoa Teste",email:"pessoa@example.test",city:"Brasilia",country:"Brasil"},career:{headline:"Analista de Suporte",skills:["Linux","Docker"]}};
const engine = process.env.CAREER_ENGINE_URL || "http://career-engine:7130";
let activeRenders=0, peakRenders=0;
const compiler = new LocalLatexCompiler();
const compile = compiler.compile.bind(compiler);
compiler.compile = async input => {activeRenders++;peakRenders=Math.max(peakRenders,activeRenders);try{return await compile(input);}finally{activeRenders--;}};
const extract = async file => {
  const response = await fetch(`${engine}/documents/extract`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({filename:"fixture.pdf",data:(await readFile(file)).toString("base64")})});
  if(!response.ok) throw new Error(`Local extraction HTTP ${response.status}`);
  return response.json();
};
try {
  assert.equal((await compiler.health()).status,"HEALTHY");
  const timestamp=new Date().toISOString();
  for(const id of ["job-a","job-b"])store.jobs.upsert({id,title:"Analista de Suporte Junior",company:"Empresa Fixture",location:"Brasilia",description:"Suporte Linux e Docker. Atendimento de chamados.",status:"open",createdAt:timestamp,updatedAt:timestamp});
  for(const id of ["resume-a","resume-b"])store.resumes.upsert({id,title:`Base ${id}`,text:"Resumo\nProfissional de suporte\nExperiencia\nAtendi chamados Linux e documentei incidentes.\nCompetencias\nLinux Docker\nEducacao\nInstituto Fixture",sections:{summary:"Profissional de suporte",experience:[{title:"Analista de Suporte",company:"Empresa Fixture",startDate:"2024",endDate:"2025",bullets:["Atendi chamados Linux e documentei incidentes."]}],skills:["Linux","Docker"],education:[{institution:"Instituto Fixture",degree:"Tecnologia",endDate:"2025"}]},createdAt:timestamp,updatedAt:timestamp});
  const resumeService=new ResumeService({store,dataDir,profileProvider:async()=>profile,compiler,pdfTextExtractor:extract,matcher:runAtsMatcherV2});
  const documentExportService=new DocumentExportService({versions:store.resumeVersions,artifacts:store.resumeArtifacts,exports:store.documentExports,artifactService:store.resumeArtifactService});
  const comparisonService=new ResumeComparisonService({store,matcher:runAtsMatcherV2,profileProvider:async()=>profile});
  const tailor=new ResumeTailor({execute:async()=>({result:{changes:[]},meta:{promptVersion:"fixture-v1",schemaVersion:"fixture-v1"}})});
  const service=new ResumeBatchService({store,resumeSelector:new ResumeSelector(),comparisonService,tailor,resumeService,documentExportService,profileProvider:async()=>profile});
  const pool=(status,handler,concurrency)=>{const worker=new BoundedStageWorker({repository:store.resumeBatches,status,handler,concurrency,pollIntervalMs:20});workers.push(worker);return worker.start();};
  service.attachWorkers({analysis:pool("ANALYZING",item=>service.analyzeItem(item),4),tailoring:pool("TAILORING",item=>service.tailorItem(item),2),build:pool("BUILDING_VERSION",item=>service.buildItem(item),4),render:pool("RENDERING",item=>service.renderItem(item),2)});
  const started=performance.now();
  const batch=service.create({jobIds:["job-a","job-b"],baseResumeId:"resume-a",comparisonResumeIds:["resume-b"],requestedOutputs:["pdf","latex","overleaf"]});
  service.compare(batch.id);
  const waitFor=async predicate=>{const deadline=Date.now()+180000;while(Date.now()<deadline){const state=service.get(batch.id);if(state.failedItems)throw new Error(JSON.stringify(state.items.map(({status,failureCode,resumeVersionId})=>({status,failureCode,renders:resumeVersionId?store.resumeRenderRuns.forVersion(resumeVersionId):[]}))));if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error("Batch fixture timed out");};
  let current=await waitFor(state=>state.status==="AWAITING_SELECTION");
  service.select(batch.id,current.items.map(item=>({itemId:item.id,resumeId:"resume-a"})));
  service.tailor(batch.id);await waitFor(state=>state.items.every(item=>item.status==="TAILORING_REVIEW_REQUIRED"));
  service.approve(batch.id,{phase:"TAILORING"});await waitFor(state=>state.items.every(item=>item.status==="VERSION_REVIEW_REQUIRED"));
  service.approve(batch.id,{phase:"VERSION"});service.render(batch.id);
  current=await waitFor(state=>state.status==="COMPLETED");
  const exported=await new BatchExportService({store}).build(batch.id);
  assert.equal(current.completedItems,2);assert.equal(new Set(current.items.map(item=>item.resumeVersionId)).size,2);
  assert.equal(exported.manifest.missing.length,0);
  for(const item of current.items){const artifact=store.resumeArtifacts.latest(item.resumeVersionId,"PDF");assert.equal(artifact.validation.valid,true);assert.ok(artifact.validation.text.includes("Pessoa Teste"));}
  console.log(JSON.stringify({status:"PASS",durationMs:Math.round(performance.now()-started),peakRenders,items:current.items.map(item=>({jobId:item.jobId,purpose:item.version.purpose,status:item.status,outputs:item.outputStatus})),zipBytes:exported.data.length,zipFiles:exported.manifest.items.flatMap(item=>item.files).length,renderRuns:current.items.flatMap(item=>store.resumeRenderRuns.forVersion(item.resumeVersionId)).map(run=>({status:run.status,durationMs:run.durationMs})),applications:store.applications.all().length},null,2));
} finally {
  for(const worker of workers)worker.stop();
  while(workers.some(worker=>worker.running))await new Promise(resolve=>setTimeout(resolve,25));
  store.close();
  if(path.dirname(dataDir)===path.resolve(os.tmpdir())&&path.basename(dataDir).startsWith("resume-batch-validation-"))await rm(dataDir,{recursive:true,force:true});
}
