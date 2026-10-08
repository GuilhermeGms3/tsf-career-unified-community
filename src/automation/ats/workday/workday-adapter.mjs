import { HostedAtsAdapter } from "../hosted/hosted-ats-adapter.mjs";

const formFields =
  "form input:not([type=hidden]), form textarea, form select, [data-automation-id='applyFlowPage'] input:not([type=hidden]), [data-automation-id='applyFlowPage'] textarea, [data-automation-id='applyFlowPage'] select";

export class WorkdayAdapter extends HostedAtsAdapter {
  static type = "workday";
  static version = "workday-adapter-v1";

  constructor() {
    super("workday", WorkdayAdapter.version);
  }

  async exposeApplicationStep(page) {
    if (await page.locator(formFields).count()) return;
    const trigger = page
      .locator(
        "[data-automation-id='jobPostingApplyButton'], [data-automation-id='applyButton']",
      )
      .or(
        page
          .getByRole("button", { name: /apply|candidatar|inscreva-se/i })
          .or(page.getByRole("link", { name: /apply|candidatar|inscreva-se/i })),
      )
      .first();
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
    const requiresAuthentication =
      (await page.locator("input[type='password']").count()) > 0 ||
      (await page
        .getByText(/sign in|create account|entrar|criar conta/i)
        .count()) > 0;
    if (requiresAuthentication && !(await page.locator(formFields).count()))
      throw Object.assign(
        new Error("A candidatura Workday exige autenticação neste tenant."),
        { code: "WORKDAY_AUTH_REQUIRED" },
      );
  }

  async inspectApplicationForm(page, context) {
    await this.exposeApplicationStep(page);
    const inspected = await super.inspectApplicationForm(page, context);
    return {
      ...inspected,
      schema: {
        ...inspected.schema,
        variant: "workday-external-apply-step",
        warnings: [
          ...(inspected.schema?.warnings || []),
          { code: "WORKDAY_MULTI_STEP_REQUIRES_HANDOFF" },
        ],
      },
    };
  }

  async validate(page, mapped) {
    const validation = await super.validate(page, mapped);
    if (!validation.valid) return validation;
    const finalReview =
      (await page
        .locator(
          "[data-automation-id='reviewPage'], [data-automation-id='reviewSubmitPage']",
        )
        .count()) > 0;
    if (finalReview) return validation;
    return {
      valid: false,
      invalid: validation.invalid,
      unknown: [
        ...validation.unknown,
        {
          semanticKey: "WORKDAY.NEXT_STEP",
          label: "Continuar candidatura no Workday",
          required: true,
          answerStatus: "USER_REQUIRED",
        },
      ],
    };
  }
}
