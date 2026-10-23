import assert from "node:assert/strict";
import test from "node:test";
import { assertScopedSubmitAuthorization } from "../src/application/scoped-submit-authorization.mjs";

const input = { applicationId: "application-one", resumeVersionId: "version-one", confirmation: "application-one" };
function fixture({ status = "READY_TO_SUBMIT", version = "version-one", approved = true, attempt = null, receipt = null, latestId="request-one",revision=false } = {}) {
  return {
    applications: { findById: () => ({ id: "application-one",jobId:"job-one", status, resumeVersionId: version }), events: () => [{ eventType: "WHATSAPP_APPROVAL_MODE_SELECTED", metadata: { approvalMode: "AUTO_APPLY", resumeVersionId: version, approvalRequestId: "request-one" } },...(revision?[{eventType:"WHATSAPP_RESUME_REVISION_REQUESTED",metadata:{approvalRequestId:"request-one"}}]:[])] },
    whatsappProcesses:{requests:()=>[{id:latestId}]},
    whatsappApprovals: { findById: () => ({ id: "request-one", applicationId: "application-one", resumeVersionId: version, status: approved ? "APPROVED" : "DENIED" }) },
    submissionAttempts: { latest: () => attempt }, submissionReceipts: { latest: () => receipt },
  };
}
test("scoped submit exige confirmacao exata e aprovacao da versao", () => {
  assert.equal(assertScopedSubmitAuthorization(fixture(), input).request.id, "request-one");
  for (const store of [fixture({ approved: false }), fixture({ version: "old-version" }), fixture({ status: "WAITING_USER" })])
    assert.throws(() => assertScopedSubmitAuthorization(store, input));
  assert.throws(() => assertScopedSubmitAuthorization(fixture(), { ...input, confirmation: "application-other" }));
});
test("scoped submit bloqueia aprovacao substituida ou alteracao solicitada",()=>{
  for(const store of [fixture({latestId:"request-new"}),fixture({revision:true})])assert.throws(()=>assertScopedSubmitAuthorization(store,input),error=>error.code==="SCOPED_SUBMIT_REVIEW_REQUIRED");
});
test("scoped submit nao repete envio incerto, em andamento ou confirmado", () => {
  for (const status of ["UNCERTAIN", "SUBMITTING", "SUBMITTED"])
    assert.throws(() => assertScopedSubmitAuthorization(fixture({ attempt: { status } }), input), error => error.code === "SCOPED_SUBMIT_DUPLICATE_BLOCKED");
  assert.throws(() => assertScopedSubmitAuthorization(fixture({ receipt: { id: "receipt" } }), input));
});
