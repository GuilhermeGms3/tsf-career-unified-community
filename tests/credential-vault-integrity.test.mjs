import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { CredentialVault } from "../src/discovery/source-center/credential-vault.mjs";
import { withVaultFileLock } from "../src/discovery/source-center/vault-file-lock.mjs";

test("two vault instances create one key and merge concurrent writes without stale cache",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"vault-integrity-"));
  try{
    const options={vaultPath:path.join(dir,"vault.json"),keyPath:path.join(dir,"key")};
    const [a,b]=await Promise.all([new CredentialVault(options).initialize(),new CredentialVault(options).initialize()]);
    await Promise.all(Array.from({length:12},(_,i)=>(i%2?a:b).put(`entry-${i}`,`synthetic-${i}`)));
    for(let i=0;i<12;i++){assert.equal(a.get(`entry-${i}`),`synthetic-${i}`);assert.equal(b.get(`entry-${i}`),`synthetic-${i}`);}
    await b.remove("entry-0");assert.equal(a.get("entry-0"),"");
    const text=await readFile(options.vaultPath,"utf8");assert.equal(text.includes("synthetic-"),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("missing key on a nonempty vault is not replaced with an unusable new key",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"vault-missing-key-"));
  try{
    const options={vaultPath:path.join(dir,"vault.json"),keyPath:path.join(dir,"key")},vault=await new CredentialVault(options).initialize();
    await vault.put("ref","synthetic-test-value");await rm(options.keyPath);
    await assert.rejects(new CredentialVault(options).initialize(),e=>e.code==="CREDENTIAL_KEY_MISSING");
    await assert.rejects(readFile(options.keyPath),e=>e.code==="ENOENT");
    assert.equal((JSON.parse(await readFile(options.vaultPath,"utf8"))).entries.ref.ciphertext.length>0,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("separate processes merge encrypted writes under the file lock",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"vault-processes-"));
  try{
    const options={vaultPath:path.join(dir,"vault.json"),keyPath:path.join(dir,"key"),envKey:""};
    const vault=await new CredentialVault(options).initialize();
    const run=prefix=>new Promise((resolve,reject)=>{
      const script=`import {CredentialVault} from ${JSON.stringify(new URL("../src/discovery/source-center/credential-vault.mjs",import.meta.url).href)};const v=await new CredentialVault(${JSON.stringify(options)}).initialize();for(let i=0;i<8;i++)await v.put(${JSON.stringify(prefix)}+i,'synthetic-process-value');`;
      const child=spawn(process.execPath,["--input-type=module","-e",script],{stdio:"ignore"});
      child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(new Error(`Fixture process failed: ${code}`)));
    });
    await Promise.all([run("a"),run("b")]);
    for(const prefix of ["a","b"])for(let i=0;i<8;i++)assert.equal(vault.get(prefix+i),"synthetic-process-value");
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("an orphaned writer lock fails closed without replacing the last valid snapshot",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"vault-orphan-"));
  try{
    const options={vaultPath:path.join(dir,"vault.json"),keyPath:path.join(dir,"key")},vault=await new CredentialVault(options).initialize();
    await vault.put("ref","synthetic-last-good");const previous=await readFile(options.vaultPath,"utf8");
    await writeFile(`${options.vaultPath}.writer.lock`,JSON.stringify({token:"orphan-test",pid:0}));
    await assert.rejects(withVaultFileLock(options.vaultPath,()=>assert.fail("must not write"),{timeoutMs:25}),e=>e.code==="CREDENTIAL_VAULT_BUSY");
    assert.equal(await readFile(options.vaultPath,"utf8"),previous);assert.equal(vault.get("ref"),"synthetic-last-good");
  }finally{await rm(dir,{recursive:true,force:true});}
});
