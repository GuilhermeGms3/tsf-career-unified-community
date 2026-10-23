import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AppError } from "./server/errors.mjs";
import { attachProcessTimeout, fetchJsonWithTimeout } from "./server/external-operations.mjs";
import { decodeResumeUpload } from "./server/file-validation.mjs";
import {
  BACKUP_UPLOAD_LIMIT,
  BASE64_UPLOAD_LIMIT,
  readJsonBody,
  readRawJsonBody,
  sendError,
  sendJson
} from "./server/http-json.mjs";
import { atomicWriteJson } from "./server/json-storage.mjs";
import { UnifiedStateStore } from "./server/unified-state-store.mjs";
import { runAtsMatcherV2 } from "./src/matching/ats-matcher-v2.mjs";
import { AtsRecalculationService } from "./src/matching/ats-recalculation-service.mjs";
import { QualityLabelService } from "./src/benchmark/quality-label-service.mjs";
import { CoverageBenchmarkService } from "./src/benchmark/coverage-benchmark-service.mjs";
import { guardGeneratedResumeSections } from "./src/matching/resume-content-guard.mjs";
import { ApplicationEngine } from "./src/automation/application-engine.mjs";
import { assertAutomationMode } from "./src/application/types.mjs";
import {SubmissionPreflight} from "./src/application/submission-preflight.mjs";
import {SubmissionConsentService} from "./src/application/submission-consent-service.mjs";
import {ControlledSubmissionService} from "./src/application/controlled-submission-service.mjs";
import {AdapterSubmissionTransport} from "./src/application/submission-transport.mjs";
import {GreenhouseFinalRevalidator} from "./src/application/greenhouse-final-revalidator.mjs";
import {LeverFinalRevalidator} from "./src/application/lever-final-revalidator.mjs";
import {AshbyFinalRevalidator} from "./src/application/ashby-final-revalidator.mjs";
import {SmartRecruitersFinalRevalidator} from "./src/application/smartrecruiters-final-revalidator.mjs";
import {WorkableFinalRevalidator} from "./src/application/workable-final-revalidator.mjs";
import {NerdinFinalRevalidator} from "./src/application/nerdin-final-revalidator.mjs";
import {TeamtailorFinalRevalidator} from "./src/application/teamtailor-final-revalidator.mjs";
import {FinalRevalidatorRouter} from "./src/application/final-revalidator-router.mjs";
import {SubmissionReconciliationService} from "./src/application/submission-reconciliation-service.mjs";
import { LiveInspector } from "./src/automation/live-inspector.mjs";
import { canonicalGreenhouseKey, parseGreenhouseIdentity } from "./src/automation/ats/greenhouse/greenhouse-identity.mjs";
import { createIntelligenceProvider, IntelligenceService } from "./src/intelligence/intelligence-service.mjs";
import { BenchmarkService } from "./src/intelligence/runtime/benchmark-service.mjs";
import { TASK_TYPES } from "./src/intelligence/runtime/task-types.mjs";
import { SemanticQuestionClassifier } from "./src/intelligence/tasks/question-classifier.mjs";
import { ApplicationAnswerDrafter } from "./src/intelligence/tasks/answer-drafter.mjs";
import { ResumeTailor, assertTailoringApprovable } from "./src/intelligence/tasks/resume-tailor.mjs";
import { CoverLetterGenerator } from "./src/intelligence/tasks/cover-letter-generator.mjs";
import { ResumeSelector } from "./src/intelligence/tasks/resume-selector.mjs";
import { SkillGapAnalyzer } from "./src/intelligence/tasks/skill-gap-analyzer.mjs";
import { SemanticEvidenceMatcher } from "./src/intelligence/tasks/semantic-evidence-matcher.mjs";
import { SemanticRequirementEnhancer } from "./src/intelligence/tasks/semantic-requirement-enhancer.mjs";
import { IntelligenceWorker } from "./src/intelligence/intelligence-worker.mjs";
import {approvedLlmEndpoint} from "./src/security/llm-endpoint-policy.mjs";
import {createProviderRegistry} from "./src/discovery/provider-catalog.mjs";
import {discoveryTimeoutPolicy} from "./src/discovery/discovery-timeout-policy.mjs";
import {DiscoveryService} from "./src/discovery/discovery-service.mjs";
import {EventBus} from "./src/integrations/event-bus.mjs";
import {WebhookDispatcher} from "./src/integrations/webhook-dispatcher.mjs";
import {ResumeService} from "./src/resume/resume-service.mjs";
import {ResumeDocumentWorker} from "./src/resume/resume-document-worker.mjs";
import {ResumeBatchService} from "./src/resume/batch/resume-batch-service.mjs";
import {ResumeComparisonService} from "./src/resume/batch/resume-comparison-service.mjs";
import {BoundedStageWorker} from "./src/resume/batch/bounded-stage-worker.mjs";
import {ResumeBaseService} from "./src/resume/archetypes/resume-base-service.mjs";
import {extractCandidateEvidence} from "./src/matching/candidate-evidence-extractor.mjs";
import {CandidateKnowledgeBase} from "./src/application/candidate-knowledge-base.mjs";
import {DocumentExportService} from "./src/resume/export/document-export-service.mjs";
import {BatchExportService} from "./src/resume/export/batch-export-service.mjs";
import {DEFAULT_RESUME_DOCUMENT_POLICIES} from "./src/resume/templates/template-policy.mjs";
import {AutomationRequestAuth} from "./src/integrations/automation-request-auth.mjs";
import {providerSetupCatalog} from "./src/discovery/provider-setup-catalog.mjs";
import {ProviderTestService} from "./src/discovery/provider-test-service.mjs";
import {JobHuntService} from "./src/automation/job-hunt-service.mjs";
import {OpportunityService} from "./src/opportunities/opportunity-service.mjs";
import {OpportunityAvailabilityService} from "./src/opportunities/opportunity-availability-service.mjs";
import {AvailabilityScheduler} from "./src/opportunities/availability-scheduler.mjs";
import {DecisionInboxService} from "./src/product/decision-inbox-service.mjs";
import {WeeklyTechRadarService} from "./src/product/weekly-tech-radar-service.mjs";
import {DailyRefreshService} from "./src/product/daily-refresh-service.mjs";
import {ExperienceService} from "./src/product/experience-service.mjs";
import {SearchIntentService} from "./src/discovery/search-intent/search-intent-service.mjs";
import {geographySurfaceById} from "./src/discovery/search-intent/geography-surfaces.mjs";
import {CompanyRadarService} from "./src/discovery/company-radar/company-radar-service.mjs";
import {CareerPageDiscoveryService} from "./src/discovery/company-radar/career-page-discovery-service.mjs";
import {SafeHttpClient} from "./src/discovery/safe-http-client.mjs";
import {EvolutionClient} from "./src/integrations/evolution/evolution-client.mjs";
import {EvolutionConnectionService} from "./src/integrations/evolution/evolution-connection-service.mjs";
import {WhatsappApprovalGateway} from "./src/integrations/evolution/whatsapp-approval-gateway.mjs";
import {ResumeApprovalDispatcher} from "./src/integrations/evolution/resume-approval-dispatcher.mjs";
import {AutoApplyOrchestrator} from "./src/automation/auto-apply-orchestrator.mjs";
import {ApplicationQuestionEscalationService} from "./src/automation/application-question-escalation-service.mjs";
import {DelayedQuestionService,DELAYED_QUESTION_TASK,selectQuestionModel} from "./src/automation/delayed-question-service.mjs";
import {submissionRuntimeEnabled} from "./src/application/submission-runtime-policy.mjs";
import {BraveSearchProvider} from "./src/discovery/public-web/brave-search-provider.mjs";
import {CredentialVault} from "./src/discovery/source-center/credential-vault.mjs";
import {sourceOnboardingRegistry} from "./src/discovery/source-center/source-onboarding-registry.mjs";
import {SourceConnectionService} from "./src/discovery/source-center/source-connection-service.mjs";
import {GitHubApiClient} from "./src/evidence/github/github-api-client.mjs";
import {LinkedInContentCache} from "./src/discovery/linkedin/linkedin-content-cache.mjs";
import {LinkedInEnrichmentService} from "./src/discovery/linkedin/linkedin-enrichment-service.mjs";
import {LinkedInAmbiguityResolver} from "./src/discovery/linkedin/linkedin-ambiguity-resolver.mjs";
import {GitHubEvidenceProvider} from "./src/evidence/github/github-evidence-provider.mjs";
import {GitHubEvidenceProjector} from "./src/evidence/github/github-evidence-projector.mjs";
import {GitHubRecalibrationService} from "./src/evidence/github/github-recalibration-service.mjs";
import {CompanyRecommendationService} from "./src/discovery/source-center/company-recommendation-service.mjs";
import {DiscoveryV4Service} from "./src/discovery/v4/discovery-v4-service.mjs";
import {CommunityDiscoveryService} from "./src/discovery/community/community-discovery-service.mjs";
import {LeadPromotionService} from "./src/discovery/v4/lead-promotion-service.mjs";
import {RuntimeCapabilityService} from "./src/discovery/v4/runtime-capability-service.mjs";
import {completeLegacySchedule,failLegacySchedule,legacyScheduleLogContext,LEGACY_SCHEDULE_STATUS,runDueLegacySchedules} from "./src/scheduler/legacy-search-scheduler-policy.mjs";
import {createApplicationV2Routes,createAtsRoutes,createAutopilotRoutes,createCandidateKnowledgeRoutes,createCoverageBenchmarkRoutes,createDiscoveryV3Routes,createDiscoveryV4Routes,createExperienceRoutes,createOpportunityRoutes,createQualityLabRoutes,createResumeBatchRoutes,createSourceRoutes,createTodayRoutes,createWhatsappRoutes} from "./server/routes/index.mjs";
import { createMobileGateway } from "./server/mobile/mobile-gateway.mjs";
import { mobileGatewayConfig } from "./server/mobile/mobile-auth.mjs";
import { runtimeOperationPolicy } from "./server/runtime-operation-policy.mjs";
import {trustedWebConfig,authorizeWebRequest} from "./server/trusted-web-access.mjs";
import {requireLocalApiRequest} from "./server/local-mutation-guard.mjs";

const runtimePolicy = runtimeOperationPolicy();
const webConfig = trustedWebConfig();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = __dirname;
const legacyRoot = path.resolve(process.env.LEGACY_ROOT || path.join(__dirname, ".."));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.HUB_PORT || 7123);
const host = process.env.HUB_HOST || "127.0.0.1";
const careerOpsDir = path.join(legacyRoot, "career-ops");
const pipelinePath = path.join(careerOpsDir, "data", "pipeline.md");
const applicationsPath = path.join(careerOpsDir, "data", "applications.md");
const hubDataDir = path.resolve(process.env.HUB_DATA_DIR || path.join(__dirname, "data"));
const profilePath = path.join(hubDataDir, "profile.json");
const preparationPath = path.join(hubDataDir, "preparation.json");
const unifiedStatePath = path.join(hubDataDir, "unified-state.json");
const unifiedDatabasePath = path.join(hubDataDir, "career-hub.sqlite");
const resumeUploadsDir = path.join(hubDataDir, "resumes");
const generatedResumesDir = path.join(hubDataDir, "generated");
const resourcesDir = path.join(appRoot, "resources");
const careerEngineUrl = String(process.env.CAREER_ENGINE_URL || "http://127.0.0.1:7130").replace(/\/$/, "");
const discoveryTimeouts = discoveryTimeoutPolicy();
const defaultCountry = String(process.env.CAREER_DEFAULT_COUNTRY || "Portugal").trim() || "Portugal";
const unifiedStore = await new UnifiedStateStore({
  dataDir: hubDataDir,
  legacyStatePath: unifiedStatePath,
  databasePath: unifiedDatabasePath,
  startupEffects: runtimePolicy.backgroundEnabled,
}).initialize();
if (runtimePolicy.backgroundEnabled) unifiedStore.candidateFacts.syncProfile(CandidateKnowledgeBase.fromProfile(await readProfile()).all());
const candidateKnowledgeFacts=()=>{const evidence=unifiedStore.careerEvidence.evidence(),byFact=new Map();for(const item of evidence){if(!byFact.has(item.factKey))byFact.set(item.factKey,[]);byFact.get(item.factKey).push(item);}return unifiedStore.candidateFacts.active().map(fact=>({...fact,evidences:byFact.get(fact.key)||[]}));};
let githubEvidenceProvider=null;
const runCareerMatcher=input=>{const analysis=runAtsMatcherV2({...input,knowledgeFacts:candidateKnowledgeFacts(),evidenceProviders:githubEvidenceProvider?[githubEvidenceProvider]:[]});const usedSections=new Set(analysis.items.filter(item=>["MATCH","PARTIAL_MATCH"].includes(item.status)).flatMap(item=>item.evidence.map(evidence=>evidence.section)));for(const evidence of analysis.candidateEvidence)if(usedSections.has(evidence.sourceSection)&&evidence.metadata?.knowledgeFactKey)unifiedStore.candidateFacts.markUsed(evidence.metadata.knowledgeFactKey,{consumer:"MATCHER",contextId:input.job?.id||analysis.id});return analysis;};
const initialIntegrationSettings=unifiedStore.integrationSettings.get();
if(runtimePolicy.backgroundEnabled&&(!initialIntegrationSettings.enabled||!initialIntegrationSettings.configured))unifiedStore.outbox.failPending("INTEGRATION_NOT_CONFIGURED");
const eventBus=new EventBus({outbox:unifiedStore.outbox,shouldPersist:event=>{if(!runtimePolicy.backgroundEnabled)return false;if(event.type==="INTEGRATION_TEST")return true;const settings=unifiedStore.integrationSettings.get();return settings.enabled&&settings.configured&&settings.eventAllowlist.includes(event.type);}});
const linkedinCache=new LinkedInContentCache(unifiedStore.database.connection);
const linkedinEnrichment=new LinkedInEnrichmentService({cache:linkedinCache,client:id=>callCareerEngine(`/jobs/linkedin/${id}/description`,{},8000)});
const providerRegistry=createProviderRegistry({checkpointRepository:unifiedStore.discoveryProviderCheckpoints,searchClient:async input=>{const started=Date.now();const result=await callCareerEngine("/jobs/search",{query:String(input.query||""),location:String(input.location||defaultCountry),country:String(input.country||defaultCountry),geography_surface:String(input.geographySurface||""),sites:input.sites,results_wanted:input.limit||input.resultsWanted||20,hours_old:input.hoursOld||null,remote:Boolean(input.remote),portal_deadline_ms:discoveryTimeouts.portalDeadlineMs,engine_deadline_ms:discoveryTimeouts.engineDeadlineMs},discoveryTimeouts.transportDeadlineMs);const enriched=await linkedinEnrichment.enrich(result.jobs||[],{budgetMs:Math.max(0,Math.min(15000,discoveryTimeouts.transportDeadlineMs-(Date.now()-started)-1000))});for(const report of result.sourceReports||[])if(report.source==="linkedin")report.enrichment=enriched.metrics;return {...result,jobs:enriched.jobs};}});
const discoveryService=new DiscoveryService({registry:providerRegistry,repositories:unifiedStore.discovery,jobRepository:unifiedStore.jobs,boardRepository:unifiedStore.watchlists,leadRepository:unifiedStore.discoveryV4,sourceHealthRepository:unifiedStore.discoverySourceHealth,eventBus});
const providerTestService=new ProviderTestService({registry:providerRegistry,catalog:providerSetupCatalog,configurations:unifiedStore.providerConfigurations,healthHistory:unifiedStore.providerHealth,diagnostics:unifiedStore.sourceDiagnostics,discoveryService});
const searchIntentService=new SearchIntentService({intents:unifiedStore.searchIntents,expandedQueries:unifiedStore.expandedQueries});
const careerPageDiscovery=new CareerPageDiscoveryService({client:new SafeHttpClient()});
const opportunityAvailabilityService=new OpportunityAvailabilityService({store:unifiedStore});
const companyRadarService=new CompanyRadarService({watchlists:unifiedStore.watchlists,providerTestService,careerPageDiscovery});
const evolutionConnectionService=new EvolutionConnectionService({client:new EvolutionClient(),metadata:unifiedStore.whatsappConnection});
const whatsappApprovalGateway=new WhatsappApprovalGateway({store:unifiedStore,evolutionService:evolutionConnectionService,policyProvider:()=>unifiedStore.autoApplyPolicy.get()});
const resumeApprovalDispatcher=new ResumeApprovalDispatcher({store:unifiedStore,approvalGateway:whatsappApprovalGateway,policyProvider:()=>unifiedStore.autoApplyPolicy.get()});
const webhookDispatcher=new WebhookDispatcher({outbox:unifiedStore.outbox,settings:unifiedStore.integrationSettings,jobAlerts:unifiedStore.jobAlerts});
async function dispatchThroughEvent(eventId){let result=null;for(let attempt=0;attempt<25;attempt++){result=await webhookDispatcher.drainOne();if(!result||result.eventId===eventId||result.status==="RETRYABLE")break;}return result;}
const legacyLlm=(await readProfile()).llm||{};
const semanticMatcherEnabled=String(process.env.SEMANTIC_MATCHER_ENABLED||"false").toLowerCase()==="true";
const initialIntelligenceSettings=unifiedStore.intelligenceSettings.get()||unifiedStore.intelligenceSettings.save({provider:"ollama",endpoint:process.env.OLLAMA_URL||legacyLlm.ollamaUrl||"http://localhost:11434",fastModel:legacyLlm.chatModel||"",balancedModel:legacyLlm.chatModel||"",qualityModel:"",hardwareProfile:"AUTO",contextBudget:4096});
const resumeDocumentPolicy={...DEFAULT_RESUME_DOCUMENT_POLICIES,...(initialIntelligenceSettings.policies?.resumeDocuments||{})};
const resumeService=new ResumeService({store:unifiedStore,dataDir:hubDataDir,profileProvider:readProfile,eventBus,policy:resumeDocumentPolicy,matcher:runCareerMatcher,pdfTextExtractor:async file=>{const data=await readFile(file);return callCareerEngine("/documents/extract",{filename:"resume.pdf",data:data.toString("base64")});}});
const resumeBaseService=new ResumeBaseService({store:unifiedStore,evidenceProvider:async({resumes=[]}={})=>{const profile=await readProfile(),byId=new Map(),knowledgeFacts=candidateKnowledgeFacts();for(const resume of resumes.length?resumes:[{}])for(const item of extractCandidateEvidence(profile,resume,knowledgeFacts))byId.set(item.id,item);return [...byId.values()];}});
const documentExportService=new DocumentExportService({versions:unifiedStore.resumeVersions,artifacts:unifiedStore.resumeArtifacts,exports:unifiedStore.documentExports,artifactService:unifiedStore.resumeArtifactService,eventBus,policy:resumeDocumentPolicy});
const resumeDocumentWorker=new ResumeDocumentWorker({repository:unifiedStore.resumeDocumentJobs,concurrency:2,handlers:{BUILD_SPEC:payload=>resumeService.prepare(payload),RENDER:payload=>resumeService.render(payload.resumeVersionId),EXPORT:payload=>documentExportService.export(payload.resumeVersionId,payload.destination)}});
const automationRequestAuth=new AutomationRequestAuth({connection:unifiedStore.database.connection});
function buildIntelligenceService(settings=unifiedStore.intelligenceSettings.get()||initialIntelligenceSettings){return new IntelligenceService({settings,provider:createIntelligenceProvider(settings),repositories:{runs:unifiedStore.intelligenceRuns,cache:unifiedStore.intelligenceCache,benchmarks:unifiedStore.intelligenceBenchmarks}});}
let intelligenceService=buildIntelligenceService();
const buildSemanticIntelligenceService=()=>{if(!semanticMatcherEnabled)return intelligenceService;const current=unifiedStore.intelligenceSettings.get()||initialIntelligenceSettings,settings={...current,provider:process.env.SEMANTIC_LLM_PROVIDER||current.provider,endpoint:process.env.SEMANTIC_LLM_BASE_URL||current.endpoint,fastModel:process.env.SEMANTIC_LLM_MODEL||current.fastModel||"",balancedModel:process.env.SEMANTIC_LLM_MODEL||current.balancedModel||"",qualityModel:process.env.SEMANTIC_LLM_MODEL||current.qualityModel||"",timeoutMs:Number(process.env.SEMANTIC_LLM_TIMEOUT_MS)||20000};return new IntelligenceService({settings,provider:createIntelligenceProvider(settings),repositories:{runs:unifiedStore.intelligenceRuns,cache:unifiedStore.intelligenceCache,benchmarks:unifiedStore.intelligenceBenchmarks}});};
let semanticIntelligenceService=buildSemanticIntelligenceService();
let questionClassifier=new SemanticQuestionClassifier(intelligenceService);
let answerDrafter=new ApplicationAnswerDrafter(intelligenceService);
let resumeTailor=new ResumeTailor(intelligenceService);
let coverLetterGenerator=new CoverLetterGenerator(intelligenceService);
const resumeSelector=new ResumeSelector();
const jobHuntService=new JobHuntService({store:unifiedStore,discoveryService,matcher:runCareerMatcher,profileProvider:readProfile,eventBus,reviewOnly:runtimePolicy.manual,prepareResume:async({job,resume,analysis})=>{
  const reusable=unifiedStore.resumeVersions.list({jobId:job.id,status:"READY"}).find(version=>version.resumeId===resume.id&&version.tailoringRunId&&unifiedStore.resumeTailoring.findRun(version.tailoringRunId)?.analysisId===analysis.id&&unifiedStore.resumeArtifacts.latest(version.id,"PDF")?.status==="READY");
  if(reusable)return {id:reusable.id,resumeVersionId:reusable.id,tailoringRunId:reusable.tailoringRunId,status:"READY",kind:"VERSION",reused:true};
  const profile=await readProfile(),result=await resumeTailor.tailor({job,requirements:analysis.requirements||[],resume:{...resume,sections:resume.sections||{}},evidence:analysis.candidateEvidence||[],originalScore:analysis.overallScore,scoreEvaluator:tailored=>runCareerMatcher({job,profile,resume:tailored}).overallScore}),run=unifiedStore.resumeTailoring.createRun({jobId:job.id,resumeId:resume.id,analysisId:analysis.id,state:"REVIEW_REQUIRED",originalScore:result.originalScore,tailoredScore:result.tailoredScore,evidenceStatus:result.evidenceStatus,promptVersion:result.promptVersion,schemaVersion:result.schemaVersion,quality:result.quality,changes:result.changes});
  eventBus.emit("RESUME_TAILORING_REVIEW_REQUIRED",{resumeId:resume.id,jobId:job.id,tailoringRunId:run.id,atsBefore:run.originalScore,atsAfter:run.tailoredScore});
  if(run.evidenceStatus!=="VALID"||run.quality?.status!=="PASS"||run.changes.some(change=>change.validationStatus!=="VALID"))return {id:run.id,tailoringRunId:run.id,status:"REVIEW_REQUIRED",kind:"TAILORING"};
  const approvedTailoring=unifiedStore.resumeTailoring.review(run.id,"APPROVED"),draft=await resumeService.prepare({resumeId:resume.id,jobId:job.id,tailoringRunId:approvedTailoring.id,source:"MASS_HUNT_AUTOAPPLY"});
  resumeService.approve(draft.id);
  const rendered=await resumeService.render(draft.id),version=unifiedStore.resumeVersions.findById(draft.id),pdf=unifiedStore.resumeArtifacts.latest(draft.id,"PDF");
  if(version?.status!=="READY"||pdf?.status!=="READY")return {id:draft.id,resumeVersionId:draft.id,tailoringRunId:run.id,status:"REVIEW_REQUIRED",kind:"VERSION",rendered};
  return {id:version.id,resumeVersionId:version.id,tailoringRunId:run.id,status:"READY",kind:"VERSION"};
},requestApproval:({job,resumeVersionId,allowWhatsApp=true})=>resumeApprovalDispatcher.dispatch({jobId:job.id,resumeVersionId,allowWhatsApp:runtimePolicy.backgroundEnabled&&allowWhatsApp,reviewOnly:runtimePolicy.manual})});
const credentialVault=await new CredentialVault({vaultPath:path.join(hubDataDir,"source-credentials.vault.json")}).initialize();
let sourceConnectionService;
const publicWebProvider=new BraveSearchProvider({apiKeyProvider:()=>sourceConnectionService?.secret("brave-public-web")||""});
const githubClient=new GitHubApiClient({tokenProvider:()=>unifiedStore.database.connection.prepare("SELECT value FROM app_metadata WHERE key='github_disconnected'").get()?.value==='true'?"":sourceConnectionService?.secret("github")||process.env.GITHUB_TOKEN||""});
sourceConnectionService=new SourceConnectionService({registry:sourceOnboardingRegistry,credentials:unifiedStore.sourceCredentials,events:unifiedStore.sourceConnectionEvents,vault:credentialVault,providerTestService,braveProvider:publicWebProvider,githubClient,targets:unifiedStore.watchlists,jobHuntRuns:unifiedStore.jobHuntRuns,sourceHealthRepository:unifiedStore.discoverySourceHealth,whatsappStatus:()=>evolutionConnectionService.status()});
githubEvidenceProvider=new GitHubEvidenceProvider({client:githubClient,repository:unifiedStore.githubEvidence,projector:new GitHubEvidenceProjector({facts:unifiedStore.candidateFacts,evidence:unifiedStore.careerEvidence})});
sourceConnectionService.githubEvidenceProvider=githubEvidenceProvider;
const companyRecommendationService=new CompanyRecommendationService({store:unifiedStore,providerRegistry,companyRadar:companyRadarService});
const communityDiscoveryService=new CommunityDiscoveryService({repository:unifiedStore.discoveryV4,jobRepository:unifiedStore.jobs});
const leadPromotionService=new LeadPromotionService({repository:unifiedStore.discoveryV4,jobRepository:unifiedStore.jobs});
const discoveryV4Service=new DiscoveryV4Service({searchIntentService,publicWeb:publicWebProvider,repository:unifiedStore.discoveryV4,jobHuntService,evolutionService:evolutionConnectionService,communityService:communityDiscoveryService,store:unifiedStore,careerPageDiscovery});
const linkedinResolver=new LinkedInAmbiguityResolver({cache:linkedinCache,modelIdentity:()=>{const settings=intelligenceService.settings;try{approvedLlmEndpoint(settings.endpoint);}catch{return "";}return [settings.fastModel,settings.balancedModel,settings.qualityModel].some(Boolean)?JSON.stringify([settings.endpoint,settings.fastModel,settings.balancedModel,settings.qualityModel]):"";},resolve:(text,onProviderCall)=>intelligenceService.execute("LINKEDIN_OPPORTUNITY_CLASSIFICATION",{text,instruction:"Classifique somente se o texto representa uma vaga. Campos extraídos devem ser trechos literais do texto ou null. Não avalie o candidato."},{cache:false,onProviderCall})});
discoveryV4Service.linkedinResolver=linkedinResolver;
providerRegistry.get("jobspy").linkedinResolver=linkedinResolver;
const runtimeCapabilityService=new RuntimeCapabilityService({discoveryV4:discoveryV4Service,evolutionService:evolutionConnectionService,providerTestService,intelligenceStatus:()=>intelligenceService.status(),careerEngineUrl,integrationSettings:unifiedStore.integrationSettings});
const skillGapAnalyzer=new SkillGapAnalyzer();
let semanticEvidenceMatcher=new SemanticEvidenceMatcher(semanticIntelligenceService);
let semanticRequirementEnhancer=new SemanticRequirementEnhancer(semanticIntelligenceService);
function reloadIntelligence(settings){intelligenceService=buildIntelligenceService(settings);semanticIntelligenceService=buildSemanticIntelligenceService();questionClassifier=new SemanticQuestionClassifier(intelligenceService);answerDrafter=new ApplicationAnswerDrafter(intelligenceService);resumeTailor=new ResumeTailor(intelligenceService);coverLetterGenerator=new CoverLetterGenerator(intelligenceService);semanticEvidenceMatcher=new SemanticEvidenceMatcher(semanticIntelligenceService);semanticRequirementEnhancer=new SemanticRequirementEnhancer(semanticIntelligenceService);applicationEngine.questionClassifier=questionClassifier;if(typeof resumeBatchService!=="undefined")resumeBatchService.tailorEngine=resumeTailor;return intelligenceService;}
const automationHeadless=String(process.env.AUTOMATION_HEADLESS || "false").toLowerCase() === "true";
const applicationEngine = new ApplicationEngine({
  store: unifiedStore,
  dataDir: hubDataDir,
  profileProvider: readProfile,
  headless: automationHeadless,
  questionClassifier
});
const submissionEnabled=submissionRuntimeEnabled();
const submissionBrowserManager=applicationEngine.browser;
const greenhouseFinalRevalidator=new GreenhouseFinalRevalidator({store:unifiedStore,dataDir:hubDataDir,registry:applicationEngine.registry,browserManager:submissionBrowserManager});
const leverFinalRevalidator=new LeverFinalRevalidator({store:unifiedStore,dataDir:hubDataDir,registry:applicationEngine.registry,browserManager:submissionBrowserManager});
const ashbyFinalRevalidator=new AshbyFinalRevalidator({store:unifiedStore,dataDir:hubDataDir,registry:applicationEngine.registry,browserManager:submissionBrowserManager});
const smartRecruitersFinalRevalidator=new SmartRecruitersFinalRevalidator({store:unifiedStore,dataDir:hubDataDir,registry:applicationEngine.registry,browserManager:submissionBrowserManager});
const workableFinalRevalidator=new WorkableFinalRevalidator({store:unifiedStore,dataDir:hubDataDir,registry:applicationEngine.registry,browserManager:submissionBrowserManager});
const nerdinFinalRevalidator=new NerdinFinalRevalidator({store:unifiedStore,dataDir:hubDataDir,registry:applicationEngine.registry,browserManager:submissionBrowserManager});
const teamtailorFinalRevalidator=new TeamtailorFinalRevalidator({store:unifiedStore,dataDir:hubDataDir,registry:applicationEngine.registry,browserManager:submissionBrowserManager});
const finalRevalidator=new FinalRevalidatorRouter({store:unifiedStore,browserManager:submissionBrowserManager,revalidators:{greenhouse:greenhouseFinalRevalidator,lever:leverFinalRevalidator,ashby:ashbyFinalRevalidator,smartrecruiters:smartRecruitersFinalRevalidator,workable:workableFinalRevalidator,nerdin:nerdinFinalRevalidator,teamtailor:teamtailorFinalRevalidator}});
const submissionTransport=new AdapterSubmissionTransport({store:unifiedStore,registry:applicationEngine.registry,revalidator:finalRevalidator,allowExternal:submissionEnabled,allowLocalFixtures:false});
const submissionPreflight=new SubmissionPreflight({store:unifiedStore,dataDir:hubDataDir,registry:applicationEngine.registry,revalidator:finalRevalidator,policy:{submissionEnabled}});
const submissionConsentService=new SubmissionConsentService({store:unifiedStore});
const controlledSubmissionService=new ControlledSubmissionService({store:unifiedStore,preflight:submissionPreflight,transport:submissionTransport});
const submissionReconciliationService=new SubmissionReconciliationService({store:unifiedStore,transport:submissionTransport});
const answerDraftBlockedTypes=new Set(["checkbox","checkbox-group","file","hidden","radio","radio-group","select-multiple","select-one"]);
const answerDraftBlockedSemantics=/^(COMPENSATION\.|CONSENT\.|DEMOGRAPHIC\.|WORK_AUTHORIZATION\.|WORK_ARRANGEMENT\.|APPLICATION\.(NOTICE_PERIOD|START_DATE))/;
function answerDraftContext(applicationId,questionId){
  const application=unifiedStore.applications.findById(applicationId),question=unifiedStore.applicationQuestions.forApplication(applicationId).find(item=>item.id===questionId);
  if(!application||!question)throw Object.assign(new Error("Candidatura ou pergunta nao encontrada."),{code:"INTELLIGENCE_INPUT_NOT_FOUND"});
  if(question.sensitive||question.consentType||answerDraftBlockedTypes.has(String(question.fieldType||question.type||"").toLowerCase())||answerDraftBlockedSemantics.test(String(question.semanticKey||"")))throw Object.assign(new Error("Esta pergunta exige resposta direta do candidato."),{code:"DRAFT_NOT_ALLOWED"});
  const pending=unifiedStore.generatedContent.forApplication(applicationId).find(item=>item.questionId===questionId&&item.contentType==="ANSWER_DRAFT"&&item.state==="REVIEW_REQUIRED");
  return {application,question,pending};
}
const intelligenceWorker=new IntelligenceWorker({repository:unifiedStore.intelligenceJobs,concurrency:1,handlers:{
  [TASK_TYPES.RESUME_TAILORING]:async payload=>{const job=unifiedStore.jobs.findById(payload.jobId),resume=unifiedStore.resumes.findById(payload.resumeId),analysis=payload.analysisId?unifiedStore.analyses.findById(payload.analysisId):unifiedStore.analyses.all().find(x=>x.jobId===payload.jobId&&x.resumeId===payload.resumeId);if(!job||!resume)throw Object.assign(new Error("Vaga ou curriculo nao encontrado."),{code:"INTELLIGENCE_INPUT_NOT_FOUND"});const profile=await readProfile();const result=await resumeTailor.tailor({job,requirements:analysis?.requirements||[],resume:{...resume,sections:resume.sections||{}},evidence:analysis?.candidateEvidence||[],originalScore:analysis?.overallScore??analysis?.score??null,scoreEvaluator:tailored=>runCareerMatcher({job,profile,resume:tailored}).overallScore,userInstruction:String(payload.instruction||"").slice(0,800)}),run=unifiedStore.resumeTailoring.createRun({jobId:job.id,resumeId:resume.id,analysisId:analysis?.id,state:"REVIEW_REQUIRED",originalScore:result.originalScore,tailoredScore:result.tailoredScore,evidenceStatus:result.evidenceStatus,promptVersion:result.promptVersion,schemaVersion:result.schemaVersion,quality:result.quality,changes:result.changes});eventBus.emit("RESUME_TAILORING_REVIEW_REQUIRED",{resumeId:resume.id,jobId:job.id,applicationId:payload.applicationId||"",approvalRequestId:payload.approvalRequestId||"",tailoringRunId:run.id,atsBefore:run.originalScore,atsAfter:run.tailoredScore,generationMode:result.meta?.generationMode||"UNKNOWN",providerFallback:result.meta?.fallback===true,qualityStatus:result.quality?.status||"UNKNOWN"});return run;},
  [TASK_TYPES.APPLICATION_ANSWER_DRAFT]:async payload=>{const {application,question,pending}=answerDraftContext(payload.applicationId,payload.questionId);if(pending)return pending;const job=unifiedStore.jobs.findById(application.jobId),plan=unifiedStore.applicationPlans.forApplication(application.id),analysis=plan?.analysisId?unifiedStore.analyses.findById(plan.analysisId):null;const result=await answerDrafter.draft({question:{label:question.label,description:question.helpText||question.reasonRequired||"",type:question.fieldType},job,requirements:analysis?.requirements||[],evidence:analysis?.candidateEvidence||[]});if(result.evidenceStatus!=="VALID")throw Object.assign(new Error("Draft violou evidencias permitidas."),{code:"EVIDENCE_VIOLATION"});return unifiedStore.generatedContent.create({applicationId:application.id,questionId:question.id,contentType:"ANSWER_DRAFT",state:"REVIEW_REQUIRED",draft:result.draft,evidenceIds:result.evidenceIds,promptVersion:result.promptVersion,schemaVersion:result.schemaVersion});},
  [TASK_TYPES.COVER_LETTER]:async payload=>{const application=unifiedStore.applications.findById(payload.applicationId);if(!application)throw Object.assign(new Error("Candidatura nao encontrada."),{code:"INTELLIGENCE_INPUT_NOT_FOUND"});const job=unifiedStore.jobs.findById(application.jobId),plan=unifiedStore.applicationPlans.forApplication(application.id),analysis=plan?.analysisId?unifiedStore.analyses.findById(plan.analysisId):null;const result=await coverLetterGenerator.generate({requested:true,job,evidence:analysis?.candidateEvidence||[]});if(result.evidenceStatus!=="VALID")throw Object.assign(new Error("Cover letter violou evidencias permitidas."),{code:"EVIDENCE_VIOLATION"});const item=unifiedStore.generatedContent.create({applicationId:application.id,contentType:"COVER_LETTER",state:"REVIEW_REQUIRED",draft:result.draft,evidenceIds:result.evidenceIds,promptVersion:result.promptVersion,schemaVersion:result.schemaVersion});eventBus.emit("COVER_LETTER_READY",{applicationId:application.id,jobId:application.jobId});return item;}
}});
intelligenceWorker.handlers.BENCHMARK=async()=>{const status=await intelligenceService.status();const models=status.models.filter(item=>item.installed).map(item=>item.modelName);if(!models.length)throw Object.assign(new Error("Nenhum modelo instalado/configurado para benchmark."),{code:"MODEL_NOT_CONFIGURED"});return new BenchmarkService({provider:intelligenceService.provider,repository:unifiedStore.intelligenceBenchmarks,hardwareProfile:status.hardware}).run(models);};
const resumeComparisonService=new ResumeComparisonService({store:unifiedStore,matcher:runCareerMatcher,profileProvider:readProfile,contextProvider:async({job})=>({facts:candidateKnowledgeFacts().map(({lastUsedAt,...fact})=>fact).sort((a,b)=>a.key.localeCompare(b.key)),github:githubEvidenceProvider?.evidence()||null,familyFit:(await opportunityService.list()).find(item=>item.job.id===job.id)?.decision?.familyFit||null})});
const resumeBatchService=new ResumeBatchService({store:unifiedStore,resumeSelector,comparisonService:resumeComparisonService,tailor:resumeTailor,resumeService,documentExportService,profileProvider:readProfile,logger:unifiedStore.structuredLogs});
const batchExportService=new BatchExportService({store:unifiedStore});
const batchWorkerError=(item,error)=>resumeBatchService.log("RESUME_BATCH_ITEM_FAILED",unifiedStore.resumeBatches.findById(item.batchRunId),{batchItemId:item.id,jobId:item.jobId,resumeId:item.finalResumeId||item.selectedBaseResumeId,status:"FAILED",failureCode:error.code||"RESUME_BATCH_STAGE_FAILED"});
const batchWorkers={
  analysis:new BoundedStageWorker({repository:unifiedStore.resumeBatches,status:"ANALYZING",concurrency:4,handler:item=>resumeBatchService.analyzeItem(item),onError:batchWorkerError}),
  tailoring:new BoundedStageWorker({repository:unifiedStore.resumeBatches,status:"TAILORING",concurrency:initialIntelligenceSettings.hardwareProfile==="LOW_VRAM"?1:2,handler:item=>resumeBatchService.tailorItem(item),onError:batchWorkerError}),
  build:new BoundedStageWorker({repository:unifiedStore.resumeBatches,status:"BUILDING_VERSION",concurrency:4,handler:item=>resumeBatchService.buildItem(item),onError:batchWorkerError}),
  render:new BoundedStageWorker({repository:unifiedStore.resumeBatches,status:"RENDERING",concurrency:2,handler:item=>resumeBatchService.renderItem(item),onError:batchWorkerError}),
};
resumeBatchService.attachWorkers(batchWorkers);
let applicationWorkerBusy = false;

const resourceRepositories = [
  {
    id: "devops-exercises",
    name: "DevOps Exercises",
    path: path.join(resourcesDir, "devops-exercises"),
    url: "https://github.com/bregman-arie/devops-exercises",
    use: "Linux, redes, DNS, cloud, containers, observabilidade e soft skills."
  },
  {
    id: "sysadmin-skills",
    name: "Test Your Sysadmin Skills",
    path: path.join(resourcesDir, "sysadmin-skills"),
    url: "https://github.com/trimstray/test-your-sysadmin-skills",
    use: "Perguntas por nivel para NOC, suporte, infraestrutura e sysadmin."
  },
  {
    id: "blue-team-roadmap",
    name: "Blue Team Roadmap",
    path: path.join(resourcesDir, "blue-team-roadmap"),
    url: "https://github.com/keraattin/Blue-Team-Roadmap",
    use: "SOC, SIEM, triagem de alertas e resposta a incidentes."
  },
  {
    id: "interview-handbook",
    name: "Tech Interview Handbook",
    path: path.join(resourcesDir, "interview-handbook"),
    url: "https://github.com/yangshun/tech-interview-handbook",
    use: "Entrevista comportamental, metodo STAR e negociacao."
  }
];

let libraryCache = null;

const processes = new Map();

function cleanReplacementCharacters(value) {
  if (typeof value === "string") return value.replaceAll("\uFFFD", "");
  if (Array.isArray(value)) return value.map(cleanReplacementCharacters);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanReplacementCharacters(item)]));
  }
  return value;
}

function normalizeWebhookUrl(value){const url=new URL(String(value||""));if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Object.assign(new Error("Use uma URL HTTP(S) sem credenciais, query ou fragmento."),{code:"INVALID_WEBHOOK_URL"});return `${url.origin}${url.pathname}`.slice(0,1000);}
function publicIntegrationSettings(settings){let webhookUrl="";try{if(settings.webhookUrl)webhookUrl=normalizeWebhookUrl(settings.webhookUrl);}catch{}return {...settings,webhookUrl};}

function defaultUnifiedState() {
  return {
    jobs: [],
    resumes: [],
    applications: [],
    analyses: [],
    generations: [],
    searchResults: [],
    searchSchedules: [],
    alerts: [],
    searchHistory: [],
    portalReports: []
  };
}

async function readUnifiedState() {
  return cleanReplacementCharacters(await unifiedStore.read());
}

async function saveUnifiedState(state) {
  return unifiedStore.save(cleanReplacementCharacters(state));
}

function cleanUnifiedJob(input, current = {}) {
  const now = new Date().toISOString();
  return {
    id: current.id || input.id || `job-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: String(input.title ?? current.title ?? "").trim(),
    company: String(input.company ?? current.company ?? "").trim(),
    url: String(input.url ?? current.url ?? "").trim(),
    aggregatorUrl: String(input.aggregatorUrl ?? current.aggregatorUrl ?? "").trim(),
    canonicalUrl: String(input.canonicalUrl ?? current.canonicalUrl ?? "").trim(),
    greenhouseBoardToken: String(input.greenhouseBoardToken ?? current.greenhouseBoardToken ?? "").trim(),
    greenhouseJobPostId: String(input.greenhouseJobPostId ?? current.greenhouseJobPostId ?? "").trim(),
    location: String(input.location ?? current.location ?? "").trim(),
    workModel: String(input.workModel ?? current.workModel ?? "").trim(),
    salary: String(input.salary ?? current.salary ?? "").trim(),
    description: String(input.description ?? current.description ?? "").trim(),
    status: String(input.status ?? current.status ?? "salva"),
    source: String(input.source ?? current.source ?? "manual").trim(),
    provider:String(input.provider??current.provider??"").trim(),
    providerJobId:String(input.providerJobId??current.providerJobId??"").trim(),
    canonicalKey:String(input.canonicalKey??current.canonicalKey??"").trim(),
    applicationUrl:String(input.applicationUrl??current.applicationUrl??"").trim(),
    atsType:String(input.atsType??current.atsType??"").trim(),
    lifecycleStatus:String(input.lifecycleStatus??current.lifecycleStatus??"UNKNOWN").trim(),
    firstSeenAt:String(input.firstSeenAt??current.firstSeenAt??"").trim(),lastSeenAt:String(input.lastSeenAt??current.lastSeenAt??"").trim(),lastCheckedAt:String(input.lastCheckedAt??current.lastCheckedAt??"").trim(),closedAt:String(input.closedAt??current.closedAt??"").trim(),contentHash:String(input.contentHash??current.contentHash??"").trim(),provenance:input.provenance??current.provenance??{},
    sources: Array.isArray(input.sources) ? input.sources : (current.sources || []),
    externalId: String(input.externalId ?? current.externalId ?? "").trim(),
    datePosted: String(input.datePosted ?? current.datePosted ?? "").trim(),
    jobType: String(input.jobType ?? current.jobType ?? "").trim(),
    isRemote: Boolean(input.isRemote ?? current.isRemote ?? false),
    salaryMin: Number(input.salaryMin ?? current.salaryMin ?? 0) || 0,
    salaryMax: Number(input.salaryMax ?? current.salaryMax ?? 0) || 0,
    salaryCurrency: String(input.salaryCurrency ?? current.salaryCurrency ?? "").trim(),
    salaryInterval: String(input.salaryInterval ?? current.salaryInterval ?? "").trim(),
    seniority: String(input.seniority ?? current.seniority ?? "").trim(),
    fitScore: Number(input.fitScore ?? current.fitScore ?? 0),
    fitReasons: Array.isArray(input.fitReasons) ? input.fitReasons : (current.fitReasons || []),
    fitMissing: Array.isArray(input.fitMissing) ? input.fitMissing : (current.fitMissing || []),
    rankingMode: String(input.rankingMode ?? current.rankingMode ?? "regras"),
    rankingExplanation: String(input.rankingExplanation ?? current.rankingExplanation ?? "").trim(),
    createdAt: current.createdAt || now,
    updatedAt: now
  };
}

async function upsertUnifiedJob(input) {
  const incomingGreenhouseKey = canonicalGreenhouseKey({ boardToken: input.greenhouseBoardToken, jobPostId: input.greenhouseJobPostId }) || canonicalGreenhouseKey(parseGreenhouseIdentity(input.canonicalUrl || input.url));
  const current = unifiedStore.jobs.findByIdentity({
    id: input.id,
    externalId: input.externalId,
    url: input.url,
    canonicalUrl: input.canonicalUrl,
    canonicalKey: input.canonicalKey || incomingGreenhouseKey,
  });
  const job = cleanUnifiedJob({
    ...input,
    canonicalKey: input.canonicalKey || incomingGreenhouseKey,
  }, current || {});
  if (!job.title || !job.company || !job.description) {
    return { ok: false, error: "Informe cargo, empresa e descricao da vaga." };
  }
  const persisted = unifiedStore.database.transaction(() => unifiedStore.jobs.upsert(job));
  return { ok: true, job: persisted };
}

function safeUploadName(value) {
  return path.basename(String(value || "curriculo"))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
}

async function callCareerEngine(pathname, payload, timeout = Number(process.env.CAREER_ENGINE_TIMEOUT_MS || 120000)) {
  const { response, data } = await fetchJsonWithTimeout(`${careerEngineUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }, {
    timeout,
    timeoutMessage: "O motor Python excedeu o tempo limite.",
    timeoutCode: "ENGINE_TIMEOUT",
    unavailableMessage: "O motor Python esta indisponivel.",
    unavailableCode: "ENGINE_UNAVAILABLE"
  });
  if (!response.ok || !data.ok) {
    const status = response.status >= 400 && response.status <= 599 ? response.status : 502;
    const code = status === 504 ? "ENGINE_TIMEOUT" : status === 422 ? "INVALID_FILE" : "ENGINE_ERROR";
    throw new AppError(data.detail || data.error || `O motor Python respondeu ${response.status}.`, {
      status,
      code: data.code || code
    });
  }
  return data;
}

async function createUnifiedResume(input) {
  const now = new Date().toISOString();
  const id = `resume-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const title = String(input.title || path.parse(String(input.fileName || "")).name).trim();
  let text = String(input.text || "").trim();
  let sections = {};
  let extraction = { method: text ? "pasted-text" : "", pages: 0, characters: text.length };
  if (!title) return { ok: false, error: "Informe um nome ou selecione um arquivo." };

  let storedPath = "";
  let fileName = "";
  if (input.fileData && input.fileName) {
    fileName = safeUploadName(input.fileName);
    const buffer = decodeResumeUpload(fileName, input.fileData);
    try {
      const extracted = await callCareerEngine("/documents/extract", {
        filename: fileName,
        data: input.fileData
      });
      text = extracted.text;
      sections = extracted.sections || {};
      extraction = {
        method: extracted.method,
        pages: extracted.pages,
        characters: extracted.characters,
        contact: extracted.contact || {}
      };
    } catch (error) {
      if (text.length < 40) {
        throw error;
      }
      extraction = { method: "pasted-text-fallback", pages: 0, characters: text.length, warning: error.message };
    }
    await mkdir(resumeUploadsDir, { recursive: true });
    storedPath = path.join(resumeUploadsDir, `${id}-${fileName}`);
    await writeFile(storedPath, buffer);
  }

  if (text.length < 40) {
    return { ok: false, error: "Nao foi possivel obter texto suficiente do curriculo." };
  }

  extraction.importStatus = extraction.contact?.email?.value || extraction.contact?.phone?.value
    ? "IMPORTED"
    : "IMPORTED_NEEDS_REVIEW";

  const resume = {
    id,
    title,
    text,
    fileName,
    storedPath,
    focus: String(input.focus || "").trim(),
    sections,
    extraction,
    importStatus: extraction.importStatus,
    createdAt: now,
    updatedAt: now
  };
  const persisted = unifiedStore.database.transaction(() => unifiedStore.resumes.upsert(resume));
  return { ok: true, resume: persisted };
}

async function upsertUnifiedApplication(input) {
  try {
    return await unifiedStore.upsertApplication(input);
  } catch (error) {
    if (String(error?.code || "").startsWith("INVALID_APPLICATION_")) {
      throw new AppError(error.message, { status: 400, code: error.code, cause: error });
    }
    throw error;
  }
}

function normalizedText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

async function analyzeUnifiedAts(input) {
  const job = unifiedStore.jobs.findById(input.jobId);
  const resume = input.resumeId?unifiedStore.resumes.findById(input.resumeId):{id:null,text:"",sections:{}};
  if (!job) return { ok: false, error: "Selecione uma vaga." };
  if (input.resumeId&&!resume) return { ok: false, error: "O currículo selecionado não foi encontrado." };
  const profile = await readProfile();
  const analysis = runCareerMatcher({ job, profile, resume });
  const lowConfidenceRequirements=semanticMatcherEnabled?analysis.requirements.filter(requirement=>requirement.importance==="unknown").slice(0,10):[];
  const requirementEnhancement=lowConfidenceRequirements.length?await semanticRequirementEnhancer.enhance(lowConfidenceRequirements,{deterministicConfidence:.4}):{requirements:[],enhanced:false,source:"DETERMINISTIC"};
  const semanticMatches=[];if(semanticMatcherEnabled)for(const item of analysis.items.filter(entry=>["NO_MATCH","PARTIAL_MATCH","UNKNOWN"].includes(entry.status)).slice(0,5)){const candidates=analysis.candidateEvidence.filter(evidence=>evidence.type===item.requirement.type||["skill","tool","framework","platform","cloud","methodology"].includes(evidence.type)).slice(0,12);const semantic=await semanticEvidenceMatcher.match(item.requirement,candidates);if(semantic.status==="MATCH"||semantic.status==="PARTIAL_MATCH")semanticMatches.push({requirementId:item.requirementId,...semantic,meta:undefined});}
  analysis.semanticEnhancement={status:semanticMatches.length||requirementEnhancement.enhanced?"ENHANCED":"UNCHANGED",requirementEnhancements:requirementEnhancement.requirements,evidenceMatches:semanticMatches,warnings:semanticMatches.length||requirementEnhancement.enhanced?["Semantic enhancements are advisory and do not change deterministic scores, eligibility or blockers."]:[]};
  const persistedAnalysis = unifiedStore.database.transaction(() => {
    const saved = unifiedStore.analyses.upsert(analysis);
    unifiedStore.jobRequirements.syncForJob(
      job.id,
      analysis.requirements || [],
    );
    unifiedStore.analysisItems.syncForAnalysis(
      saved.id,
      analysis.items || [],
    );
    return saved;
  });
  unifiedStore.candidateKnowledge.syncGapsFromAnalysis({jobId:job.id,analysisId:persistedAnalysis.id,items:analysis.items||[]});
  opportunityService.invalidate();
  const responseAnalysis = {
    ...persistedAnalysis,
    requirements: analysis.requirements || [],
    items: analysis.items || [],
  };
  return { ok: true, analysis: responseAnalysis };
}

function uniqueTerms(value) {
  return [...new Set(
    String(value || "")
      .split(/[\n,;|]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function inferSeniority(value) {
  const text = normalizedText(value);
  if (/\b(estagio|estagiario|aprendiz|trainee)\b/.test(text)) return "entrada";
  if (/\b(junior|jr|nivel i|nivel 1|n1)\b/.test(text)) return "junior";
  if (/\b(pleno|mid|nivel ii|nivel 2|n2)\b/.test(text)) return "pleno";
  if (/\b(senior|sr|especialista|nivel iii|nivel 3|n3|coordenador|gerente)\b/.test(text)) return "senior";
  return "nao informado";
}

function rankUnifiedJob(job, profile, resumes = [], desiredSeniority = "") {
  const blockedCompanies = uniqueTerms(profile.preferences?.blacklistCompanies);
  const blockedTitles = uniqueTerms(profile.preferences?.blacklistTitleTerms);

  if (blockedCompanies.some((term) => normalizedText(job.company).includes(normalizedText(term)))) {
    return { score: 0, reasons: [], missing: ["Empresa bloqueada no perfil."], blocked: true };
  }
  if (blockedTitles.some((term) => {
    const normalizedTerm = normalizedText(term);
    return normalizedText(job.title).includes(normalizedTerm) ||
      (normalizedTerm.length >= 6 && normalizedText(job.title).includes(normalizedTerm.slice(0, 5)));
  })) {
    return { score: 0, reasons: [], missing: ["Titulo bloqueado no perfil."], blocked: true };
  }

  const combinedResume = {
    id: "combined-resumes",
    text: resumes.map((resume) => resume.text).filter(Boolean).join("\n\n"),
    sections: {
      experience: resumes.map((resume) => resume.sections?.experience || "").filter(Boolean).join("\n\n"),
      skills: resumes.flatMap((resume) => Array.isArray(resume.sections?.skills) ? resume.sections.skills : [resume.sections?.skills || ""]).filter(Boolean),
      education: resumes.map((resume) => resume.sections?.education || "").filter(Boolean).join("\n"),
      certifications: resumes.map((resume) => resume.sections?.certifications || "").filter(Boolean).join("\n"),
      languages: resumes.map((resume) => resume.sections?.languages || "").filter(Boolean).join("\n")
    },
    extraction: {}
  };
  const matcher = runCareerMatcher({ job: { ...job, id: job.id || job.externalId || jobIdentity(job) }, profile, resume: combinedResume });
  const reasons = matcher.items.filter((item) => item.status === "MATCH").slice(0, 4).map((item) => `${item.requirement.normalizedName}: ${item.explanation}`);
  const missing = matcher.items.filter((item) => ["NO_MATCH", "UNKNOWN"].includes(item.status)).slice(0, 6).map((item) => `${item.requirement.normalizedName}: ${item.explanation}`);
  const seniority = job.seniority || inferSeniority(`${job.title} ${job.description.slice(0, 800)}`);

  return {
    score: matcher.overallScore,
    reasons,
    missing,
    blocked: false,
    seniority,
    eligibility: matcher.eligibility
  };
}

function canonicalJobUrl(value) {
  try {
    const url = new URL(String(value || ""));
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|trk|tracking|ref|refid|source|src|from)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().replace(/[?#].*$/, "").replace(/\/$/, "");
  }
}

function jobIdentity(job) {
  const greenhouseKey = canonicalGreenhouseKey({ boardToken: job.greenhouseBoardToken, jobPostId: job.greenhouseJobPostId }) || canonicalGreenhouseKey(parseGreenhouseIdentity(job.canonicalUrl || job.url));
  if (greenhouseKey) return greenhouseKey;
  const url = canonicalJobUrl(job.url);
  if (url) return `url:${normalizedText(url)}`;
  return `text:${normalizedText(job.title).replace(/\W/g, "")}|${normalizedText(job.company).replace(/\W/g, "")}|${normalizedText(job.location).replace(/\W/g, "").slice(0, 40)}`;
}

function deduplicateJobs(jobs) {
  const byKey = new Map();
  for (const raw of jobs) {
    const job = { ...raw, url: canonicalJobUrl(raw.url), sources: [raw.source].filter(Boolean) };
    const fallbackKey = `text:${normalizedText(job.title).replace(/\W/g, "")}|${normalizedText(job.company).replace(/\W/g, "")}`;
    const key = jobIdentity(job);
    const existing = byKey.get(key) || byKey.get(fallbackKey);
    if (!existing) {
      byKey.set(key, job);
      if (key !== fallbackKey) byKey.set(fallbackKey, job);
      continue;
    }
    existing.sources = [...new Set([...(existing.sources || []), job.source].filter(Boolean))];
    if ((job.description || "").length > (existing.description || "").length) {
      const sources = existing.sources;
      Object.assign(existing, job, { sources });
    }
    if (!existing.salary && job.salary) {
      Object.assign(existing, {
        salary: job.salary,
        salaryMin: job.salaryMin,
        salaryMax: job.salaryMax,
        salaryCurrency: job.salaryCurrency,
        salaryInterval: job.salaryInterval
      });
    }
  }
  return [...new Set(byKey.values())];
}

function monthlySalary(job) {
  const amount = Number(job.salaryMax || job.salaryMin || 0);
  const interval = normalizedText(job.salaryInterval);
  if (!amount) return 0;
  if (interval.includes("year") || interval.includes("ano")) return amount / 12;
  if (interval.includes("hour") || interval.includes("hora")) return amount * 160;
  if (interval.includes("week") || interval.includes("semana")) return amount * 4.33;
  if (interval.includes("day") || interval.includes("dia")) return amount * 22;
  return amount;
}

function filterJobs(jobs, input) {
  const workModel = String(input.workModel || (input.remote ? "remote" : "todos"));
  const seniority = String(input.seniority || "todos");
  const minimumSalary = Math.max(0, Number(input.minimumSalary || 0));
  const salaryOnly = Boolean(input.salaryOnly) || minimumSalary > 0;
  const minimumScore = Math.max(0, Math.min(100, Number(input.minimumScore || 0)));
  return jobs.filter((job) => {
    const text = normalizedText(`${job.title} ${job.description.slice(0, 1200)} ${job.workModel}`);
    const isRemote = Boolean(job.isRemote) || /\b(remoto|remote|home office)\b/.test(text);
    const isHybrid = /\b(hibrido|hybrid)\b/.test(text);
    if (workModel === "remote" && !isRemote) return false;
    if (workModel === "hybrid" && !isHybrid) return false;
    if (workModel === "onsite" && (isRemote || isHybrid)) return false;
    if (salaryOnly && !monthlySalary(job)) return false;
    if (minimumSalary && monthlySalary(job) < minimumSalary) return false;
    if (seniority !== "todos" && job.seniority !== "nao informado" && job.seniority !== seniority) return false;
    if (job.fitScore < minimumScore) return false;
    return true;
  });
}

async function applyLlmRanking(jobs, profile) {
  if (!jobs.length) return { jobs, used: false, error: "" };
  const candidates = jobs.slice(0, 12);
  try {
    const response=await intelligenceService.execute(TASK_TYPES.JOB_RANKING,{candidate:{roles:uniqueTerms(profile.career?.targetRoles),skills:uniqueTerms(profile.career?.skills),years:profile.career?.yearsExperience,locationRule:profile.career?.locationRule,workModels:profile.career?.workModels},jobs:candidates.map(job=>({id:job.externalId||jobIdentity(job),title:job.title,company:job.company,location:job.location,deterministicScore:job.fitScore,description:job.description.slice(0,2600)}))},{fallback:{rankings:[]}});
    if(response.meta.fallback)return {jobs,used:false,error:"Ollama/Intelligence Layer sem modelo disponivel; ranking deterministico preservado."};
    const parsed=response.result;
    const results = Array.isArray(parsed.rankings) ? parsed.rankings : [];
    const byId = new Map(results.map((item) => [String(item.id), item]));
    const updated = jobs.map((job) => {
      const id = job.externalId || jobIdentity(job);
      const item = byId.get(String(id));
      if (!item) return job;
      const adjustment = Math.max(-15, Math.min(15, Number(item.adjustment || 0)));
      return {
        ...job,
        fitScore: Math.max(0, Math.min(100, Math.round(job.fitScore + adjustment))),
        rankingMode: "regras + Ollama",
        rankingExplanation: String(item.explanation || "").slice(0, 500),
        fitMissing: [...new Set([
          ...(job.fitMissing || []),
          ...(Array.isArray(item.missing) ? item.missing.map(String) : [])
        ])].slice(0, 8)
      };
    });
    return { jobs: updated, used: true, error: "" };
  } catch (error) {
    return { jobs, used: false, error: `Ranking por IA indisponivel: ${error.message}` };
  }
}

async function searchUnifiedJobs(input, options = {}) {
  const query = String(input.query || "").trim();
  if (query.length < 2) return { ok: false, error: "Informe o cargo ou palavras-chave." };
  const requestedGeographies=Array.isArray(input.geographies)?input.geographies.map(geographySurfaceById).filter(Boolean):[],surfaces=requestedGeographies.length?requestedGeographies:[{id:"CUSTOM",location:String(input.location||defaultCountry).trim(),country:String(input.country||defaultCountry),workModel:Boolean(input.remote)?"REMOTE":"",remoteScope:Boolean(input.remote)?String(input.country||defaultCountry):""}],sites=Array.isArray(input.sites)?input.sites:["indeed","linkedin","glassdoor"],discoveries=[];
  for(const surface of surfaces)discoveries.push(await discoveryService.discover({
    query,location:surface.location||String(input.location||defaultCountry).trim(),country:surface.country||String(input.country||defaultCountry),remoteScope:surface.remoteScope||"",workModel:surface.workModel||"",sites,
    providers:Array.isArray(input.providers)&&input.providers.length?input.providers:["jobspy"],organizationKey:String(input.organizationKey||""),company:String(input.company||""),
    limit:Math.max(1,Math.min(50,Number(input.resultsWanted||20))),hoursOld:input.hoursOld?Number(input.hoursOld):null,remote:surface.workModel==="REMOTE"||Boolean(input.remote),geographySurface:surface.id
  }));
  const engine={jobs:discoveries.flatMap(item=>item.jobs||[]),sites,sourceReports:discoveries.flatMap(item=>(item.sourceReports||[]).map(report=>({...report,source:report.provider,status:report.status==="HEALTHY"?"ok":report.status==="EMPTY"?"empty":String(report.status||"error").toLowerCase()}))),discoveryRun:discoveries.at(-1)?.run};
  const portalReports=engine.sourceReports.flatMap(report=>report.sites||[]),sourceRawCount=portalReports.reduce((total,report)=>total+Number(report.rawResults||0),0),geographyRejectedCount=portalReports.reduce((total,report)=>total+Number(report.geographyRejectedResults||0),0);
  const profile = await readProfile();
  const desiredSeniority = String(input.seniority || "todos");
  let ranked = deduplicateJobs(engine.jobs)
    .map((job) => {
      const activeResumes = unifiedStore.resumes.allActive?.() || unifiedStore.resumes.all();
      const fit = rankUnifiedJob(job, profile, activeResumes, desiredSeniority);
      return {
        ...job,
        fitScore: fit.score,
        fitReasons: fit.reasons,
        fitMissing: fit.missing,
        blocked: fit.blocked,
        seniority: fit.seniority,
        rankingMode: "regras",
        rankingExplanation: ""
      };
    })
    .filter((job) => !job.blocked)
    .sort((a, b) => b.fitScore - a.fitScore);
  const llm = input.useLlm ? await applyLlmRanking(ranked, profile) : { jobs: ranked, used: false, error: "" };
  ranked = filterJobs(llm.jobs, input).sort((a, b) => b.fitScore - a.fitScore);
  const activeHuntProfile=jobHuntService.listProfiles().find(item=>item.enabled)||jobHuntService.listProfiles()[0]||{},analysisSummary=await jobHuntService.evaluateDiscoveredJobs(ranked,{consider:activeHuntProfile.considerThreshold??70,priority:activeHuntProfile.notifyThreshold??85});
  opportunityService.invalidate();
  for(const job of ranked.filter(item=>item.fitScore>=80).slice(0,10))eventBus.emit("HIGH_MATCH_FOUND",{jobId:job.id||"",title:job.title,company:job.company,fitScore:job.fitScore,provider:job.provider||job.source});
  const currentProjection=unifiedStore.searchProjection(),searchHistory=[{
    id: `search-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    query,
    location: String(input.location || defaultCountry),
    count: ranked.length,
    rawCount: engine.jobs.length,
    sourceRawCount,
    geographyRejectedCount,
    analyzedCount: analysisSummary.matchEvaluated,
    relevantCount: analysisSummary.relevantOpportunities,
    priorityCount: analysisSummary.priorityOpportunities,
    sources: engine.sites,
    sourceReports: Array.isArray(engine.sourceReports) ? engine.sourceReports : [],
    rankingMode: llm.used ? "regras + Ollama" : "regras",
    rankingWarning: llm.error,
    scheduled: Boolean(options.scheduled),
    createdAt: new Date().toISOString()
  },...(currentProjection.searchHistory||[])].slice(0,50),state=await unifiedStore.saveSearchProjection({
    searchResults:options.persistResults===false?currentProjection.searchResults:ranked.slice(0,150),
    portalReports:Array.isArray(engine.sourceReports)?engine.sourceReports:[],
    searchHistory
  });
  return {
    ok: true,
    jobs: ranked.slice(0, 150),
    count: ranked.length,
    rawCount: engine.jobs.length,
    sourceRawCount,
    geographyRejectedCount,
    analyzedCount: analysisSummary.matchEvaluated,
    relevantCount: analysisSummary.relevantOpportunities,
    priorityCount: analysisSummary.priorityOpportunities,
    sites: engine.sites,
    sourceReports: state.portalReports,
    rankingMode: llm.used ? "regras + Ollama" : "regras",
    rankingWarning: llm.error,
    state
  };
}

const ONBOARDING_STATES=new Set(["NOT_STARTED","IN_PROGRESS","COMPLETED","SKIPPED"]);
async function readProductOnboarding(){
  const profile=await readProfile(),current=profile.product?.onboarding;
  if(current&&ONBOARDING_STATES.has(current.status)&&current.status!=="NOT_STARTED")return current;
  const connection=unifiedStore.database.connection,
    persistedSetup=connection.prepare("SELECT EXISTS(SELECT 1 FROM job_hunt_profiles LIMIT 1) OR EXISTS(SELECT 1 FROM resumes LIMIT 1) OR EXISTS(SELECT 1 FROM candidate_facts WHERE lifecycle_status='ACTIVE' LIMIT 1) configured").get(),
    configured=Boolean(profile.personal?.fullName||profile.career?.targetRoles?.length||profile.career?.headline||persistedSetup?.configured);
  if(current&&ONBOARDING_STATES.has(current.status)&&!configured)return current;
  const onboarding={status:configured?"COMPLETED":"NOT_STARTED",step:configured?5:1,areas:[],seniorities:["INTERNSHIP","JUNIOR"],geographies:["LOCAL_LISBON","LOCAL_PORTO","REMOTE_PORTUGAL"],autopilot:false,updatedAt:new Date().toISOString()};
  await saveProfile({...profile,product:{...(profile.product||{}),onboarding}});
  return onboarding;
}
async function saveProductOnboarding(input={}){
  const allowedGeographies=new Set(["LOCAL_DF","REMOTE_BRAZIL","LOCAL_LISBON","LOCAL_PORTO","LOCAL_BRAGA","REMOTE_PORTUGAL"]),profile=await readProfile(),status=ONBOARDING_STATES.has(input.status)?input.status:"IN_PROGRESS",onboarding={status,step:Math.max(1,Math.min(5,Number(input.step)||1)),areas:Array.isArray(input.areas)?input.areas.map(String).slice(0,10):[],seniorities:Array.isArray(input.seniorities)?input.seniorities.filter(value=>["INTERNSHIP","JUNIOR"].includes(value)):[],geographies:Array.isArray(input.geographies)?input.geographies.filter(value=>allowedGeographies.has(value)):[],autopilot:input.autopilot===true,updatedAt:new Date().toISOString()};
  await saveProfile({...profile,product:{...(profile.product||{}),onboarding}});
  if(status==="COMPLETED"&&onboarding.autopilot&&!jobHuntService.listProfiles().length){
    const priorities=[];
    if(onboarding.geographies.includes("LOCAL_DF"))priorities.push({priority:priorities.length+1,location:"Brasília, DF",workModel:"HYBRID",remoteScope:"",accepted:true});
    if(onboarding.geographies.includes("REMOTE_BRAZIL"))priorities.push({priority:priorities.length+1,location:"Brasil",workModel:"REMOTE",remoteScope:"Brasil",accepted:true});
    if(onboarding.geographies.includes("LOCAL_LISBON"))priorities.push({priority:priorities.length+1,location:"Lisboa, Portugal",workModel:"HYBRID",remoteScope:"",accepted:true});
    if(onboarding.geographies.includes("LOCAL_PORTO"))priorities.push({priority:priorities.length+1,location:"Porto, Portugal",workModel:"HYBRID",remoteScope:"",accepted:true});
    if(onboarding.geographies.includes("LOCAL_BRAGA"))priorities.push({priority:priorities.length+1,location:"Braga, Portugal",workModel:"HYBRID",remoteScope:"",accepted:true});
    if(onboarding.geographies.includes("REMOTE_PORTUGAL"))priorities.push({priority:priorities.length+1,location:"Portugal",workModel:"REMOTE",remoteScope:"Portugal",accepted:true});
    jobHuntService.saveProfile({name:"Minha busca automática",enabled:true,jobFamilies:onboarding.areas,seniorities:onboarding.seniorities.length?onboarding.seniorities:["INTERNSHIP","JUNIOR"],locations:priorities.map(item=>item.location),locationPolicy:{priorities,allowOnsiteOutsideArea:false},sourcePreferences:["indeed","linkedin","glassdoor","google"],workModels:[...new Set(priorities.map(item=>item.workModel))],considerThreshold:70,prepareResumeThreshold:82,notifyThreshold:90,prepareResume:true,schedule:{mode:"INTERVAL",everyHours:6},notificationPolicy:{maxInstantAlerts:3,digestEnabled:true,decisionClasses:["RECOMMENDED","REVIEW"],delivery:["WHATSAPP"],summaryFields:["ROLE","COMPANY","LOCATION","RECOMMENDATION","STRENGTHS_GAPS","JOB_LINK"]}});
  }
  return onboarding;
}

async function analyzeJobForUser(input={}){
  let candidate={title:String(input.title||"").trim(),company:String(input.company||"").trim(),description:String(input.description||"").trim(),location:String(input.location||"").trim(),workModel:String(input.workModel||"").trim(),url:String(input.url||"").trim(),source:"manual-analysis"};
  if(candidate.url&&!candidate.description){
    try{
      const inspected=await careerPageDiscovery.inspect(candidate.url,{company:candidate.company,limit:10}),normalizedUrl=candidate.url.replace(/\/$/,"");
      const extracted=inspected.jobs.find(job=>[job.sourceUrl,job.canonicalUrl,job.applicationUrl].some(value=>String(value||"").replace(/\/$/,"")===normalizedUrl))||inspected.jobs[0];
      if(!extracted)return {ok:true,status:"DESCRIPTION_REQUIRED",needsDescription:true,message:"Não conseguimos ler esta página automaticamente.",url:candidate.url};
      candidate={...extracted,url:extracted.canonicalUrl||extracted.sourceUrl||candidate.url,source:extracted.provider||"career-page"};
    }catch(error){
      if(["PRIVATE_DISCOVERY_TARGET","UNSAFE_DISCOVERY_URL"].includes(error.code))throw error;
      return {ok:true,status:"DESCRIPTION_REQUIRED",needsDescription:true,message:"Não conseguimos ler esta página automaticamente.",url:candidate.url,errorCode:error.code||"PUBLIC_JOB_EXTRACTION_FAILED"};
    }
  }
  if(candidate.description.length<40)return {ok:true,status:"DESCRIPTION_REQUIRED",needsDescription:true,message:"Cole a descrição da vaga para continuar.",url:candidate.url};
  if(!candidate.title)candidate.title="Vaga para análise";
  if(!candidate.company)candidate.company="Empresa não informada";
  const saved=await upsertUnifiedJob(candidate);
  if(!saved.ok)return saved;
  const analyzed=await analyzeUnifiedAts({jobId:saved.job.id,resumeId:String(input.resumeId||"")});
  const opportunity=(await opportunityService.list()).find(item=>item.job.id===saved.job.id);
  return {ok:true,status:"ANALYZED",job:saved.job,analysis:analyzed.analysis,opportunity};
}

function cleanSearchSchedule(input, current = {}) {
  const intervalHours = Math.max(1, Math.min(168, Number(input.intervalHours ?? current.intervalHours ?? 12)));
  const now = new Date();
  const explicitlyReenabled = input.enabled === true && current.enabled === false;
  return {
    id: current.id || input.id || `schedule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name: String(input.name ?? current.name ?? input.query ?? "Busca de vagas").trim().slice(0, 100),
    query: String(input.query ?? current.query ?? "").trim().slice(0, 180),
    location: String(input.location ?? current.location ?? defaultCountry).trim().slice(0, 120),
    sites: Array.isArray(input.sites) ? input.sites.filter((site) => ["indeed", "linkedin", "glassdoor", "google"].includes(site)) : (current.sites || ["indeed"]),
    providers:Array.isArray(input.providers)?input.providers.filter(id=>providerRegistry.get(id)):(current.providers||["jobspy"]),
    organizationKey:String(input.organizationKey??current.organizationKey??"").trim().slice(0,160),
    resultsWanted: Math.max(5, Math.min(50, Number(input.resultsWanted ?? current.resultsWanted ?? 15))),
    hoursOld: Math.max(1, Math.min(2160, Number(input.hoursOld ?? current.hoursOld ?? 168))),
    workModel: String(input.workModel ?? current.workModel ?? "todos"),
    salaryOnly: Boolean(input.salaryOnly ?? current.salaryOnly ?? false),
    minimumSalary: Math.max(0, Number(input.minimumSalary ?? current.minimumSalary ?? 0)),
    seniority: String(input.seniority ?? current.seniority ?? "todos"),
    minimumScore: Math.max(0, Math.min(100, Number(input.minimumScore ?? current.minimumScore ?? 0))),
    useLlm: Boolean(input.useLlm ?? current.useLlm ?? false),
    intervalHours,
    enabled: Boolean(input.enabled ?? current.enabled ?? true),
    seenKeys: Array.isArray(current.seenKeys) ? current.seenKeys.slice(-1000) : [],
    lastRunAt: current.lastRunAt || "",
    lastNewCount: Number(current.lastNewCount || 0),
    schedulerStatus: explicitlyReenabled ? LEGACY_SCHEDULE_STATUS.ACTIVE : (current.schedulerStatus || LEGACY_SCHEDULE_STATUS.ACTIVE),
    failureCount: explicitlyReenabled ? 0 : Math.max(0, Number(current.failureCount || 0)),
    lastErrorCode: explicitlyReenabled ? "" : String(current.lastErrorCode || ""),
    lastFailureAt: explicitlyReenabled ? "" : String(current.lastFailureAt || ""),
    lastError: explicitlyReenabled ? "" : (current.lastError || ""),
    nextRunAt: input.nextRunAt || current.nextRunAt || new Date(now.getTime() + intervalHours * 3600000).toISOString(),
    createdAt: current.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  };
}

async function upsertSearchSchedule(input) {
  const state = await readUnifiedState();
  const index = state.searchSchedules.findIndex((item) => item.id === input.id);
  const schedule = cleanSearchSchedule(input, index >= 0 ? state.searchSchedules[index] : {});
  if (schedule.query.length < 2 || (!schedule.sites.length&&!schedule.providers.length)) {
    return { ok: false, error: "Informe a busca e escolha pelo menos um portal." };
  }
  if (index >= 0) state.searchSchedules[index] = schedule;
  else state.searchSchedules.unshift(schedule);
  await saveUnifiedState(state);
  return { ok: true, schedule, state };
}

async function deleteSearchSchedule(id) {
  const state = await readUnifiedState();
  state.searchSchedules = state.searchSchedules.filter((item) => item.id !== id);
  await saveUnifiedState(state);
  return { ok: true, state };
}

async function runSearchSchedule(id) {
  let state = await readUnifiedState();
  const schedule = state.searchSchedules.find((item) => item.id === id);
  if (!schedule) return { ok: false, error: "Busca agendada nao encontrada." };
  if (!schedule.enabled || [LEGACY_SCHEDULE_STATUS.INVALID_REFERENCE, LEGACY_SCHEDULE_STATUS.FAILED_PERMANENT, LEGACY_SCHEDULE_STATUS.RETRY_EXHAUSTED].includes(schedule.schedulerStatus)) {
    return { ok: false, skipped: true, errorCode: "SCHEDULE_NOT_RUNNABLE", schedule };
  }
  try {
    const result = await searchUnifiedJobs(schedule, { scheduled: true, persistResults: true });
    if (result.sourceReports.every((report) => !["ok", "empty"].includes(report.status))) {
      throw Object.assign(new Error("Scheduled sources unavailable."), { code: "SCHEDULE_SOURCES_UNAVAILABLE" });
    }
    state = await readUnifiedState();
    const current = state.searchSchedules.find((item) => item.id === id);
    if (!current) return { ok: false, error: "A busca agendada foi removida durante a execucao." };
    const known = new Set(current.seenKeys || []);
    const newJobs = result.jobs.filter((job) => !known.has(jobIdentity(job)));
    const now = new Date();
    Object.assign(current, completeLegacySchedule(current, now));
    current.seenKeys = [...new Set([
      ...(current.seenKeys || []),
      ...result.jobs.map(jobIdentity)
    ])].slice(-1000);
    current.lastNewCount = newJobs.length;
    for (const job of newJobs.slice(0, 30)) {
      state.alerts.unshift({
        id: `alert-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        type: "new-job",
        title: `${job.title} - ${job.company}`,
        message: `${job.fitScore}% de aderencia | ${job.location || "local nao informado"}`,
        job,
        scheduleId: current.id,
        scheduleName: current.name,
        read: false,
        createdAt: now.toISOString()
      });
    }
    state.alerts = state.alerts.slice(0, 200);
    await saveUnifiedState(state);
    return { ...result, newCount: newJobs.length, state };
  } catch (error) {
    state = await readUnifiedState();
    const current = state.searchSchedules.find((item) => item.id === id);
    if (current) {
      const failed = failLegacySchedule(current, error);
      await unifiedStore.saveSearchSchedule(failed);
      console.warn("Falha controlada no scheduler legado.", legacyScheduleLogContext(failed));
      state = await readUnifiedState();
      return { ok: false, error: failed.lastError, errorCode: failed.lastErrorCode, schedule: failed, state };
    }
    return { ok: false, error: "A busca agendada foi removida durante a execucao.", errorCode: "SCHEDULE_REMOVED", state };
  }
}

let scheduledSearchRunning = false;

async function runDueScheduledSearches() {
  if (scheduledSearchRunning) return;
  scheduledSearchRunning = true;
  try {
    const schedules = unifiedStore.searchSchedules.all();
    await runDueLegacySchedules({ schedules, run: runSearchSchedule });
  } finally {
    scheduledSearchRunning = false;
  }
}

async function markAlertsRead(input) {
  const state = await readUnifiedState();
  const ids = new Set(Array.isArray(input.ids) ? input.ids.map(String) : []);
  for (const alert of state.alerts) {
    if (!ids.size || ids.has(alert.id)) alert.read = true;
  }
  if (input.clear) state.alerts = state.alerts.filter((item) => !item.read);
  await saveUnifiedState(state);
  return { ok: true, state };
}

function fallbackResumeSections(job, resume, profile) {
  const extracted = resume.sections || {};
  const profileSkills = uniqueTerms(profile.career?.skills);
  const jobText = normalizedText(`${job.title} ${job.description}`);
  const prioritizedSkills = [...profileSkills]
    .sort((a, b) =>
      Number(jobText.includes(normalizedText(b))) - Number(jobText.includes(normalizedText(a)))
    )
    .slice(0, 18);
  return {
    summary: extracted.summary || profile.career?.summary || "",
    skills: prioritizedSkills,
    experience: extracted.experience || profile.experience || resume.text,
    education: extracted.education || profile.education || "",
    certifications: extracted.certifications || profile.certifications || "",
    projects: extracted.projects || "",
    languages: extracted.languages || (profile.career?.englishLevel ? `Ingles: ${profile.career.englishLevel}` : "")
  };
}

async function adaptedResumeSections(job, resume, profile, analysis) {
  const fallback = fallbackResumeSections(job, resume, profile);
  const approved=unifiedStore.resumeTailoring.latestFor(job.id,resume.id);
  if(!approved||approved.state!=="APPROVED")return {sections:fallback,usedFallback:true,warning:approved?"Alteracoes semanticas aguardam revisao.":"Nenhum tailoring aprovado; geracao deterministica utilizada.",tailoringRun:approved};
  const proposed=structuredClone(fallback);for(const change of approved.changes.filter(item=>item.validationStatus==="VALID")){for(const [section,value] of Object.entries(proposed))if(typeof value==="string"&&value.includes(change.original))proposed[section]=value.replace(change.original,change.proposed);}
  const guarded=guardGeneratedResumeSections({generated:proposed,fallback,analysis});return {sections:guarded.sections,usedFallback:guarded.rejectedUnsupportedContent.length>0,warning:guarded.rejectedUnsupportedContent.length?`Conteudo sem evidencia foi descartado nas secoes: ${guarded.rejectedUnsupportedContent.join(", ")}.`:"",tailoringRun:approved};
}

async function generateUnifiedResume(input) {
  const state = await readUnifiedState();
  const job = state.jobs.find((item) => item.id === input.jobId);
  const resume = state.resumes.find((item) => item.id === input.resumeId);
  if (!job || !resume) return { ok: false, error: "Selecione uma vaga e um curriculo." };
  const profile = await readProfile();
  let analysis = state.analyses.find((item) => item.jobId === job.id && item.resumeId === resume.id);
  if (!analysis) {
    const result = await analyzeUnifiedAts({ jobId: job.id, resumeId: resume.id });
    analysis = result.analysis;
    Object.assign(state, result.state);
  }
  const adapted = await adaptedResumeSections(job, resume, profile, analysis);
  const safeBase = safeUploadName(`${job.title}-${job.company}`)
    .replace(/\.[^.]+$/, "")
    .replace(/_+/g, "-")
    .toLowerCase() || "curriculo-adaptado";
  const generated = await callCareerEngine("/documents/generate", {
    full_name: profile.personal?.fullName || "Curriculo",
    headline: profile.career?.headline || resume.focus,
    contact_lines: [
      profile.personal?.email,
      profile.personal?.phone,
      [profile.personal?.city, profile.personal?.country].filter(Boolean).join(", "),
      profile.personal?.linkedin
    ].filter(Boolean),
    sections: adapted.sections,
    output_name: safeBase
  });
  const id = `generation-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  await mkdir(generatedResumesDir, { recursive: true });
  const docxPath = path.join(generatedResumesDir, `${id}-${safeBase}.docx`);
  const pdfPath = path.join(generatedResumesDir, `${id}-${safeBase}.pdf`);
  await writeFile(docxPath, Buffer.from(generated.docx, "base64"));
  await writeFile(pdfPath, Buffer.from(generated.pdf, "base64"));
  const record = {
    id,
    jobId: job.id,
    resumeId: resume.id,
    title: `${job.title} - ${job.company}`,
    sections: adapted.sections,
    docxPath,
    pdfPath,
    usedFallback: adapted.usedFallback,
    warning: adapted.warning,
    createdAt: new Date().toISOString()
  };
  const freshState = await readUnifiedState();
  freshState.generations.unshift(record);
  freshState.generations = freshState.generations.slice(0, 100);
  await saveUnifiedState(freshState);
  return { ok: true, generation: record, state: freshState };
}

async function deleteKnownFile(file) {
  if (!file) return;
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(hubDataDir) + path.sep)) return;
  await unlink(resolved).catch(() => {});
}

async function deleteUnifiedEntity(input) {
  const state = await readUnifiedState();
  const type = String(input.type || "");
  const id = String(input.id || "");
  if (type === "resume") {
    const resume = state.resumes.find((item) => item.id === id);
    if (!resume) return { ok: false, error: "Curriculo nao encontrado." };
    if(unifiedStore.resumeVersions.list({resumeId:id}).length)return {ok:false,error:"O curriculo possui versoes imutaveis. Arquive as versoes; artefatos referenciados nao podem ser excluidos.",code:"RESUME_HAS_IMMUTABLE_VERSIONS"};
    await deleteKnownFile(resume.storedPath);
    const generations = state.generations.filter((item) => item.resumeId === id);
    for (const item of generations) {
      await deleteKnownFile(item.docxPath);
      await deleteKnownFile(item.pdfPath);
    }
    state.resumes = state.resumes.filter((item) => item.id !== id);
    state.analyses = state.analyses.filter((item) => item.resumeId !== id);
    state.generations = state.generations.filter((item) => item.resumeId !== id);
  } else if (type === "job") {
    const generations = state.generations.filter((item) => item.jobId === id);
    for (const item of generations) {
      await deleteKnownFile(item.docxPath);
      await deleteKnownFile(item.pdfPath);
    }
    state.jobs = state.jobs.filter((item) => item.id !== id);
    state.applications = state.applications.filter((item) => item.jobId !== id);
    state.analyses = state.analyses.filter((item) => item.jobId !== id);
    state.generations = state.generations.filter((item) => item.jobId !== id);
  } else if (type === "application") {
    state.applications = state.applications.filter((item) => item.id !== id);
  } else if (type === "generation") {
    const generation = state.generations.find((item) => item.id === id);
    if (generation) {
      await deleteKnownFile(generation.docxPath);
      await deleteKnownFile(generation.pdfPath);
    }
    state.generations = state.generations.filter((item) => item.id !== id);
  } else {
    return { ok: false, error: "Tipo de registro invalido." };
  }
  await saveUnifiedState(state);
  return { ok: true, state };
}

async function readJsonIfExists(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function fileBackupEntry(file, meta = {}) {
  if (!file) return null;
  try {
    const data = await readFile(file);
    return { ...meta, fileName: path.basename(file), data: data.toString("base64") };
  } catch {
    return null;
  }
}

const PORTABLE_SQLITE_TABLES=Object.freeze(["job_hunt_profiles","search_intents","expanded_queries","candidate_facts","career_entities","knowledge_evidence","resume_tailoring_runs","resume_tailoring_changes","resume_batch_runs","resume_batch_items","resume_batch_comparisons"]);
function currentSchemaVersion(){return Number(unifiedStore.database.connection.prepare("SELECT MAX(version) version FROM schema_migrations").get()?.version||0);}
function portableSqliteSections(){const connection=unifiedStore.database.connection,sections={};for(const table of PORTABLE_SQLITE_TABLES){const exists=connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);if(exists)sections[table]=connection.prepare(`SELECT * FROM ${table}`).all();}return sections;}
function restorePortableSqliteSections(sections={}){const connection=unifiedStore.database.connection;unifiedStore.database.transaction(()=>{for(const table of PORTABLE_SQLITE_TABLES){const rows=Array.isArray(sections[table])?sections[table]:[];for(const row of rows){const allowed=new Set(connection.prepare(`PRAGMA table_info(${table})`).all().map(item=>item.name)),entries=Object.entries(row).filter(([column])=>allowed.has(column));if(!entries.length)continue;const columns=entries.map(([column])=>column),placeholders=columns.map(()=>"?").join(",");connection.prepare(`INSERT OR REPLACE INTO ${table}(${columns.join(",")}) VALUES(${placeholders})`).run(...entries.map(([,value])=>value));}}});}
function backupSummary(backup={}){return {product:backup.product,backupVersion:Number(backup.backupVersion||backup.version||0),schemaVersion:Number(backup.schemaVersion||0),createdAt:backup.createdAt||backup.exportedAt||"",sections:Object.fromEntries(Object.entries(backup.sections||{}).map(([key,value])=>[key,Array.isArray(value)?value.length:0])),legacyState:{resumes:backup.state?.resumes?.length||0,opportunities:backup.state?.jobs?.length||0,applications:backup.state?.applications?.length||0},files:Array.isArray(backup.files)?backup.files.length:0,secretsIncluded:false,compatible:backup.product==="career-hub-unified"&&[1,2].includes(Number(backup.backupVersion||backup.version))&&(!backup.schemaVersion||Number(backup.schemaVersion)<=currentSchemaVersion())};}

async function createUnifiedBackup() {
  const state = await readUnifiedState();
  const files = [];
  const documentVersions=unifiedStore.resumeVersions.list(),documentArtifacts=documentVersions.flatMap(version=>unifiedStore.resumeArtifacts.forVersion(version.id)),missingArtifacts=[];
  for (const resume of state.resumes) {
    const item = await fileBackupEntry(resume.storedPath, { kind: "resume", id: resume.id });
    if (item) files.push(item);
  }
  for (const generation of state.generations) {
    for (const format of ["docx", "pdf"]) {
      const item = await fileBackupEntry(generation[`${format}Path`], {
        kind: "generation",
        id: generation.id,
        format
      });
      if (item) files.push(item);
    }
  }
  for(const artifact of documentArtifacts){const item=await fileBackupEntry(artifact.storagePath,{kind:"resume-document-artifact",id:artifact.id,resumeVersionId:artifact.resumeVersionId,artifactType:artifact.artifactType});if(item)files.push(item);else missingArtifacts.push({artifactId:artifact.id,resumeVersionId:artifact.resumeVersionId,artifactType:artifact.artifactType,status:"MISSING_AT_BACKUP"});}
  return {
    product: "career-hub-unified",
    version: 2,
    backupVersion: 2,
    schemaVersion: currentSchemaVersion(),
    createdAt: new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    profile: await readProfile(),
    preparation: await readPreparation(),
    state,
    files,
    sections: portableSqliteSections(),
    exclusions:["source_credentials","credential_vault","integration_secrets","cookies","authorization_headers","environment_variables"],
    documentEngine:{strategy:"METADATA_AND_FILES",versions:documentVersions,artifacts:documentArtifacts.map(item=>({...item,storagePath:""})),renderRuns:documentVersions.flatMap(version=>unifiedStore.resumeRenderRuns.forVersion(version.id)),exports:documentVersions.flatMap(version=>unifiedStore.documentExports.forVersion(version.id)),applicationPlans:state.applications.map(item=>unifiedStore.applicationPlans.forApplication(item.id)).filter(Boolean),missingArtifacts}
  };
}

async function restoreUnifiedBackup(input) {
  let backup = input.backup;
  if (!backup && input.fileData) {
    try {
      const match = String(input.fileData).match(/^data:application\/json;base64,([A-Za-z0-9+/]*={0,2})$/);
      if (!match) throw new Error("invalid data URL");
      backup = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    } catch (error) {
      throw new AppError("O arquivo de backup e invalido ou esta corrompido.", {
        status: 400,
        code: "INVALID_BACKUP",
        cause: error
      });
    }
  }
  const backupVersion=Number(backup?.backupVersion||backup?.version||0);
  if (!backup || backup.product !== "career-hub-unified" || ![1,2].includes(backupVersion) || (backup.schemaVersion&&Number(backup.schemaVersion)>currentSchemaVersion())) {
    throw new AppError("Este arquivo nao e um backup valido do Career Hub.", {
      status: 400,
      code: "INVALID_BACKUP"
    });
  }
  const state = { ...defaultUnifiedState(), ...(backup.state || {}) };
  state.jobs = Array.isArray(state.jobs) ? state.jobs : [];
  state.resumes = Array.isArray(state.resumes) ? state.resumes : [];
  state.applications = Array.isArray(state.applications) ? state.applications : [];
  state.analyses = Array.isArray(state.analyses) ? state.analyses : [];
  state.generations = Array.isArray(state.generations) ? state.generations : [];
  state.searchResults = Array.isArray(state.searchResults) ? state.searchResults : [];
  state.searchSchedules = Array.isArray(state.searchSchedules) ? state.searchSchedules : [];
  state.alerts = Array.isArray(state.alerts) ? state.alerts : [];
  state.searchHistory = Array.isArray(state.searchHistory) ? state.searchHistory : [];
  state.portalReports = Array.isArray(state.portalReports) ? state.portalReports : [];
  await mkdir(resumeUploadsDir, { recursive: true });
  await mkdir(generatedResumesDir, { recursive: true });
  for (const item of Array.isArray(backup.files) ? backup.files : []) {
    if (!item.data || !item.id) continue;
    if (item.kind === "resume") {
      const resume = state.resumes.find((entry) => entry.id === item.id);
      if (!resume) continue;
      const target = path.join(resumeUploadsDir, `${resume.id}-${safeUploadName(item.fileName)}`);
      await writeFile(target, Buffer.from(item.data, "base64"));
      resume.storedPath = target;
    } else if (item.kind === "generation" && ["docx", "pdf"].includes(item.format)) {
      const generation = state.generations.find((entry) => entry.id === item.id);
      if (!generation) continue;
      const target = path.join(generatedResumesDir, `${generation.id}-${safeUploadName(item.fileName)}`);
      await writeFile(target, Buffer.from(item.data, "base64"));
      generation[`${item.format}Path`] = target;
    }
  }
  const versionLinks=new Map(state.applications.filter(item=>item.resumeVersionId).map(item=>[item.id,item.resumeVersionId]));for(const item of state.applications)item.resumeVersionId="";
  await saveUnifiedState(state);
  const documentEngine=backup.documentEngine&&typeof backup.documentEngine==="object"?backup.documentEngine:{versions:[],artifacts:[],applicationPlans:[]};
  for(const version of documentEngine.versions||[]){if(unifiedStore.resumeVersions.findById(version.id))continue;try{unifiedStore.resumeVersions.create(version);}catch(error){throw new AppError(`Falha ao restaurar a versao ${version.id}.`,{status:400,code:"INVALID_BACKUP_RESUME_VERSION",cause:error});}}
  const restoredArtifactPaths=new Map();for(const item of Array.isArray(backup.files)?backup.files:[]){if(item.kind!=="resume-document-artifact"||!item.data||!item.id)continue;const version=unifiedStore.resumeVersions.findById(item.resumeVersionId);if(!version)continue;const config={LATEX_SOURCE:"resume.tex",PDF:"resume.pdf",EXTRACTED_TEXT:"extracted.txt",EXPORT_BUNDLE:"overleaf-export.zip"}[item.artifactType];if(!config)continue;const dir=unifiedStore.resumeArtifactService.versionDir(version.resumeId,version.id);await mkdir(dir,{recursive:true});const target=path.join(dir,config);await writeFile(target,Buffer.from(item.data,"base64"));restoredArtifactPaths.set(item.id,target);}
  for(const artifact of documentEngine.artifacts||[]){const target=restoredArtifactPaths.get(artifact.id);if(!target)continue;unifiedStore.resumeArtifacts.create({...artifact,storagePath:target});}
  for(const render of documentEngine.renderRuns||[]){if(unifiedStore.resumeRenderRuns.findById(render.id))continue;const started=unifiedStore.resumeRenderRuns.start({id:render.id,resumeVersionId:render.resumeVersionId,compiler:render.compiler,compilerVersion:render.compilerVersion,manifest:render.manifest});unifiedStore.resumeRenderRuns.finish(started.id,{status:render.status,errorCode:render.errorCode,durationMs:render.durationMs,manifest:render.manifest,logExcerpt:render.logExcerpt});}
  for(const exported of documentEngine.exports||[]){if(unifiedStore.documentExports.findById(exported.id))continue;unifiedStore.documentExports.create(exported);}
  for(const [applicationId,versionId] of versionLinks){const application=unifiedStore.applications.findById(applicationId),version=unifiedStore.resumeVersions.findById(versionId);if(application&&version)unifiedStore.applications.updateDetails({...application,resumeVersionId:version.id,updatedAt:new Date().toISOString()});}
  for(const plan of documentEngine.applicationPlans||[]){if(unifiedStore.applications.findById(plan.applicationId))unifiedStore.applicationPlans.save(plan);}
  if (backup.profile) await saveProfile(backup.profile);
  if (backup.preparation) await savePreparation(backup.preparation);
  if(backupVersion>=2)restorePortableSqliteSections(backup.sections||{});
  return { ok: true, state, profile: await readProfile() };
}

async function syncLegacyProjects() {
  const report = { profile: false, preparation: false, resumes: 0, jobs: 0, warnings: [] };
  const oldHubData = path.join(legacyRoot, "job-search-hub", "data");
  const oldProfile = await readJsonIfExists(path.join(oldHubData, "profile.json"), null);
  if (oldProfile) {
    await saveProfile(oldProfile);
    report.profile = true;
  }
  const oldPreparation = await readJsonIfExists(path.join(oldHubData, "preparation.json"), null);
  if (oldPreparation) {
    await savePreparation(oldPreparation);
    report.preparation = true;
  }

  const state = await readUnifiedState();
  const oldState = await readJsonIfExists(path.join(oldHubData, "unified-state.json"), null);
  if (oldState) {
    for (const job of oldState.jobs || []) {
      if (!state.jobs.some((item) => item.url && item.url === job.url)) {
        state.jobs.push(job);
        report.jobs += 1;
      }
    }
  }
  const extracts = await readJsonIfExists(path.join(oldHubData, "resume-extracts.json"), []);
  for (const extract of extracts) {
    const legacyName = safeUploadName(extract.name).toLowerCase();
    if (!extract.text || state.resumes.some((item) =>
      safeUploadName(item.fileName).toLowerCase() === legacyName
    )) continue;
    const now = new Date().toISOString();
    state.resumes.push({
      id: `legacy-resume-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      title: path.parse(extract.name || "Curriculo legado").name,
      text: String(extract.text),
      fileName: String(extract.name || ""),
      storedPath: "",
      focus: "Importado do hub anterior",
      sections: {},
      extraction: { method: "legacy-text", pages: 0, characters: String(extract.text).length },
      createdAt: now,
      updatedAt: now
    });
    report.resumes += 1;
  }
  if (!oldProfile && !extracts.length && !oldState) {
    report.warnings.push("Nenhum dado do hub anterior foi encontrado.");
  }
  report.warnings.push("Bancos internos de terceiros nao sao alterados; a sincronizacao importa apenas formatos conhecidos.");
  await saveUnifiedState(state);
  return { ok: true, report, state, profile: await readProfile() };
}

const projects = [
  {
    id: "jobsync",
    name: "JobSync",
    path: path.join(legacyRoot, "jobsync"),
    type: "Next.js + SQLite + Docker",
    status: "Mais completo para tracker, resumes, AI match e discovery Greenhouse/Lever.",
    role: "Central principal recomendada",
    localUrl: "http://localhost:3737",
    cost: "Pode usar Ollama local; cloud keys opcionais.",
    risk: "Baixo para organização; automações de descoberta não enviam candidatura.",
    commands: {
      install: "npm install",
      dev: "npm run dev",
      docker: "docker compose up"
    }
  },
  {
    id: "applyease",
    name: "ApplyEase",
    path: path.join(legacyRoot, "ApplyEase"),
    type: "Chrome extension + React + FastAPI + Postgres/pgvector",
    status: "Boa suíte local: autofill, match, CV tailored, cover letter e tracker.",
    role: "Extensão local para preencher formulários",
    localUrl: "http://localhost:3001",
    cost: "Local LLM via Ollama/LM Studio.",
    risk: "Médio: depende de Postgres/pgvector e revisão manual antes de enviar.",
    commands: {
      frontendInstall: "cd frontend; npm install",
      frontendDev: "cd frontend; $env:PORT='3001'; $env:REACT_APP_API_BASE='http://localhost:8000'; npm start",
      backendInstall: "cd applyease-backend; python -m pip install -r requirements.txt",
      backendDev: "cd applyease-backend; python -m uvicorn app:app --reload --port 8000"
    }
  },
  {
    id: "ats-screener",
    name: "ATS Screener",
    path: path.join(legacyRoot, "ats-screener"),
    type: "SvelteKit",
    status: "Validador ATS especializado com seis perfis de ATS.",
    role: "Pontuador ATS dedicado",
    localUrl: "http://localhost:5175",
    cost: "Pode rodar anônimo/self-host; Ollama se configurado.",
    risk: "Baixo; arquivos são parseados no browser, mas análise pode ir ao LLM configurado.",
    commands: {
      install: "pnpm install",
      dev: "pnpm dev -- --host 127.0.0.1 --port 5175"
    }
  },
  {
    id: "jobmatchai",
    name: "JobMatchAI",
    path: path.join(legacyRoot, "JobMatchAI"),
    type: "Chrome extension MV3",
    status: "Extensão pronta: analisa vagas, autofill, cover letter, tailored resume e tracker.",
    role: "Painel lateral dentro dos sites de vaga",
    localUrl: "chrome://extensions",
    cost: "Usa chave própria no browser; vários providers com free tier.",
    risk: "Médio: chama providers externos se configurados e mexe em formulários.",
    commands: {
      test: "npm test"
    }
  },
  {
    id: "auto-apply-bot",
    name: "Auto Apply Bot",
    path: path.join(legacyRoot, "auto-apply-bot"),
    type: "TypeScript + Playwright MCP + SQLite",
    status: "Automação ambiciosa, ainda em desenvolvimento e com bloqueios anti-bot.",
    role: "Copiloto/dry-run para candidaturas",
    localUrl: "http://localhost:3000",
    cost: "Gemini principal; auxiliares podem usar Ollama.",
    risk: "Alto: pode violar ToS de portais; use DRY_RUN e baixo volume.",
    commands: {
      install: "npm install",
      dryRun: "$env:DRY_RUN='true'; npm start",
      typecheck: "npm run typecheck"
    }
  },
  {
    id: "career-ops",
    name: "Career Ops",
    path: path.join(legacyRoot, "career-ops"),
    type: "Agent/CLI + Node + Playwright",
    status: "Pipeline de avaliação, scanner, PDFs, pesquisa e tracker via CLI.",
    role: "Estratégia e pipeline profundo",
    localUrl: "",
    cost: "Pode usar modelos locais/OpenRouter/Gemini free conforme config.",
    risk: "Baixo a médio; foi desenhado como human-in-the-loop.",
    commands: {
      install: "npm install",
      doctor: "npm run doctor",
      tracker: "npm run tracker",
      scan: "npm run scan",
      scanVerify: "node scan.mjs --verify",
      pipeline: "npm run or:pipeline",
      mergeTracker: "node merge-tracker.mjs",
      upskill: "node upskill.mjs --summary"
    }
  },
  {
    id: "ai-resume-analyzer",
    name: "AI Resume Analyzer",
    path: path.join(legacyRoot, "ai-resume-analyzer"),
    type: "React Router + Vite",
    status: "Bom app tutorial para upload e feedback, mas depende de Puter.js.",
    role: "Análise visual de currículo",
    localUrl: "http://localhost:5174",
    cost: "Puter/AI no browser; menos ideal para 100% local.",
    risk: "Baixo técnico, mas menos alinhado com privacidade local.",
    commands: {
      install: "npm install",
      dev: "npm run dev -- --host 127.0.0.1 --port 5174"
    }
  }
];

const workflow = [
  {
    id: "discover",
    title: "Encontrar e ranquear",
    owner: "Career Ops",
    description: "Scanner, pipeline e reports para separar vagas boas de perda de tempo.",
    actions: [
      { projectId: "career-ops", commandId: "doctor", label: "Checar setup" },
      { projectId: "career-ops", commandId: "scan", label: "Scan" },
      { projectId: "career-ops", commandId: "pipeline", label: "Processar pipeline" }
    ]
  },
  {
    id: "adapt",
    title: "Adaptar curriculo",
    owner: "ATS Screener / Resume Analyzer",
    description: "Pontuar ATS, revisar gaps e gerar uma versao ajustada para cada vaga relevante.",
    actions: [
      { projectId: "ats-screener", commandId: "dev", label: "Abrir ATS Screener" },
      { projectId: "ai-resume-analyzer", commandId: "dev", label: "Abrir Resume Analyzer" }
    ]
  },
  {
    id: "track",
    title: "Registrar e acompanhar",
    owner: "JobSync",
    description: "Fonte da verdade para enviados, entrevistas, follow-ups e resultados.",
    actions: [
      { projectId: "jobsync", commandId: "dev", label: "Abrir JobSync" }
    ]
  },
  {
    id: "apply",
    title: "Reduzir repeticao",
    owner: "AutoApply",
    description: "Copiloto com dry-run e revisao. Nada de disparo indiscriminado.",
    actions: [
      { projectId: "auto-apply-bot", commandId: "dryRun", label: "Rodar dry-run" },
      { projectId: "auto-apply-bot", commandId: "typecheck", label: "Typecheck" }
    ]
  }
];

const presets = [
  {
    id: "start-workbench",
    title: "Iniciar bancada",
    description: "Sobe JobSync, ATS Screener e Resume Analyzer para uma sessao de trabalho.",
    commands: [
      ["jobsync", "dev"],
      ["ats-screener", "dev"],
      ["ai-resume-analyzer", "dev"]
    ]
  },
  {
    id: "start-apply-assist",
    title: "Bancada com AutoApply dry-run",
    description: "Sobe os apps principais e inicia AutoApply em modo teste.",
    commands: [
      ["jobsync", "dev"],
      ["ats-screener", "dev"],
      ["ai-resume-analyzer", "dev"],
      ["auto-apply-bot", "dryRun"]
    ]
  },
  {
    id: "install-core",
    title: "Instalar dependencias base",
    description: "Instala dependencias dos modulos que voce pretende usar primeiro.",
    commands: [
      ["career-ops", "install"],
      ["jobsync", "install"],
      ["ats-screener", "install"],
      ["ai-resume-analyzer", "install"],
      ["auto-apply-bot", "install"]
    ]
  }
];

function commandFor(projectId, commandId) {
  const project = projects.find((item) => item.id === projectId);
  if (!project || !project.commands[commandId]) return null;
  return { project, command: project.commands[commandId] };
}

function startCommand(projectId, commandId) {
  const item = commandFor(projectId, commandId);
  if (!item) return { ok: false, error: "Comando nao permitido.", code: "COMMAND_NOT_ALLOWED" };
  if (!existsSync(item.project.path)) {
    return { ok: false, error: `Projeto externo nao encontrado: ${item.project.name}.`, code: "PROJECT_NOT_FOUND" };
  }

  const key = `${projectId}:${commandId}`;
  const current = processes.get(key);
  if (current && !current.exited) return { ok: true, alreadyRunning: true, key };

  const startedAt = new Date().toISOString();
  const record = { key, projectId, commandId, startedAt, exited: false, code: null, timedOut: false, logs: [] };
  const child = spawnCommand(item.command, item.project.path, {
    ...process.env,
    FORCE_COLOR: "1"
  });

  record.pid = child.pid;
  child.stdout.on("data", (chunk) => pushLog(record, chunk));
  child.stderr.on("data", (chunk) => pushLog(record, chunk));
  child.on("exit", (code) => {
    record.exited = true;
    record.code = code;
    pushLog(record, `\n[processo finalizado com codigo ${code}]\n`);
  });
  attachProcessTimeout(child, Number(process.env.EXTERNAL_COMMAND_TIMEOUT_MS || 30 * 60 * 1000), () => {
    record.timedOut = true;
    pushLog(record, "\n[processo encerrado por timeout]\n");
  });
  processes.set(key, record);
  return { ok: true, key, pid: child.pid };
}

function spawnCommand(command, cwd, env) {
  if (process.platform === "win32") {
    return spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      cwd,
      shell: false,
      windowsHide: true,
      env
    });
  }

  return spawn("sh", ["-lc", toPosixCommand(command)], {
    cwd,
    shell: false,
    detached: true,
    env
  });
}

function toPosixCommand(command) {
  return String(command)
    .replace(/\$env:([A-Z0-9_]+)=('([^']*)'|"([^"]*)"|([^;]+));/gi, (_, key, _raw, single, double, bare) => {
      const value = single ?? double ?? String(bare || "").trim();
      return `export ${key}=${JSON.stringify(value)};`;
    })
    .replace(/--host 127\.0\.0\.1/g, "--host 0.0.0.0");
}

function defaultProfile() {
  return {
    personal: {
      fullName: "",
      email: "",
      phone: "",
      city: "",
      state: "",
      postalCode: "",
      country: "Portugal",
      timezone: "Europe/Lisbon",
      linkedin: "",
      github: "",
      portfolio: ""
    },
    career: {
      headline: "",
      summary: "",
      targetRoles: "",
      yearsExperience: "",
      skills: "",
      salaryExpectation: "A combinar",
      workModels: "remoto, hibrido",
      locationRule: "",
      englishLevel: "intermediario",
      availability: "Imediata"
    },
    experience: "",
    education: "",
    certifications: "",
    resumeData: { experience: [], education: [], projects: [], certifications: [], languages: [], skills: [] },
    preferences: {
      blacklistCompanies: "",
      blacklistTitleTerms: "estagio, trainee",
      searchKeywords: ""
    },
    files: {
      mainResumePath: ""
    },
    llm: {
      provider: "ollama",
      ollamaUrl: "http://localhost:11434",
      chatModel: "",
      embeddingModel: "",
      spendTier: "economy"
    }
  };
}

async function readProfile() {
  try {
    return mergeProfile(defaultProfile(), JSON.parse(await readFile(profilePath, "utf8")));
  } catch {
    return defaultProfile();
  }
}

async function saveProfile(profile) {
  const merged = mergeProfile(await readProfile(), profile || {});
  await atomicWriteJson(profilePath, merged);
  return merged;
}

function mergeProfile(base, next) {
  const output = { ...base };
  for (const [key, value] of Object.entries(next)) {
    output[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergeProfile(base[key] || {}, value)
      : value;
  }
  return output;
}

async function backupIfExists(file) {
  if (!existsSync(file)) return null;
  const backup = `${file}.hub-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await copyFile(file, backup);
  return backup;
}

async function exportProfile(target) {
  const profile = await readProfile();
  if (target === "career-ops") return exportCareerOps(profile);
  if (target === "auto-apply") return exportAutoApply(profile);
  return { ok: false, error: "Destino nao suportado." };
}

async function exportCareerOps(profile) {
  const configPath = path.join(careerOpsDir, "config", "profile.yml");
  const cvPath = path.join(careerOpsDir, "cv.md");
  await mkdir(path.dirname(configPath), { recursive: true });
  const backups = [await backupIfExists(configPath), await backupIfExists(cvPath)].filter(Boolean);
  await writeFile(configPath, buildCareerOpsProfile(profile), "utf8");
  await writeFile(cvPath, buildCvMarkdown(profile), "utf8");
  return { ok: true, files: [configPath, cvPath], backups };
}

async function exportAutoApply(profile) {
  const configDir = path.join(legacyRoot, "auto-apply-bot", "config");
  const autoApplyDir = path.join(legacyRoot, "auto-apply-bot");
  const perfilPath = path.join(configDir, "perfil.json");
  const curriculosPath = path.join(configDir, "curriculos.json");
  const envPath = path.join(autoApplyDir, ".env");
  await mkdir(configDir, { recursive: true });
  const backups = [await backupIfExists(perfilPath), await backupIfExists(curriculosPath), await backupIfExists(envPath)].filter(Boolean);
  await atomicWriteJson(perfilPath, buildAutoApplyProfile(profile));
  await atomicWriteJson(curriculosPath, buildAutoApplyResumes(profile));
  await writeFile(envPath, buildAutoApplyEnv(profile, await readAutoApplyEnvSeed(autoApplyDir)), "utf8");
  return { ok: true, files: [perfilPath, curriculosPath, envPath], backups };
}

async function readAutoApplyEnvSeed(autoApplyDir) {
  const envPath = path.join(autoApplyDir, ".env");
  if (existsSync(envPath)) return readFile(envPath, "utf8");
  return readTextIfExists(path.join(autoApplyDir, ".env.example"));
}

function buildAutoApplyEnv(profile, seed) {
  return updateEnv(seed, {
    DRY_RUN: "true",
    LLM_AUX_PROVIDER: profile.llm.provider || "ollama",
    LLM_AUX_MODEL: profile.llm.chatModel || "qwen3:8b",
    OLLAMA_URL: profile.llm.ollamaUrl || "http://localhost:11434",
    SCORE_MINIMO: "6",
    MAX_POR_EXECUCAO: "5"
  });
}

function updateEnv(seed, updates) {
  const seen = new Set();
  const lines = String(seed || "").split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n").trim()}\n`;
}

function listFromText(text) {
  return String(text || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function yamlString(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlList(items, indent = "    ", fallback = "") {
  const values = listFromText(items);
  if (values.length) return values.map((item) => `${indent}- ${yamlString(item)}`).join("\n");
  return fallback ? `${indent}- ${yamlString(fallback)}` : `${indent}[]`;
}

function buildCareerOpsProfile(profile) {
  const roles = listFromText(profile.career.targetRoles);
  const primaryRole = roles[0] || profile.career.headline || "Target Role";
  return `# Generated by Job Search Hub. Edit in the hub, then export again.
candidate:
  full_name: ${yamlString(profile.personal.fullName)}
  email: ${yamlString(profile.personal.email)}
  phone: ${yamlString(profile.personal.phone)}
  location: ${yamlString([profile.personal.city, profile.personal.country].filter(Boolean).join(", "))}
  linkedin: ${yamlString(profile.personal.linkedin)}
  portfolio_url: ${yamlString(profile.personal.portfolio)}
  github: ${yamlString(profile.personal.github)}
  twitter: ""
  photo: ""

target_roles:
  primary:
${yamlList(profile.career.targetRoles, "    ", primaryRole)}
  archetypes:
    - name: ${yamlString(primaryRole)}
      level: "Junior/Mid/Senior"
      fit: "primary"

narrative:
  headline: ${yamlString(profile.career.headline)}
  exit_story: ${yamlString(profile.career.summary)}
  superpowers:
${yamlList(profile.career.skills, "    ", "Adaptabilidade e aprendizado rapido")}
  proof_points: []

compensation:
  target_range: ${yamlString(profile.career.salaryExpectation)}
  currency: "BRL"
  minimum: ${yamlString(profile.career.salaryExpectation)}
  location_flexibility: ${yamlString(profile.career.locationRule)}

location:
  country: ${yamlString(profile.personal.country)}
  city: ${yamlString(profile.personal.city)}
  timezone: ${yamlString(profile.personal.timezone)}
  visa_status: "Check per role"

language:
  output: pt-BR

spend_tier: ${String(profile.llm.spendTier || "economy")}

cv:
  output_format: "html"

cover_letter:
  notice_period_days: 30
  primary_domain: ${yamlString(profile.career.headline)}

scan:
  extractor: cli

auto_pdf_score_threshold: 4.0
`;
}

function buildCvMarkdown(profile) {
  return `# ${profile.personal.fullName || "Seu Nome"}

${profile.career.headline || ""}

${profile.personal.email || ""} | ${profile.personal.phone || ""} | ${profile.personal.city || ""}
${profile.personal.linkedin || ""} ${profile.personal.github || ""} ${profile.personal.portfolio || ""}

## Resumo

${profile.career.summary || ""}

## Skills

${listFromText(profile.career.skills).map((item) => `- ${item}`).join("\n")}

## Experiencia

${profile.experience || ""}

## Educacao

${profile.education || ""}

## Certificacoes

${profile.certifications || ""}
`;
}

function buildAutoApplyProfile(profile) {
  return {
    nome: profile.personal.fullName,
    email: profile.personal.email,
    telefone: profile.personal.phone,
    linkedin: profile.personal.linkedin,
    github: profile.personal.github,
    portfolio: profile.personal.portfolio,
    curriculo_path: profile.files.mainResumePath || "./assets/curriculo.pdf",
    titulo_profissional: profile.career.headline,
    anos_experiencia: Number(profile.career.yearsExperience || 0),
    stack_principal: listFromText(profile.career.skills),
    resumo_profissional: profile.career.summary,
    pretensao_salarial: profile.career.salaryExpectation,
    modelo_trabalho: listFromText(profile.career.workModels),
    cidade: profile.personal.city,
    regra_localizacao: profile.career.locationRule,
    nivel_ingles: profile.career.englishLevel,
    blacklist_empresas: listFromText(profile.preferences.blacklistCompanies),
    blacklist_termos_titulo: listFromText(profile.preferences.blacklistTitleTerms),
    disponibilidade: profile.career.availability,
    palavras_chave_busca: listFromText(profile.preferences.searchKeywords || profile.career.targetRoles),
    experiencias: [
      {
        empresa: "",
        cargo: profile.career.headline,
        periodo: "",
        descricao: profile.experience
      }
    ],
    bancos_de_dados: [],
    metodologias: [],
    informacoes_extras: {
      formacao: profile.education,
      idiomas: `Portugues nativo, Ingles ${profile.career.englishLevel}`,
      certificacoes: profile.certifications,
      diferencial: profile.career.summary
    }
  };
}

function buildAutoApplyResumes(profile) {
  const resume = profile.files.mainResumePath || "./assets/curriculo.pdf";
  return {
    fallback: {
      id: "hub-principal",
      arquivo: resume,
      foco: "Curriculo principal do Job Search Hub",
      usar_quando: "Quando nenhum curriculo especifico se encaixar melhor."
    },
    curriculos: [
      {
        id: "principal",
        arquivo: resume,
        foco: profile.career.headline || "Perfil principal",
        usar_quando: `Vagas relacionadas a: ${listFromText(profile.career.targetRoles).join(", ")}`
      }
    ]
  };
}

async function ensurePipelineFile() {
  await mkdir(path.dirname(pipelinePath), { recursive: true });
  if (!existsSync(pipelinePath)) {
    await writeFile(
      pipelinePath,
      "# Career Ops Pipeline\n\n## Pending\n\n## Done\n",
      "utf8"
    );
  }
}

async function addPipelineItem(input) {
  const value = String(input || "").trim();
  if (!value) return { ok: false, error: "Cole uma URL ou descricao de vaga." };
  await ensurePipelineFile();
  const text = await readFile(pipelinePath, "utf8");
  const item = `- [ ] ${value.replace(/\r?\n/g, " ").trim()}`;
  const next = text.includes("## Pending")
    ? text.replace("## Pending", `## Pending\n${item}`)
    : `${text.trim()}\n\n## Pending\n${item}\n`;
  await writeFile(pipelinePath, next, "utf8");
  return { ok: true, item };
}

function defaultPreparation() {
  return {
    activeJobId: "",
    jobs: [],
    sources: resourceRepositories.map(({ path: localPath, ...source }) => ({
      ...source,
      installed: existsSync(localPath),
      localPath
    }))
  };
}

async function readPreparation() {
  try {
    const saved = JSON.parse(await readFile(preparationPath, "utf8"));
    return { ...defaultPreparation(), ...saved, jobs: Array.isArray(saved.jobs) ? saved.jobs : [], sources: defaultPreparation().sources };
  } catch {
    return defaultPreparation();
  }
}

async function markdownFiles(directory) {
  const output = [];
  if (!existsSync(directory)) return output;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await markdownFiles(fullPath));
    else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name)) output.push(fullPath);
  }
  return output;
}

function cleanMarkdown(text) {
  return String(text || "")
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownSections(text, fallbackTitle) {
  const lines = cleanMarkdown(text).split("\n");
  const sections = [];
  let title = fallbackTitle;
  let buffer = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content.length >= 80) {
      for (let offset = 0; offset < content.length; offset += 3600) {
        sections.push({ title, content: content.slice(offset, offset + 4200) });
      }
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,4}\s+(.+)/);
    if (heading) {
      flush();
      title = heading[1].replace(/[*_`]/g, "").trim() || fallbackTitle;
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

async function buildLibraryIndex(force = false) {
  if (libraryCache && !force) return libraryCache;
  const chunks = [];
  const repos = [];

  for (const repo of resourceRepositories) {
    const files = await markdownFiles(repo.path);
    let repoChunks = 0;
    for (const file of files) {
      const relativePath = path.relative(repo.path, file).replaceAll("\\", "/");
      const text = await readFile(file, "utf8");
      for (const section of markdownSections(text, path.basename(file))) {
        chunks.push({
          id: `${repo.id}:${relativePath}:${repoChunks}`,
          repoId: repo.id,
          repoName: repo.name,
          file: relativePath,
          title: section.title,
          content: section.content
        });
        repoChunks += 1;
      }
    }
    repos.push({
      id: repo.id,
      name: repo.name,
      url: repo.url,
      use: repo.use,
      localPath: repo.path,
      installed: existsSync(repo.path),
      files: files.length,
      chunks: repoChunks
    });
  }

  libraryCache = {
    builtAt: new Date().toISOString(),
    repos,
    chunks,
    stats: {
      repositories: repos.filter((repo) => repo.installed).length,
      files: repos.reduce((sum, repo) => sum + repo.files, 0),
      chunks: chunks.length
    }
  };
  return libraryCache;
}

const searchStopWords = new Set([
  "para", "como", "com", "uma", "uns", "das", "dos", "que", "por", "nao", "this", "that",
  "the", "and", "with", "from", "your", "vaga", "empresa", "junior", "analista", "descricao"
]);

function normalizedWords(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .match(/[a-z0-9+#.-]{3,}/g)
    ?.filter((word) => !searchStopWords.has(word))
    .slice(0, 35) || [];
}

function searchLibrary(index, query, options = {}) {
  const terms = [...new Set(normalizedWords(query))];
  const repoId = String(options.repoId || "");
  if (!terms.length) return [];

  return index.chunks
    .filter((chunk) => !repoId || chunk.repoId === repoId)
    .map((chunk) => {
      const title = `${chunk.title} ${chunk.file}`.toLowerCase();
      const content = chunk.content.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 8;
        const matches = content.split(term).length - 1;
        score += Math.min(matches, 6);
      }
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Number(options.limit || 12), 30))
    .map((chunk) => ({
      id: chunk.id,
      repoId: chunk.repoId,
      repoName: chunk.repoName,
      file: chunk.file,
      title: chunk.title,
      score: chunk.score,
      content: chunk.content,
      snippet: chunk.content.replace(/\s+/g, " ").slice(0, 700)
    }));
}

function libraryQueryFor(type, job, extra = {}) {
  const typeTerms = {
    studyPlan: "linux network networking dns dhcp troubleshooting monitoring observability active directory azure noc soc",
    technicalTraining: extra.topic || "linux network dns troubleshooting monitoring security",
    starBank: "behavioral interview star teamwork conflict leadership mistake prioritization",
    companyResearch: "interview preparation company research questions recruiter",
    interviewDay: "self introduction behavioral interview final questions mock interview",
    contracting: "offer negotiation salary benefits compensation",
    postInterview: "after interview follow up thank you retrospective",
    interviewQuestion: extra.mode === "rh" ? "behavioral interview questions star" : "linux network troubleshooting interview questions",
    interviewFeedback: "interview rubric behavioral technical communication"
  };
  return `${job.title} ${job.description} ${typeTerms[type] || typeTerms.studyPlan}`;
}

async function relevantLibraryMaterial(type, job, extra = {}) {
  const index = await buildLibraryIndex();
  const results = searchLibrary(index, libraryQueryFor(type, job, extra), { limit: 7 });
  return results;
}

function libraryMaterialText(results) {
  if (!results.length) return "Nenhum trecho local relevante foi encontrado.";
  return results
    .map((result, index) => `[${index + 1}] ${result.repoName} | ${result.file} | ${result.title}\n${result.content.slice(0, 1800)}`)
    .join("\n\n");
}

async function savePreparation(state) {
  await atomicWriteJson(preparationPath, state);
  return state;
}

function cleanJob(input, current = {}) {
  const now = new Date().toISOString();
  return {
    id: current.id || input.id || `prep-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: String(input.title ?? current.title ?? "").trim(),
    company: String(input.company ?? current.company ?? "").trim(),
    url: String(input.url ?? current.url ?? "").trim(),
    description: String(input.description ?? current.description ?? "").trim(),
    stage: String(input.stage ?? current.stage ?? "preparacao"),
    interviewDate: String(input.interviewDate ?? current.interviewDate ?? ""),
    employmentType: String(input.employmentType ?? current.employmentType ?? ""),
    salary: String(input.salary ?? current.salary ?? ""),
    workModel: String(input.workModel ?? current.workModel ?? ""),
    shift: String(input.shift ?? current.shift ?? ""),
    onCall: String(input.onCall ?? current.onCall ?? ""),
    benefits: String(input.benefits ?? current.benefits ?? ""),
    companyNotes: String(input.companyNotes ?? current.companyNotes ?? ""),
    postNotes: String(input.postNotes ?? current.postNotes ?? ""),
    outputs: { ...(current.outputs || {}), ...(input.outputs || {}) },
    interview: { ...(current.interview || {}), ...(input.interview || {}) },
    createdAt: current.createdAt || now,
    updatedAt: now
  };
}

async function upsertPreparationJob(input) {
  const state = await readPreparation();
  const index = state.jobs.findIndex((job) => job.id === input.id);
  const job = cleanJob(input, index >= 0 ? state.jobs[index] : {});
  if (!job.title && !job.company && !job.description) {
    return { ok: false, error: "Informe pelo menos cargo, empresa ou descricao da vaga." };
  }
  if (index >= 0) state.jobs[index] = job;
  else state.jobs.unshift(job);
  state.activeJobId = job.id;
  await savePreparation(state);
  return { ok: true, job, state };
}

async function setActivePreparationJob(id) {
  const state = await readPreparation();
  if (id && !state.jobs.some((job) => job.id === id)) {
    return { ok: false, error: "Vaga de preparacao nao encontrada." };
  }
  state.activeJobId = id || "";
  await savePreparation(state);
  return { ok: true, state };
}

function preparationPrompt(type, job, profile, extra = {}, localMaterial = "") {
  const base = `Voce e um orientador de carreira brasileiro especializado em vagas junior de NOC, SOC, suporte N2, redes e infraestrutura.
Responda em portugues do Brasil, de forma pratica, honesta e concisa. Nao invente experiencia, fatos da empresa nem requisitos ausentes.

CANDIDATO
Nome: ${profile.personal.fullName}
Titulo: ${profile.career.headline}
Skills: ${profile.career.skills}
Resumo: ${profile.career.summary}
Experiencia: ${profile.experience}
Formacao e certificacoes: ${profile.education} | ${profile.certifications}

VAGA
Cargo: ${job.title}
Empresa: ${job.company}
URL: ${job.url}
Descricao: ${job.description}
Etapa: ${job.stage}
Notas publicas coladas pelo candidato: ${job.companyNotes}

MATERIAL DE REFERENCIA INSTALADO LOCALMENTE
Use o material abaixo como apoio. Nao copie respostas cegamente, nao trate opinioes como fatos
e cite o repositorio e o arquivo quando aproveitar uma informacao especifica.

${localMaterial}
`;

  const prompts = {
    studyPlan: `Crie um plano de estudo de ${extra.days || 7} dias. Separe: JA SEI, PRECISO REVISAR e NAO VALE PRIORIZAR AGORA. Depois monte tarefas diarias de no maximo 90 minutos, com exercicio pratico e criterio de conclusao.`,
    technicalTraining: `Crie 12 perguntas de treino sobre ${extra.topic || "NOC, redes e troubleshooting"}, priorizando o que aparece na vaga. Misture fundamentos, cenarios e comandos. Inclua uma resposta esperada curta depois de cada pergunta.`,
    starBank: `Monte 6 roteiros STAR usando apenas fatos presentes na experiencia do candidato. Cubra incidente tecnico, priorizacao, atendimento dificil, aprendizado rapido, trabalho em equipe e erro/melhoria. Onde faltar resultado mensuravel, escreva [CONFIRMAR COM O CANDIDATO] em vez de inventar.`,
    companyResearch: `Organize as notas publicas fornecidas em: o que sabemos, possiveis etapas, perguntas relatadas, cultura/sinais, salario/beneficios e pontos que ainda precisam ser pesquisados. Diferencie claramente fato, relato e hipotese.`,
    interviewDay: `Prepare: apresentacao de 60 segundos, 8 lembretes para o dia, 6 perguntas inteligentes para RH/gestor e sinais de alerta. A apresentacao deve ser fiel ao perfil e natural para falar em voz alta.`,
    contracting: `Crie um checklist de avaliacao de proposta considerando: salario ${job.salary}, regime ${job.employmentType}, modelo ${job.workModel}, escala ${job.shift}, sobreaviso ${job.onCall}, beneficios ${job.benefits}. Inclua perguntas sobre CLT/PJ, horas extras, adicional noturno, escala, equipamento, experiencia e documentos. Nao de aconselhamento juridico.`,
    postInterview: `Com base nestas anotacoes: ${job.postNotes || "nenhuma anotacao ainda"}, crie uma retrospectiva com acertos, lacunas, proximos estudos, follow-up de 4 linhas e o que registrar para a proxima etapa.`,
    interviewQuestion: `Atue como entrevistador no modo ${extra.mode || "tecnico"}. Faca apenas UMA pergunta adequada a vaga e ao nivel junior. Nao forneca a resposta. Evite repetir esta pergunta anterior: ${job.interview?.question || "nenhuma"}.`,
    interviewFeedback: `Avalie a resposta do candidato para a pergunta abaixo.
Pergunta: ${extra.question}
Resposta: ${extra.answer}
Devolva: nota de 0 a 10, o que foi bom, o que faltou, uma resposta melhor (sem inventar experiencia) e uma pergunta de aprofundamento.`
  };
  return `${base}\nTAREFA\n${prompts[type] || prompts.studyPlan}`;
}

function fallbackPreparation(type, job, extra = {}, localResults = []) {
  const title = job.title || "esta vaga";
  const templates = {
    studyPlan: `# Plano inicial para ${title}

## Ja sei
- Relacione os requisitos da vaga com suas experiencias em suporte N1/N2, Active Directory, Azure, redes e troubleshooting.

## Preciso revisar
- DNS e DHCP: fluxo, portas e diagnostico.
- TCP/IP: camadas, roteamento, NAT, ping, tracert e nslookup.
- Monitoramento: alerta, severidade, evidencia, escalonamento e pos-incidente.
- Linux e Windows Server: logs, servicos, processos e permissoes.

## Nao vale priorizar agora
- Tecnologias citadas apenas como diferencial e sem uso central na vaga.
- Conteudo avancado antes de dominar os cenarios basicos.

## Proximos ${extra.days || 7} dias
1. Marque os requisitos da descricao como sei, revisar ou desconheco.
2. Pratique um diagnostico de DNS e conectividade no seu computador.
3. Explique em voz alta um atendimento N2 do inicio ao fim.
4. Revise logs, servicos e processos em Linux e Windows.
5. Monte um incidente simulado de monitoramento e escalonamento.
6. Treine perguntas tecnicas e comportamentais.
7. Faca uma entrevista simulada completa e revise os erros.`,
    technicalTraining: `# Treino inicial: ${extra.topic || "NOC e infraestrutura"}

1. Um usuario acessa o IP, mas nao o nome do servidor. O que voce verifica?
2. Qual a diferenca entre DNS autoritativo e recursivo?
3. Como voce diagnostica perda de pacotes?
4. O que ocorre desde digitar uma URL ate a pagina abrir?
5. Como distinguir falha de rede, aplicacao e sistema operacional?
6. O que verificar em um alerta de CPU alta?
7. Para que servem DHCP, gateway e mascara de rede?
8. Como desbloquear uma conta com seguranca no Active Directory?
9. Quais evidencias devem entrar em um chamado escalado?
10. Como priorizar dois incidentes simultaneos?
11. Onde procurar logs de servicos no Linux e no Windows?
12. Quando um alerta deve ser tratado como falso positivo?`,
    starBank: "# Banco STAR inicial\n\nUse situacoes reais do seu historico profissional. Preencha Situacao, Tarefa, Acao e Resultado para: incidente tecnico, priorizacao, atendimento dificil, automacao, trabalho em equipe e um erro que virou melhoria. Nao invente numeros; marque o que precisa confirmar.",
    companyResearch: "# Pesquisa da empresa\n\nAinda nao ha analise por IA. Abra os links publicos, cole os relatos encontrados nas notas e gere novamente. Trate relatos como indicios, nao como garantia do processo atual.",
    interviewDay: "# Dia da entrevista\n\n- Teste camera, audio e internet.\n- Tenha a vaga e o curriculo abertos.\n- Prepare uma apresentacao de 60 segundos.\n- Responda com contexto, acao e resultado.\n- Quando nao souber, explique como investigaria.\n- Pergunte sobre rotina, equipe, escala, ferramentas e proximas etapas.",
    contracting: "# Contratacao\n\nConfirme regime, salario bruto, beneficios, horario, escala, sobreaviso, horas extras, local, equipamento, inicio, periodo de experiencia e documentos. Compare a proposta completa, nao apenas o salario.",
    postInterview: "# Pos-entrevista\n\nRegistre perguntas, respostas fracas, tecnologias citadas, nomes dos entrevistadores e prazo prometido. Envie um agradecimento curto e estude primeiro o ponto tecnico que mais se repetiu.",
    interviewQuestion: `Conte como voce investigaria um chamado em que o usuario perdeu acesso a um sistema interno, mas a internet continua funcionando.`,
    interviewFeedback: "# Avaliacao inicial\n\nO Ollama nao esta disponivel para avaliar semanticamente agora. Compare sua resposta com esta estrutura: confirmar impacto, reproduzir, coletar evidencias, testar DNS/rede/autenticacao/aplicacao, registrar acoes, resolver ou escalar com contexto."
  };
  const base = templates[type] || templates.studyPlan;
  if (!localResults.length) return base;
  const references = localResults
    .slice(0, 5)
    .map((result) => `### ${result.title}\nFonte local: ${result.repoName} / ${result.file}\n\n${result.snippet}`)
    .join("\n\n");
  return `${base}\n\n## Material real da biblioteca local\n\n${references}`;
}

async function ollamaStatus() {
  const status=await intelligenceService.status();return {ok:status.status==="HEALTHY"||status.status==="DEGRADED",baseUrl:status.endpoint,models:status.models.filter(model=>model.installed).map(model=>model.modelName),error:status.health.error||"",code:status.health.code||"",status:status.status};
}

async function generatePreparation(input) {
  const state = await readPreparation();
  const index = state.jobs.findIndex((job) => job.id === input.jobId);
  if (index < 0) return { ok: false, error: "Salve a vaga antes de gerar a preparacao." };
  const job = state.jobs[index];
  const profile = await readProfile();
  const type = String(input.type || "studyPlan");
  const localResults = await relevantLibraryMaterial(type, job, input);
  const localMaterial = libraryMaterialText(localResults);
  let output = "";
  let usedFallback = false;
  try {
    const fallback=fallbackPreparation(type,job,input,localResults);const response=await intelligenceService.execute(TASK_TYPES.PREPARATION_GENERATION,{type,job:{title:job.title,company:job.company,description:String(job.description||"").slice(0,5000)},instructions:preparationPrompt(type,job,{career:profile.career},input,localMaterial)},{fallback:{content:fallback}});output=response.result.content;usedFallback=response.meta.fallback;if(usedFallback)input.ollamaError="Intelligence Layer usou fallback deterministico.";
  } catch (error) {
    usedFallback = true;
    output = fallbackPreparation(type, job, input, localResults);
    input.ollamaError = error.message;
  }

  if (type === "interviewQuestion") {
    job.interview = { ...(job.interview || {}), mode: input.mode || "tecnico", question: output, answer: "" };
  } else if (type === "interviewFeedback") {
    job.interview = { ...(job.interview || {}), answer: input.answer || "", feedback: output };
  } else {
    job.outputs = { ...(job.outputs || {}), [type]: output };
  }
  job.updatedAt = new Date().toISOString();
  state.jobs[index] = job;
  await savePreparation(state);
  return {
    ok: true,
    output,
    job,
    usedFallback,
    ollamaError: input.ollamaError || "",
    librarySources: localResults.map(({ repoName, file, title, score }) => ({ repoName, file, title, score }))
  };
}

async function readRequestJson(req, options) {
  return readJsonBody(req, options);
}

async function readCareerOpsState() {
  const pipeline = await readTextIfExists(pipelinePath);
  const applications = await readTextIfExists(applicationsPath);
  const pending = parseChecklist(pipeline, false);
  const done = parseChecklist(pipeline, true);
  const trackerRows = parseMarkdownTable(applications);
  return {
    paths: { pipeline: pipelinePath, applications: applicationsPath },
    pipelineExists: existsSync(pipelinePath),
    applicationsExists: existsSync(applicationsPath),
    pending,
    done,
    trackerRows,
    counts: {
      pending: pending.length,
      done: done.length,
      tracker: trackerRows.length
    }
  };
}

async function readTextIfExists(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

function parseChecklist(text, checked) {
  const marker = checked ? "x" : " ";
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`- [${marker}]`))
    .map((line) => line.replace(/^- \[[ x]\]\s*/i, ""))
    .slice(0, 50);
}

function parseMarkdownTable(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
  if (lines.length < 3) return [];
  const header = splitTableLine(lines[0]);
  return lines
    .slice(2)
    .map(splitTableLine)
    .filter((cells) => cells.length === header.length)
    .map((cells) => Object.fromEntries(header.map((key, index) => [key || `col${index}`, cells[index] || ""])))
    .slice(-25)
    .reverse();
}

function splitTableLine(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function pushLog(record, chunk) {
  record.logs.push(String(chunk));
  if (record.logs.length > 300) record.logs.splice(0, record.logs.length - 300);
}

function json(res, data, status = 200) {
  const payload = data?.ok === false && !data.code
    ? { ...data, code: status >= 500 ? "OPERATION_FAILED" : "INVALID_REQUEST" }
    : data;
  sendJson(res, payload, status);
}

function binary(res, data, contentTypeValue, fileName) {
  const safeName = safeUploadName(fileName);
  res.writeHead(200, {
    "content-type": contentTypeValue,
    "content-length": data.length,
    "content-disposition": `attachment; filename="${safeName}"`,
    "cache-control": "no-store"
  });
  res.end(data);
}

function contentType(file) {
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  return "text/plain; charset=utf-8";
}

const opportunityService=new OpportunityService({store:unifiedStore,profileProvider:readProfile,revisionCheckIntervalMs:30_000});
if(runtimePolicy.backgroundEnabled)void opportunityService.list().catch(error=>unifiedStore.structuredLogs.record({category:"OPPORTUNITIES",eventCode:"PROJECTION_WARMUP_FAILED",status:"DEGRADED",level:"WARN",errorCode:error.code||"OPPORTUNITY_PROJECTION_FAILED",message:"A projeção inicial será reconstruída no primeiro acesso."}));
discoveryV4Service.capabilities();
const {ApplicationBatchService}=await import("./src/application/application-batch-service.mjs");
const {createApplicationBatchRoutes}=await import("./server/routes/application-batch-routes.mjs");
const {SourceAuthService}=await import('./src/source-connections/source-auth-service.mjs');
const {SESSION_PROVIDER_IDS}=await import('./src/source-connections/session-provider-registry.mjs');
const {SourceReadinessService}=await import('./src/source-connections/provider-readiness.mjs');
const {ObservabilityService}=await import('./src/observability/observability-service.mjs');
const {createConnectionsObservabilityRoutes}=await import('./server/routes/connections-observability-routes.mjs');
const sourceAuth=new SourceAuthService({store:unifiedStore,vault:credentialVault,connections:sourceConnectionService,githubEvidence:githubEvidenceProvider});
const {createAutomationSessionProvider}=await import('./src/source-connections/automation-session-provider.mjs');
const automationSessionProvider=createAutomationSessionProvider(sourceAuth);
applicationEngine.sessionStateProvider=automationSessionProvider;
for(const revalidator of [ashbyFinalRevalidator,smartRecruitersFinalRevalidator,workableFinalRevalidator,nerdinFinalRevalidator,teamtailorFinalRevalidator])revalidator.sessionStateProvider=automationSessionProvider;
const verifyActivePortalSessions=async()=>{
  for(const provider of SESSION_PROVIDER_IDS){
    if(sourceAuth.status(provider).status!=="SESSION_ACTIVE")continue;
    await sourceAuth.check(provider).catch(error=>unifiedStore.structuredLogs.record({category:"SOURCE_AUTH",provider,eventCode:"SILENT_SESSION_CHECK_FAILED",status:"DEGRADED",level:"WARN",errorCode:error.code||"SESSION_CHECK_FAILED",message:error.message}));
  }
};
const sourceReadiness=new SourceReadinessService({connections:sourceConnectionService,auth:sourceAuth,submissionEnabled});
const observability=new ObservabilityService({store:unifiedStore,readiness:sourceReadiness});
const applicationBatchService=new ApplicationBatchService({store:unifiedStore,dataDir:hubDataDir,profileProvider:readProfile,opportunityService,headless:automationHeadless,submissionEnabled,sourceReadiness,sourceAuth});
const applicationQuestionEscalation=new ApplicationQuestionEscalationService({store:unifiedStore,approvalGateway:whatsappApprovalGateway,answerDrafterProvider:()=>answerDrafter,notificationsEnabled:runtimePolicy.backgroundEnabled});
const autoApplyOrchestrator=new AutoApplyOrchestrator({store:unifiedStore,profileProvider:readProfile,applicationEngine,applicationBatchService,submissionPreflight,consentService:submissionConsentService,controlledSubmission:controlledSubmissionService,submissionEnabled,manualSince:runtimePolicy.queueSince,resultHandler:runtimePolicy.backgroundEnabled?(context,result)=>whatsappApprovalGateway.notifyAutoApplyResult(context,result):null,questionEscalation:applicationQuestionEscalation,availabilityService:opportunityAvailabilityService});
const delayedQuestions=new DelayedQuestionService({store:unifiedStore,approvalGateway:whatsappApprovalGateway,drafterProvider:()=>answerDrafter,routing:application=>autoApplyOrchestrator.automaticRouting(application),researchProvider:publicWebProvider,
  modelProvider:async configured=>selectQuestionModel(await intelligenceService.provider.listModels(),configured)});
applicationQuestionEscalation.delayedQuestions=delayedQuestions;
intelligenceWorker.handlers[DELAYED_QUESTION_TASK]=payload=>delayedQuestions.execute(payload);
whatsappApprovalGateway.approvalHandler=context=>autoApplyOrchestrator.start(context);
whatsappApprovalGateway.revisionHandler=({request,application,observation})=>{const version=unifiedStore.resumeVersions.findById(request.resumeVersionId);if(!version||version.resumeId!==application.resumeId)throw Object.assign(new Error("Currículo da aprovação não encontrado."),{code:"WHATSAPP_REVISION_CONTEXT_INVALID",status:409});const payload={jobId:request.jobId,resumeId:version.resumeId,applicationId:application.id,approvalRequestId:request.id,instruction:String(observation||"").slice(0,800),questionId:createHash("sha256").update(`${request.id}:${observation}`).digest("hex")};const job=unifiedStore.intelligenceJobs.enqueue(TASK_TYPES.RESUME_TAILORING,payload);intelligenceWorker.schedule();return {status:"QUEUED",jobId:job.id};};
whatsappApprovalGateway.rejectionHandler=({request})=>resumeService.archive(request.resumeVersionId);
whatsappApprovalGateway.questionAnswerHandler=({application,question,answer})=>unifiedStore.answerApplicationQuestion(application.id,question.id,answer,{reusable:false});
whatsappApprovalGateway.questionResumeHandler=({request,application})=>{
  const pending=unifiedStore.applicationQuestions.forApplication(application.id).some(question=>question.required&&question.answerStatus==="USER_REQUIRED");
  return pending?applicationQuestionEscalation.escalate(application.id):{status:"QUEUED"};
};
whatsappApprovalGateway.handoffResumeHandler=({application,token,approvalRequest,commandHash})=>autoApplyOrchestrator.start({request:{id:`whatsapp-handoff:${application.id}:${commandHash||token}`,source:"WHATSAPP_HANDOFF",...(approvalRequest?{approvalRequestId:approvalRequest.id}:{})},application});
resumeApprovalDispatcher.autoApplyHandler=context=>autoApplyOrchestrator.start(context);
if(runtimePolicy.backgroundEnabled){
resumeBatchService.attachReadyDispatcher(input=>resumeApprovalDispatcher.dispatch(input));
for(const eventType of ["RESUME_VERSION_APPROVED","RESUME_RENDER_READY"])
  eventBus.on(eventType,event=>{
    const version=unifiedStore.resumeVersions.findById(event.payload?.resumeVersionId||"");
    // Mass Hunt owns its notification budget, quiet hours and pause boundary.
    if(version?.source==="MASS_HUNT_AUTOAPPLY")return;
    void resumeApprovalDispatcher.dispatch(event.payload).catch(error=>
      unifiedStore.structuredLogs.record({
        category:"APPLICATION_AUTOMATION",
        level:"WARN",
        eventCode:"WHATSAPP_APPROVAL_DISPATCH_FAILED",
        jobId:event.payload?.jobId||"",
        resumeVersionId:event.payload?.resumeVersionId||"",
        errorCode:error.code||"WHATSAPP_APPROVAL_DISPATCH_FAILED",
        message:error.message,
      }),
    );
  });
eventBus.on("RESUME_TAILORING_REVIEW_REQUIRED",event=>{
  if(event.payload?.approvalRequestId)void whatsappApprovalGateway.notifyResumeRevisionReady(event.payload);
});
sourceAuth.onAuthenticated=async (provider,tenant)=>{
  if(provider!=='gupy')return;
  for(const row of unifiedStore.database.connection.prepare("SELECT id FROM application_drafts WHERE status='WAITING_USER' AND locked_by IS NULL").all()){
    const draft=unifiedStore.applicationBatches.findItem(row.id);
    if(/AUTH|LOGIN/.test(draft.reason||'')&&new URL(draft.applicationUrl).hostname===tenant&&applicationBatchService.canRetry(draft))applicationBatchService.queue(draft.id,draft.mode);
  }
};
sourceAuth.onDisconnected=async provider=>{if(provider!=='gupy')return;for(const session of [...applicationBatchService.browser.activeSessions])await applicationBatchService.browser.close(session,{traceStopped:true});};
const logRetentionTimer=setInterval(()=>unifiedStore.structuredLogs.prune(),3600000);logRetentionTimer.unref();
unifiedStore.structuredLogs.record({category:'SYSTEM',eventCode:'RUNTIME_READY',message:'Connections and diagnostics initialized',metadata:{schemaVersion:27,submissionEnabled}});
}
if(runtimePolicy.workersEnabled){
applicationBatchService.worker=new BoundedStageWorker({repository:unifiedStore.applicationBatches,status:"PREPARING",concurrency:2,claimOptions:{since:runtimePolicy.queueSince},handler:async item=>{
  await applicationBatchService.prepare(item);
  const prepared=unifiedStore.applicationBatches.findItem(item.id);
  if(prepared?.status==="READY_TO_SUBMIT"&&prepared.approvalRequestId&&submissionEnabled)await applicationBatchService.submit(prepared.id,{confirmed:true,idempotencyKey:`whatsapp-autoapply:${prepared.approvalRequestId}:gupy`});
  return unifiedStore.applicationBatches.findItem(item.id);
}}).start();
if(runtimePolicy.backgroundEnabled){
const applicationPreparationTimer=setInterval(()=>applicationBatchService.prepareEligible().catch(()=>{}),60000);
applicationPreparationTimer.unref();
}
for(const worker of [resumeDocumentWorker,intelligenceWorker,...Object.values(batchWorkers)]){
  worker.claimOptions={since:runtimePolicy.queueSince};
  worker.start();
}
}
const decisionInbox=new DecisionInboxService({store:unifiedStore,opportunityService,weeklyTechRadar:new WeeklyTechRadarService()});
const dailyRefreshService=new DailyRefreshService({store:unifiedStore,jobHuntService,opportunityService,availabilityService:opportunityAvailabilityService,decisionInbox});
const availabilityScheduler=new AvailabilityScheduler({store:unifiedStore,refreshService:dailyRefreshService});
opportunityAvailabilityService.onChange=()=>{opportunityService.invalidate();decisionInbox.scheduleRebuild();};
whatsappApprovalGateway.feedbackChanged=()=>{opportunityService.invalidate();decisionInbox.scheduleRebuild();};
whatsappApprovalGateway.processCommands.availabilityService=opportunityAvailabilityService;
whatsappApprovalGateway.processCommands.onChange=whatsappApprovalGateway.feedbackChanged;
whatsappApprovalGateway.cancelHandler=async applicationId=>{for(const session of applicationEngine.browser.activeSessions||[])if(session.applicationId===applicationId)await applicationEngine.browser.close(session);};
const atsRecalculationService=new AtsRecalculationService({store:unifiedStore,reanalyze:analyzeUnifiedAts});
const qualityLabelService=new QualityLabelService({dataDir:hubDataDir});
const coverageBenchmarkService=new CoverageBenchmarkService({repository:unifiedStore.coverageBenchmark,store:unifiedStore,discoveryService,jobHuntService,opportunityService});
const experienceService=new ExperienceService({store:unifiedStore,opportunityService,profileProvider:readProfile,adapterRegistry:applicationEngine.registry,sessionProvider:applicationId=>submissionBrowserManager.status(applicationId)});
const extractedRouteHandlers=[
  createConnectionsObservabilityRoutes({auth:sourceAuth,readiness:sourceReadiness,observability,readJson:readRequestJson,json,sendError}),
  createResumeBatchRoutes({service:resumeBatchService,exportService:batchExportService,readJson:readRequestJson,json,binary,sendError}),
  createApplicationBatchRoutes({service:applicationBatchService,readJson:readRequestJson,json,sendError}),
  createApplicationV2Routes({store:unifiedStore,submissionPreflight,consentService:submissionConsentService,controlledSubmission:controlledSubmissionService,reconciliation:submissionReconciliationService,sessionProvider:applicationId=>submissionBrowserManager.status(applicationId),readJson:readRequestJson,json,sendError}),
  createTodayRoutes({store:unifiedStore,decisionInbox,dailyRefreshService,readJson:readRequestJson,json,sendError}),
  createAtsRoutes({recalculationService:atsRecalculationService,readJson:readRequestJson,json,sendError}),
  createQualityLabRoutes({service:qualityLabelService,readJson:readRequestJson,json,sendError}),
  createCoverageBenchmarkRoutes({service:coverageBenchmarkService,readJson:readRequestJson,json,sendError}),
  createOpportunityRoutes({store:unifiedStore,opportunityService,availabilityService:opportunityAvailabilityService,dailyRefreshService,availabilityScheduler,decisionInbox,readJson:readRequestJson,json,sendError}),
  createExperienceRoutes({experienceService,profileProvider:readProfile,readJson:readRequestJson,json,sendError}),
  createCandidateKnowledgeRoutes({store:unifiedStore,githubEvidenceProvider,githubRecalibration:new GitHubRecalibrationService({store:unifiedStore,matcher:runCareerMatcher,profileProvider:readProfile,opportunities:opportunityService}),readJson:readRequestJson,json,sendError}),
  createSourceRoutes({store:unifiedStore,providerTestService,sourceConnectionService,companyRecommendations:companyRecommendationService,opportunityService,readJson:readRequestJson,json,sendError}),
  createDiscoveryV3Routes({store:unifiedStore,searchIntentService,companyRadarService,providerTestService,readJson:readRequestJson,json,sendError}),
  createDiscoveryV4Routes({store:unifiedStore,service:discoveryV4Service,leadPromotionService,evolutionService:evolutionConnectionService,communityService:communityDiscoveryService,approvalGateway:whatsappApprovalGateway,runtimeCapabilities:runtimeCapabilityService,readJson:readRequestJson,json,sendError}),
  createAutopilotRoutes({store:unifiedStore,jobHuntService,readJson:readRequestJson,json,sendError,publicIntegrationSettings}),
  createWhatsappRoutes({service:evolutionConnectionService,approvalGateway:whatsappApprovalGateway,store:unifiedStore,readJson:readRequestJson,json,sendError,publicIntegrationSettings})
];

const server = createServer(async (req, res) => {
  if(req.url==="/api/health"&&req.method==="GET"){
    json(res,{ok:true,mode:runtimePolicy.mode});return;
  }
  try{authorizeWebRequest(req,webConfig);}catch(error){sendError(res,error,{status:error.status||403,code:error.code,message:error.message});return;}
  const url = new URL(req.url || "/", webConfig.enabled?webConfig.origin:`http://${req.headers.host}`);
  try{requireLocalApiRequest(req,url);}catch(error){sendError(res,error,{status:error.status||403,code:error.code,message:error.message});return;}
  if(url.pathname==="/api/runtime"&&req.method==="GET"){
    json(res,{ok:true,mode:runtimePolicy.mode,backgroundEnabled:runtimePolicy.backgroundEnabled,workersEnabled:runtimePolicy.workersEnabled,submissionEnabled,sessionRenewalEnabled:true});return;
  }
  if(!runtimePolicy.allowRequest(req.method,url.pathname)){
    json(res,{ok:false,code:runtimePolicy.manual?"MANUAL_MODE_API_RESTRICTED":"MAINTENANCE_MODE",error:runtimePolicy.manual?"Modo manual: use os comandos do aplicativo mobile. Agendas e integracoes automaticas permanecem pausadas.":"Sistema em manutencao: agendas, filas e envios pausados. A renovacao manual de Cofres esta disponivel."},423);return;
  }
  if(url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/observability')){
    const started=Date.now();const correlationId=`http-${randomUUID()}`;res.setHeader('X-Correlation-Id',correlationId);
    res.once('finish',()=>{if(req.method!=='GET'||res.statusCode>=400)unifiedStore.structuredLogs.record({category:res.statusCode===403?'SECURITY':'HTTP',eventCode:res.statusCode>=400?'HTTP_OPERATION_FAILED':'HTTP_OPERATION_COMPLETED',level:res.statusCode>=500?'ERROR':res.statusCode>=400?'WARN':'INFO',correlationId:res.getHeader('X-Correlation-Id')||correlationId,operation:req.method,status:String(res.statusCode),durationMs:Date.now()-started,errorCode:res.statusCode>=400?`HTTP_${res.statusCode}`:'',message:url.pathname.replace(/\/handoff\/[^/]+/,'/handoff/[request]')});});
  }
  for(const handler of extractedRouteHandlers)if(await handler(req,res,url))return;
  const applicationAction = url.pathname.match(/^\/api\/unified\/applications\/([^/]+)\/(plan|preflight|details|queue|run|questions)(?:\/([^/]+)\/answer)?$/);

  if (applicationAction) {
    const applicationId = decodeURIComponent(applicationAction[1]);
    const action = applicationAction[2];
    try {
      if (action === "plan" && req.method === "GET") {
        const plan = unifiedStore.applicationPlans.forApplication(applicationId);
        json(res, { ok: Boolean(plan), plan }, plan ? 200 : 404);
        return;
      }
      if (action === "plan" && req.method === "POST") {
        const input = await readRequestJson(req);
        const plan = unifiedStore.planApplication(applicationId, String(input.analysisId || ""), await readProfile(), input.policy || {});
        json(res, { ok: true, plan });
        return;
      }
      if (action === "preflight" && req.method === "POST") {
        const input = await readRequestJson(req); const mode = assertAutomationMode(input.mode);
        const preflight = await applicationEngine.preflight.evaluate(applicationId, { mode });
        const currentPlan = unifiedStore.applicationPlans.forApplication(applicationId);
        if (currentPlan) unifiedStore.applicationPlans.save({ ...currentPlan, preflight });
        json(res, { ok: true, preflight });
        return;
      }
      if (action === "details" && req.method === "GET") {
        json(res, { ok: true, ...unifiedStore.applicationEngineDetails(applicationId, await readProfile()) });
        return;
      }
      if (action === "questions" && !applicationAction[3] && req.method === "GET") {
        json(res, { ok: true, questions: unifiedStore.applicationQuestions.forApplication(applicationId) });
        return;
      }
      if (action === "questions" && applicationAction[3] && req.method === "POST") {
        const input = await readRequestJson(req);
        if (input.value === undefined || JSON.stringify(input.value).length > 10000) throw Object.assign(new Error("Resposta ausente ou muito extensa."), { code: "INVALID_QUESTION_ANSWER" });
        const result = unifiedStore.answerApplicationQuestion(applicationId, decodeURIComponent(applicationAction[3]), input.value, { reusable: input.reusable === true });
        json(res, { ok: true, ...result });
        return;
      }
      if (action === "queue" && req.method === "POST") {
        const input = await readRequestJson(req); const mode = assertAutomationMode(input.mode);
        json(res, { ok: true, queue: unifiedStore.queueApplication(applicationId, mode) });
        return;
      }
      if (action === "run" && req.method === "POST") {
        if (applicationWorkerBusy) { json(res, { ok: false, code: "WORKER_BUSY", error: "O worker ja esta processando outra candidatura." }, 409); return; }
        const input = await readRequestJson(req); const mode = assertAutomationMode(input.mode);
        let queued = unifiedStore.applicationQueue.forApplication(applicationId);
        if (!queued || queued.status !== "QUEUED") queued = unifiedStore.queueApplication(applicationId, mode);
        const claimed = unifiedStore.applicationQueue.claim(`worker-${process.pid}`, applicationId);
        if (!claimed) { json(res, { ok: false, code: "QUEUE_LOCKED", error: "A candidatura nao esta disponivel para execucao." }, 409); return; }
        applicationWorkerBusy = true;
        try {
          const result = await applicationEngine.run({ applicationId, mode });
          if(result.application?.status==="WAITING_USER")eventBus.emit("APPLICATION_WAITING_USER",{applicationId,jobId:result.application.jobId,reason:result.attempt?.errorCode||"REVIEW_REQUIRED"});
          if(result.application?.status==="READY_TO_SUBMIT")eventBus.emit("APPLICATION_READY_TO_SUBMIT",{applicationId,jobId:result.application.jobId,requiresReview:true});
          if(result.inspection?.health==="DEGRADED")eventBus.emit("ADAPTER_DEGRADED",{applicationId,adapter:result.inspection.adapterType,health:result.inspection.health});
          if(result.inspection?.health==="UNSUPPORTED")eventBus.emit("ADAPTER_UNSUPPORTED",{applicationId,adapter:result.inspection.adapterType,health:result.inspection.health});
          unifiedStore.applicationQueue.finish(applicationId, "DONE");
          json(res, { ok: true, ...result, plan: unifiedStore.applicationPlans.forApplication(applicationId), events: unifiedStore.applications.events(applicationId) });
        } catch (error) {
          unifiedStore.applicationQueue.finish(applicationId, "FAILED", { code: error.code || "ATTEMPT_FAILED", message: error.message });
          throw error;
        } finally { applicationWorkerBusy = false; }
        return;
      }
    } catch (error) {
      sendError(res, error, { status: 400, code: error.code || "APPLICATION_ENGINE_ERROR", message: "Nao foi possivel executar a acao da candidatura." });
      return;
    }
  }

  if (url.pathname === "/api/unified/greenhouse/live-inspect" && req.method === "POST") {
    try {
      const input = await readRequestJson(req);
      const report = await new LiveInspector({ headless: true, publicOnly: true }).inspect(String(input.url || ""), { fill: false });
      json(res, { ok: true, report });
    } catch (error) {
      sendError(res, error, { status: 400, code: error.code || "LIVE_INSPECT_FAILED", message: "Nao foi possivel inspecionar a URL informada." });
    }
    return;
  }

  if(url.pathname==="/api/discovery/providers"&&req.method==="GET"){json(res,{ok:true,providers:await providerRegistry.diagnostics()});return;}
  if(url.pathname==="/api/discovery/runs"&&req.method==="GET"){json(res,{ok:true,runs:unifiedStore.discovery.runs()});return;}
  const provenanceRoute=url.pathname.match(/^\/api\/discovery\/jobs\/([^/]+)\/provenance$/);if(provenanceRoute&&req.method==="GET"){const jobId=decodeURIComponent(provenanceRoute[1]),job=unifiedStore.jobs.findById(jobId);json(res,{ok:Boolean(job),job,sources:job?unifiedStore.discovery.sourcesForJob(jobId):[]},job?200:404);return;}
  if(url.pathname==="/api/discovery/watchlists"&&req.method==="GET"){json(res,{ok:true,watchlists:unifiedStore.watchlists.all(),boards:unifiedStore.watchlists.boards()});return;}
  if(url.pathname==="/api/discovery/watchlists"&&req.method==="POST"){try{const input=await readRequestJson(req);if(!String(input.name||"").trim()||!String(input.careerUrl||"").trim())throw Object.assign(new Error("Nome e URL de carreira sao obrigatorios."),{code:"INVALID_WATCHLIST"});const watchlist=unifiedStore.watchlists.save(input),detected=discoveryService.sources.resolve(watchlist.careerUrl);let board=null;if(detected.canonicalTarget&&detected.organizationKey)board=unifiedStore.watchlists.saveBoard({watchlistId:watchlist.id,company:watchlist.name,provider:detected.atsType,organizationKey:detected.organizationKey,careerUrl:detected.url,source:"watchlist_url",confidence:.98,enabled:watchlist.active});eventBus.emit("WATCHLIST_UPDATED",{watchlistId:watchlist.id,name:watchlist.name,active:watchlist.active,provider:board?.provider||""});json(res,{ok:true,watchlist,board});}catch(error){sendError(res,error,{status:400,code:error.code||"INVALID_WATCHLIST"});}return;}
  const watchlistDelete=url.pathname.match(/^\/api\/discovery\/watchlists\/([^/]+)$/);if(watchlistDelete&&req.method==="DELETE"){json(res,{ok:unifiedStore.watchlists.remove(decodeURIComponent(watchlistDelete[1]))});return;}
  if(url.pathname==="/api/integrations/n8n"&&req.method==="GET"){json(res,{ok:true,settings:publicIntegrationSettings(unifiedStore.integrationSettings.get())});return;}
  if(url.pathname==="/api/integrations/n8n"&&req.method==="POST"){try{const input=await readRequestJson(req),allowedEvents=["JOB_HIGH_MATCH","JOB_MATCH_DIGEST_READY","INTEGRATION_TEST"],webhookUrl=String(input.webhookUrl||"").trim(),settings=unifiedStore.integrationSettings.save({enabled:input.enabled===true,webhookUrl:webhookUrl?normalizeWebhookUrl(webhookUrl):"",secretEnvName:String(input.secretEnvName||"CAREER_N8N_WEBHOOK_SECRET"),eventAllowlist:Array.isArray(input.eventAllowlist)&&input.eventAllowlist.length?input.eventAllowlist.filter(type=>allowedEvents.includes(type)):allowedEvents,timeoutMs:Number(input.timeoutMs)||5000});json(res,{ok:true,settings:publicIntegrationSettings(settings)});}catch(error){sendError(res,error,{status:400,code:error.code||"INVALID_N8N_SETTINGS",message:error.message});}return;}
  if(url.pathname==="/api/integrations/n8n/dispatch"&&req.method==="POST"){json(res,{ok:true,result:await webhookDispatcher.drainOne()});return;}
  if(url.pathname==="/api/integrations/n8n/test"&&req.method==="POST"){try{const event=eventBus.emit("INTEGRATION_TEST",{channel:"N8N",message:"Teste seguro do Career Unified",requiresReview:true}),result=await dispatchThroughEvent(event.id);json(res,{ok:true,eventId:event.id,result});}catch(error){sendError(res,error,{status:400,code:error.code||"N8N_TEST_FAILED"});}return;}
  if(url.pathname==="/api/integrations/whatsapp/test"&&req.method==="POST"){try{const event=eventBus.emit("INTEGRATION_TEST",{channel:"WHATSAPP",message:"Career Unified conectado. Nenhuma candidatura foi enviada.",requiresReview:true}),result=await dispatchThroughEvent(event.id);json(res,{ok:true,eventId:event.id,result});}catch(error){sendError(res,error,{status:400,code:error.code||"WHATSAPP_TEST_FAILED"});}return;}

  if(url.pathname==="/api/resume-documents/templates"&&req.method==="GET"){json(res,{ok:true,templates:resumeService.templates.list(),policy:resumeDocumentPolicy});return;}
  if(url.pathname==="/api/resume-archetypes"&&req.method==="GET"){json(res,{ok:true,items:resumeBaseService.list()});return;}
  if(url.pathname==="/api/resume-archetypes/prepare"&&req.method==="POST"){try{json(res,{ok:true,assignments:await resumeBaseService.prepareDrafts()},201);}catch(error){sendError(res,error,{status:400,code:error.code||"RESUME_ARCHETYPE_PREPARE_FAILED"});}return;}
  const archetypeReviewRoute=url.pathname.match(/^\/api\/resume-archetypes\/assignments\/([^/]+)\/review$/);if(archetypeReviewRoute&&req.method==="POST"){try{const input=await readRequestJson(req),status=String(input.status||"").toUpperCase();json(res,{ok:true,assignment:unifiedStore.resumeArchetypeAssignments.review(decodeURIComponent(archetypeReviewRoute[1]),status)});}catch(error){sendError(res,error,{status:400,code:error.code||"RESUME_ARCHETYPE_REVIEW_FAILED"});}return;}
  if(url.pathname==="/api/resume-documents/templates/benchmarks"&&req.method==="GET"){json(res,{ok:true,benchmarks:unifiedStore.templateBenchmarks.list()});return;}
  if(url.pathname==="/api/resume-documents/compiler-health"&&req.method==="GET"){json(res,{ok:true,health:await resumeService.compiler.health()});return;}
  if(url.pathname==="/api/resume-documents/metrics"&&req.method==="GET"){json(res,{ok:true,metrics:resumeService.metrics()});return;}
  if(url.pathname==="/api/resume-documents/versions"&&req.method==="GET"){json(res,{ok:true,versions:unifiedStore.resumeVersions.list({resumeId:String(url.searchParams.get("resumeId")||""),jobId:String(url.searchParams.get("jobId")||""),status:String(url.searchParams.get("status")||"")})});return;}
  if(url.pathname==="/api/resume-documents/versions"&&req.method==="POST"){try{const input=await readRequestJson(req),payload={resumeId:String(input.resumeId||"").slice(0,200),jobId:String(input.jobId||"").slice(0,200),applicationId:String(input.applicationId||"").slice(0,200),templateId:String(input.templateId||"").slice(0,80),templateVersion:String(input.templateVersion||"").slice(0,80),archetypeId:String(input.archetypeId||"GENERAL").slice(0,80),language:["pt-BR","en"].includes(input.language)?input.language:"pt-BR",tailoringRunId:String(input.tailoringRunId||"").slice(0,200),source:"USER"},job=unifiedStore.resumeDocumentJobs.enqueue("BUILD_SPEC",payload);resumeDocumentWorker.schedule();json(res,{ok:true,job},202);}catch(error){sendError(res,error,{status:400,code:error.code||"RESUME_VERSION_JOB_FAILED"});}return;}
  if(url.pathname==="/api/resume-documents/tailor"&&req.method==="POST"){try{const input=await readRequestJson(req),payload={jobId:String(input.jobId||"").slice(0,200),resumeId:String(input.resumeId||"").slice(0,200),analysisId:String(input.analysisId||"").slice(0,200),applicationId:String(input.applicationId||"").slice(0,200),instruction:String(input.instruction||"").slice(0,800)};eventBus.emit("RESUME_TAILORING_STARTED",{resumeId:payload.resumeId,jobId:payload.jobId,applicationId:payload.applicationId});const job=unifiedStore.intelligenceJobs.enqueue(TASK_TYPES.RESUME_TAILORING,payload);intelligenceWorker.schedule();json(res,{ok:true,job},202);}catch(error){sendError(res,error,{status:400,code:error.code||"RESUME_TAILORING_JOB_FAILED"});}return;}
  const resumeVersionRoute=url.pathname.match(/^\/api\/resume-documents\/versions\/([^/]+)(?:\/(review|revise|render|artifacts|export))?$/);if(resumeVersionRoute){const versionId=decodeURIComponent(resumeVersionRoute[1]),action=resumeVersionRoute[2]||"";try{if(req.method==="GET"&&!action){const version=unifiedStore.resumeVersions.findById(versionId);json(res,version?{ok:true,version,artifacts:unifiedStore.resumeArtifacts.forVersion(versionId),renderRuns:unifiedStore.resumeRenderRuns.forVersion(versionId),exports:unifiedStore.documentExports.forVersion(versionId)}:{ok:false,code:"RESUME_VERSION_NOT_FOUND"},version?200:404);return;}if(req.method==="GET"&&action==="artifacts"){json(res,{ok:true,artifacts:unifiedStore.resumeArtifacts.forVersion(versionId)});return;}if(req.method==="POST"&&action==="review"){const input=await readRequestJson(req),version=input.state==="REJECTED"?resumeService.reject(versionId):resumeService.approve(versionId);let job=null;if(version.status==="APPROVED"&&resumeDocumentPolicy.allowAutomaticRenderAfterApproval){job=unifiedStore.resumeDocumentJobs.enqueue("RENDER",{resumeVersionId:version.id});resumeDocumentWorker.schedule();}json(res,{ok:true,version,job},job?202:200);return;}if(req.method==="POST"&&action==="revise"){const input=await readRequestJson(req),version=await resumeService.revise(versionId,{resumeSpec:input.resumeSpec});json(res,{ok:true,version},201);return;}if(req.method==="POST"&&action==="render"){const version=unifiedStore.resumeVersions.findById(versionId),retryableFailure=version?.status==="FAILED"&&Boolean(version.approvedAt);if(!version||(!["APPROVED","READY"].includes(version.status)&&!retryableFailure))throw Object.assign(new Error("Versao nao aprovada."),{code:"RESUME_VERSION_NOT_APPROVED"});const job=unifiedStore.resumeDocumentJobs.enqueue("RENDER",{resumeVersionId:versionId});resumeDocumentWorker.schedule();json(res,{ok:true,job},202);return;}if(req.method==="POST"&&action==="export"){const input=await readRequestJson(req),destination=String(input.destination||"LOCAL").toUpperCase();if(!["LOCAL","N8N","OVERLEAF","GOOGLE_DRIVE"].includes(destination))throw Object.assign(new Error("Destino invalido."),{code:"DOCUMENT_DESTINATION_UNKNOWN"});const job=unifiedStore.resumeDocumentJobs.enqueue("EXPORT",{resumeVersionId:versionId,destination});resumeDocumentWorker.schedule();json(res,{ok:true,job},202);return;}}catch(error){sendError(res,error,{status:error.status||400,code:error.code||"RESUME_DOCUMENT_ACTION_FAILED",message:error.message});return;}}
  const resumeJobRoute=url.pathname.match(/^\/api\/resume-documents\/jobs\/([^/]+)(?:\/(cancel))?$/);if(resumeJobRoute){const jobId=decodeURIComponent(resumeJobRoute[1]);if(req.method==="GET"&&!resumeJobRoute[2]){const job=unifiedStore.resumeDocumentJobs.findById(jobId);json(res,job?{ok:true,job}:{ok:false,code:"RESUME_DOCUMENT_JOB_NOT_FOUND"},job?200:404);return;}if(req.method==="POST"&&resumeJobRoute[2]==="cancel"){const job=unifiedStore.resumeDocumentJobs.cancel(jobId);json(res,job?{ok:true,job}:{ok:false,code:"RESUME_DOCUMENT_JOB_NOT_CANCELLED"},job?200:409);return;}}
  const resumeArtifactDownload=url.pathname.match(/^\/api\/resume-documents\/artifacts\/([^/]+)\/download$/);if(resumeArtifactDownload&&req.method==="GET"){const artifact=unifiedStore.resumeArtifacts.findById(decodeURIComponent(resumeArtifactDownload[1])),version=artifact?unifiedStore.resumeVersions.findById(artifact.resumeVersionId):null;if(!artifact||!version){json(res,{ok:false,code:"RESUME_ARTIFACT_NOT_FOUND"},404);return;}try{const data=await unifiedStore.resumeArtifactService.readAllowed(artifact,version.resumeId),extension={LATEX_SOURCE:"tex",PDF:"pdf",EXTRACTED_TEXT:"txt",EXPORT_BUNDLE:"zip"}[artifact.artifactType]||"bin";binary(res,data,artifact.mimeType,`resume-${version.id}.${extension}`);}catch(error){sendError(res,error,{status:409,code:error.code||"RESUME_ARTIFACT_INVALID"});}return;}
  if(url.pathname==="/api/automation/resume-documents/jobs"&&req.method==="POST"){try{const body=await readRawJsonBody(req),auth=automationRequestAuth.verify({rawBody:body.raw,headers:req.headers}),input=body.data,jobType=String(input.jobType||"").toUpperCase();if(!["BUILD_SPEC","RENDER","EXPORT"].includes(jobType))throw Object.assign(new Error("Acao de automacao invalida."),{code:"AUTOMATION_ACTION_NOT_ALLOWED"});const payload=jobType==="BUILD_SPEC"?{resumeId:String(input.resumeId||"").slice(0,200),jobId:String(input.jobId||"").slice(0,200),applicationId:String(input.applicationId||"").slice(0,200),templateId:String(input.templateId||"").slice(0,80),language:["pt-BR","en"].includes(input.language)?input.language:"pt-BR",tailoringRunId:String(input.tailoringRunId||"").slice(0,200),source:"N8N_AUTHENTICATED"}:{resumeVersionId:String(input.resumeVersionId||"").slice(0,200),...(jobType==="EXPORT"?{destination:String(input.destination||"LOCAL").toUpperCase()}:{})},job=unifiedStore.resumeDocumentJobs.enqueue(jobType,payload);resumeDocumentWorker.schedule();json(res,{ok:true,authenticated:auth.authenticated,job},202);}catch(error){sendError(res,error,{status:error.status||401,code:error.code||"AUTOMATION_AUTH_FAILED",message:error.message});}return;}

  if (url.pathname === "/api/projects") {
    json(res, { mode: "unified", projects: [], workflow: [], presets: [] });
    return;
  }

  if (url.pathname === "/api/unified" && req.method === "GET") {
    json(res, { ok: true, state: await readUnifiedState() });
    return;
  }

  if (url.pathname === "/api/unified/job" && req.method === "POST") {
    try {
      const result = await upsertUnifiedJob(await readRequestJson(req));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_JOB", message: "Nao foi possivel salvar a vaga." });
    }
    return;
  }

  if (url.pathname === "/api/unified/resume" && req.method === "POST") {
    try {
      const result = await createUnifiedResume(await readRequestJson(req, { limit: BASE64_UPLOAD_LIMIT }));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_FILE", message: "Nao foi possivel importar o curriculo." });
    }
    return;
  }

  if (url.pathname === "/api/unified/application" && req.method === "POST") {
    try {
      const result = await upsertUnifiedApplication(await readRequestJson(req));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_APPLICATION", message: "Nao foi possivel salvar a candidatura." });
    }
    return;
  }

  if (url.pathname === "/api/unified/ats" && req.method === "POST") {
    try {
      const result = await analyzeUnifiedAts(await readRequestJson(req));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      console.error("ATS analysis failed", {
        code: error?.code || "ATS_ANALYSIS_FAILED",
        message: String(error?.message || "unknown error").slice(0, 300),
      });
      sendError(res, error, { status: 400, code: "INVALID_REQUEST", message: "Nao foi possivel analisar o curriculo." });
    }
    return;
  }

  if (url.pathname === "/api/unified/jobs/search" && req.method === "POST") {
    try {
      const result = await searchUnifiedJobs(await readRequestJson(req));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 502, code: "JOB_SEARCH_FAILED", message: "A busca de vagas falhou." });
    }
    return;
  }

  if(url.pathname==="/api/product/onboarding"&&req.method==="GET"){
    json(res,{ok:true,onboarding:await readProductOnboarding()});
    return;
  }
  if(url.pathname==="/api/product/onboarding"&&req.method==="POST"){
    json(res,{ok:true,onboarding:await saveProductOnboarding(await readRequestJson(req))});
    return;
  }

  if (url.pathname === "/api/opportunities/analyze" && req.method === "POST") {
    try {
      json(res, await analyzeJobForUser(await readRequestJson(req)));
    } catch (error) {
      sendError(res,error,{status:error.status||400,code:error.code||"JOB_ANALYSIS_FAILED",message:error.message||"Não foi possível analisar esta vaga."});
    }
    return;
  }

  if (url.pathname === "/api/unified/search-schedule" && req.method === "POST") {
    try {
      const result = await upsertSearchSchedule(await readRequestJson(req));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_SCHEDULE", message: "Nao foi possivel salvar o agendamento." });
    }
    return;
  }

  if (url.pathname === "/api/unified/search-schedule/run" && req.method === "POST") {
    try {
      const input = await readRequestJson(req);
      const result = await runSearchSchedule(String(input.id || ""));
      json(res, result, result.ok ? 200 : 502);
    } catch (error) {
      sendError(res, error, { status: 502, code: "JOB_SEARCH_FAILED", message: "A busca agendada falhou." });
    }
    return;
  }

  if (url.pathname === "/api/unified/search-schedule/delete" && req.method === "POST") {
    try {
      const input = await readRequestJson(req);
      json(res, await deleteSearchSchedule(String(input.id || "")));
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_REQUEST" });
    }
    return;
  }

  if (url.pathname === "/api/unified/alerts" && req.method === "POST") {
    try {
      json(res, await markAlertsRead(await readRequestJson(req)));
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_REQUEST" });
    }
    return;
  }

  if (url.pathname === "/api/unified/resume/generate" && req.method === "POST") {
    try {
      const result = await generateUnifiedResume(await readRequestJson(req));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 500, code: "GENERATION_FAILED", message: "Nao foi possivel gerar o curriculo." });
    }
    return;
  }

  if (url.pathname === "/api/unified/delete" && req.method === "POST") {
    try {
      const result = await deleteUnifiedEntity(await readRequestJson(req));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "DELETE_FAILED", message: "Nao foi possivel excluir o registro." });
    }
    return;
  }

  if (url.pathname === "/api/unified/generated" && req.method === "GET") {
    const state = await readUnifiedState();
    const generation = state.generations.find((item) => item.id === url.searchParams.get("id"));
    const format = url.searchParams.get("format") === "pdf" ? "pdf" : "docx";
    if (!generation) {
      json(res, { ok: false, error: "Arquivo gerado nao encontrado." }, 404);
      return;
    }
    const file = format === "pdf" ? generation.pdfPath : generation.docxPath;
    try {
      const data = await readFile(file);
      const extension = format === "pdf" ? "pdf" : "docx";
      const mime = format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      binary(res, data, mime, `${safeUploadName(generation.title)}.${extension}`);
    } catch {
      json(res, { ok: false, error: "O arquivo nao existe mais no volume local." }, 404);
    }
    return;
  }

  if (url.pathname === "/api/engine/status" && req.method === "GET") {
    try {
      const { response, data } = await fetchJsonWithTimeout(`${careerEngineUrl}/health`, {}, {
        timeout: 5000,
        timeoutMessage: "O motor Python excedeu o tempo limite.",
        timeoutCode: "ENGINE_TIMEOUT",
        unavailableMessage: "O motor Python esta indisponivel.",
        unavailableCode: "ENGINE_UNAVAILABLE"
      });
      json(res, { ok: response.ok && data.ok, url: careerEngineUrl, ...data }, response.ok ? 200 : 503);
    } catch (error) {
      sendError(res, error, { status: 503, code: "ENGINE_UNAVAILABLE", message: "O motor Python esta indisponivel." });
    }
    return;
  }

  if (url.pathname === "/api/unified/backup" && req.method === "GET") {
    const backup = await createUnifiedBackup();
    const data = Buffer.from(`${JSON.stringify(backup, null, 2)}\n`, "utf8");
    binary(res, data, "application/json; charset=utf-8", `career-hub-backup-${new Date().toISOString().slice(0, 10)}.json`);
    return;
  }

  if(url.pathname==="/api/unified/backup/inspect"&&req.method==="POST"){
    try{let input=await readRequestJson(req,{limit:BACKUP_UPLOAD_LIMIT}),backup=input.backup;if(!backup&&input.fileData){const match=String(input.fileData).match(/^data:application\/json;base64,([A-Za-z0-9+/]*={0,2})$/);if(!match)throw new Error("invalid data URL");backup=JSON.parse(Buffer.from(match[1],"base64").toString("utf8"));}const summary=backupSummary(backup);json(res,{ok:summary.compatible,summary},summary.compatible?200:400);}catch(error){sendError(res,error,{status:400,code:"INVALID_BACKUP",message:"O arquivo de backup é inválido ou incompatível."});}return;
  }

  if (url.pathname === "/api/unified/backup/restore" && req.method === "POST") {
    try {
      const result = await restoreUnifiedBackup(await readRequestJson(req, { limit: BACKUP_UPLOAD_LIMIT }));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_BACKUP", message: "O arquivo de backup e invalido." });
    }
    return;
  }

  if (url.pathname === "/api/unified/sync-legacy" && req.method === "POST") {
    try {
      json(res, await syncLegacyProjects());
    } catch (error) {
      sendError(res, error, { status: 500, code: "LEGACY_SYNC_FAILED", message: "Nao foi possivel importar os dados legados." });
    }
    return;
  }

  if (url.pathname === "/api/ollama/status" && req.method === "GET") {
    const result = await ollamaStatus();
    json(res, result, result.ok ? 200 : 503);
    return;
  }

  if (url.pathname === "/api/profile") {
    if (req.method === "GET") {
      json(res, await readProfile());
      return;
    }
    if (req.method === "POST") {
      try {
        const profile = await saveProfile(await readRequestJson(req));
        unifiedStore.candidateFacts.syncProfile(CandidateKnowledgeBase.fromProfile(profile).all());
        if(profile.llm?.ollamaUrl){const current=unifiedStore.intelligenceSettings.get();const settings=unifiedStore.intelligenceSettings.save({...current,endpoint:process.env.OLLAMA_URL||profile.llm.ollamaUrl,fastModel:profile.llm.chatModel||current?.fastModel||"",balancedModel:profile.llm.chatModel||current?.balancedModel||""});reloadIntelligence(settings);}
        json(res, { ok: true, profile });
      } catch (error) {
        sendError(res, error, { status: 400, code: "INVALID_PROFILE", message: "Nao foi possivel salvar o perfil." });
      }
      return;
    }
  }

  if (url.pathname === "/api/profile/export" && req.method === "POST") {
    try {
      const { target } = await readRequestJson(req);
      const result = await exportProfile(target);
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "PROFILE_EXPORT_FAILED", message: "Nao foi possivel exportar o perfil." });
    }
    return;
  }

  if(url.pathname==="/api/intelligence/status"&&req.method==="GET"){json(res,{ok:true,...await intelligenceService.status()});return;}
  if(url.pathname==="/api/intelligence/settings"){
    if(req.method==="GET"){json(res,{ok:true,settings:unifiedStore.intelligenceSettings.get()});return;}
    if(req.method==="POST"){try{const input=await readRequestJson(req),provider=["ollama","lm-studio"].includes(input.provider)?input.provider:"ollama",candidate={provider,endpoint:String(input.endpoint||(provider==="lm-studio"?"http://host.docker.internal:1234/v1":"http://host.docker.internal:11434")),fastModel:String(input.fastModel||"").slice(0,200),balancedModel:String(input.balancedModel||"").slice(0,200),qualityModel:String(input.qualityModel||"").slice(0,200),hardwareProfile:["AUTO","LOW_VRAM","BALANCED","HIGH_MEMORY"].includes(input.hardwareProfile)?input.hardwareProfile:"AUTO",contextBudget:Math.max(512,Math.min(32768,Number(input.contextBudget||4096))),policies:input.policies||{}};if(input.provider&&!['ollama','lm-studio'].includes(input.provider))throw Object.assign(new Error("Provider local nao suportado."),{code:"PROVIDER_MISCONFIGURED"});const configuredProvider=createIntelligenceProvider(candidate);candidate.endpoint=configuredProvider.baseUrl;const settings=unifiedStore.intelligenceSettings.save(candidate);reloadIntelligence(settings);const profile=await readProfile(),llm={...(profile.llm||{}),provider,chatModel:settings.balancedModel||settings.fastModel||"",...(provider==="ollama"?{ollamaUrl:settings.endpoint}:{lmStudioUrl:settings.endpoint})};await saveProfile({...profile,llm});json(res,{ok:true,settings,status:await intelligenceService.status()});}catch(error){sendError(res,error,{status:400,code:error.code||"INVALID_INTELLIGENCE_SETTINGS",message:"Nao foi possivel salvar as configuracoes de inteligencia."});}return;}
  }
  if(url.pathname==="/api/intelligence/models/refresh"&&req.method==="POST"){json(res,{ok:true,status:await intelligenceService.refresh()});return;}
  if(url.pathname==="/api/intelligence/benchmark"&&req.method==="POST"){const job=unifiedStore.intelligenceJobs.enqueue("BENCHMARK",{});intelligenceWorker.schedule();json(res,{ok:true,job},202);return;}
  if(url.pathname==="/api/intelligence/jobs"&&req.method==="POST"){try{const input=await readRequestJson(req);const allowed=new Set([TASK_TYPES.RESUME_TAILORING,TASK_TYPES.APPLICATION_ANSWER_DRAFT,TASK_TYPES.COVER_LETTER]);if(!allowed.has(input.task))throw Object.assign(new Error("Tarefa nao permitida nesta API."),{code:"INVALID_INTELLIGENCE_TASK"});const payload={jobId:String(input.jobId||"").slice(0,200),resumeId:String(input.resumeId||"").slice(0,200),analysisId:String(input.analysisId||"").slice(0,200),applicationId:String(input.applicationId||"").slice(0,200),questionId:String(input.questionId||"").slice(0,200),...(input.task===TASK_TYPES.RESUME_TAILORING?{instruction:String(input.instruction||"").slice(0,800)}:{})};if(input.task===TASK_TYPES.APPLICATION_ANSWER_DRAFT){const context=answerDraftContext(payload.applicationId,payload.questionId);if(context.pending){json(res,{ok:true,job:null,generatedContent:context.pending,reused:true});return;}}const job=unifiedStore.intelligenceJobs.enqueue(input.task,payload);intelligenceWorker.schedule();json(res,{ok:true,job},202);}catch(error){sendError(res,error,{status:error.status||400,code:error.code||"INVALID_INTELLIGENCE_JOB",message:error.message||"Nao foi possivel criar a tarefa de inteligencia."});}return;}
  const intelligenceJobAction=url.pathname.match(/^\/api\/intelligence\/jobs\/([^/]+)(?:\/(cancel))?$/);if(intelligenceJobAction){const jobId=decodeURIComponent(intelligenceJobAction[1]);if(req.method==="GET"&&!intelligenceJobAction[2]){const job=unifiedStore.intelligenceJobs.findById(jobId);json(res,job?{ok:true,job}:{ok:false,error:"Tarefa nao encontrada."},job?200:404);return;}if(req.method==="POST"&&intelligenceJobAction[2]==="cancel"){const job=unifiedStore.intelligenceJobs.cancel(jobId);json(res,job?{ok:true,job}:{ok:false,error:"Tarefa nao pode ser cancelada."},job?200:409);return;}}
  const generatedReview=url.pathname.match(/^\/api\/intelligence\/generated\/([^/]+)\/review$/);if(generatedReview&&req.method==="POST"){try{const input=await readRequestJson(req),item=unifiedStore.generatedContent.review(decodeURIComponent(generatedReview[1]),String(input.state||""));if(!item)throw Object.assign(new Error("Conteudo nao encontrado ou ja revisado."),{code:"REVIEW_NOT_AVAILABLE"});if(item.state==="APPROVED"&&item.contentType==="ANSWER_DRAFT"&&item.applicationId&&item.questionId){unifiedStore.applicationQuestions.answer(item.applicationId,item.questionId,item.draft,{source:"LLM_APPROVED",reusable:false});unifiedStore.applications.recordEvent(item.applicationId,"GENERATED_ANSWER_APPROVED",{questionId:item.questionId,source:"LLM_APPROVED"});}json(res,{ok:true,item});}catch(error){sendError(res,error,{status:400,code:error.code||"INVALID_REVIEW",message:"Nao foi possivel revisar o conteudo."});}return;}
  const tailoringReview=url.pathname.match(/^\/api\/intelligence\/tailoring\/([^/]+)\/review$/);if(tailoringReview&&req.method==="POST"){try{const input=await readRequestJson(req),id=decodeURIComponent(tailoringReview[1]),state=String(input.state||"");if(state==="APPROVED"){const current=unifiedStore.resumeTailoring.findRun(id);if(!current)throw Object.assign(new Error("Tailoring nao encontrado ou ja revisado."),{code:"REVIEW_NOT_AVAILABLE"});assertTailoringApprovable(current);}const run=unifiedStore.resumeTailoring.review(id,state);if(!run)throw Object.assign(new Error("Tailoring nao encontrado ou ja revisado."),{code:"REVIEW_NOT_AVAILABLE"});json(res,{ok:true,run});}catch(error){sendError(res,error,{status:400,code:error.code||"INVALID_REVIEW",message:error.message||"Nao foi possivel revisar o tailoring."});}return;}
  if(url.pathname==="/api/intelligence/skill-gaps"&&req.method==="GET"){const state=await readUnifiedState();const jobs=new Map(state.jobs.map(job=>[job.id,job]));const analyses=state.analyses.map(item=>({...item,company:jobs.get(item.jobId)?.company||""}));const gaps=skillGapAnalyzer.analyze(analyses);const snapshot=unifiedStore.skillGapSnapshots.save(gaps,analyses.length);json(res,{ok:true,snapshot});return;}

  if (url.pathname === "/api/preset/run" && req.method === "POST") {
    try {
      const { presetId } = await readRequestJson(req);
      const preset = presets.find((item) => item.id === presetId);
      if (!preset) {
        json(res, { ok: false, error: "Preset nao encontrado.", code: "PRESET_NOT_FOUND" }, 404);
        return;
      }
      const results = preset.commands.map(([projectId, commandId]) => startCommand(projectId, commandId));
      json(res, { ok: results.every((item) => item.ok), results });
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_REQUEST" });
    }
    return;
  }

  if (url.pathname === "/api/careerops") {
    json(res, await readCareerOpsState());
    return;
  }

  if (url.pathname === "/api/preparation" && req.method === "GET") {
    json(res, await readPreparation());
    return;
  }

  if (url.pathname === "/api/preparation/library" && req.method === "GET") {
    try {
      const index = await buildLibraryIndex(url.searchParams.get("refresh") === "1");
      const query = url.searchParams.get("q") || "";
      const repoId = url.searchParams.get("repo") || "";
      json(res, {
        ok: true,
        builtAt: index.builtAt,
        stats: index.stats,
        repos: index.repos,
        query,
        results: query ? searchLibrary(index, query, { repoId, limit: 20 }) : []
      });
    } catch (error) {
      sendError(res, error, { status: 500, code: "LIBRARY_FAILED", message: "Nao foi possivel ler a biblioteca local." });
    }
    return;
  }

  if (url.pathname === "/api/preparation/job" && req.method === "POST") {
    try {
      const result = await upsertPreparationJob(await readRequestJson(req));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_JOB", message: "Nao foi possivel salvar a preparacao." });
    }
    return;
  }

  if (url.pathname === "/api/preparation/active" && req.method === "POST") {
    try {
      const { id } = await readRequestJson(req);
      const result = await setActivePreparationJob(id);
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "INVALID_REQUEST" });
    }
    return;
  }

  if (url.pathname === "/api/preparation/generate" && req.method === "POST") {
    try {
      const result = await generatePreparation(await readRequestJson(req));
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "PREPARATION_FAILED", message: "Nao foi possivel gerar a preparacao." });
    }
    return;
  }

  if (url.pathname === "/api/pipeline/add" && req.method === "POST") {
    try {
      const { input } = await readRequestJson(req);
      const result = await addPipelineItem(input);
      json(res, result, result.ok ? 200 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "PIPELINE_UPDATE_FAILED", message: "Nao foi possivel atualizar o pipeline." });
    }
    return;
  }

  if (url.pathname === "/api/run" && req.method === "POST") {
    try {
      const { projectId, commandId } = await readRequestJson(req);
      const result = startCommand(projectId, commandId);
      json(res, result, result.ok ? 200 : result.code === "PROJECT_NOT_FOUND" ? 404 : 400);
    } catch (error) {
      sendError(res, error, { status: 400, code: "COMMAND_FAILED", message: "Nao foi possivel iniciar o comando." });
    }
    return;
  }

  if (url.pathname === "/api/logs") {
    const key = url.searchParams.get("key");
    const record = key ? processes.get(key) : null;
    json(res, record || { key, logs: [], exited: true });
    return;
  }

  if (url.pathname === "/api/processes") {
    json(res, Array.from(processes.values()).map(({ logs, ...rest }) => rest));
    return;
  }

const deepLink = url.pathname === "/analyze" || /^\/(opportunities|processes|resumes|resume-batches|application-batches|applications|autopilot|knowledge|settings|connections|vaults|observability|quality-lab)(\/|$)/.test(url.pathname);
  const requested = url.pathname === "/" || deepLink ? "index.html" : url.pathname.slice(1);
  const file = path.normalize(path.join(publicDir, requested));
  if (!file.startsWith(publicDir)) {
    json(res, { ok: false, error: "Caminho invalido." }, 400);
    return;
  }

  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": contentType(file) });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Job Search Hub em http://${host}:${port} (SQLite: ${unifiedDatabasePath})`);
});

const mobileConfig = mobileGatewayConfig();
if (mobileConfig.enabled) {
  const mobileGateway = createMobileGateway({
    config: mobileConfig,
    readOnly: runtimePolicy.maintenance,
    operationMode: runtimePolicy.mode,
    sourceReadiness: () => sourceReadiness.list(),
    store: unifiedStore,
    jobHuntService,
    decisionInbox,
    opportunityService,
    experienceService,
    eventBus,
    applicationActions: {
      analyze: async ({applicationId}) => ({ applicationId, url: `/applications/${encodeURIComponent(applicationId)}` }),
      approve: async ({applicationId,resumeVersionId,idempotencyKey,identity}) => {
        const application=unifiedStore.applications.findById(applicationId);
        if(!application)throw Object.assign(new Error("Candidatura nao encontrada."),{code:"APPLICATION_NOT_FOUND",status:404});
        return unifiedStore.applicationDecisionService.decide({applicationId,resumeVersionId:resumeVersionId||application.resumeVersionId,decision:"APPROVE",mode:"AUTO_APPLY",actor:identity.login,channel:"MOBILE",idempotencyKey});
      },
      resume: async ({applicationId,resumeVersionId,idempotencyKey,identity}) => {
        const application=unifiedStore.applications.findById(applicationId),decision=application&&unifiedStore.applicationDecisions.latest(applicationId,application.resumeVersionId);
        if(!application||resumeVersionId&&resumeVersionId!==application.resumeVersionId||!decision||!unifiedStore.applicationDecisionService.isCurrent(decision))throw Object.assign(new Error("Revise e aprove a versao atual antes de retomar."),{code:"DECISION_CONTEXT_STALE",status:409});
        unifiedStore.database.transaction(()=>unifiedStore.applicationDecisionService.enqueue(decision,null,`resume:${createHash("sha256").update(idempotencyKey).digest("hex").slice(0,20)}`,{channel:"MOBILE"}));
        return {status:"QUEUED",decisionId:decision.id};
      },
      reject: async ({applicationId,resumeVersionId,idempotencyKey,identity}) => {
        const application=unifiedStore.applications.findById(applicationId);
        if(!application)throw Object.assign(new Error("Candidatura nao encontrada."),{code:"APPLICATION_NOT_FOUND",status:404});
        return unifiedStore.applicationDecisionService.decide({applicationId,resumeVersionId:resumeVersionId||application.resumeVersionId,decision:"REJECT",mode:"REVIEW_ONLY",actor:identity.login,channel:"MOBILE",idempotencyKey});
      },
      request_change: async ({applicationId,instruction}) => {const application=unifiedStore.applications.findById(applicationId);if(!application?.resumeVersionId||!instruction)throw Object.assign(new Error("Informe a alteração desejada."),{code:"REVISION_INSTRUCTION_REQUIRED",status:400});const job=unifiedStore.intelligenceJobs.enqueue(TASK_TYPES.RESUME_TAILORING,{jobId:application.jobId,resumeId:application.resumeId,applicationId,instruction,questionId:randomUUID()});intelligenceWorker.schedule();return {status:"QUEUED",jobId:job.id};},
      answer: async ({applicationId,questionId,answer,resumeVersionId,fingerprint,idempotencyKey,identity}) => unifiedStore.applicationDecisionService.answer({applicationId,questionId,answer,resumeVersionId,fingerprint,idempotencyKey,actor:identity.login,channel:"MOBILE"}),
    },
  });
  mobileGateway.listen(mobileConfig.port, mobileConfig.host, () => {
    console.log(
      `Mobile Gateway em http://${mobileConfig.host}:${mobileConfig.port} (Tailscale Serve obrigatório)`,
    );
  });
}

if(runtimePolicy.backgroundEnabled){
const scheduledSearchTimer = setInterval(() => {
  try{availabilityScheduler.tick();}catch(error){console.error("Verificação agendada falhou:",error.code||"VERIFICATION_SCHEDULER_FAILED");}
  jobHuntService.runDue().catch((error)=>console.error("Job Hunt agendado falhou:",error.message));
}, 60000);
scheduledSearchTimer.unref();
const initialSessionCheckTimer=setTimeout(()=>void verifyActivePortalSessions(),60_000);initialSessionCheckTimer.unref();
const sessionCheckTimer=setInterval(()=>void verifyActivePortalSessions(),24*60*60*1000);sessionCheckTimer.unref();
const webhookTimer=setInterval(()=>webhookDispatcher.drainOne().catch(()=>null),5000);webhookTimer.unref();
}
if(runtimePolicy.workersEnabled){
const autoApplyRecoveryTimer=setInterval(()=>autoApplyOrchestrator.resumePending().catch(error=>console.error("Retomada AutoApply falhou:",error.code||"AUTOAPPLY_RECOVERY_FAILED")),5000);autoApplyRecoveryTimer.unref();
}
