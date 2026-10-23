import test from 'node:test';
import assert from 'node:assert/strict';
import {radarOptions,mobileSearchInput,applicationRecovery,MOBILE_SEARCH_PROFILE} from '../server/mobile/mobile-radar.mjs';
import {projectHunt,mobileApplicationActions} from '../server/mobile/mobile-projections.mjs';

const input={queries:['DevOps','Linux'],locations:['Brasília, DF'],workModels:['REMOTE','HYBRID'],seniorities:['JUNIOR'],sourcePreferences:['gupy','indeed','nerdin'],prepareResume:true};
test('mobile offers resume, not a reused approval, for interrupted work and never resubmits uncertain or running applications',()=>{
  for(const status of ['FAILED','RETRYABLE','WAITING_USER'])assert.equal(mobileApplicationActions(status).includes('RESUME'),true);
  for(const status of ['SUBMITTED','SUBMISSION_UNCERTAIN','SUBMITTING','FILLING'])assert.deepEqual(mobileApplicationActions(status),['ANALYZE']);
});
test('mobile manual search preserves canonical policy but never activates schedules or inherits old families',()=>{
  const result=mobileSearchInput({...input,enabled:true,endpoint:'http://127.0.0.1'}, {jobFamilies:['SUPPORT'],considerThreshold:60,prepareResumeThreshold:70,notifyThreshold:80,enabled:true});
  assert.equal(result.enabled,false);assert.deepEqual(result.jobFamilies,[]);assert.equal(result.endpoint,undefined);
  assert.equal(result.considerThreshold,60);assert.deepEqual(result.queries,['DevOps','Linux']);assert.equal(result.locationPolicy.priorities.length,2);
  for(const bad of [{...input,sourcePreferences:['internal']},{...input,queries:[]},{...input,queries:['a'.repeat(121)]},{...input,locations:[]},{...input,prepareResume:'true'}])assert.throws(()=>mobileSearchInput(bad),e=>e.status===400);
});
test('radar projects public discovery separately from vault authentication and does not leak sessions',()=>{
  const options=radarOptions([{id:MOBILE_SEARCH_PROFILE,queries:['Java'],sourcePreferences:['gupy']}],[{providerId:'gupy',displayName:'Gupy',sessionManaged:true,canDiscover:true,authentication:'SESSION_EXPIRED',session:{cookie:'secret'}},{providerId:'catho',displayName:'Catho',sessionManaged:true,canDiscover:false}]);
  assert.deepEqual(options.search.queries,['Java']);assert.equal(options.sources.find(s=>s.id==='gupy').canDiscover,true);
  assert.equal(options.vaults.find(s=>s.id==='catho').canDiscover,false);assert.equal(JSON.stringify(options).includes('secret'),false);
});
test('jobspy source outcomes are grouped per portal rather than pretending all portals succeeded',()=>{
  const hunt=projectHunt({id:'run',report:{sourceReports:[{provider:'jobspy',sites:[{site:'indeed',status:'SUCCESS',acceptedResults:4},{site:'indeed',status:'TIMED_OUT',errorCode:'TIMEOUT',acceptedResults:0},{site:'linkedin',status:'NO_RESULTS',acceptedResults:0}]},{provider:'gupy',called:false,status:'BUDGET_SKIPPED',requestCount:0}]}});
  assert.equal(hunt.sources.find(s=>s.id==='indeed').found,4);assert.equal(hunt.sources.find(s=>s.id==='indeed').status,'PARTIAL');
  assert.equal(hunt.sources.find(s=>s.id==='linkedin').consulted,true);assert.equal(hunt.sources.find(s=>s.id==='gupy').consulted,false);
});
test('mobile recovery reports evidence, not an invented saved browser or stale resume upload',()=>{
  const recovery=applicationRecovery({applications:{findById:()=>({resumeVersionId:'new'}),events:()=>[{eventType:'FORM_FILL_STARTED'},{eventType:'FIELD_AUDIT',metadata:{field:'PHONE',status:'FAILED'}},{eventType:'FORM_FILL_STARTED'},{eventType:'FIELD_AUDIT',metadata:{field:'NAME',status:'FILLED'}}]},applicationInspections:{latest:()=>({fieldsFound:5})},resumeUploadAudits:{forApplication:()=>[{resumeVersionId:'old',status:'UPLOADED'}]}},'app');
  assert.equal(recovery.filledFields,1);assert.equal(recovery.failedFields,0);assert.equal(recovery.resumeUploaded,false);assert.equal(recovery.browserContinuationAvailable,false);assert.equal(recovery.receiptConfirmed,false);
});
