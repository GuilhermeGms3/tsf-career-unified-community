import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { AdapterRegistry } from "../src/automation/ats/adapter-registry.mjs";
import { BrowserManager } from "../src/automation/browser/browser-manager.mjs";
import { FinalRevalidatorRouter } from "../src/application/final-revalidator-router.mjs";
import { GreenhouseFinalRevalidator } from "../src/application/greenhouse-final-revalidator.mjs";
import { LeverFinalRevalidator } from "../src/application/lever-final-revalidator.mjs";
import { AshbyFinalRevalidator } from "../src/application/ashby-final-revalidator.mjs";
import { SmartRecruitersFinalRevalidator } from "../src/application/smartrecruiters-final-revalidator.mjs";
import { WorkableFinalRevalidator } from "../src/application/workable-final-revalidator.mjs";
import { NerdinFinalRevalidator } from "../src/application/nerdin-final-revalidator.mjs";
import { TeamtailorFinalRevalidator } from "../src/application/teamtailor-final-revalidator.mjs";
import { SubmissionPreflight } from "../src/application/submission-preflight.mjs";
import { SubmissionConsentService } from "../src/application/submission-consent-service.mjs";
import { ControlledSubmissionService } from "../src/application/controlled-submission-service.mjs";
import { AdapterSubmissionTransport } from "../src/application/submission-transport.mjs";
import { assertScopedSubmitAuthorization } from "../src/application/scoped-submit-authorization.mjs";
import { EvolutionClient } from "../src/integrations/evolution/evolution-client.mjs";

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
const applicationId = option("application"), resumeVersionId = option("resume-version"), confirmation = option("confirm");
const execute = args.includes("--submit");
if (!applicationId || !resumeVersionId || (execute && confirmation !== applicationId))
  throw new Error("Use --application=ID --resume-version=ID; envio exige --submit --confirm=ID.");
const dataDir = path.resolve(option("data") || "data");
let store, browserManager;
const report = { applicationId, resumeVersionId, startedAt: new Date().toISOString(), mode: execute ? "SCOPED_EXTERNAL_SUBMIT" : "FINAL_PREFLIGHT", actionTriggered: false };
try {
  // The normal owner lease must be available. Never run beside an active server writer.
  store = await new UnifiedStateStore({ dataDir }).initialize();
  const { application, request } = assertScopedSubmitAuthorization(store, { applicationId, resumeVersionId, confirmation: execute ? confirmation : applicationId });
  const registry = new AdapterRegistry();
  browserManager = new BrowserManager({ dataDir, headless: true, timeout: 15000 });
  const common = { store, dataDir, registry, browserManager };
  const types = { greenhouse: GreenhouseFinalRevalidator, lever: LeverFinalRevalidator, ashby: AshbyFinalRevalidator, smartrecruiters: SmartRecruitersFinalRevalidator, workable: WorkableFinalRevalidator, nerdin: NerdinFinalRevalidator, teamtailor: TeamtailorFinalRevalidator };
  const revalidator = new FinalRevalidatorRouter({ store, browserManager, revalidators: Object.fromEntries(Object.entries(types).map(([type, Type]) => [type, new Type(common)])) });
  const preflight = new SubmissionPreflight({ ...common, revalidator, policy: { submissionEnabled: execute } });
  const checked = await preflight.evaluate(applicationId, { fresh: true });
  report.provider = checked.adapterType;
  report.gates = checked.gates.map(({ id, status, message }) => ({ id, status, message }));
  report.status = checked.readyForConsent ? "READY_FOR_CONSENT" : "BLOCKED";
  if (execute && checked.readyForConsent) {
    await mkdir(path.join(dataDir, "backups"), { recursive: true });
    store.database.connection.prepare("VACUUM INTO ?").run(path.join(dataDir, "backups", `before-controlled-submit-${Date.now()}.sqlite`));
    const granted = new SubmissionConsentService({ store }).grant(applicationId, checked, { source: "WHATSAPP_APPROVAL", reference: request.id });
    const transport = new AdapterSubmissionTransport({ ...common, revalidator, allowExternal: true, allowLocalFixtures: false });
    const result = await new ControlledSubmissionService({ store, preflight, transport }).submit({ applicationId, consentToken: granted.token, idempotencyKey: `controlled-homologation:${applicationId}:${resumeVersionId}` });
    report.status = result.attempt.status;
    report.receiptId = result.receipt?.id || "";
    report.confirmation = result.receipt?.confirmationText || "";
    report.errorCode = result.attempt.errorCode || "";
    report.gates=store.submissionPreflights.latest(applicationId).gates.map(({id,status,message})=>({id,status,message}));
  }
  report.actionTriggered = store.applications.events(applicationId).some(event => event.eventType === "SUBMIT_ACTION_TRIGGERED");
  if (execute && process.env.CAREER_WHATSAPP_TARGET && process.env.EVOLUTION_INSTANCE_NAME) {
    const job = store.jobs.findById(application.jobId);
    const message = report.status === "SUBMITTED" ? `Candidatura enviada com confirmação\n${job.title} — ${job.company}\nPortal: ${report.provider}\nRecibo: ${report.receiptId}`
      : report.status === "UNCERTAIN" ? `Envio não confirmado\n${job.title} — ${job.company}\nO clique ocorreu, mas o portal não confirmou. Não vou repetir automaticamente. Confira: ${job.applicationUrl || job.url}`
      : `Envio controlado não concluído\n${job.title} — ${job.company}\n${(report.gates || []).filter(gate => gate.status !== "READY" && gate.id !== "CONSENT").map(gate => gate.message).join("\n")}\nConferir: ${job.applicationUrl || job.url}`;
    try { await new EvolutionClient().sendText(process.env.EVOLUTION_INSTANCE_NAME, process.env.CAREER_WHATSAPP_TARGET, message); report.notificationAccepted = true; }
    catch { report.notificationAccepted = false; }
  }
} catch (error) {
  report.status = "FAILED";
  report.errorCode = error.code || "CONTROLLED_HOMOLOGATION_FAILED";
  if(error.preflight)report.gates=error.preflight.gates.map(({id,status,message,details})=>({id,status,message,code:details?.code||""}));
  if (store && applicationId) report.actionTriggered = store.applications.events(applicationId).some(event => event.eventType === "SUBMIT_ACTION_TRIGGERED");
  if(execute&&store&&process.env.CAREER_WHATSAPP_TARGET&&process.env.EVOLUTION_INSTANCE_NAME){
    const application=store.applications.findById(applicationId),job=application&&store.jobs.findById(application.jobId);
    if(job){const explanation=(report.gates||[]).filter(gate=>gate.status==="BLOCKED").map(gate=>gate.message).join("\n")||"Uma conferência de segurança falhou; revise a candidatura no TSF antes de tentar novamente.";
      try{await new EvolutionClient().sendText(process.env.EVOLUTION_INSTANCE_NAME,process.env.CAREER_WHATSAPP_TARGET,`Envio controlado não confirmado\n${job.title} — ${job.company}\n${report.actionTriggered?"Já houve ação de envio; não vou repetir automaticamente.":"A tentativa parou antes do clique final."}\n${explanation}\nConferir no portal: ${job.applicationUrl||job.url}`);report.notificationAccepted=true;}catch{report.notificationAccepted=false;}}
  }
  process.exitCode = 1;
} finally {
  for (const session of browserManager?.activeSessions || []) await browserManager.close(session).catch(() => {});
  store?.close();
  report.finishedAt = new Date().toISOString();
  const output = path.join(dataDir, "operational-homologation");
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, `controlled-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
