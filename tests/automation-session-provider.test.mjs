import assert from "node:assert/strict";
import test from "node:test";
import {createAutomationSessionProvider} from "../src/source-connections/automation-session-provider.mjs";

test("automacao restaura somente a sessao do portal e host corretos",async()=>{
  const calls=[],state={cookies:[],origins:[]},provider=createAutomationSessionProvider({storageState:(...args)=>{calls.push(args);return state;}});
  assert.equal(await provider("indeed","https://br.indeed.com/viewjob?jk=test"),state);
  assert.deepEqual(calls,[["indeed","br.indeed.com"]]);
  for(const [portal,url] of [["indeed","https://evil.test/"],["indeed","https://www.nerdin.com.br/vaga_candidatura.php?id=1"],["indeed","http://br.indeed.com/viewjob?jk=test"],["indeed","https://user:pass@br.indeed.com/viewjob?jk=test"],["unknown","https://br.indeed.com/viewjob?jk=test"]])assert.equal(await provider(portal,url),undefined);
  assert.equal(calls.length,1);
});
test("sessao ausente nao bloqueia abertura publica nem fabrica autenticacao",async()=>{
  const provider=createAutomationSessionProvider({storageState:()=>undefined});
  assert.equal(await provider("indeed","https://br.indeed.com/viewjob?jk=test"),undefined);
});
