import assert from "node:assert/strict";
import test from "node:test";
import { preferenceLearning } from "../src/opportunities/preference-learning.mjs";
test("preferências são leves, precisam de amostra e não viram bloqueio",()=>{
  const jobs=Array.from({length:5},(_,i)=>({id:String(i),title:"Analista de Infraestrutura"}));
  const feedback=jobs.map(job=>({jobId:job.id,userDecision:"REJECT",rejectionReason:"NOT_INTERESTED",updatedAt:new Date().toISOString()}));
  assert.equal(preferenceLearning(jobs,feedback.slice(0,2)).get("INFRASTRUCTURE").adjustment,0);
  const adjustment=preferenceLearning(jobs,feedback).get("INFRASTRUCTURE").adjustment;
  assert.ok(adjustment<0&&adjustment>=-3);
  assert.equal(preferenceLearning(jobs,feedback.map(item=>({...item,rejectionReason:"BAD_LOCATION"}))).size,0);
});
