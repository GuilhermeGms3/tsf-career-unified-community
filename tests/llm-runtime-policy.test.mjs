import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {approvedLlmEndpoint} from "../src/security/llm-endpoint-policy.mjs";
import {submissionRuntimeEnabled} from "../src/application/submission-runtime-policy.mjs";
import {OpenAICompatibleLocalProvider} from "../src/intelligence/providers/openai-compatible-local-provider.mjs";
import {selectQuestionModel} from "../src/automation/delayed-question-service.mjs";

test("modelo automatico exige Qwen3 4B 2507 unico, sem escolher versao parecida",()=>{
  const names=values=>values.map(name=>({name}));
  const target="qwen/qwen3-4b-instruct-2507";
  assert.equal(selectQuestionModel(names([target,"qwen/qwen3.5-4b-2507"])),target);
  assert.equal(selectQuestionModel(names(["qwen/qwen3.5-4b-2507"])),"");
  assert.equal(selectQuestionModel(names([target,"other/qwen3-4b-instruct-2507"])),"");
  assert.equal(selectQuestionModel(names([target]),"missing-model"),"");
  assert.equal(selectQuestionModel(names([target]),target),target);
});

test("LLM VPN exige origem exata; nao libera rede arbitraria, porta ou credenciais",()=>{
  const allowedOrigins="http://100.64.0.10:1234,https://pc.example.ts.net";
  assert.equal(approvedLlmEndpoint("http://100.64.0.10:1234/v1",{allowedOrigins}),"http://100.64.0.10:1234/v1");
  assert.equal(approvedLlmEndpoint("https://pc.example.ts.net/v1",{allowedOrigins}),"https://pc.example.ts.net/v1");
  for(const url of ["http://100.64.0.11:1234/v1","http://100.64.0.10:9000/v1","https://api.example.com/v1","http://169.254.169.254/","http://user:secret@100.64.0.10:1234/v1","http://100.64.0.10:1234/v1?token=x"])assert.throws(()=>approvedLlmEndpoint(url,{allowedOrigins}));
  assert.throws(()=>approvedLlmEndpoint("http://100.64.0.10:1234/v1",{allowedOrigins:""}));
});

test("runtime e capacidades exigem production e flag true exata",()=>{
  for(const NODE_ENV of [undefined,"test","development","production"])for(const CAREER_SUBMISSION_ENABLED of [undefined,"false","true","1","yes"])assert.equal(submissionRuntimeEnabled({NODE_ENV,CAREER_SUBMISSION_ENABLED}),NODE_ENV==="production"&&CAREER_SUBMISSION_ENABLED==="true");
});

test("timeout LM Studio inclui leitura do corpo e nao segue redirects",async()=>{
  const server=createServer((_req,res)=>{res.writeHead(200,{"content-type":"application/json"});res.flushHeaders();});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const provider=new OpenAICompatibleLocalProvider({baseUrl:`http://127.0.0.1:${server.address().port}/v1`,defaultModel:"fixture",timeoutMs:50});
    await assert.rejects(provider.generateStructured("fixture",{schema:{type:"object"}}),error=>error.code==="PROVIDER_TIMEOUT");
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  let redirect;
  const provider=new OpenAICompatibleLocalProvider({defaultModel:"fixture",fetchImpl:async(_url,options)=>{redirect=options.redirect;return {ok:true,json:async()=>({choices:[]})};}});
  await provider.generateStructured("fixture",{schema:{type:"object"}});assert.equal(redirect,"error");
});
