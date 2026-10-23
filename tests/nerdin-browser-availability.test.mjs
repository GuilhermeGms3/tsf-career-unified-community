import assert from "node:assert/strict";
import test from "node:test";
import {chromium} from "playwright";
import {NerdinMetadataClient} from "../src/automation/ats/nerdin/nerdin-metadata-client.mjs";
import {parseNerdinIdentity} from "../src/automation/ats/nerdin/nerdin-target-policy.mjs";

test("fallback de disponibilidade exige resposta OK, mesma vaga e formulario Nerdin",async()=>{
  const b=await chromium.launch({headless:true});
  try{
    const p=await b.newPage(),identity=parseNerdinIdentity("https://www.nerdin.com.br/vaga_candidatura.php?id=99207"),client=new NerdinMetadataClient();
    await p.route("**/*",route=>route.fulfill({status:200,contentType:"text/html",body:'<form id="form-candidatura"><input name="nome_candidato"><input name="curriculo" type="file"></form>'}));
    const response=await p.goto(identity.applicationUrl);
    assert.equal((await client.checkPage(p,identity,response)).status,"OPEN");
    assert.equal(await client.checkPage(p,{...identity,providerJobId:"other"},response),null);
    assert.equal(await client.checkPage(p,identity,{ok:()=>false}),null);
    await p.setContent('<p>Vaga encerrada</p>');
    assert.equal((await client.checkPage(p,identity,response)).status,"CLOSED");
    await p.setContent('<p>Erro generico</p>');
    assert.equal(await client.checkPage(p,identity,response),null);
  }finally{await b.close();}
});
