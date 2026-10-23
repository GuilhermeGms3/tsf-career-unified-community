import assert from "node:assert/strict";
import test from "node:test";
import { evaluateApplicationRoutingPolicy, resumeAtsScore } from "../src/application/application-routing-policy.mjs";
import { effectiveJobHuntThresholds } from "../src/automation/job-hunt-policy.mjs";

const policy={enabled:true,minimumAtsScore:80,whatsappMinimumAtsScore:60,whatsappMaximumAtsScore:79};
const gates={resumeApproved:true,factsVerified:true,questionsAnswered:true,sessionValid:true,portalCanSubmit:true,portalHomologated:true,submissionEnabled:true,noPriorSubmission:true};
for(const [score,route] of [[59,"PLATFORM_ANALYSIS"],[60,"WHATSAPP_REVIEW"],[79,"WHATSAPP_REVIEW"],[80,"AUTO_APPLY"]]){
  test(`all entry origins route score ${score} to ${route}`,()=>{
    for(const origin of ["MASS_HUNT","MANUAL_SEARCH","SCHEDULED_SEARCH","LINK","RESTART"]){
      const result=evaluateApplicationRoutingPolicy({score,policy,qualityApproved:true,eligibility:"ELIGIBLE",gates});
      assert.equal(result.route,route,origin);assert.equal(result.automaticSubmitAllowed,score>=80,origin);
    }
  });
}
for(const missing of Object.keys(gates))test(`score80 never authorizes submit when ${missing} is false or unknown`,()=>{
  for(const value of [false,undefined])assert.equal(evaluateApplicationRoutingPolicy({score:80,policy,qualityApproved:true,eligibility:"ELIGIBLE",gates:{...gates,[missing]:value}}).automaticSubmitAllowed,false);
});
test("quality, eligibility and standing authorization remain separate from score",()=>{
  assert.equal(evaluateApplicationRoutingPolicy({score:80,policy,qualityApproved:false,eligibility:"ELIGIBLE",gates}).automaticSubmitAllowed,false);
  assert.equal(evaluateApplicationRoutingPolicy({score:80,policy,qualityApproved:true,eligibility:"NOT_ELIGIBLE",gates}).route,"PLATFORM_ANALYSIS");
  assert.equal(evaluateApplicationRoutingPolicy({score:80,policy:{...policy,enabled:false},qualityApproved:true,eligibility:"ELIGIBLE",gates}).automaticSubmitAllowed,false);
});
test("custom thresholds remain explicit; no migration overwrites preferences",()=>{
  const custom={...policy,minimumAtsScore:90,whatsappMaximumAtsScore:89};
  assert.equal(evaluateApplicationRoutingPolicy({score:85,policy:custom,qualityApproved:true}).route,"WHATSAPP_REVIEW");
  assert.equal(custom.minimumAtsScore,90);
  assert.equal(effectiveJobHuntThresholds({considerThreshold:75,prepareResumeThreshold:82,notifyThreshold:95},custom).notify,60);
});
test("unknown score is not coerced to zero and invalid policy fails closed",()=>{
  for(const score of [null,undefined,"",NaN,-1,101])assert.equal(evaluateApplicationRoutingPolicy({score,policy,qualityApproved:true}).route,"PLATFORM_ANALYSIS");
  assert.equal(resumeAtsScore({atsAfter:{overallScore:0}}),0);
  assert.equal(resumeAtsScore({}),null);
  assert.equal(evaluateApplicationRoutingPolicy({score:99,policy:{...policy,minimumAtsScore:"invalid"},qualityApproved:true}).automaticSubmitAllowed,false);
});
