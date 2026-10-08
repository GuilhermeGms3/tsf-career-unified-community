import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("Application V2 backend, frontend and migration expose the same controlled submission contract",async()=>{
  const [page,routes,migration,server]=await Promise.all([
    readFile("public/features/applications/page.js","utf8"),
    readFile("server/routes/application-v2-routes.mjs","utf8"),
    readFile("db/migrations/019_application_engine_v2.sql","utf8"),
    readFile("server.mjs","utf8")
  ]);
  for(const tab of ["preflight","review","questions","resume","attempts","timeline"])assert.match(page,new RegExp(`"${tab}"`));
  for(const action of ["preflight","consent","submit","verify","reconcile","session"])assert.match(routes,new RegExp(action));
  for(const gate of ["ELIGIBILITY","QUESTIONS","SENSITIVE_QUESTIONS","RESUME_ARTIFACT","DUPLICATE","JOB_OPEN","INSPECTION_FRESHNESS","ADAPTER_HEALTH","DOM_CONFIDENCE","SESSION_AND_CHALLENGE","RATE_LIMIT","KILL_SWITCH","CONSENT"])assert.match(page,new RegExp(gate));
  assert.match(page,/data-open-submit-consent/);
  assert.match(page,/data-submit-application/);
  assert.match(server,/AdapterSubmissionTransport/);
  assert.match(server,/SubmissionReconciliationService/);
  assert.match(server,/CAREER_SUBMISSION_ENABLED/);
  assert.doesNotMatch(migration,/password|cookie|session_token|consent_token\s+(?:TEXT|BLOB)|secret_value/i);
  assert.doesNotMatch(routes,/console\.log|consentToken.*recordEvent/i);
});
