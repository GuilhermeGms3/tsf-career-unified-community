import assert from "node:assert/strict";
import test from "node:test";
import { withTargetedResumeHeadline } from "../src/resume/resume-target-headline.mjs";

test("cabeçalho da vaga não conserva lista ampla da base nem inventa cargo", () => {
  const base = { candidate: { fullName: "Pessoa", headline: "Suporte técnico, Service Desk e infraestrutura", links: [{ url: "https://example.test" }] }, experiences: [{ title: "Suporte de TI" }] };
  const tailored = withTargetedResumeHeadline(base, { title: "Analista de Infraestrutura Júnior", description: "Atendimento Service Desk" });
  assert.equal(tailored.candidate.headline, "Infraestrutura de TI");
  assert.equal(base.candidate.headline, "Suporte técnico, Service Desk e infraestrutura");
  assert.deepEqual(tailored.experiences, base.experiences);
  assert.deepEqual(tailored.candidate.links, base.candidate.links);
  assert.doesNotMatch(tailored.candidate.headline, /Analista|Júnior|Service Desk/);
});

test("cabeçalho geral é preservado e família segue o título, não stacks da descrição", () => {
  const base = { candidate: { headline: "TI" } };
  assert.equal(withTargetedResumeHeadline(base, null), base);
  assert.equal(withTargetedResumeHeadline(base, { title: "Cargo não identificado" }), base);
  assert.equal(withTargetedResumeHeadline(base, { title: "Desenvolvedor Backend", description: "Redes e Azure" }).candidate.headline, "Desenvolvimento backend");
});
