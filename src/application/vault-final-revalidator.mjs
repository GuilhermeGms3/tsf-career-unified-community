import { HostedFinalRevalidator } from "./hosted-final-revalidator.mjs";
import { formStructureHash } from "./form-structure-hash.mjs";
import { CandidateKnowledgeBase } from "./candidate-knowledge-base.mjs";
import { validateResumeArtifact } from "../automation/automation-validation.mjs";
import { detectChallenge, vaultLoginWall } from "../automation/challenge-detection.mjs";
import { portalSubmitProfile } from "../automation/ats/last-mile/portal-submit-profiles.mjs";
import { profileHostAllowed, vaultJobStatus } from "../automation/ats/last-mile/last-mile-engine.mjs";

const isHumanChallenge = (code) => /CAPTCHA|MFA|LOGIN|VERIFICATION|ANTI_BOT/.test(String(code || ""));
const pagePath = (value) => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return ""; } };
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, phase: "PRE_ACTION", ...extra });

// Revalidacao final generica dos Cofres (todos menos o Gupy, que usa o Application Batch). Abre a vaga
// com a sessao do Cofre (sem sessao nao ha envio), confirma na propria pagina que a vaga esta aberta e
// que voce ainda nao se candidatou, inspeciona a entrada ou o formulario logado e prepara a travessia:
// etapas reveladas depois da entrada sao preenchidas com as respostas ja confirmadas e cada clique e
// registrado na candidatura. Quem clica e o adapter (ultima milha progressiva), so com consentimento.
export class VaultFinalRevalidator extends HostedFinalRevalidator {
  constructor({ provider, onSessionRejected = null, assistant = null, ...options } = {}) {
    const profile = portalSubmitProfile(provider);
    if (!profile || provider === "gupy") throw new Error(`Cofre sem revalidação genérica: ${provider}`);
    const identity = (value) => ({ canonicalUrl: profileHostAllowed(profile, value) ? pagePath(value) : "" });
    const validateTarget = (value) => {
      if (!profileHostAllowed(profile, value)) throw fail(`${profile.codePrefix}_TARGET_NOT_OFFICIAL`, `A vaga não está num host oficial de ${profile.label}.`);
      return { url: value, identity: identity(value), localFixture: false };
    };
    super({ ...options, provider, metadataClient: { checkJob: async () => ({ status: "UNKNOWN" }) }, parseIdentity: identity, validateTarget });
    Object.assign(this, { profile, onSessionRejected, assistant });
  }

  // Tela de login com a sessao aplicada: sessao recusada pelo portal, o Cofre volta a pedir conexao.
  async challenge(page, applicationId, vaultSession) {
    const code = await detectChallenge(page) || (vaultSession && vaultLoginWall(page, this.provider) ? "LOGIN_REQUIRED" : "");
    if (code === "LOGIN_REQUIRED" && vaultSession) {
      this.store.applications.recordEvent(applicationId, "VAULT_SESSION_REJECTED", { provider: this.provider });
      await Promise.resolve().then(() => this.onSessionRejected?.(this.provider, { applicationId, reason: "PORTAL_LOGIN_REQUIRED" })).catch(() => {});
    }
    return code;
  }

  reusable() { return this.store.candidateAnswers?.reusable?.() || []; }
  knowledge() { return CandidateKnowledgeBase.fromFacts([...(this.store.candidateFacts?.active?.() || []), ...(this.store.candidateKnowledge?.applicationFacts?.() || [])], this.reusable()); }

  async inspect(applicationId, { keepSession = false } = {}) {
    const context = this.resolve(applicationId);
    let session;
    try {
      const resumed = this.browserManager.resume(applicationId), resumeAfterChallenge = Boolean(resumed && isHumanChallenge(resumed.sessionMeta?.reason));
      if (resumed) session = resumed;
      else {
        const storageState = await this.sessionStateProvider(this.provider, context.target.url);
        if (!storageState) throw fail("LOGIN_REQUIRED", `Conecte o Cofre ${this.profile.label} antes do envio.`, { vaultSessionMissing: true });
        session = await this.browserManager.open(applicationId, `${this.provider}-final-preflight-${Date.now()}`, { storageState });
      }
      if (!resumeAfterChallenge) await session.page.goto(context.target.url, { waitUntil: "domcontentloaded" });
      const challenge = await this.challenge(session.page, applicationId, true);
      if (challenge) throw Object.assign(new Error(`Verificação humana pendente em ${this.profile.label}.`), { code: challenge });
      const adapter = this.registry.get(this.provider), inspected = await adapter.inspectApplicationForm(session.page, { job: context.job, questions: this.store.applicationQuestions.forApplication(applicationId), sessionApplied: true });
      const boundary = await adapter.findSubmitBoundary(session.page).then(() => true).catch(() => false);
      const jobCheck = await vaultJobStatus(session.page, { openEvidence: boundary, clock: this.clock });
      const schema = inspected.schema, structureHash = formStructureHash(schema.fields), resumeField = schema.fields.some((field) => field.semanticKey === "RESUME.FILE" && !field.hidden);
      const report = { url: context.identity.canonicalUrl, ats: this.provider, adapterVersion: adapter.constructor.version, variant: schema.variant, fieldsFound: schema.fields.length, requiredFields: schema.fields.filter((field) => field.required).length, knownFields: 0, unknownFields: schema.fields.filter((field) => field.required).length, supported: schema.health !== "UNSUPPORTED", compatibilityConfidence: schema.compatibilityConfidence, warnings: schema.warnings || [], submissionBoundary: boundary, fresh: true, formStructureHash: structureHash, resumeSource: resumeField ? "UPLOAD" : "PORTAL_PROFILE", jobStatus: jobCheck.status };
      const inspection = this.store.applicationInspections.create({ applicationId, adapterType: this.provider, adapterVersion: adapter.constructor.version, detectedVariant: schema.variant, compatibilityConfidence: schema.compatibilityConfidence, health: schema.health, domSignature: schema.domSignature, unsupportedSignals: schema.unsupportedSignals, warnings: schema.warnings, report });
      const result = { context, jobCheck, inspection, adapter, inspected, schema, formStructureHash: structureHash, checkedAt: this.clock().toISOString(), session: keepSession ? session : null };
      if (!keepSession) { await this.browserManager.close(session); session = null; }
      return result;
    } catch (error) {
      if (session && isHumanChallenge(error.code) && !this.browserManager.headless) { await this.browserManager.hold(session, { status: error.code, adapterType: this.provider }).catch(() => this.browserManager.close(session).catch(() => {})); session = null; }
      if (session) await this.browserManager.close(session).catch(() => {});
      throw error;
    }
  }

  // Preenche a etapa atual com respostas ja confirmadas. Perguntas novas ficam salvas na candidatura para
  // voce responder; uma pergunta obrigatoria sem resposta para a travessia.
  async fillStep(applicationId, adapter, page, { selected, artifact }) {
    const questions = () => this.store.applicationQuestions.forApplication(applicationId);
    const inspected = await adapter.inspectApplicationForm(page, { questions: questions(), sessionApplied: true });
    if (!inspected.fields.length || inspected.schema.variant === "apply-entry") return { status: "FILLED" };
    if (inspected.schema.health === "UNSUPPORTED") return { status: "UNSUPPORTED" };
    const mapped = adapter.mapFields(inspected, this.knowledge(), questions(), this.reusable()).map((field) => field.semanticKey === "RESUME.FILE" && artifact ? { ...field, answer: artifact.id, answerStatus: "KNOWN", answerSource: "application_plan" } : field);
    this.store.applicationQuestions.sync(applicationId, mapped, { complete: false });
    if (mapped.some((field) => field.required && !field.hidden && field.answerStatus === "USER_REQUIRED")) return { status: "USER_REQUIRED" };
    const audit = await adapter.fill(page, mapped, { resumePath: selected?.path || "", resumeArtifact: artifact });
    if (audit.some((item) => item.status === "FAILED")) return { status: "FAILED" };
    return { status: (await adapter.validate(page, mapped)).valid ? "FILLED" : "INVALID" };
  }

  async prepareForSubmit(applicationId, { expectedPreflight } = {}) {
    const live = await this.inspect(applicationId, { keepSession: true });
    try {
      if (live.jobCheck.status === "ALREADY_APPLIED") throw fail(this.code("ALREADY_APPLIED"), `${this.profile.label} já mostra candidatura para esta vaga.`, { jobCheck: live.jobCheck });
      if (live.jobCheck.status !== "OPEN") throw fail(this.code("JOB_NOT_OPEN"), `A vaga ${this.profile.label} não está confirmada como aberta.`, { jobCheck: live.jobCheck });
      if (live.schema.health !== "HEALTHY" || Number(live.schema.compatibilityConfidence) < 0.8) throw fail(this.code("FRESH_INSPECTION_BLOCKED"), `Inspeção ${this.profile.label} fresca não está saudável.`);
      if (!live.inspection.report.submissionBoundary) throw fail(this.code("SUBMIT_BOUNDARY_MISSING"), `Entrada ou botão final de ${this.profile.label} ausente.`);
      if (expectedPreflight?.domSignature && expectedPreflight.domSignature !== live.schema.domSignature || expectedPreflight?.formStructureHash && expectedPreflight.formStructureHash !== live.formStructureHash) throw fail("PREVIEW_STALE", "Estrutura do formulário mudou depois da revisão final.");
      const version = live.context.application.resumeVersionId ? this.store.resumeVersions.findById(live.context.application.resumeVersionId) : null, artifact = version ? this.store.resumeArtifacts.latest(version.id, "PDF") : null;
      const selected = await validateResumeArtifact({ version, artifact, dataDir: this.dataDir });
      const filled = await this.fillStep(applicationId, live.adapter, live.session.page, { selected, artifact });
      if (filled.status !== "FILLED") throw fail(this.code(`FRESH_FILL_${filled.status}`), `Preenchimento fresco de ${this.profile.label} não ficou completo.`);
      const challenge = await detectChallenge(live.session.page);
      if (challenge) throw fail(challenge, `Desafio humano antes do envio em ${this.profile.label}.`);
      const onStep = async ({ kind, label, source = "RULE" }) => this.store.applications.recordEvent(applicationId, "SUBMIT_STEP", { provider: this.provider, kind, source, label: String(label || "").slice(0, 160) });
      const fillStep = (page) => this.fillStep(applicationId, live.adapter, page, { selected, artifact });
      // Sem campo de CV na pagina o portal envia o curriculo salvo na conta, nao o PDF da vaga.
      const resumeSource = live.inspection.report.resumeSource, mapped = resumeSource === "UPLOAD" ? live.adapter.mapFields(live.inspected, this.knowledge(), this.store.applicationQuestions.forApplication(applicationId), this.reusable()).map((field) => field.semanticKey === "RESUME.FILE" ? { ...field, answer: artifact?.id, answerStatus: "KNOWN" } : field) : [];
      return { ...live, mapped, validation: { valid: true }, selected, resumeSource, submitOptions: { fillStep, onStep, assistant: this.assistant } };
    } catch (error) {
      await this.browserManager.close(live.session).catch(() => {});
      throw error;
    }
  }
}

export const VAULT_REVALIDATOR_PROVIDERS = Object.freeze(["indeed", "solides", "recrutei", "iel", "infojobs", "catho", "vagas", "programathor", "geekhunter", "empregare"]);
