import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { assertResumeAttached } from "../src/application/resume-upload-verification.mjs";

test("o clique final exige exatamente o PDF selecionado no formulário", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "resume-upload-verification-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<form><input type="file"><button type="submit">Enviar</button></form>');
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const selected = Buffer.from("%PDF-1.4 selected"), other = Buffer.from("%PDF-1.4 other");
    const expectedHash = createHash("sha256").update(selected).digest("hex");
    const selectedPath = path.join(directory, "selected", "resume.pdf");
    const otherPath = path.join(directory, "other", "resume.pdf");
    await mkdir(path.dirname(selectedPath), { recursive: true });
    await mkdir(path.dirname(otherPath), { recursive: true });
    await writeFile(selectedPath, selected);
    await writeFile(otherPath, other);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/apply`);
    const fields = [{ semanticKey: "RESUME.FILE", type: "file", selector: 'input[type="file"]' }];
    await assert.rejects(assertResumeAttached(page, expectedHash, fields), { code: "RESUME_UPLOAD_NOT_CONFIRMED" });
    await page.locator('input[type="file"]').setInputFiles(otherPath);
    await assert.rejects(assertResumeAttached(page, expectedHash, fields), { code: "RESUME_UPLOAD_NOT_CONFIRMED" });
    await page.locator('input[type="file"]').setInputFiles(selectedPath);
    await assert.rejects(assertResumeAttached(page, expectedHash, []), { code: "RESUME_UPLOAD_NOT_CONFIRMED" });
    await assert.doesNotReject(assertResumeAttached(page, expectedHash, fields));
  } finally {
    await browser?.close();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
