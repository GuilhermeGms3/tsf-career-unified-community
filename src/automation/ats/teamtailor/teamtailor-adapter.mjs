import { HostedAtsAdapter } from "../hosted/hosted-ats-adapter.mjs";
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
    const triggers = page.getByRole("button", { name: /apply|candidatar|inscreva-se/i })
      .or(page.getByRole("link", { name: /apply|candidatar|inscreva-se/i }));
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
        const required = !field.hidden && (field.required || /(?:\*|\b)required\b/i.test(field.label));
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

  async findSubmitBoundary(page) {
    const candidates = page.locator(`${APPLICATION_FORM} button[type='submit'], ${APPLICATION_FORM} input[type='submit']`), matching = [];
    for (let index = 0; index < await candidates.count(); index++) {
      const candidate = candidates.nth(index);
      if (!await candidate.isVisible().catch(() => false) || await candidate.isDisabled().catch(() => true)) continue;
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
    const boundary = await this.findSubmitBoundary(page), beforeUrl = page.url();
    await onActionTriggered();
    try {
      await boundary.click();
    } catch (error) {
      throw Object.assign(new Error("Falha ao acionar o boundary final Teamtailor."), { code: "TEAMTAILOR_SUBMIT_CLICK_FAILED", phase: "POST_ACTION", cause: error });
    }
    const success = page.getByText(/application (has been )?(received|submitted)|thank you for (your application|applying)|successfully applied|candidatura (foi )?enviada|inscri[cç][aã]o (foi )?enviada/i).first();
    let confirmationKind = "";
    try {
      await Promise.race([
        success.waitFor({ state: "visible", timeout: confirmationTimeoutMs }).then(() => { confirmationKind = "SUCCESS_TEXT"; }),
        page.waitForURL((url) => url.href !== beforeUrl && /(thank|confirm|application|submitted|success)/i.test(url.pathname + url.search), { timeout: confirmationTimeoutMs }).then(() => { confirmationKind = "CONFIRMATION_URL"; }),
      ]);
    } catch {}
    if (!confirmationKind) return { status: "UNCERTAIN", errorCode: "TEAMTAILOR_CONFIRMATION_NOT_OBSERVED" };
    const confirmationText = await success.textContent().catch(() => "");
    return {
      status: "SUBMITTED",
      receipt: {
        confirmationUrl: page.url(),
        confirmationText: confirmationText || "Teamtailor application confirmation observed",
        metadata: { confirmationKind, providerStatus: "SUBMITTED" },
      },
    };
  }
}
