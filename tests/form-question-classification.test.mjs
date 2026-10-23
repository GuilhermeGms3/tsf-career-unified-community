import assert from "node:assert/strict";
import test from "node:test";
import {classifyFormQuestions} from "../src/automation/classify-form-questions.mjs";

const fields=[{label:"Pergunta um",confidence:0,semanticKey:"CUSTOM.QUESTION",type:"text",fingerprint:"original"},{label:"Pergunta dois",confidence:0,semanticKey:"CUSTOM.QUESTION",type:"text"}];
test("LLM lenta nao bloqueia formulario e nao enfileira varias classificacoes apos timeout",async()=>{
  let calls=0;const start=Date.now(),result=await classifyFormQuestions(fields,{classify:()=>{calls++;return new Promise(()=>{});}},{ats:"iel",timeoutMs:20});
  assert.equal(result.timedOut,true);assert.equal(calls,1);assert.equal(result.fields[0].fingerprint,"original");assert.ok(Date.now()-start<1000);
});
test("falha sincrona da classificacao preserva pergunta para resposta humana",async()=>{
  const result=await classifyFormQuestions(fields,{classify:()=>{throw new Error("offline");}},{ats:"indeed"});assert.equal(result.failed,true);assert.deepEqual(result.fields,fields);
});
test("classificacao preserva campos protegidos e aplica sugestao somente ao campo elegivel",async()=>{
  const protectedField={...fields[0],sensitive:true};let calls=0;
  const result=await classifyFormQuestions([protectedField,fields[1]],{classify:async()=>{calls++;return {semanticKey:"APPLICATION.MOTIVATION",confidence:.9};}},{ats:"empregare"});
  assert.equal(calls,1);assert.equal(result.fields[0],protectedField);assert.equal(result.fields[1].semanticKey,"APPLICATION.MOTIVATION");assert.equal(fields[1].semanticKey,"CUSTOM.QUESTION");
});
