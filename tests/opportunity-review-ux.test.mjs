import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("vacancy review exposes meaningful requirements and canonical decisions", async () => {
  const page = await read("public/features/opportunities/page.js");

  assert.match(page, /requirement\.normalizedName/);
  assert.match(page, /requirement\.originalText/);
  assert.match(page, /data-opportunity-decision="APPLY"/);
  assert.match(page, /data-opportunity-decision="REVIEW"/);
  assert.match(page, /recordDecision\("REJECT", reason/);
  assert.match(page, /JSON\.stringify\(\{ userDecision, rejectionReason \}\)/);
});

test("vacancy cards are linkable as a whole and keep modified-click behavior", async () => {
  const [page, router, features] = await Promise.all([
    read("public/features/opportunities/page.js"),
    read("public/app/router.js"),
    read("public/styles/features.css"),
  ]);

  assert.match(page, /class="opportunity-card-hit-area" data-link href=/);
  assert.match(router, /event\.ctrlKey/);
  assert.match(router, /event\.metaKey/);
  assert.match(features, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(features, /\.opportunity-card-hit-area\s*\{/);
});

test("vacancy workspace exposes the main workflows without extra clicks", async () => {
  const [page, styles] = await Promise.all([
    read("public/features/opportunities/page.js"),
    read("public/styles/opportunity-workspace.css"),
  ]);

  assert.match(page, /<details open id="opportunity-analysis"/);
  assert.match(page, /<details open id="opportunity-resume"/);
  assert.match(page, /<details open id="opportunity-application"/);
  assert.match(page, /section instanceof HTMLDetailsElement/);
  assert.match(styles, /\.opportunity-overview-grid\s*\{/);
  assert.match(styles, /\.workspace-collapsible\s*\{/);
});

test("vacancy decisions are visible and the selected resume follows the workspace request", async () => {
  const page = await read("public/features/opportunities/page.js");

  assert.match(page, /\["decisions", "Minhas decisões"\]/);
  assert.match(page, /career\.resumeChoice\.\$\{route\.id\}/);
  assert.match(page, /workspaceParams\.set\("resumeId", preferredResumeId\)/);
  assert.match(page, /data-decision-feedback/);
  assert.match(page, /APPLY: "Aplicaria"/);
  assert.match(page, /REVIEW: "Talvez aplicaria"/);
  assert.match(page, /REJECT: "Não aplicaria"/);
});
