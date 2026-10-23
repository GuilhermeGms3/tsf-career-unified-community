import assert from "node:assert/strict";
import test from "node:test";
import { OpportunityAvailabilityService } from "../src/opportunities/opportunity-availability-service.mjs";

test("HTTP 200 com aviso Nerdin de candidaturas encerradas não é vaga disponível", async () => {
  let job = { id: "closed", url: "https://www.nerdin.com.br/vaga_emprego/vaga-99159.php", lifecycleStatus: "OPEN", lastSeenAt: "2026-10-01" };
  const service = new OpportunityAvailabilityService({
    store: { jobs: { findById: () => job, upsert: value => (job = value) } },
    client: { getText: async () => ({ data: "Agradecemos seu interesse! No momento, não estamos aceitando novas candidaturas para esta vaga, mas temos várias outras oportunidades esperando por você.", response: { status: 200 }, url: job.url }) },
  });
  const result = await service.verify(job.id);
  assert.equal(result.availability.status, "CLOSED");
  assert.equal(job.lifecycleStatus, "CLOSED");
  assert.equal(job.lastSeenAt, "2026-10-01");
  assert.ok(job.closedAt);
});
