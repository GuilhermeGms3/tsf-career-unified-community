export const FORM_ENGINE_VERSION = "universal-form-v3";
// Public installations must establish their own evidence, never inherit private receipts.
export const SUBMIT_EVIDENCE = Object.freeze([]);

export function submitHomologation(provider, adapterVersion, { scenario = "", now = Date.now(), records = SUBMIT_EVIDENCE } = {}) {
  const evidence = records.filter(record => record.provider === provider);
  const active = evidence.find(record => record.adapterVersion === adapterVersion && record.formEngineVersion === FORM_ENGINE_VERSION &&
    record.scenario === scenario && scenario && record.status === "APPROVED" &&
    record.result === "EXTERNALLY_CONFIRMED" && record.receiptReference && record.evidenceReference &&
    Number.isFinite(Date.parse(record.observedAt)) && Date.parse(record.observedAt) <= now &&
    Number.isFinite(Date.parse(record.validUntil)) && Date.parse(record.validUntil) > now);
  return {
    schemaVersion: 1, provider, adapterVersion, formEngineVersion: FORM_ENGINE_VERSION, scenario,
    status: active ? "APPROVED" : evidence.length ? "HISTORICAL_ONLY" : "NOT_VERIFIED",
    automaticSubmitEligible: Boolean(active), evidence: structuredClone(evidence),
  };
}
