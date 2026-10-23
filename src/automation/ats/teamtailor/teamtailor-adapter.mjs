import { HostedAtsAdapter } from "../hosted/hosted-ats-adapter.mjs";
import { captureSubmissionConfirmation, waitForSubmissionConfirmation } from "../../submission-confirmation.mjs";
import { buildDomSignature } from "../greenhouse/dom-signature.mjs";
import { assessAdapterHealth } from "../greenhouse/adapter-health.mjs";

const APPLICATION_FORM = "form[action*='/applications']";

export class TeamtailorAdapter extends HostedAtsAdapter {
  static type = "teamtailor";
  static version = "teamtailor-adapter-v1";

  constructor() {
    super(TeamtailorAdapter.type, TeamtailorAdapter.version);
  }

  async exposeForm(page) {
    if (await page.locator(`${APPLICATION_FORM} input:not([type=hidden]), ${APPLICATION_FORM} textarea, ${APPLICATION_FORM} select`).count()) return;
    const reject=page.getByRole("button",{name:/decline all non-necessary cookies|rejeitar.*cookies/i});
    if(await reject.count()&&await reject.first().isVisible().catch(()=>false))await reject.first().click();
    const triggers = page.getByRole("button", { name: /apply|candidat(?:ar|a-se|e-se)|inscreva-se/i })
      .or(page.getByRole("link", { name: /apply|candidat(?:ar|a-se|e-se)|inscreva-se/i }));
    await triggers.first().waitFor({state:"visible",timeout:5000}).catch(()=>{});
    for (let index = 0; index < await triggers.count(); index++) {
      const trigger = triggers.nth(index);
      if (!await trigger.isVisible().catch(() => false)) continue;
      await trigger.click();
      break;
    }
    await page.locator(`${APPLICATION_FORM} input:not([type=hidden]), ${APPLICATION_FORM} textarea, ${APPLICATION_FORM} select`)
      .first().waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});
  }

  async inspectApplicationForm(page, context) {
    await this.exposeForm(page);
    const inspected = await super.inspectApplicationForm(page, context), fields = inspected.fields
      .filter((field) => /^candidate(?:_|\[)/i.test(field.externalKey))
      .map((field) => {
        const required = !field.hidden && (field.required || /\*|\brequired\b|obrigat[oó]ri[oa]/i.test(field.label));
        const resumeField = field.type === "file" && field.externalKey === "candidate_resume_remote_url";
        const semanticKey = resumeField ? "RESUME.FILE" : field.semanticKey;
        const confidence = resumeField ? 0.99 : field.semanticKey === "CUSTOM.QUESTION" && field.label ? Math.max(field.confidence, 0.7) : field.confidence;
        return { ...field, semanticKey, required, confidence, answerStatus: required ? "USER_REQUIRED" : field.answerStatus };
      }), unknownRequired = fields.filter((field) => field.required && field.confidence < 0.7),
      materialFields = fields.filter((field) => !field.hidden || field.required),
      hasApplicationIdentity = fields.some((field) => /^(IDENTITY\.|CONTACT\.EMAIL$|RESUME\.FILE$)/.test(field.semanticKey || "")),
      unsupportedSignals = fields.length ? unknownRequired.map((field) => `UNKNOWN_REQUIRED:${field.externalKey}`) : ["NO_FORM_FIELDS"];
    if (fields.length && !hasApplicationIdentity) unsupportedSignals.push("NO_APPLICATION_IDENTITY_FIELDS");
    const health = assessAdapterHealth({ fields, warnings: [], unsupportedSignals }), schema = {
      ...inspected.schema,
      fields,
      warnings: unknownRequired.map((field) => ({ code: "UNKNOWN_REQUIRED_QUESTION", field: field.label })),
      domSignature: buildDomSignature(materialFields, [this.type]),
      ...health,
    };
    return { ...inspected, fields, schema };
  }

  async findSubmitBoundary(page, {requireEnabled=true} = {}) {
    const candidates = page.locator(`${APPLICATION_FORM} button[type='submit'], ${APPLICATION_FORM} input[type='submit']`), matching = [];
    for (let index = 0; index < await candidates.count(); index++) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false) || requireEnabled && await candidate.isDisabled().catch(() => true)) continue;
      const label = String(await candidate.getAttribute("value") || await candidate.textContent() || "").trim();
      if (/submit application|send application|apply for this job|enviar candidatura|enviar inscri[cç][aã]o|finalizar candidatura/i.test(label)) matching.push(candidate);
    }
    if (matching.length !== 1)
      throw Object.assign(new Error(matching.length ? "Boundary final Teamtailor ambígua." : "Boundary final Teamtailor não encontrada."), {
        code: matching.length ? "TEAMTAILOR_SUBMIT_BOUNDARY_AMBIGUOUS" : "TEAMTAILOR_SUBMIT_BOUNDARY_MISSING",
        phase: "PRE_ACTION",
      });
    return matching[0];
  }

  async submit(page, { onActionTriggered = async () => {}, confirmationTimeoutMs = 10000 } = {}) {
    const boundary = await this.findSubmitBoundary(page), baseline = await captureSubmissionConfirmation(page);
    await onActionTriggered();
    try {
      await boundary.click();
    } catch (error) {
      throw Object.assign(new Error("Falha ao acionar o boundary final Teamtailor."), { code: "TEAMTAILOR_SUBMIT_CLICK_FAILED", phase: "POST_ACTION", cause: error });
    }
    return waitForSubmissionConfirmation(page, { baseline, provider: this.type, timeoutMs: confirmationTimeoutMs });
  }
}
