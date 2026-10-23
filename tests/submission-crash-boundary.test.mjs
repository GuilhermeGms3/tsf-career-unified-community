import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { UnifiedStateStore } from "../server/unified-state-store.mjs";
import { ControlledSubmissionService } from "../src/application/controlled-submission-service.mjs";
import { SubmissionConsentService } from "../src/application/submission-consent-service.mjs";
import { SubmissionReconciliationService } from "../src/application/submission-reconciliation-service.mjs";

async function fixture(handler) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "submit-crash-"));
  let store = await new UnifiedStateStore({ dataDir }).initialize();
  const at = new Date().toISOString();
  store.jobs.upsert({ id: "job", title: "Synthetic job", company: "Fixture", url: "https://example.test/jobs/1", createdAt: at, updatedAt: at });
  store.resumes.upsert({ id: "resume", title: "Synthetic resume", text: "Test", createdAt: at, updatedAt: at });
  store.applications.create({ id: "application", jobId: "job", resumeId: "resume", status: "READY_TO_SUBMIT", createdAt: at, updatedAt: at }, {}, { allowHistorical: true });
  store.resumeVersions.create({ id: "version", resumeId: "resume", jobId: "job", applicationId: "application", templateId: "ATS_STRICT", templateVersion: "ats-strict-v1", language: "en", status: "READY", contentHash: "test", resumeSpec: {}, source: "USER", approvedAt: at });
  store.applications.updateDetails({ ...store.applications.findById("application"), resumeVersionId: "version" });
  const preview = { applicationId: "application", adapterType: "greenhouse", status: "REVIEW_REQUIRED", gates: [], snapshotHash: "snapshot", answerSnapshotHash: "answers", readyForConsent: true, readyForSubmit: true, fresh: true, freshUntil: new Date(Date.now() + 60000).toISOString(), version: "test" };
  preview.id = store.submissionPreflights.create(preview).id;
  const consent = new SubmissionConsentService({ store }).grant("application", preview);
  const transport = { submit: command => handler(command, store) };
  const service = new ControlledSubmissionService({ store, preflight: { evaluate: async () => preview }, transport });
  return { get store() { return store; }, service, consent, submit: key => service.submit({ applicationId: "application", consentToken: consent.token, idempotencyKey: key }),
    restart: async () => { store.close(); store = await new UnifiedStateStore({ dataDir }).initialize(); return store; },
    close: async () => { store.close(); await rm(dataDir, { recursive: true, force: true }); } };
}

const confirmed = () => ({ status: "SUBMITTED", receipt: { confirmationText: "Application received", confirmationUrl: "https://example.test/confirmation" } });

test("intent persisted before adapter action survives crash before callback", async () => {
  let actions = 0;
  const f = await fixture(async command => {
    await command.onActionArmed();
    actions++;
    throw Object.assign(new Error("crash without trigger callback"), { phase: "PRE_ACTION" });
  });
  try {
    const result = await f.submit("first");
    assert.equal(result.uncertain, true);
    const store = await f.restart();
    assert.equal(store.submissionAttempts.latest("application").status, "UNCERTAIN");
    assert.equal(store.applications.findById("application").status, "SUBMISSION_UNCERTAIN");
    assert.equal(actions, 1);
  } finally { await f.close(); }
});

test("duplicate action authorization callback cannot permit a second final action", async () => {
  let actions = 0;
  const f = await fixture(async command => {
    await command.onActionArmed();
    await command.onActionTriggered(); actions++;
    await command.onActionTriggered(); actions++;
    return confirmed();
  });
  try { const result = await f.submit("double"); assert.equal(actions, 1); assert.equal(result.uncertain, true); }
  finally { await f.close(); }
});

test("failed persistence of arm blocks adapter action", async () => {
  let actions = 0;
  const f = await fixture(async command => { await command.onActionArmed(); actions++; return confirmed(); });
  try {
    const record = f.store.applications.recordEvent.bind(f.store.applications);
    f.store.applications.recordEvent = (id, type, payload) => { if (type === "SUBMIT_ACTION_ARMED") throw new Error("induced write failure"); return record(id, type, payload); };
    await assert.rejects(f.submit("write-fails"), /induced write failure/);
    assert.equal(actions, 0);
    assert.equal(f.store.submissionAttempts.latest("application").phase, "PRE_ACTION");
  } finally { await f.close(); }
});

test("expired worker fencing is checked before arming an external action",async()=>{
  let clicks=0;const f=await fixture(async command=>{await command.onActionArmed();clicks++;return confirmed();});
  try{
    await assert.rejects(f.service.submit({applicationId:"application",consentToken:f.consent.token,idempotencyKey:"lost-worker",assertExecutionAllowed:()=>{throw Object.assign(new Error("Lease lost"),{code:"AUTOAPPLY_LEASE_LOST"});}}),e=>e.code==="AUTOAPPLY_LEASE_LOST");
    assert.equal(clicks,0);assert.equal(f.store.submissionAttempts.latest("application").phase,"PRE_ACTION");
  }finally{await f.close();}
});

test("receipt and application confirmation roll back together on write failure", async () => {
  const f = await fixture(async command => { await command.onActionArmed(); await command.onActionTriggered(); return confirmed(); });
  try {
    const record = f.store.applications.recordEvent.bind(f.store.applications);
    f.store.applications.recordEvent = (id, type, payload) => { if (type === "RECEIPT_CAPTURED") throw new Error("induced receipt event failure"); return record(id, type, payload); };
    const result = await f.submit("receipt-fails");
    assert.equal(result.uncertain, true);
    assert.equal(f.store.submissionReceipts.latest("application"), null);
    assert.equal(f.store.applications.findById("application").status, "SUBMISSION_UNCERTAIN");
  } finally { await f.close(); }
});

test("empty transport receipt cannot establish external confirmation", async () => {
  const f = await fixture(async command => { await command.onActionArmed(); await command.onActionTriggered(); return { status: "SUBMITTED", receipt: {} }; });
  try { assert.equal((await f.submit("empty")).uncertain, true); assert.equal(f.store.submissionReceipts.latest("application"), null); }
  finally { await f.close(); }
});

test("provider reconciliation without positive evidence cannot invent a manual receipt",async()=>{
  const f=await fixture(async command=>{await command.onActionArmed();return {status:"UNCERTAIN"};});
  try{
    await f.submit("uncertain-reconcile");
    const service=new SubmissionReconciliationService({store:f.store,transport:{verify:async()=>({status:"SUBMITTED",receipt:{}})}});
    await assert.rejects(service.verify("application"),e=>e.code==="RECEIPT_CONFIRMATION_REQUIRED");
    assert.equal(f.store.submissionReceipts.latest("application"),null);
    assert.equal(f.store.applications.findById("application").status,"SUBMISSION_UNCERTAIN");
  }finally{await f.close();}
});

test("application status cannot hide potential delivery as a retryable failure or cancellation",async()=>{
  const f=await fixture(async (command,store)=>{
    await command.onActionArmed();
    assert.throws(()=>store.applicationService.transitionApplication("application","FAILED"),e=>e.code==="SUBMISSION_RECONCILIATION_REQUIRED");
    return {status:"UNCERTAIN"};
  });
  try{
    assert.equal((await f.submit("guard-status")).uncertain,true);
    assert.throws(()=>f.store.applicationService.transitionApplication("application","CANCELLED"),e=>e.code==="SUBMISSION_RECONCILIATION_REQUIRED");
    assert.equal(f.store.applications.findById("application").status,"SUBMISSION_UNCERTAIN");
  }finally{await f.close();}
});

for (const phase of ["PRE_ACTION", "ACTION_TRIGGERED"]) {
  test(`startup recovers persisted ${phase} without trusting an adapter callback`, async () => {
    const f = await fixture(async () => { throw new Error("Must not execute transport during recovery"); });
    try {
      const consent = f.consent.consent;
      const { attempt } = f.store.submissionAttempts.begin({ applicationId: "application", consentId: consent.id, preflightId: consent.preflightId, idempotencyKey: "interrupted", adapterType: "greenhouse" });
      f.store.submissionAttempts.transition(attempt.id, "SUBMITTING", { phase });
      f.store.applicationService.transitionApplication("application", "SUBMITTING");
      const reopened = await f.restart();
      assert.equal(reopened.submissionAttempts.latest("application").status, phase === "PRE_ACTION" ? "FAILED" : "UNCERTAIN");
      assert.equal(reopened.applications.findById("application").status, phase === "PRE_ACTION" ? "FAILED" : "SUBMISSION_UNCERTAIN");
    } finally { await f.close(); }
  });
}

test("startup repairs historical receipt persisted before application confirmation", async () => {
  const f = await fixture(async () => { throw new Error("No external action"); });
  try {
    const consent = f.consent.consent;
    const { attempt } = f.store.submissionAttempts.begin({ applicationId: "application", consentId: consent.id, preflightId: consent.preflightId, idempotencyKey: "receipt-interrupted", adapterType: "greenhouse" });
    f.store.submissionAttempts.transition(attempt.id, "SUBMITTING", { phase: "ACTION_TRIGGERED" });
    f.store.applicationService.transitionApplication("application", "SUBMITTING");
    f.store.submissionReceipts.create({ applicationId: "application", submissionAttemptId: attempt.id, provider: "greenhouse", confirmationText: "Application received", submittedAt: new Date().toISOString(), receiptHash: "test", resumeVersionId: "version", answerSnapshotHash: "answers" });
    const reopened = await f.restart();
    assert.equal(reopened.applications.findById("application").status, "SUBMITTED");
    assert.equal(reopened.submissionAttempts.latest("application").status, "SUBMITTED");
    assert.ok(reopened.submissionReceipts.latest("application"));
  } finally { await f.close(); }
});

test("post-arm failure cannot be relabeled retryable by a repository caller", async () => {
  const f = await fixture(async command => { await command.onActionArmed(); throw new Error("Interrupted"); });
  try {
    const result = await f.submit("uncertain");
    assert.throws(() => f.store.submissionAttempts.transition(result.attempt.id, "FAILED", { phase: "PRE_ACTION" }), error => error.code === "INVALID_SUBMISSION_TRANSITION");
    assert.equal(f.store.submissionAttempts.latest("application").status, "UNCERTAIN");
  } finally { await f.close(); }
});
