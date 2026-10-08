import {buildApplicationJourney} from "./experience-service.mjs";
import {buildDailyDecisionSummary,buildSearchQueue,isDailyDecisionExcluded,isRefreshableOpportunity} from "./daily-decision-service.mjs";
import {isCurrentAtsAnalysis} from "../matching/analysis-version.mjs";

const startOfLocalDay=date=>new Date(date.getFullYear(),date.getMonth(),date.getDate()).toISOString();
const localDayKey=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");

export class DecisionInboxService{
  constructor({store,opportunityService,weeklyTechRadar=null,maxOpportunities=5,snapshotRefreshMs=120000}={}){Object.assign(this,{store,opportunityService,weeklyTechRadar,maxOpportunities,snapshotRefreshMs});this.rebuildPromise=null;}

  async read({fresh=false}={}){
    const saved=this.store.dailyInboxSnapshots?.get?.();
    if(fresh)return this.build();
    if(!saved?.inbox){
      this.scheduleRebuild();
      return {generatedAt:new Date().toISOString(),items:[],dailyDecision:{dailyPlan:[],dailyProgress:{reviewed:0,prepared:0,applied:0}},awaitingRefresh:0,snapshot:{served:false,warming:true,refreshing:true}};
    }
    const ageMs=Math.max(0,Date.now()-(Date.parse(saved.generatedAt)||0));
    if(ageMs>=this.snapshotRefreshMs)this.scheduleRebuild();
    return {...saved.inbox,snapshot:{served:true,ageMs,refreshing:Boolean(this.rebuildPromise)}};
  }

  scheduleRebuild(){
    if(this.rebuildPromise)return this.rebuildPromise;
    this.rebuildPromise=new Promise(resolve=>setTimeout(resolve,0)).then(()=>this.build()).catch(()=>null).finally(()=>{this.rebuildPromise=null;});
    return this.rebuildPromise;
  }

  async build(){
    const generatedAt=new Date(),dismissed=this.store.decisionDismissals.keys({since:startOfLocalDay(generatedAt)}),items=[],applications=this.store.applications.all();
    const byJob=new Map(applications.map(item=>[item.jobId,item]));
    const add=item=>{if(!dismissed.has(item.key))items.push(item);};
    const allOpportunities=await this.opportunityService.list();
    const profiles=this.store.jobHuntProfiles?.all?.()||[],activeProfile=profiles.find(item=>item.enabled)||profiles[0]||null,activeIntent=activeProfile?this.store.searchIntents?.forProfile?.(activeProfile.id):null,locationPolicy=activeIntent?.locationPolicy||activeProfile?.locationPolicy||{};

    for(const application of applications){
      const journey=buildApplicationJourney(application,this.store.applications.events(application.id));
      const pendingQuestions=this.store.applicationQuestions.forApplication(application.id).filter(item=>item.answerStatus==="USER_REQUIRED"),question=pendingQuestions[0];
      if(question)add({key:`question:${question.id}`,category:"APPLICATIONS",inboxPriority:112,title:pendingQuestions.length===1?"Responder pergunta obrigatória":`Responder ${pendingQuestions.length} perguntas obrigatórias`,description:pendingQuestions.length===1?question.label:`${question.label} e mais ${pendingQuestions.length-1} pendência(s).`,why:[question.reasonRequired||"A candidatura precisa das suas respostas antes de continuar."],cta:{label:"Responder agora",view:"applications",applicationId:application.id,tab:"questions",questionId:question.id},dismissible:true});
      else if(application.status==="READY_TO_SUBMIT")add({key:`application:${application.id}:READY_TO_SUBMIT`,category:"APPLICATIONS",inboxPriority:110,title:"Revisar antes de enviar",description:application.nextAction||"O preenchimento terminou e aguarda sua revisão final.",why:["O Career Unified nunca envia a candidatura automaticamente."],cta:{label:"Abrir candidatura",view:"applications",applicationId:application.id},dismissible:true});
      else if(application.status==="WAITING_USER")add({key:`application:${application.id}:WAITING_USER`,category:"APPLICATIONS",inboxPriority:108,title:"Resolver candidatura pendente",description:application.nextAction||"Uma ação humana é necessária para continuar.",why:["O fluxo foi pausado com segurança."],cta:{label:"Abrir candidatura",view:"applications",applicationId:application.id},dismissible:true});
      else if(["RETRYABLE","BLOCKED"].includes(application.status))add({key:`application:${application.id}:${application.status}`,category:"APPLICATIONS",inboxPriority:106,title:"Revisar falha da candidatura",description:application.nextAction||`Status ${application.status}.`,why:["A automação não avançou sem confirmação."],cta:{label:"Abrir candidatura",view:"applications",applicationId:application.id},dismissible:true});
      if(journey.followUpDue)add({key:`followup:${application.id}`,category:"APPLICATIONS",inboxPriority:101,title:"Follow-up devido",description:"Processo pós-envio sem interação significativa recente.",why:[`Última interação: ${journey.lastMeaningfulAt||"não informada"}.`],cta:{label:"Registrar acompanhamento",view:"applications",applicationId:application.id},dismissible:true});
      const upcoming=journey.interviews.find(item=>{const distance=Date.parse(item.scheduledAt)-Date.now();return distance>=0&&distance<=7*86400000;});
      if(upcoming)add({key:`interview:${upcoming.id}`,category:"APPLICATIONS",inboxPriority:103,title:"Entrevista próxima",description:`${upcoming.type} em ${upcoming.scheduledAt}.`,why:["Há uma etapa de entrevista registrada para os próximos sete dias."],cta:{label:"Preparar entrevista",view:"applications",applicationId:application.id},dismissible:true});
    }

    const pendingTailoring=[...(this.store.resumeTailoring?.list?.({state:"REVIEW_REQUIRED"})||[])]
      .filter((item,index,all)=>all.findIndex(candidate=>candidate.jobId===item.jobId)===index)
      .filter(item=>allOpportunities.some(opportunity=>(opportunity.job.id===item.jobId||opportunity.job.duplicateGroup?.jobIds?.includes(item.jobId))&&opportunity.freshness?.current!==false&&opportunity.decision?.visibility?.today&&!opportunity.decision?.hardBlockers?.length));
    for(const tailoring of pendingTailoring.slice(0,6)){
      const job=this.store.jobs.findById(tailoring.jobId);
      add({key:`tailoring:${tailoring.id}`,category:"RESUMES",inboxPriority:96,title:"Revisar ajustes do currículo",description:[job?.title,job?.company].filter(Boolean).join(" · ")||"Uma preparação aguarda sua revisão.",why:["Os ajustes já estão preparados e precisam da sua aprovação antes de gerar o currículo."],cta:{label:"Revisar ajustes",view:"pipeline",jobId:tailoring.jobId,tab:"resume"},dismissible:true});
    }
    for(const version of this.store.resumeVersions.list().filter(item=>item.status==="REVIEW_REQUIRED").slice(0,6))add({key:`resume:${version.id}`,category:"RESUMES",inboxPriority:90,title:"Revisar currículo preparado",description:`A versão ${version.id} aguarda aprovação humana.`,why:["Conteúdo gerado nunca é aprovado automaticamente."],cta:{label:"Revisar currículo",view:"resumes",resumeVersionId:version.id},dismissible:true});
    const alerts=this.store.jobAlerts?.list?.()||[];
    for(const alert of alerts.filter(item=>["RETRYABLE","FAILED"].includes(item.status)).slice(0,5))add({key:`alert:${alert.id}`,category:"AUTOPILOT",inboxPriority:85,title:"Corrigir falha crítica do Autopilot",description:`A entrega terminou como ${alert.status}.`,why:["A vaga foi preservada; somente a notificação falhou."],cta:{label:"Abrir Autopilot",view:"autopilot"},dismissible:true});
    for(const provider of (this.store.providerHealth?.latestAll?.()||[]).filter(item=>item.setupStatus==="READY"&&["ERROR","OFFLINE","AUTH_REQUIRED"].includes(item.healthStatus)).slice(0,3))add({key:`provider:${provider.providerId}:${provider.checkedAt}`,category:"AUTOPILOT",inboxPriority:84,title:"Fonte importante indisponível",description:provider.message||`${provider.providerId} está ${provider.healthStatus}.`,why:[provider.errorCode||"O último teste da fonte falhou."],cta:{label:"Revisar fonte",view:"autopilot",section:"sources"},dismissible:true});
    const pendingAlerts=alerts.filter(item=>["PENDING","RETRYABLE"].includes(item.status));
    const whatsapp=this.store.whatsappConnection?.get?.();
    if(pendingAlerts.length&&whatsapp?.connectionState!=="CONNECTED")add({key:"whatsapp:pending-alerts",category:"INTEGRATIONS",inboxPriority:86,title:"WhatsApp desconectado com alertas pendentes",description:`${pendingAlerts.length} alerta(s) aguardam entrega.`,why:["A descoberta continua funcionando; somente o canal de notificação requer atenção."],cta:{label:"Conectar WhatsApp",view:"autopilot",section:"notifications"},dismissible:true});

    for(const opportunity of allOpportunities.filter(item=>item.analysis&&!isCurrentAtsAnalysis(item.analysis)&&item.decision?.visibility?.today&&item.freshness?.current!==false&&!item.decision?.hardBlockers?.length&&!isDailyDecisionExcluded(item,locationPolicy)).slice(0,5))add({key:`legacy-analysis:${opportunity.analysis.id}`,category:"OPPORTUNITIES",inboxPriority:78,title:"Atualizar análise antiga",description:[opportunity.job.title,opportunity.job.company].filter(Boolean).join(" · "),why:["A análise histórica foi preservada, mas não representa o scoring atual."],cta:{label:"Atualizar análise",view:"pipeline",jobId:opportunity.job.id,tab:"analysis"},dismissible:true});
    const dispositionPriority={PREPARE_ELIGIBLE:82,RECOMMENDED:80,REVIEW:74,STRETCH:72};
    const awaitingRefresh=allOpportunities.filter(item=>!byJob.has(item.job.id)&&isRefreshableOpportunity(item,locationPolicy));
    if(awaitingRefresh.length)add({key:"opportunities:refresh",category:"OPPORTUNITIES",inboxPriority:79,title:"Atualizar vagas antes de decidir",description:`${awaitingRefresh.length} oportunidade(s) saíram da fila porque a disponibilidade precisa ser confirmada.`,why:["Execute uma nova busca para trabalhar apenas com vagas atuais."],cta:{label:"Atualizar busca",view:"pipeline",section:"discover"},dismissible:false});
    const eligibleOpportunities=allOpportunities.filter(item=>!byJob.has(item.job.id)&&!item.feedback?.userDecision&&(!item.analysis||isCurrentAtsAnalysis(item.analysis))&&item.decision?.visibility?.today&&item.freshness?.current!==false&&!isDailyDecisionExcluded(item,locationPolicy)).sort((a,b)=>(dispositionPriority[b.decision.disposition]||0)-(dispositionPriority[a.decision.disposition]||0)||b.priority.score-a.priority.score);
    for(const opportunity of eligibleOpportunities.slice(0,this.maxOpportunities)){const humanReason=String(opportunity.decision.decisionExplanation?.summary||"").trim()||"Abra a oportunidade para revisar os critérios e evidências.";add({key:`opportunity:${opportunity.job.id}`,category:"OPPORTUNITIES",inboxPriority:dispositionPriority[opportunity.decision.disposition]||70,title:opportunity.job.title||"Oportunidade sem título",description:[opportunity.job.company,opportunity.job.location,opportunity.job.workModel].filter(Boolean).join(" · "),opportunity:{job:opportunity.job,priority:opportunity.priority,decision:opportunity.decision,freshness:opportunity.freshness,analysis:{matched:opportunity.analysis?.matched||[],missing:opportunity.analysis?.missing||[],unknownRequirements:opportunity.analysis?.unknownRequirements||[]}},why:[humanReason],cta:{label:opportunity.analysis?"Revisar oportunidade":"Analisar vaga",view:"pipeline",jobId:opportunity.job.id,tab:opportunity.analysis?"summary":"analysis"},dismissible:true});}

    items.sort((a,b)=>b.inboxPriority-a.inboxPriority||a.title.localeCompare(b.title));
    const categories=Object.fromEntries(["OPPORTUNITIES","RESUMES","APPLICATIONS","AUTOPILOT","INTEGRATIONS"].map(category=>[category,items.filter(item=>item.category===category).length])),urgentActions=items.filter(item=>item.inboxPriority>=95).length,highImpactActions=items.filter(item=>item.inboxPriority>=85&&item.inboxPriority<95).length;
    const status=!items.length?"CLEAR":urgentActions?"URGENT":items[0]?.key==="opportunities:refresh"?"REFRESH_REQUIRED":"ACTION_REQUIRED";
    const headline=status==="CLEAR"?"Nenhuma decisão pendente":status==="URGENT"?"Comece pelas ações que dependem de você":status==="REFRESH_REQUIRED"?"Atualize as vagas antes de decidir":"Há ações prontas para avançar";
    const runs=this.store.jobHuntRuns?.list?.()||[],expandedQueries=activeIntent?this.store.expandedQueries?.forIntent?.(activeIntent.id,activeIntent.version)||[]:[],plannerState=activeProfile?this.store.discoveryQueryPlannerState?.get?.(activeProfile.id):null;
    const searchQueue=buildSearchQueue({profile:activeProfile,runs,expandedQueries,plannerState,now:generatedAt});
    const weeklyTechRadar=await (this.weeklyTechRadar?.get?.()||Promise.resolve(null));
    const dailyDecision=buildDailyDecisionSummary({opportunities:allOpportunities,applications,lastReviewAt:this.store.dailyReviewState?.get?.().lastDailyReviewAt||"",now:generatedAt,locationPolicy,searchQueue,awaitingRefresh:awaitingRefresh.length,weeklyTechRadar});
    const result={generatedAt:generatedAt.toISOString(),items,dailyDecision,hasMoreOpportunities:eligibleOpportunities.length>this.maxOpportunities,awaitingRefresh:awaitingRefresh.length,categories,daily:{date:localDayKey(generatedAt),status,headline,totalActions:items.length,urgentActions,highImpactActions,primaryKey:items[0]?.key||"",categories}};
    this.store.dailyInboxSnapshots?.save?.(result);
    return result;
  }
}
