import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const routes=await readFile(new URL("../server/routes/candidate-knowledge-routes.mjs",import.meta.url),"utf8"),knowledge=await readFile(new URL("../public/features/knowledge/page.js",import.meta.url),"utf8"),opportunities=await readFile(new URL("../public/features/opportunities/page.js",import.meta.url),"utf8"),guard=await readFile(new URL("../src/intelligence/validation/evidence-guard.mjs",import.meta.url),"utf8");
const capabilities=[
  ["inventory","/api/candidate-knowledge/inventory",knowledge],
  ["career entity create","/api/candidate-knowledge/entities",knowledge],
  ["entity detail","/api/candidate-knowledge/entities/",knowledge],
  ["enrichment","/api/candidate-knowledge/enrichment",knowledge],
  ["proposal review","/api/candidate-knowledge/proposals/",knowledge],
  ["skill detail","/api/candidate-knowledge/skills/",knowledge],
  ["gap resolution","/api/candidate-knowledge/gaps/",knowledge],
  ["opportunity gap deep link","/knowledge?section=reviews&gap=",opportunities],
];
for(const [name,contract,frontend] of capabilities)test(`parity: ${name}`,()=>{assert.ok(frontend.includes(contract),`${contract} sem consumidor frontend`);});
test("parity: toda capability principal possui loading, empty, error e feedback",()=>{for(const marker of ["loading-state","action-empty","role=\"alert\"","form-status","aria-live","toast("])assert.ok(knowledge.includes(marker),`estado ausente: ${marker}`);});
test("parity: claim validator é internal consumer do EvidenceGuard",()=>{assert.ok(routes.includes("claims/validate"));assert.ok(guard.includes("class EvidenceGuard"));});
