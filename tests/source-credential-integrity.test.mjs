import assert from "node:assert/strict";
import test from "node:test";
import { SourceConnectionService } from "../src/discovery/source-center/source-connection-service.mjs";

for(const code of ["CREDENTIAL_REFERENCE_MISSING","CREDENTIAL_DECRYPT_FAILED","CREDENTIAL_VAULT_INVALID"]){
  test(`credential metadata becomes INVALID without deleting an unreadable vault: ${code}`,()=>{
    let metadata={providerId:"github",credentialRef:"temporary-test-ref",credentialKind:"TOKEN",status:"CONNECTED"};const events=[];
    const service=new SourceConnectionService({credentials:{get:()=>metadata,save:value=>{metadata=value;}},events:{record:event=>events.push(event)},vault:{get:()=>{if(code==="CREDENTIAL_REFERENCE_MISSING")return "";throw Object.assign(new Error("synthetic"),{code});}}});
    assert.equal(service.secret("github"),"");assert.equal(metadata.status,"INVALID");
    assert.equal(events[0].errorCode,code);assert.equal(service.secret("github"),"");assert.equal(events.length,1);
  });
}
