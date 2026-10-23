import { ResumeSelector } from "../intelligence/tasks/resume-selector.mjs";
import { AdapterRegistry } from "../automation/ats/adapter-registry.mjs";
import { NextActionEngine } from "./next-action-engine.mjs";
import { TemplateRegistry } from "../resume/templates/template-registry.mjs";
import { tailoringQuality } from "../intelligence/tasks/resume-tailor.mjs";
import {applicationProvider} from "../discovery/source-attribution.mjs";

const latest = (items = []) =>
  [...items].sort((a, b) =>
    String(b.updatedAt || b.createdAt).localeCompare(
      String(a.updatedAt || a.createdAt),
    ),
  )[0] || null;
const preferredResumeVersion = (versions = []) => {
  const usable = versions.filter((item) => ["READY", "APPROVED"].includes(item.status));
  return latest(usable.filter((item) => item.templateId === "BASE_01")) || latest(usable) || latest(versions);
};
const APPLICATION_OUTCOMES=Object.freeze(["SUBMITTED","SCREENING","RECRUITER_INTERVIEW","TECHNICAL_INTERVIEW","FINAL_INTERVIEW","OFFER","REJECTED","WITHDRAWN","ACCEPTED"]);
const TERMINAL_OUTCOMES=new Set(["REJECTED","WITHDRAWN","ACCEPTED"]);
const FOLLOW_UP_EVENTS=new Set(["FOLLOW_UP_CONTACT_RECORDED","FOLLOW_UP_RESPONSE_RECORDED","FOLLOW_UP_DEFERRED","FOLLOW_UP_COMPLETED"]);
export class ExperienceService {
  constructor({
    store,
    opportunityService,
    profileProvider,
    adapterRegistry = new AdapterRegistry(),
    nextAction = new NextActionEngine(),
    templateRegistry = new TemplateRegistry(),
    sessionProvider = () => ({ status: "NONE", interactiveAvailable: false }),
  } = {}) {
    Object.assign(this, {
      store,
      opportunityService,
      profileProvider,
      adapterRegistry,
      nextAction,
      templateRegistry,
      sessionProvider,
    });
  }

  async opportunityWorkspace(jobId, { resumeId = "" } = {}) {
    const opportunity = this.opportunityService.find
      ? await this.opportunityService.find(jobId)
      : (await this.opportunityService.list()).find(
          (item) =>
            item.job.id === jobId ||
            item.job.duplicateGroup?.jobIds?.includes(jobId),
        );
    if (!opportunity) return null;
    const { job, requirements, items } = opportunity;
    const projectedAnalysis = opportunity.analysis;
    const analysis = projectedAnalysis?.id && this.store.analyses?.findById
      ? this.store.analyses.findById(projectedAnalysis.id) || projectedAnalysis
      : projectedAnalysis;
    const jobVersions = this.store.resumeVersions.list({ jobId });
    const resumeRecommendation = this.resumeRecommendation(job, analysis, resumeId);
    const selectedResumeId = resumeRecommendation?.selectedResumeId || "";
    const jobApplications = this.store.applications?.all
        ? this.store.applications.all().filter((item) => item.jobId === job.id)
        : opportunity.application
          ? [opportunity.application]
          : [],
      application = latest(jobApplications.filter((item) => item.status !== "CANCELLED")) || latest(jobApplications);
    const applicationVersion = application?.resumeVersionId
      ? jobVersions.find((item) => item.id === application.resumeVersionId) || null
      : null;
    const resumeVersion = applicationVersion || preferredResumeVersion(
      selectedResumeId
        ? jobVersions.filter((item) => item.resumeId === selectedResumeId)
        : jobVersions,
    );
    const resumeTailoring = selectedResumeId
      ? this.store.resumeTailoring.latestFor(job.id, selectedResumeId)
      : null;
    const questions = application
      ? this.store.applicationQuestions.forApplication(application.id)
      : [];
    const timeline = [
      {
        type: "DISCOVERED",
        label: "Oportunidade descoberta",
        at: job.firstSeenAt || job.createdAt,
        source: job.provider || job.source || "manual",
      },
      ...(analysis
        ? [
            {
              type: "ANALYZED",
              label: "Análise técnica concluída",
              at: analysis.updatedAt || analysis.createdAt,
              source: analysis.algorithmVersion,
            },
          ]
        : []),
      ...(resumeTailoring
        ? [
            {
              type: "RESUME_TAILORING",
              label: `Ajustes do currículo ${resumeTailoring.state.toLowerCase()}`,
              at: resumeTailoring.updatedAt,
              source: resumeTailoring.evidenceStatus,
              entityId: resumeTailoring.id,
            },
          ]
        : []),
      ...jobVersions.map((version) => ({
        type: "RESUME_VERSION",
        label: `Currículo ${String(version.status || "criado").toLowerCase()}`,
        at: version.updatedAt,
        source: version.source,
        entityId: version.id,
      })),
      ...(application
        ? this.store.applications
            .events(application.id)
            .map((event) => ({
              type: event.eventType,
              label: applicationEventLabel(event),
              at: event.createdAt,
              source: event.metadata?.reason || "Career Unified",
              entityId: event.id,
            }))
        : []),
    ]
      .filter((item) => item.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return {
      job,
      analysis,
      requirements,
      analysisItems: items,
      evidenceGaps: (this.store.candidateKnowledge?.gaps?.(jobId)||[]).filter(item=>item.analysisId===analysis?.id),
      priority: opportunity.priority,
      decision: opportunity.decision,
      freshness: opportunity.freshness,
      feedback: opportunity.feedback,
      application,
      resumeRecommendation,
      resumeTailoring: resumeTailoring
        ? { ...resumeTailoring, quality: tailoringQuality(resumeTailoring) }
        : null,
      resumeVersion: resumeVersion
        ? {
            ...resumeVersion,
            artifacts: this.store.resumeArtifacts.forVersion(resumeVersion.id),
          }
        : null,
      applicationMethod: applicationMethod(job, this.adapterRegistry),
      nextAction: this.nextAction.forOpportunity({
        analysis,
        resumeTailoring,
        resumeVersion,
        application,
        questions,
      }),
      timeline,
    };
  }

  resumeRecommendation(job, analysis, preferredResumeId = "") {
    const allResumes = this.store.resumes.allActive?.() || this.store.resumes.all();
    if (!allResumes.length) return null;
    const defaultResumeId = this.defaultResumeId();
    const resumes = allResumes.filter((item) => item.resumeKind === "BASE");
    if (!resumes.length) return null;
    const analyses = this.store.analyses.forJob
      ? this.store.analyses.forJob(job.id)
      : this.store.analyses.all().filter((item) => item.jobId === job.id);
    const versions = this.store.resumeVersions
      .list()
      .filter(
        (item) =>
          ["APPROVED", "READY"].includes(item.status) &&
          !item.jobId &&
          !item.tailoringRunId,
      );
    const selection = new ResumeSelector().select({
      resumes,
      resumeVersions: versions.length ? versions : null,
      analyses,
      job,
      requirements: this.store.jobRequirements.forJob(job.id),
      evidence: analysis?.candidateEvidence || [],
      archetypes: this.store.resumeArchetypes.list(),
      assignments: this.store.resumeArchetypeAssignments.list({
        status: "APPROVED",
      }),
    });
    const selectedResumeId = resumes.some((item) => item.id === preferredResumeId)
      ? preferredResumeId
      : resumes.some((item) => item.id === defaultResumeId)
        ? defaultResumeId
        : selection.selectedResumeId;
    const resume = resumes.find((item) => item.id === selectedResumeId) || null;
    const baseOptions = resumes
      .map((item) => {
        const itemAnalysis = latest(
          analyses.filter((entry) => entry.resumeId === item.id),
        );
        return {
          resumeId: item.id,
          title: item.title || "Currículo sem título",
          language: item.language || "pt-BR",
          focus: item.focus || "",
          analysisId: itemAnalysis?.id || "",
          analysisScore:
            itemAnalysis?.overallScore ?? itemAnalysis?.score ?? null,
          recommended: item.id === selection.selectedResumeId,
          isDefault: item.id === defaultResumeId,
          selected: item.id === selectedResumeId,
        };
      })
      .sort(
        (a, b) =>
          Number(b.selected) - Number(a.selected) ||
          Number(b.isDefault) - Number(a.isDefault) ||
          Number(b.recommended) - Number(a.recommended) ||
          Number(b.analysisScore ?? -1) - Number(a.analysisScore ?? -1) ||
          a.title.localeCompare(b.title, "pt-BR"),
      );
    return {
      ...selection,
      selectedResumeId,
      resume,
      baseOptions,
      templateRecommendation: recommendTemplates(
        job,
        this.store.jobRequirements.forJob(job.id),
        this.templateRegistry.list(),
      ),
      coverage: analysis?.overallScore ?? analysis?.score ?? null,
    };
  }

  applications() {
    return this.store.applications
      .all()
      .map((application) => {
        const job = this.store.jobs.findById(application.jobId);
        const events = this.store.applications.events(application.id);
        const questions = this.store.applicationQuestions.forApplication(
          application.id,
        );
        return {
          application,
          job,
          journey: buildApplicationJourney(application, events),
          pendingQuestions: questions.filter(
            (item) => item.answerStatus === "USER_REQUIRED",
          ).length,
          nextAction: this.nextAction.forApplication({
            application,
            questions,
          }),
        };
      })
      .sort((a, b) =>
        String(b.application.updatedAt).localeCompare(
          String(a.application.updatedAt),
        ),
      );
  }

  applicationFunnel(applications = this.applications()) {
    const applicationByJob = new Map(
        applications.map((item) => [item.application.jobId, item]),
      ),
      feedbackByJob = new Map(
        (this.store.jobFeedback?.all?.() || []).map((item) => [item.jobId, item]),
      ),
      latestTailoringByJob = new Map(),
      latestVersionByJob = new Map();
    const tailoringRuns = this.store.resumeTailoring?.listSummaries?.() ||
      this.store.resumeTailoring?.list?.() || [];
    for (const run of tailoringRuns)
      if (!latestTailoringByJob.has(run.jobId)) latestTailoringByJob.set(run.jobId, run);
    for (const version of this.store.resumeVersions?.list?.() || [])
      if (version.jobId && !latestVersionByJob.has(version.jobId)) latestVersionByJob.set(version.jobId, version);
    const actionableJobIds = new Set([
      ...applications
        .filter((item) => item.application.status !== "CANCELLED")
        .map((item) => item.application.jobId),
      ...[...feedbackByJob.values()]
        .filter((item) => ["APPLY", "SAVE", "REVIEW"].includes(item.userDecision))
        .map((item) => item.jobId),
    ]);
    const record = (jobId) => {
      const application = applicationByJob.get(jobId) || null,
        feedback = feedbackByJob.get(jobId) || null,
        tailoring = latestTailoringByJob.get(jobId) || null,
        resumeVersion = latestVersionByJob.get(jobId) || null,
        updatedAt = [
          application?.application?.updatedAt,
          feedback?.updatedAt,
          tailoring?.updatedAt,
          resumeVersion?.updatedAt,
        ].filter(Boolean).sort().at(-1) || "";
      return {
        job: ((job) => job ? {
          id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
          workModel: job.workModel,
        } : null)(this.store.jobs.findById(jobId)),
        application: application?.application ? {
          id: application.application.id,
          status: application.application.status,
          manualSent: application.journey?.stage === "SUBMITTED" && application.application.status !== "SUBMITTED",
          updatedAt: application.application.updatedAt,
        } : null,
        feedback: feedback ? {
          userDecision: feedback.userDecision,
          updatedAt: feedback.updatedAt,
        } : null,
        tailoring: tailoring ? {
          id: tailoring.id,
          state: tailoring.state,
          originalScore: tailoring.originalScore,
          tailoredScore: tailoring.tailoredScore,
          evidenceStatus: tailoring.evidenceStatus,
          quality: tailoringQuality(tailoring),
          updatedAt: tailoring.updatedAt,
        } : null,
        resumeVersion: resumeVersion ? {
          id: resumeVersion.id,
          status: resumeVersion.status,
          templateId: resumeVersion.templateId,
          updatedAt: resumeVersion.updatedAt,
        } : null,
        updatedAt,
      };
    },
      sort = (items) => items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      interested = sort(
        [...feedbackByJob.values()]
          .filter((item) => ["APPLY", "SAVE", "REVIEW"].includes(item.userDecision))
          .map((item) => record(item.jobId))
          .filter((item) => item.job),
      ),
      prepared = sort(
        [...actionableJobIds]
          .map(record)
          .filter((item) =>
            item.job &&
            (item.resumeVersion ||
              (item.tailoring && !["REJECTED"].includes(item.tailoring.state))),
          ),
      ),
      submitted = sort(
        applications
          .filter((item) => item.application.status === "SUBMITTED" || item.journey?.stage === "SUBMITTED")
          .map((item) => record(item.application.jobId)),
      ),
      active = sort(
        applications
          .filter((item) => item.application.status !== "CANCELLED")
          .map((item) => record(item.application.jobId)),
      ),
      recent = sort(
        [...new Set([
          ...interested.map((item) => item.job.id),
          ...prepared.map((item) => item.job.id),
          ...active.map((item) => item.job.id),
        ])].map(record),
      ).slice(0, 12);
    return { interested, prepared, active, submitted, recent };
  }

  applicationWorkspace(applicationId, profile = {}) {
    const details = this.store.applicationEngineDetails(applicationId, profile);
    if (!details.application) return null;
    const events = this.store.applications.events(applicationId);
    const attempts =
      this.store.applicationAttempts.forApplication(applicationId);
    const uploads = this.store.resumeUploadAudits.forApplication(applicationId);
    const eventCount = (type) =>
      events.filter((event) => (event.type || event.eventType) === type).length;
    const resumeVersion = details.application.resumeVersionId
      ? this.store.resumeVersions.findById(details.application.resumeVersionId)
      : null;
    return {
      ...details,
      attempts,
      uploads,
      resumeVersion: resumeVersion
        ? {
            ...resumeVersion,
            artifacts: this.store.resumeArtifacts.forVersion(resumeVersion.id),
          }
        : null,
      method: applicationMethod(details.job || {}, this.adapterRegistry),
      submissionSession: this.sessionProvider(applicationId),
      submissionMetrics: {
        finalPreflightStarted: eventCount("FINAL_PREFLIGHT_STARTED"),
        finalPreflightBlocked: eventCount("FINAL_PREFLIGHT_FAILED"),
        submitActionArmed: eventCount("SUBMIT_ACTION_ARMED"),
        submitActionTriggered: eventCount("SUBMIT_ACTION_TRIGGERED"),
        submissionConfirmed: eventCount("SUBMISSION_CONFIRMED"),
        submissionUncertain: eventCount("SUBMISSION_UNCERTAIN"),
        receiptCaptured: eventCount("RECEIPT_CAPTURED"),
        manualReconciliation: eventCount("SUBMISSION_RECONCILED"),
      },
      submissionPreviewStale: events.some(event=>event.type==="PREVIEW_INVALIDATED"&&Date.parse(event.createdAt||event.timestamp||0)>Date.parse(details.submissionPreflight?.evaluatedAt||0)),
      journey: buildApplicationJourney(details.application, events),
      nextAction: this.nextAction.forApplication({
        application: details.application,
        questions: details.questions,
      }),
      timeline: events
        .map((event) => ({ ...event, label: applicationEventLabel(event) }))
        .reverse(),
    };
  }

  recordApplicationAction(applicationId,input={}){
    const application=this.store.applications.findById(applicationId);
    if(!application)throw Object.assign(new Error("Candidatura não encontrada."),{code:"APPLICATION_NOT_FOUND",status:404});
    const action=String(input.action||"").toUpperCase();
    const text=value=>String(value||"").trim().slice(0,1000);
    const occurredAt=validDate(input.occurredAt)||new Date().toISOString();
    let eventType="",metadata={occurredAt};
    if(action==="ADVANCE_APPLICATION"){
      const next={PLANNED:"APPROVED",APPROVED:"QUEUED"}[application.status];
      if(!next)throw Object.assign(new Error("Esta candidatura não pode avançar manualmente a partir do estado atual."),{code:"APPLICATION_ADVANCE_NOT_ALLOWED"});
      const updated=this.store.applicationService.transitionApplication(applicationId,next,{source:"user",reason:"manual_advance"});
      const events=this.store.applications.events(applicationId);
      return {application:updated,event:events.at(-1),journey:buildApplicationJourney(updated,events)};
    }else if(action==="CANCEL_APPLICATION"){
      if(["CANCELLED","SUBMITTED"].includes(application.status))throw Object.assign(new Error("Esta candidatura não pode ser retirada da fila."),{code:"APPLICATION_CANCEL_NOT_ALLOWED"});
      const updated=this.store.applicationService.transitionApplication(applicationId,"CANCELLED",{source:"user",reason:"removed_from_pipeline"});
      const events=this.store.applications.events(applicationId);
      return {application:updated,event:events.at(-1),journey:buildApplicationJourney(updated,events)};
    }else if(action==="REGISTER_OUTCOME"){
      const outcome=String(input.outcome||"").toUpperCase();
      if(!APPLICATION_OUTCOMES.includes(outcome))throw Object.assign(new Error("Etapa de acompanhamento inválida."),{code:"APPLICATION_OUTCOME_INVALID"});
      eventType="APPLICATION_OUTCOME_RECORDED";metadata={...metadata,outcome,note:text(input.note)};
    }else if(action==="REGISTER_INTERVIEW"){
      const scheduledAt=validDate(input.scheduledAt);
      if(!scheduledAt)throw Object.assign(new Error("Informe uma data válida para a entrevista."),{code:"INTERVIEW_DATE_INVALID"});
      eventType="INTERVIEW_RECORDED";metadata={...metadata,scheduledAt,type:text(input.type).slice(0,80)||"INTERVIEW",status:text(input.status).slice(0,40)||"SCHEDULED",note:text(input.note)};
    }else if(action==="REGISTER_CONTACT"){
      eventType="FOLLOW_UP_CONTACT_RECORDED";metadata={...metadata,channel:text(input.channel).slice(0,40)||"OTHER",note:text(input.note)};
    }else if(action==="REGISTER_RESPONSE"){
      eventType="FOLLOW_UP_RESPONSE_RECORDED";metadata={...metadata,note:text(input.note)};
    }else if(action==="DEFER_FOLLOW_UP"){
      const deferredUntil=validDate(input.deferredUntil);
      if(!deferredUntil)throw Object.assign(new Error("Informe até quando adiar o follow-up."),{code:"FOLLOW_UP_DATE_INVALID"});
      eventType="FOLLOW_UP_DEFERRED";metadata={...metadata,deferredUntil,note:text(input.note)};
    }else if(action==="COMPLETE_FOLLOW_UP"){
      eventType="FOLLOW_UP_COMPLETED";metadata={...metadata,note:text(input.note)};
    }else throw Object.assign(new Error("Ação de acompanhamento inválida."),{code:"APPLICATION_ACTION_INVALID"});
    this.store.applications.recordEvent(applicationId,eventType,metadata);
    const events=this.store.applications.events(applicationId);
    return {event:events.at(-1),journey:buildApplicationJourney(application,events)};
  }

  resumes() {
    const versions = this.store.resumeVersions.list();
    const resumes = this.store.resumes.allActive?.() || this.store.resumes.all();
    return resumes.map((resume) => ({
      resume,
      versions: versions.filter((version) => version.resumeId === resume.id),
      assignment:
        this.store.resumeArchetypeAssignments
          .list()
          .find(
            (item) => item.resumeId === resume.id && item.status === "APPROVED",
          ) || null,
    }));
  }

  defaultResumeId() {
    const resumeId = this.store?.database?.getMetadata?.(
      "default_resume_id",
      "",
    );
    const resume = resumeId ? this.store.resumes.findById(resumeId) : null;
    return resume?.resumeKind === "BASE" ? resume.id : "";
  }

  setDefaultResumeId(resumeId) {
    const resume = this.store.resumes.findById(resumeId);
    if (!resume)
      throw Object.assign(new Error("Currículo base não encontrado."), {
        code: "RESUME_NOT_FOUND",
        status: 404,
      });
    const selected = this.store.database.transaction(() => {
      for (const item of this.store.resumes.allActive?.() || this.store.resumes.all())
        this.store.resumes.upsert({
          ...item,
          resumeKind: item.id === resume.id ? "BASE" : "DERIVED",
          updatedAt: new Date().toISOString(),
        });
      this.store.database.setMetadata("default_resume_id", resume.id);
      return this.store.resumes.findById(resume.id);
    });
    return { resumeId: selected.id, resume: selected };
  }

  applicationCapabilities() {
    return this.adapterRegistry.listCapabilities();
  }
}

export function recommendTemplates(job={},requirements=[],templates=[]){
  const current=[...new Map(templates.map(item=>[item.id,item])).values()],text=`${job.title||""} ${job.description||""} ${requirements.map(item=>item.label||item.name||item.text||"").join(" ")}`.toLowerCase(),technicalSignals=(text.match(/\b(java|javascript|typescript|python|react|node|spring|sql|cloud|aws|azure|docker|kubernetes|devops|sre|dados|software|sistemas|infraestrutura|seguran[cç]a|qa|testes?)\b/g)||[]).length,leadership=/\b(lead|lider|lideran[cç]a|gerente|manager|coordenador|head|diretor)\b/i.test(text),earlyCareer=/\b(est[aá]gio|estagi[aá]ri[oa]|trainee|j[uú]nior|junior|jr\.?|entry[ -]level|assistente)\b/i.test(text),dense=String(job.description||"").length>4500||requirements.length>18;
  const ranked=current.map(template=>{
    let recommendationScore={BASE_01:110,OVERLEAF_BLUE:78,OVERLEAF_CLASSIC:76,ATS_STRICT:84,ATS_TECH:technicalSignals>=2?92:76,ATS_BALANCED:86,ATS_EARLY_CAREER:earlyCareer?96:70,ATS_IMPACT:leadership?97:72,PROFESSIONAL:leadership?82:66,COMPACT:dense?88:64,ATS_CLEAN:55}[template.id]??50;
    const reasons=[];
    if(template.id==="BASE_01")reasons.push("Mantem a estrutura visual aprovada do PDF BASE 01 e seus links clicaveis.");
    if(template.id==="OVERLEAF_BLUE")reasons.push("Aplica o modelo Overleaf azul aos mesmos fatos confirmados da BASE 01.");
    if(template.id==="OVERLEAF_CLASSIC")reasons.push("Aplica o modelo Overleaf com faixas de secao aos mesmos fatos confirmados da BASE 01.");
    if(template.id==="ATS_TECH")reasons.push(technicalSignals>=2?"Prioriza competências técnicas relevantes para esta vaga.":"Mantém competências técnicas antes da experiência.");
    if(template.id==="ATS_STRICT")reasons.push("Estrutura de uma coluna com leitura ATS conservadora.");
    if(template.id==="ATS_BALANCED")reasons.push("Equilibra competências, experiência e projetos para candidaturas gerais.");
    if(template.id==="ATS_EARLY_CAREER")reasons.push(earlyCareer?"Destaca projetos, formação e competências para esta vaga de início de carreira.":"Útil quando projetos e formação sustentam uma experiência profissional mais curta.");
    if(template.id==="ATS_IMPACT")reasons.push(leadership?"Prioriza experiência, resultados e liderança pedidos nesta vaga.":"Prioriza resultados comprovados e progressão profissional.");
    if(template.id==="PROFESSIONAL")reasons.push(leadership?"Hierarquia adequada para experiência de liderança.":"Apresentação profissional discreta e ATS-safe.");
    if(template.id==="COMPACT")reasons.push(dense?"A vaga e o histórico pedem maior densidade sem reduzir a fonte abaixo de 10pt.":"Útil quando o conteúdo precisa caber em até duas páginas.");
    if(template.id==="ATS_CLEAN")reasons.push("Modelo legado preservado para compatibilidade histórica.");
    return {...template,recommendationScore,reasons};
  }).sort((a,b)=>b.recommendationScore-a.recommendationScore||a.name.localeCompare(b.name));
  return {recommendedTemplateId:ranked[0]?.id||"BASE_01",candidates:ranked.map((item,index)=>({...item,recommended:index===0}))};
}

export function buildApplicationJourney(application={},events=[],now=new Date()){
  const timestamp=now instanceof Date?now.getTime():Date.parse(now);
  const outcomeEvents=events.filter(item=>item.eventType==="APPLICATION_OUTCOME_RECORDED"&&APPLICATION_OUTCOMES.includes(item.metadata?.outcome));
  const statusOutcome=application.status==="SUBMITTED"?{metadata:{outcome:"SUBMITTED"},createdAt:application.appliedAt||application.updatedAt||application.createdAt}:null;
  const latestEffective=items=>[...items].sort((a,b)=>String(eventEffectiveDate(b)).localeCompare(String(eventEffectiveDate(a))))[0]||null;
  const latestOutcome=latestEffective([...outcomeEvents,...(statusOutcome?[statusOutcome]:[])]);
  const outcome=latestOutcome?.metadata?.outcome||"";
  const interviews=events.filter(item=>item.eventType==="INTERVIEW_RECORDED").map(item=>({id:item.id,scheduledAt:item.metadata?.scheduledAt||item.createdAt,type:item.metadata?.type||"INTERVIEW",status:item.metadata?.status||"SCHEDULED",note:item.metadata?.note||"",createdAt:item.createdAt})).sort((a,b)=>String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const followUps=events.filter(item=>FOLLOW_UP_EVENTS.has(item.eventType));
  const meaningful=[...outcomeEvents,...followUps,...events.filter(item=>item.eventType==="INTERVIEW_RECORDED")];
  if(statusOutcome)meaningful.push(statusOutcome);
  const lastMeaningfulAt=eventEffectiveDate(latestEffective(meaningful));
  const deferred=latestEffective(followUps.filter(item=>item.eventType==="FOLLOW_UP_DEFERRED"));
  const deferredUntil=validDate(deferred?.metadata?.deferredUntil)||"";
  const postSubmit=Boolean(outcome)||application.status==="SUBMITTED";
  const dueAt=lastMeaningfulAt?new Date(Date.parse(lastMeaningfulAt)+7*86400000).toISOString():"";
  const followUpDue=postSubmit&&!TERMINAL_OUTCOMES.has(outcome)&&(!deferredUntil||Date.parse(deferredUntil)<=timestamp)&&Boolean(dueAt)&&Date.parse(dueAt)<=timestamp;
  return {stage:outcome||application.status,postSubmit,terminal:TERMINAL_OUTCOMES.has(outcome),followUpDue,dueAt,deferredUntil,lastMeaningfulAt,interviews,outcomeHistory:outcomeEvents.map(item=>({outcome:item.metadata.outcome,note:item.metadata.note||"",occurredAt:eventEffectiveDate(item)}))};
}

function eventEffectiveDate(event){return validDate(event?.metadata?.occurredAt)||validDate(event?.createdAt)||"";}
function validDate(value){const parsed=Date.parse(String(value||""));return Number.isFinite(parsed)?new Date(parsed).toISOString():"";}

function applicationMethod(job = {}, adapterRegistry) {
  const destination=job.applicationUrl||job.canonicalUrl||job.url||"",resolved=applicationProvider(destination).toLowerCase();
  const ats = resolved!=="unknown"?resolved:String(job.atsType || "unknown").toLowerCase();
  const capability = adapterRegistry?.describe(ats) || {
    level: "MANUAL", implemented: false, canInspect: false, canFill: false,
    canSubmit: false, label: "Abertura e acompanhamento manuais",
  };
  return {
    method: job.applicationMethod || "UNKNOWN",
    atsType: ats,
    applicationUrl: destination,
    capability,
  };
}

function applicationEventLabel(event) {
  if (event.eventType && event.eventType !== "STATUS_TRANSITION")
    return event.eventType.replaceAll("_", " ").toLowerCase();
  return event.fromStatus
    ? `${event.fromStatus} → ${event.toStatus}`
    : `Candidatura criada em ${event.toStatus}`;
}
