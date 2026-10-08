export async function assertResumeAttached(page, expectedHash, fields = []) {
  if (!/^[a-f0-9]{64}$/i.test(String(expectedHash || ""))) {
    throw Object.assign(new Error("Hash do currículo não está disponível."), {
      code: "RESUME_UPLOAD_NOT_CONFIRMED",
      phase: "PRE_ACTION",
    });
  }
  for (const field of fields.filter((item) => item.semanticKey === "RESUME.FILE" && item.type === "file" && !item.hidden)) {
    const frame = page.frames().find((item) => item.url() === field.frameUrl) || page.mainFrame();
    const locator = field.selector ? frame.locator(field.selector) : frame.getByLabel(field.label, { exact: true });
    const hashes = await locator.evaluateAll(async (inputs) => {
      const files = inputs.flatMap((input) => [...(input.files || [])]);
      return Promise.all(files.map(async (file) => {
        const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      }));
    });
    if (hashes.some((hash) => hash.toLowerCase() === expectedHash.toLowerCase())) return;
  }
  throw Object.assign(new Error("O PDF selecionado não está anexado ao formulário."), {
    code: "RESUME_UPLOAD_NOT_CONFIRMED",
    phase: "PRE_ACTION",
  });
}
