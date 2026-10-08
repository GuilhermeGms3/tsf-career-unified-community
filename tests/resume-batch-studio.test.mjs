import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { HubDatabase } from "../db/database.mjs";
import { ResumeVersionService } from "../src/resume/resume-version-service.mjs";
import { BoundedStageWorker } from "../src/resume/batch/bounded-stage-worker.mjs";
import { ResumeDocumentWorker } from "../src/resume/resume-document-worker.mjs";
import { ResumeBatchService } from "../src/resume/batch/resume-batch-service.mjs";
import { ResumeComparisonService } from "../src/resume/batch/resume-comparison-service.mjs";
import { runAtsMatcherV2 } from "../src/matching/ats-matcher-v2.mjs";
import { BatchExportService } from "../src/resume/export/batch-export-service.mjs";
import {
  isTerminalJobStatus,
  requiresHumanReview,
} from "../public/features/shared/job-status.js";

async function fixture() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "resume-batch-studio-")),
    store = await new UnifiedStateStore({ dataDir }).initialize(),
    timestamp = new Date().toISOString();
  for (const id of ["job-a", "job-b"])
    store.jobs.upsert({
      id,
      title: `Backend ${id}`,
      company: "Acme",
      location: "Remote",
      description: "Node.js Docker",
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  for (const id of ["resume-a", "resume-b"])
    store.resumes.upsert({
      id,
      title: `Base ${id}`,
      text: "Node.js Docker",
      sections: { summary: "Backend" },
      resumeKind: id === "resume-a" ? "BASE" : "DERIVED",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  store.database.setMetadata("default_resume_id", "resume-a");
  return {
    dataDir,
    store,
    async close() {
      this.store.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("ResumeVersion separa conteúdo idêntico por vaga e reutiliza a mesma vaga", async () => {
  const f = await fixture();
  try {
    const service = new ResumeVersionService({
        versions: f.store.resumeVersions,
      }),
      base = {
        resumeId: "resume-a",
        templateId: "ATS_CLEAN",
        templateVersion: "ats-clean-v1",
        language: "pt-BR",
        contentHash: "same-content",
        resumeSpec: { candidate: { fullName: "Pessoa" } },
        source: "TEST",
      };
    const first = service.createDraft({ ...base, jobId: "job-a" }),
      second = service.createDraft({ ...base, jobId: "job-b" }),
      repeated = service.createDraft({ ...base, jobId: "job-a" });
    assert.equal(first.purpose, "JOB_SPECIFIC");
    assert.notEqual(first.id, second.id);
    assert.equal(repeated.id, first.id);
    assert.equal(repeated.reused, true);
  } finally {
    await f.close();
  }
});

test("ResumeVersion genérica mantém identidade separada da específica", async () => {
  const f = await fixture();
  try {
    const service = new ResumeVersionService({
        versions: f.store.resumeVersions,
      }),
      base = {
        resumeId: "resume-a",
        templateId: "ATS_CLEAN",
        templateVersion: "ats-clean-v1",
        language: "pt-BR",
        contentHash: "same-content",
        resumeSpec: {},
        source: "TEST",
      },
      generic = service.createDraft(base),
      specific = service.createDraft({
        ...base,
        jobId: "job-a",
        batchRunId: "batch-context",
        batchItemId: "item-context",
      });
    assert.notEqual(generic.id, specific.id);
    assert.equal(generic.purpose, "GENERIC");
    assert.equal(specific.batchRunId, "batch-context");
  } finally {
    await f.close();
  }
});

test("migration 023 preserva histórico e infere purpose apenas pelo job_id", async () => {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),"resume-batch-migration-")),migrationsDir=path.join(dataDir,"migrations"),databasePath=path.join(dataDir,"history.sqlite");await mkdir(migrationsDir);const sourceDir=path.resolve(import.meta.dirname,"..","db","migrations"),names=(await readdir(sourceDir)).filter(name=>/^0(?:0[1-9]|1\d|2[0-2])_/.test(name));for(const name of names)await copyFile(path.join(sourceDir,name),path.join(migrationsDir,name));
  let database=await new HubDatabase(databasePath,{migrationsDir}).initialize();const timestamp=new Date().toISOString();database.connection.prepare("INSERT INTO jobs(id,title,company,location,description,created_at,updated_at) VALUES('history-job','Backend','Acme','Remote','Node',?,?)").run(timestamp,timestamp);database.connection.prepare("INSERT INTO resumes(id,title,text,created_at,updated_at) VALUES('history-resume','Base','Node',?,?)").run(timestamp,timestamp);database.connection.prepare("INSERT INTO resume_versions(id,resume_id,job_id,template_id,template_version,language,status,content_hash,resume_spec_json,source,created_at,updated_at) VALUES('history-specific','history-resume','history-job','ATS_CLEAN','ats-clean-v1','pt-BR','REVIEW_REQUIRED','specific-hash','{}','TEST',?,?),('history-generic','history-resume',NULL,'ATS_CLEAN','ats-clean-v1','pt-BR','REVIEW_REQUIRED','generic-hash','{}','TEST',?,?)").run(timestamp,timestamp,timestamp,timestamp);database.close();database=await new HubDatabase(databasePath).initialize();try{assert.equal(database.connection.prepare("SELECT purpose FROM resume_versions WHERE id='history-specific'").get().purpose,"JOB_SPECIFIC");assert.equal(database.connection.prepare("SELECT purpose FROM resume_versions WHERE id='history-generic'").get().purpose,"GENERIC");assert.equal(database.connection.prepare("SELECT COUNT(*) count FROM resume_versions").get().count,2);}finally{database.close();await rm(dataDir,{recursive:true,force:true});}
});

test("batch persiste intenção e rejeita saltos arbitrários de item", async () => {
  const f = await fixture();
  try {
    const batch = f.store.resumeBatches.create({
      jobIds: ["job-a", "job-b"],
      baseResumeId: "resume-a",
      comparisonResumeIds: ["resume-b"],
      requestedOutputs: { pdf: true, latex: true },
      language: "pt-BR",
    });
    assert.equal(batch.items.length, 2);
    assert.equal(batch.status, "DRAFT");
    assert.throws(
      () => f.store.resumeBatches.transitionItem(batch.items[0].id, "READY"),
      (error) => error.code === "RESUME_BATCH_ITEM_TRANSITION_INVALID",
    );
    f.store.resumeBatches.startComparing(batch.id);
    assert.equal(
      f.store.resumeBatches
        .findById(batch.id)
        .items.filter((item) => item.status === "ANALYZING").length,
      2,
    );
    f.store.resumeBatches.startComparing(batch.id);
    assert.equal(f.store.resumeBatches.findById(batch.id).status, "ANALYZING");
  } finally {
    await f.close();
  }
});

test("pools limitados preenchem todos os slots disponíveis", async () => {
  const queue = Array.from({ length: 7 }, (_, index) => ({
      id: `item-${index}`,
    })),
    completed = [];
  let running = 0,
    peak = 0;
  const repository = {
      claim: () => queue.shift() || null,
      release: () => {},
      findItem: () => null,
    },
    worker = new BoundedStageWorker({
      repository,
      status: "ANALYZING",
      concurrency: 4,
      pollIntervalMs: 10,
      handler: async (item) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 20));
        completed.push(item.id);
        running -= 1;
      },
    });
  worker.start();
  const deadline = Date.now() + 1000;
  while (completed.length < 7 && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  worker.stop();
  assert.equal(peak, 4);
  assert.equal(completed.length, 7);
});

test("recovery libera item stale e worker o processa sem novo comando", async () => {
  const f = await fixture();
  try {
    const batch = f.store.resumeBatches.create({
      jobIds: ["job-a"],
      baseResumeId: "resume-a",
      comparisonResumeIds: [],
      requestedOutputs: { pdf: true },
      language: "pt-BR",
    });
    f.store.resumeBatches.startComparing(batch.id);
    const claimed = f.store.resumeBatches.claim("ANALYZING", "crashed-worker");
    // A restart invalidates even a recently acquired lease from the old owner.
    f.store.close();
    f.store = await new UnifiedStateStore({ dataDir: f.dataDir }).initialize();
    const worker = new BoundedStageWorker({
      repository: f.store.resumeBatches,
      status: "ANALYZING",
      pollIntervalMs: 10,
      handler: async (item) =>
        f.store.resumeBatches.transitionItem(item.id, "ANALYZED", {
          recommendedResumeId: "resume-a",
        }),
    });
    worker.start();
    const deadline = Date.now() + 1000;
    while (
      f.store.resumeBatches.findItem(claimed.id).status !== "ANALYZED" &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    while (worker.running && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    worker.stop();
    assert.equal(f.store.resumeBatches.findItem(claimed.id).status, "ANALYZED");
  } finally {
    await f.close();
  }
});

test("filas técnicas reutilizam trabalho ativo equivalente", async () => {
  const f = await fixture();
  try {
    const first = f.store.resumeDocumentJobs.enqueue("RENDER", {
        resumeVersionId: "version-x",
      }),
      repeated = f.store.resumeDocumentJobs.enqueue("RENDER", {
        resumeVersionId: "version-x",
      }),
      tailor = f.store.intelligenceJobs.enqueue("RESUME_TAILORING", {
        jobId: "job-a",
        resumeId: "resume-a",
      }),
      tailorRepeated = f.store.intelligenceJobs.enqueue("RESUME_TAILORING", {
        jobId: "job-a",
        resumeId: "resume-a",
      });
    assert.equal(first.id, repeated.id);
    assert.equal(tailor.id, tailorRepeated.id);
  } finally {
    await f.close();
  }
});

test("restart recupera render recente e worker processa sem novo comando", async () => {
  const f=await fixture();let worker;
  try {
    const version=f.store.resumeVersions.create({resumeId:"resume-a",jobId:"job-a",templateId:"ATS_CLEAN",templateVersion:"ats-clean-v1",language:"pt-BR",status:"RENDERING",contentHash:"restart-render",resumeSpec:{},source:"TEST",approvedAt:new Date().toISOString()});
    const queued=f.store.resumeDocumentJobs.enqueue("RENDER",{resumeVersionId:version.id});f.store.resumeDocumentJobs.claim("old-worker");
    f.store.close();f.store=await new UnifiedStateStore({dataDir:f.dataDir}).initialize();
    assert.equal(f.store.resumeDocumentJobs.findById(queued.id).status,"QUEUED");assert.equal(f.store.resumeVersions.findById(version.id).status,"FAILED");
    worker=new ResumeDocumentWorker({repository:f.store.resumeDocumentJobs,pollIntervalMs:10,handlers:{RENDER:async()=>({version:f.store.resumeVersions.transition(version.id,"READY")})}}).start();
    await waitFor(()=>f.store.resumeDocumentJobs.findById(queued.id).status==="COMPLETED");
  } finally {worker?.stop();await f.close();}
});

test("REVIEW_REQUIRED é estado terminal de espera humana", () => {
  assert.equal(isTerminalJobStatus("REVIEW_REQUIRED"), true);
  assert.equal(requiresHumanReview("REVIEW_REQUIRED"), true);
  assert.equal(isTerminalJobStatus("RUNNING"), false);
});

test("comparação reutiliza identidade atual e invalida ao mudar conhecimento ou currículo", async () => {
  const f=await fixture();
  try {
    let calls=0, revision=1;
    const service=new ResumeComparisonService({store:f.store, matcher:input=>{calls++;return runAtsMatcherV2(input);},profileProvider:async()=>({}),contextProvider:()=>({knowledgeRevision:revision})});
    const create=()=>f.store.resumeBatches.create({jobIds:["job-a"],baseResumeId:"resume-a",comparisonResumeIds:[],requestedOutputs:{latex:true},language:"pt-BR"});
    const first=create(),second=create();
    await service.compare(first.items[0],["resume-a"]);
    const reused=await service.compare(second.items[0],["resume-a"]);
    assert.equal(calls,1);assert.equal(reused[0].reused,true);
    await service.compare(first.items[0],["resume-a"]);assert.equal(calls,1);
    revision++;await service.compare(first.items[0],["resume-a"]);assert.equal(calls,2);
    f.store.resumes.upsert({...f.store.resumes.findById("resume-a"),text:"Node Docker Kubernetes",updatedAt:new Date().toISOString()});
    await service.compare(first.items[0],["resume-a"]);assert.equal(calls,3);
  } finally {await f.close();}
});

test("comandos rejeitam listas malformadas e idioma desconhecido", async () => {
  const f=await fixture();
  try {
    const service=new ResumeBatchService({store:f.store,resumeService:{templates:{get:()=>({})}}});
    assert.throws(()=>service.create({jobIds:["job-a"],baseResumeId:"resume-b"}),error=>error.code==="RESUME_BATCH_BASE_RESUME_INVALID");
    assert.throws(()=>service.create({jobIds:["job-a"],baseResumeId:"resume-a",language:"xx"}),error=>error.code==="RESUME_BATCH_LANGUAGE_INVALID");
    assert.throws(()=>service.create({jobIds:["job-a"],baseResumeId:"resume-a",afterReady:"SEND_EVERYTHING"}),error=>error.code==="RESUME_BATCH_AFTER_READY_INVALID");
    const batch=service.create({jobIds:["job-a"],baseResumeId:"resume-a"});
    assert.equal(batch.metadata.afterReady,"PREPARE_ONLY");
    for(const action of ["tailor","render","retry"]) assert.throws(()=>service[action](batch.id,"item-1"),error=>error.code==="RESUME_BATCH_ARRAY_INVALID");
    assert.throws(()=>service.approve(batch.id,{phase:"UNKNOWN"}),error=>error.code==="RESUME_BATCH_REVIEW_INVALID");
  } finally {await f.close();}
});

test("limite inicial de 25 é validado sem truncar silenciosamente", async () => {
  const f = await fixture();
  try {
    const service = new ResumeBatchService({
        store: f.store,
        resumeService: { templates: { get: () => ({ id: "ATS_CLEAN" }) } },
      }),
      jobIds = [];
    for (let index = 0; index < 26; index++) {
      const id = `limit-job-${index}`,
        timestamp = new Date().toISOString();
      f.store.jobs.upsert({
        id,
        title: "Backend",
        company: "Acme",
        description: "Node",
        status: "open",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      jobIds.push(id);
    }
    assert.throws(
      () =>
        service.create({
          jobIds,
          baseResumeId: "resume-a",
          requestedOutputs: ["pdf"],
        }),
      (error) => error.code === "RESUME_BATCH_LIMIT_EXCEEDED",
    );
  } finally {
    await f.close();
  }
});

test("falha de um item produz sucesso parcial sem cancelar o restante", async () => {
  const f = await fixture();
  try {
    const batch = f.store.resumeBatches.create({
        jobIds: ["job-a", "job-b"],
        baseResumeId: "resume-a",
        comparisonResumeIds: [],
        requestedOutputs: { pdf: true },
        language: "pt-BR",
      }),
      [ready, failed] = batch.items;
    for (const status of [
      "ANALYZING",
      "ANALYZED",
      "BASE_SELECTED",
      "TAILORING",
      "TAILORING_REVIEW_REQUIRED",
      "TAILORING_APPROVED",
      "BUILDING_VERSION",
      "VERSION_REVIEW_REQUIRED",
      "VERSION_APPROVED",
      "READY",
    ])
      f.store.resumeBatches.transitionItem(
        ready.id,
        status,
        status === "BASE_SELECTED" ? { finalResumeId: "resume-a" } : {},
      );
    f.store.resumeBatches.transitionItem(failed.id, "ANALYZING");
    f.store.resumeBatches.transitionItem(failed.id, "FAILED", {
      failureCode: "FIXTURE_FAILURE",
    });
    const result = f.store.resumeBatches.findById(batch.id);
    assert.equal(result.status, "PARTIAL_SUCCESS");
    assert.equal(result.completedItems, 1);
    assert.equal(result.failedItems, 1);
  } finally {
    await f.close();
  }
});

test("export do batch cria ZIP com manifesto e nomes sanitizados", async () => {
  const f = await fixture();
  try {
    const timestamp = new Date().toISOString();
    f.store.jobs.upsert({
      ...f.store.jobs.findById("job-a"),
      title: "../../Backend / Junior",
      company: "Acme ../ Corp",
      updatedAt: timestamp,
    });
    const version = f.store.resumeVersions.create({
      resumeId: "resume-a",
      jobId: "job-a",
      templateId: "ATS_CLEAN",
      templateVersion: "ats-clean-v1",
      language: "pt-BR",
      status: "READY",
      contentHash: "batch-export",
      resumeSpec: { candidate: { fullName: "Pessoa" } },
      source: "TEST",
      approvedAt: timestamp,
    });
    await f.store.resumeArtifactService.write({
      resumeId: "resume-a",
      resumeVersionId: version.id,
      artifactType: "LATEX_SOURCE",
      content: "\\documentclass{article}",
    });
    await f.store.resumeArtifactService.write({
      resumeId: "resume-a",
      resumeVersionId: version.id,
      artifactType: "PDF",
      content: Buffer.from("%PDF-1.4 batch"),
    });
    const batch = f.store.resumeBatches.create({
        jobIds: ["job-a"],
        baseResumeId: "resume-a",
        comparisonResumeIds: [],
        requestedOutputs: { pdf: true, latex: true, overleaf: false },
        language: "pt-BR",
      }),
      item = batch.items[0];
    for (const status of [
      "ANALYZING",
      "ANALYZED",
      "BASE_SELECTED",
      "TAILORING",
      "TAILORING_REVIEW_REQUIRED",
      "TAILORING_APPROVED",
      "BUILDING_VERSION",
    ])
      f.store.resumeBatches.transitionItem(
        item.id,
        status,
        status === "BASE_SELECTED" ? { finalResumeId: "resume-a" } : {},
      );
    f.store.resumeBatches.transitionItem(item.id, "VERSION_REVIEW_REQUIRED", {
      resumeVersionId: version.id,
    });
    f.store.resumeBatches.transitionItem(item.id, "VERSION_APPROVED");
    f.store.resumeBatches.transitionItem(item.id, "READY", {
      outputStatus: { pdf: "READY", latex: "READY" },
    });
    const output = await new BatchExportService({ store: f.store }).build(
        batch.id,
      ),
      text = output.data.toString("utf8");
    assert.equal(output.data.subarray(0, 2).toString(), "PK");
    assert.match(text, /manifest\.json/);
    assert.match(text, /resume\.pdf/);
    assert.match(text, /resume\.tex/);
    assert.doesNotMatch(text, /\.\.\//);
  } finally {
    await f.close();
  }
});

test("export separa vagas com empresa e cargo iguais e neutraliza segmento ..", async () => {
  const items=[{id:"item-a",jobId:"job-a",resumeVersionId:"version-a",status:"READY"},{id:"item-b",jobId:"job-b",resumeVersionId:"version-b",status:"READY"}],store={
    resumeBatches:{findById:()=>({id:"batch-a",status:"COMPLETED",items,requestedOutputs:{pdf:true}})},
    jobs:{findById:()=>({company:"..",title:"Mesmo cargo"})},resumeVersions:{findById:id=>({id,jobId:id==="version-a"?"job-a":"job-b",resumeId:"resume-a",status:"READY"})},
    resumeArtifacts:{latest:(id,type)=>type==="PDF"?{id:`${id}-pdf`,artifactType:type,status:"READY"}:null},resumeArtifactService:{readAllowed:async()=>Buffer.from("%PDF-1.4")},
  };
  const output=await new BatchExportService({store}).build("batch-a"),names=output.manifest.items.flatMap(item=>item.files.map(file=>file.name));
  assert.equal(new Set(names).size,2);assert.ok(names.every(name=>!name.split("/").includes("..")));assert.equal(output.manifest.missing.length,0);
});

test("orquestrador percorre comparação, duas revisões e geração até COMPLETED", async () => {
  const f = await fixture(), workers = [], dispatched = [];
  try {
    const comparisonService = { matcher: () => ({ overallScore: 80 }), compare: async (item, resumeIds) => resumeIds.map((resumeId,index) => { const identityKey=`${item.jobId}:${resumeId}`,record=f.store.resumeBatches.upsertComparison({batchRunId:item.batchRunId,batchItemId:item.id,jobId:item.jobId,resumeId,identityKey}),timestamp=new Date().toISOString(),analysis=f.store.analyses.upsert({id:`analysis-${item.jobId}-${resumeId}`,jobId:item.jobId,resumeId,score:80+index,overallScore:80+index,matched:[],missing:[],suggestions:[],candidateEvidence:[],algorithmVersion:"ats-matcher-v2",createdAt:timestamp,updatedAt:timestamp});return f.store.resumeBatches.finishComparison(record.id,{analysisId:analysis.id,score:analysis.overallScore,result:{}});}) },
      resumeService={templates:{get:(id)=>({id,version:"ats-clean-v1"})},prepare:async input=>f.store.resumeVersions.create({resumeId:input.resumeId,jobId:input.jobId,batchRunId:input.batchRunId,batchItemId:input.batchItemId,tailoringRunId:input.tailoringRunId,templateId:"ATS_CLEAN",templateVersion:"ats-clean-v1",language:"pt-BR",status:"REVIEW_REQUIRED",contentHash:`${input.jobId}-content`,resumeSpec:{candidate:{fullName:"Pessoa"}},source:"RESUME_BATCH"}),approve:id=>f.store.resumeVersions.transition(id,"APPROVED"),reject:id=>f.store.resumeVersions.transition(id,"REJECTED"),render:async id=>({version:f.store.resumeVersions.transition(id,"READY")})},
      service=new ResumeBatchService({store:f.store,resumeSelector:{},comparisonService,tailor:{tailor:async()=>({state:"REVIEW_REQUIRED",changes:[],evidenceStatus:"VALID",originalScore:80,tailoredScore:80,promptVersion:"fixture-v1",schemaVersion:"fixture-v1"})},resumeService,documentExportService:{export:async()=>({status:"OVERLEAF_EXPORT_READY"})},profileProvider:async()=>({})}),
      stage=(status,key,handler,concurrency=2)=>{const worker=new BoundedStageWorker({repository:f.store.resumeBatches,status,concurrency,pollIntervalMs:10,handler});workers.push(worker);return worker.start();},attached={analysis:stage("ANALYZING","analysis",item=>service.analyzeItem(item),4),tailoring:stage("TAILORING","tailoring",item=>service.tailorItem(item),2),build:stage("BUILDING_VERSION","build",item=>service.buildItem(item),4),render:stage("RENDERING","render",item=>service.renderItem(item),2)};service.attachWorkers(attached);service.attachReadyDispatcher(async input=>dispatched.push(input));
    let batch=service.create({jobIds:["job-a","job-b"],baseResumeId:"resume-a",comparisonResumeIds:["resume-b"],requestedOutputs:["pdf","latex"],afterReady:"REVIEW_OR_AUTOAPPLY"});service.compare(batch.id);await waitFor(()=>service.get(batch.id).status==="AWAITING_SELECTION");batch=service.get(batch.id);service.select(batch.id,batch.items.map(item=>({itemId:item.id,resumeId:item.recommendedResumeId})));service.tailor(batch.id);await waitFor(()=>service.get(batch.id).items.every(item=>item.status==="TAILORING_REVIEW_REQUIRED"));service.approve(batch.id,{phase:"TAILORING",state:"APPROVED"});await waitFor(()=>service.get(batch.id).items.every(item=>item.status==="VERSION_REVIEW_REQUIRED"));service.approve(batch.id,{phase:"VERSION",state:"APPROVED"});service.render(batch.id);await waitFor(()=>service.get(batch.id).status==="COMPLETED");batch=service.get(batch.id);assert.equal(batch.completedItems,2);assert.equal(dispatched.length,2);assert.equal(dispatched.every(item=>item.batchRunId===batch.id),true);assert.equal(new Set(batch.items.map(item=>item.version.purpose)).has("JOB_SPECIFIC"),true);assert.equal(new Set(batch.items.map(item=>item.version.jobId)).size,2);assert.equal(service.render(batch.id).status,"COMPLETED");assert.equal(service.cancel(batch.id).status,"COMPLETED");
  } finally { for(const worker of workers)worker.stop();await f.close(); }
});

test("opt-in aprova e renderiza sem revisão manual apenas quando a qualidade passa", async () => {
  const f = await fixture(), workers = [];
  try {
    const comparisonService = {
      matcher: () => ({ overallScore: 82 }),
      compare: async (item, resumeIds) => resumeIds.map((resumeId) => {
        const record = f.store.resumeBatches.upsertComparison({ batchRunId: item.batchRunId, batchItemId: item.id, jobId: item.jobId, resumeId, identityKey: `${item.jobId}:${resumeId}` });
        const analysis = f.store.analyses.upsert({ id: `analysis-${item.jobId}-${resumeId}`, jobId: item.jobId, resumeId, score: 82, overallScore: 82, matched: [], missing: [], suggestions: [], candidateEvidence: [], algorithmVersion: "ats-matcher-v2", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        return f.store.resumeBatches.finishComparison(record.id, { analysisId: analysis.id, score: 82, result: {} });
      }),
    };
    const resumeService = {
      templates: { get: () => ({ version: "ats-clean-v1" }) },
      prepare: async (input) => f.store.resumeVersions.create({ resumeId: input.resumeId, jobId: input.jobId, batchRunId: input.batchRunId, batchItemId: input.batchItemId, tailoringRunId: input.tailoringRunId, templateId: "ATS_CLEAN", templateVersion: "ats-clean-v1", language: "pt-BR", status: "REVIEW_REQUIRED", contentHash: `${input.jobId}-safe`, resumeSpec: { candidate: { fullName: "Pessoa" } }, source: "RESUME_BATCH" }),
      approve: (id) => f.store.resumeVersions.transition(id, "APPROVED"),
      render: async (id) => ({ version: f.store.resumeVersions.transition(id, "READY") }),
    };
    const service = new ResumeBatchService({ store: f.store, resumeSelector: {}, comparisonService, tailor: { tailor: async () => ({ changes: [], evidenceStatus: "VALID", originalScore: 82, tailoredScore: 82, quality: { status: "PASS", autoApplyEligible: true }, promptVersion: "fixture", schemaVersion: "fixture" }) }, resumeService, documentExportService: {}, profileProvider: async () => ({}) });
    for (const [status, handler] of [["ANALYZING", (item) => service.analyzeItem(item)], ["TAILORING", (item) => service.tailorItem(item)], ["BUILDING_VERSION", (item) => service.buildItem(item)], ["RENDERING", (item) => service.renderItem(item)]]) workers.push(new BoundedStageWorker({ repository: f.store.resumeBatches, status, concurrency: 1, pollIntervalMs: 10, handler }).start());
    service.attachWorkers({ analysis: workers[0], tailoring: workers[1], build: workers[2], render: workers[3] });
    let batch = service.create({ jobIds: ["job-a"], baseResumeId: "resume-a", comparisonResumeIds: [], requestedOutputs: ["pdf"], autoApproveSafe: true });
    service.compare(batch.id);
    await waitFor(() => service.get(batch.id).status === "AWAITING_SELECTION");
    batch = service.get(batch.id);
    service.select(batch.id, [{ itemId: batch.items[0].id, resumeId: "resume-a" }]);
    service.tailor(batch.id);
    await waitFor(() => service.get(batch.id).status === "COMPLETED", 5000);
    batch = service.get(batch.id);
    assert.equal(batch.metadata.autoApproveSafe, true);
    assert.equal(batch.items[0].status, "READY");
    assert.equal(batch.items[0].reviewState, "APPROVED");
  } finally {
    for (const worker of workers) worker.stop();
    await f.close();
  }
});

async function waitFor(predicate, timeoutMs=2000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error("timeout waiting for batch state");}
