import { FORM_ENGINE_VERSION } from "../automation/ats/submit-homologation.mjs";
import { GupyApplicationAdapter } from "../automation/ats/gupy/gupy-application-adapter.mjs";

export const EXTERNAL_CONFIRMATIONS = Object.freeze(["PORTAL_APPLICATION_LIST", "CONFIRMATION_EMAIL", "RECRUITER_CONTACT"]);
const DAY_MS = 86400000;

// Transforma um envio real em evidencia local de homologacao. Exige recibo positivo ja gravado pelo
// Controlled Submit, inspecao da mesma versao de adapter feita antes do envio e confirmacao humana
// fora da pagina de envio (lista de candidaturas do portal, e-mail ou contato do recrutador).
// So o envio automatico (limiar de nota) depende disto; os demais gates continuam valendo a cada envio.
export class SubmitHomologationService {
  constructor({ store, registry, clock = () => new Date(), maxValidDays = 90 } = {}) {
    Object.assign(this, { store, registry, clock, maxValidDays });
  }

  error(code, message, status = 409) {
    return Object.assign(new Error(message), { code, status });
  }

  // O Gupy envia pelo Application Batch com o adapter V2; os demais portais pelo adapter do registry.
  adapterVersion(provider) {
    return provider === "gupy" ? GupyApplicationAdapter.version : this.registry.version(provider);
  }

  // Versao do adapter e cenario do formulario no momento do envio.
  submittedContext(applicationId, provider, observed) {
    if (provider === "gupy") {
      const draft = this.store.applicationBatches.forApplication(applicationId);
      if (!draft?.adapterVersion || !draft.flow || Date.parse(draft.readyAt) > observed) throw this.error("SUBMIT_HOMOLOGATION_INSPECTION_MISSING", "Não há rascunho Gupy pronto antes do envio.");
      return { adapterVersion: draft.adapterVersion, scenario: GupyApplicationAdapter.scenarioOf(draft) };
    }
    const inspection = this.store.applicationInspections.latest(applicationId);
    if (!inspection || String(inspection.adapterType).toLowerCase() !== provider || Date.parse(inspection.createdAt) > observed) throw this.error("SUBMIT_HOMOLOGATION_INSPECTION_MISSING", "Não há inspeção deste portal feita antes do envio.");
    return { adapterVersion: inspection.adapterVersion, scenario: inspection.detectedVariant };
  }

  approve(applicationId, { externalConfirmation = "", validDays = 30 } = {}) {
    if (!EXTERNAL_CONFIRMATIONS.includes(externalConfirmation)) throw this.error("SUBMIT_HOMOLOGATION_CONFIRMATION_REQUIRED", "Informe onde a candidatura foi confirmada fora da página de envio.", 400);
    const days = Number(validDays);
    if (!Number.isInteger(days) || days < 1 || days > this.maxValidDays) throw this.error("SUBMIT_HOMOLOGATION_VALIDITY_INVALID", `A validade precisa ficar entre 1 e ${this.maxValidDays} dias.`, 400);
    const receipt = this.store.submissionReceipts.latest(applicationId);
    if (!receipt) throw this.error("SUBMIT_HOMOLOGATION_RECEIPT_REQUIRED", "A candidatura ainda não tem recibo de envio confirmado.");
    const existing = this.store.submitHomologations.forReceipt(receipt.id);
    if (existing) return { homologation: existing, reused: true };
    if (this.store.submissionAttempts.findById(receipt.submissionAttemptId)?.status !== "SUBMITTED") throw this.error("SUBMIT_HOMOLOGATION_ATTEMPT_NOT_SUBMITTED", "O envio não terminou como confirmado.");
    const provider = String(receipt.provider || "").toLowerCase(), observed = Date.parse(receipt.submittedAt), now = this.clock();
    if (!Number.isFinite(observed) || observed > now.getTime()) throw this.error("SUBMIT_HOMOLOGATION_RECEIPT_INVALID", "A data do recibo é inválida.");
    const submitted = this.submittedContext(applicationId, provider, observed);
    if (!submitted.scenario) throw this.error("SUBMIT_HOMOLOGATION_SCENARIO_MISSING", "A inspeção não identificou o cenário do formulário.");
    if (submitted.adapterVersion !== this.adapterVersion(provider)) throw this.error("SUBMIT_HOMOLOGATION_ADAPTER_CHANGED", "O adapter mudou desde o envio; homologue com um envio feito pela versão atual.");
    const validUntil = new Date(observed + days * DAY_MS);
    if (validUntil <= now) throw this.error("SUBMIT_HOMOLOGATION_EXPIRED", "Esse envio é antigo demais para a validade pedida.");
    const homologation = this.store.submitHomologations.create({
      provider, adapterVersion: submitted.adapterVersion, formEngineVersion: FORM_ENGINE_VERSION, scenario: submitted.scenario,
      externalConfirmation, applicationId, submissionReceiptId: receipt.id, receiptHash: receipt.receiptHash,
      observedAt: new Date(observed).toISOString(), validUntil: validUntil.toISOString(), approvedAt: now.toISOString(),
    });
    this.store.applications.recordEvent(applicationId, "SUBMIT_HOMOLOGATION_APPROVED", { homologationId: homologation.id, provider, scenario: homologation.scenario, adapterVersion: homologation.adapterVersion, externalConfirmation, validUntil: homologation.validUntil });
    return { homologation, reused: false };
  }

  revoke(id, { reason = "" } = {}) {
    const current = this.store.submitHomologations.findById(id);
    if (!current) throw this.error("SUBMIT_HOMOLOGATION_NOT_FOUND", "Homologação não encontrada.", 404);
    if (current.status !== "APPROVED") return current;
    const revoked = this.store.submitHomologations.revoke(id, { reason, at: this.clock().toISOString() });
    if (current.applicationId) this.store.applications.recordEvent(current.applicationId, "SUBMIT_HOMOLOGATION_REVOKED", { homologationId: id, reason: revoked.revokeReason });
    return revoked;
  }

  // `active` repete a regra de submitHomologation() para a interface mostrar o que de fato libera envio.
  list({ provider = "" } = {}) {
    const now = this.clock().getTime();
    return this.store.submitHomologations.list({ provider: String(provider).toLowerCase() }).map((item) => ({
      ...item,
      active: item.status === "APPROVED" && Date.parse(item.validUntil) > now && item.formEngineVersion === FORM_ENGINE_VERSION && item.adapterVersion === this.adapterVersion(item.provider),
    }));
  }
}
