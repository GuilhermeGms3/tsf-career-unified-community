import test from "node:test";
import assert from "node:assert/strict";
import { classifyGeography, PreMatchPlausibility } from "../src/discovery/relevance/pre-match-plausibility.mjs";

const policy={priorities:[
  {priority:1,location:"Brasília, DF",workModel:"HYBRID",accepted:true},
  {priority:2,location:"Brasília, DF",workModel:"ONSITE",accepted:true},
  {priority:3,location:"Brasil",remoteScope:"Brasil",workModel:"REMOTE",accepted:true},
]};
const intent={families:["INFRASTRUCTURE"],seniorities:["JUNIOR"],locationPolicy:policy};

test("Brasília sem modalidade mantém geografia MATCH e pede revisão da modalidade",()=>{
  for(const location of ["Brasília","Brasilia","Brasília, DF","Brasilia, DF","Brasília - DF","Distrito Federal","Distrito Federal, Brasil","Brasília, Distrito Federal"]){
    const result=classifyGeography({location},policy);
    assert.equal(result.geographicMatch.status,"MATCH",location);
    assert.equal(result.workModelMatch.status,"UNKNOWN",location);
    assert.equal(result.accepted,true,location);
    assert.equal(result.reviewRequired,true,location);
  }
  const preMatch=new PreMatchPlausibility().evaluate({title:"Analista de Infraestrutura Junior",description:"Linux redes suporte",location:"Brasília, DF",lifecycleStatus:"OPEN"},intent);
  assert.notEqual(preMatch.decision,"REJECT");
  assert.ok(preMatch.reasons.includes("WORK_MODEL_UNKNOWN"));
});

test("Brasília híbrida e presencial são compatíveis",()=>{
  assert.equal(classifyGeography({location:"Brasília",workModel:"HYBRID"},policy).accepted,true);
  assert.equal(classifyGeography({location:"Brasília, DF",workModel:"ONSITE"},policy).accepted,true);
});

test("Remote Brazil é aceito e países estrangeiros são rejeitados independentemente da modalidade",()=>{
  const remote=classifyGeography({location:"Brasil",workModel:"REMOTE",remote:true},policy);
  assert.equal(remote.geographicMatch.status,"MATCH");
  assert.equal(remote.workModelMatch.status,"MATCH");
  for(const job of [{location:"Ontario, Canada"},{location:"Lima, Peru"},{location:"Canada",workModel:"REMOTE",remote:true}]){
    const result=classifyGeography(job,policy);
    assert.equal(result.geographicMatch.status,"MISMATCH",job.location);
    assert.equal(result.accepted,false,job.location);
    assert.ok(result.geographicMatch.reasonCodes.includes("FOREIGN_LOCATION"));
  }
});

test("local desconhecido permanece UNKNOWN sem falso match",()=>{
  const result=classifyGeography({},policy);
  assert.equal(result.geographicMatch.status,"UNKNOWN");
  assert.equal(result.accepted,true);
  assert.equal(result.reviewRequired,true);
});
