export const SUCCESS_TEXT = /(?:your )?application (?:has been |was |is )?(?:successfully )?(?:received|submitted|sent)|we (?:have )?received your application|thank you for (?:your application|applying)|successfully applied|candidatura (?:foi )?(?:enviada|recebida|realizada)(?: com sucesso)?|inscri[cç][aã]o (?:foi )?(?:enviada|recebida)|obrigado por se candidatar/i;
export const FAILURE_TEXT = /\b(?:not|cannot|failed|failure|error|unsuccessful|n[aã]o|erro|falha|imposs[ií]vel)\b/i;

async function visibleConfirmations(page) {
  const matches = page.getByText(SUCCESS_TEXT), counts = new Map();
  for (let index = 0; index < await matches.count(); index++) {
    const element = matches.nth(index);
    if (!await element.isVisible().catch(() => false)) continue;
    const text = String(await element.textContent().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 500);
    if (text && !FAILURE_TEXT.test(text)) counts.set(text, (counts.get(text) || 0) + 1);
  }
  return counts;
}

export async function captureSubmissionConfirmation(page) {
  return { origin: new URL(page.url()).origin, visible: await visibleConfirmations(page) };
}

export async function waitForSubmissionConfirmation(page, { baseline, provider, timeoutMs = 10000 } = {}) {
  const deadline = Date.now() + Math.max(1, Math.min(30000, Number(timeoutMs) || 10000));
  while (true) {
    // A changed URL alone can also mean login, validation errors or another form step.
    if (new URL(page.url()).origin === baseline.origin) {
      const current = await visibleConfirmations(page);
      for (const [text, count] of current) {
        if (count > (baseline.visible.get(text) || 0)) return {
          status: "SUBMITTED",
          receipt: {
            confirmationUrl: page.url(), confirmationText: text,
            metadata: { confirmationKind: "NEW_VISIBLE_SUCCESS_TEXT", verificationMethod: "POST_ACTION_DOM_V1", providerStatus: "SUBMITTED" },
          },
        };
      }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(200, remaining));
  }
  return { status: "UNCERTAIN", errorCode: `${String(provider).toUpperCase()}_CONFIRMATION_NOT_OBSERVED` };
}
