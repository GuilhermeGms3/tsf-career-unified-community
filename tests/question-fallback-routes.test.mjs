import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {createAutopilotRoutes} from "../server/routes/autopilot-routes.mjs";

test("politica de perguntas usa contrato real, valida entrada e impede mutacao cross-origin",async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"question-policy-routes-"));
  const store=await new UnifiedStateStore({dataDir:dir}).initialize();
  t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  let body,response,error;
  const route=createAutopilotRoutes({store,jobHuntService:{},readJson:async()=>body,
    json:(_res,value)=>{response=value;},sendError:(_res,cause)=>{error=cause;}});
  const url=new URL("http://127.0.0.1:7123/api/auto-apply/question-fallback");
  const req={method:"PUT",headers:{host:url.host,origin:url.origin,"content-type":"application/json"},socket:{localPort:7123}};
  assert.equal(await route({...req,method:"GET"},{},url),true);
  assert.deepEqual(response.policy,{enabled:false,waitMinutes:20,autoFillEnabled:false,researchEnabled:false,model:""});
  body={enabled:true,waitMinutes:20,autoFillEnabled:true,model:"qwen3-4b-instruct-2507"};
  await route(req,{},url);
  assert.equal(error,undefined);assert.equal(response.policy.enabled,true);
  assert.equal(store.questionFallbackPolicy.get().model,body.model);
  body={waitMinutes:0};await route(req,{},url);
  assert.equal(error.code,"QUESTION_FALLBACK_POLICY_INVALID");
  assert.equal(store.questionFallbackPolicy.get().waitMinutes,20);
  error=null;body={enabled:false};
  await route({...req,headers:{...req.headers,origin:"https://untrusted.example"}},{},url);
  assert.equal(error.code,"SAME_ORIGIN_REQUIRED");assert.equal(store.questionFallbackPolicy.get().enabled,true);
  await route({...req,method:"GET"},{},new URL("/api/auto-apply/policy",url));
  assert.equal(response.questionFallbackPolicy.enabled,true);
});
