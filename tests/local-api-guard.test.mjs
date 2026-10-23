import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {UnifiedStateStore} from "../server/unified-state-store.mjs";
import {requireLocalApiRequest,SIGNED_MACHINE_ROUTES} from "../server/local-mutation-guard.mjs";

const outcome=(method,pathname,headers)=>{
  const url=new URL(pathname,`http://${headers.host}`);
  try{requireLocalApiRequest({method,headers,socket:{localPort:7123}},url);return "ALLOWED";}catch(error){return error.code;}
};

test("global API guard blocks DNS rebinding reads and cross-site mutations on every route",()=>{
  const local="127.0.0.1:7123";
  assert.equal(outcome("GET","/api/profile",{host:"evil.test:7123"}),"LOCAL_HOST_REQUIRED");
  assert.equal(outcome("GET","/api/profile",{host:local}),"ALLOWED");
  assert.equal(outcome("GET","/api/profile",{host:"localhost:7123"}),"ALLOWED");
  assert.equal(outcome("POST","/api/unified/delete",{host:local,"content-type":"text/plain",origin:"https://evil.test"}),"SAME_ORIGIN_REQUIRED");
  assert.equal(outcome("POST","/api/unified/backup/restore",{host:local,"content-type":"text/plain"}),"JSON_CONTENT_TYPE_REQUIRED");
  assert.equal(outcome("POST","/api/run",{host:local,"sec-fetch-site":"cross-site"}),"SAME_ORIGIN_REQUIRED");
  assert.equal(outcome("POST","/api/whatsapp/connect",{host:local}),"JSON_CONTENT_TYPE_REQUIRED");
  assert.equal(outcome("POST","/api/unified/delete",{host:"evil.test:7123","content-type":"application/json"}),"LOCAL_HOST_REQUIRED");
  assert.equal(outcome("POST","/api/unified/delete",{host:local,"content-type":"application/json",origin:"http://127.0.0.1:7123","sec-fetch-site":"same-origin"}),"ALLOWED");
  assert.equal(outcome("DELETE","/api/discovery/watchlists/x",{host:local,"content-type":"application/json; charset=utf-8"}),"ALLOWED");
  assert.equal(outcome("GET","/index.html",{host:"evil.test:7123"}),"ALLOWED");
  for(const route of SIGNED_MACHINE_ROUTES)assert.equal(outcome("POST",route,{host:"app:7123","content-type":"application/json"}),"ALLOWED",route);
});

const freePort=async()=>{const listener=createServer();await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve));const {port}=listener.address();await new Promise(resolve=>listener.close(resolve));return port;};
const send=(port,{method="GET",pathname,headers={},body})=>new Promise((resolve,reject)=>{
  const request=http.request({host:"127.0.0.1",port,method,path:pathname,headers:{host:`127.0.0.1:${port}`,...headers}},response=>{let text="";response.setEncoding("utf8");response.on("data",chunk=>text+=chunk);response.on("end",()=>{let data=null;try{data=JSON.parse(text);}catch{}resolve({status:response.statusCode,data});});});
  request.on("error",reject);request.end(body);
});

test("real HTTP process applies the guard to legacy server.mjs routes before routing",async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"local-api-guard-"));
  (await new UnifiedStateStore({dataDir:dir}).initialize()).close();
  const port=await freePort();
  const child=spawn(process.execPath,["server.mjs"],{cwd:path.resolve(import.meta.dirname,".."),env:{...process.env,HUB_DATA_DIR:dir,HUB_HOST:"127.0.0.1",HUB_PORT:String(port),CAREER_OPERATION_MODE:"maintenance",CAREER_SUBMISSION_ENABLED:"false",CAREER_WEB_TRUST_PROXY:"false",MOBILE_GATEWAY_ENABLED:"false",CAREER_CREDENTIAL_KEY_PATH:path.join(dir,"fixture.key"),CAREER_CREDENTIAL_MASTER_KEY:""},stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);
  t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once("exit",resolve));}await rm(dir,{recursive:true,force:true});});
  let ready=false;
  for(let i=0;i<100&&!ready;i++){if(child.exitCode!==null)assert.fail(output);try{ready=(await send(port,{pathname:"/api/runtime"})).status===200;}catch{}if(!ready)await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(ready,true,output);

  const rebinding=await send(port,{pathname:"/api/runtime",headers:{host:`evil.test:${port}`}});
  assert.deepEqual([rebinding.status,rebinding.data?.code],[403,"LOCAL_HOST_REQUIRED"]);
  const crossSite=await send(port,{method:"POST",pathname:"/api/unified/delete",headers:{"content-type":"text/plain",origin:"https://evil.test"},body:'{"type":"job","id":"x"}'});
  assert.deepEqual([crossSite.status,crossSite.data?.code],[403,"SAME_ORIGIN_REQUIRED"]);
  const textPlain=await send(port,{method:"POST",pathname:"/api/run",headers:{"content-type":"text/plain"},body:"{}"});
  assert.deepEqual([textPlain.status,textPlain.data?.code],[403,"JSON_CONTENT_TYPE_REQUIRED"]);
  // Same-origin JSON passes the guard and reaches the runtime policy (maintenance answers 423).
  const local=await send(port,{method:"POST",pathname:"/api/unified/delete",headers:{"content-type":"application/json",origin:`http://127.0.0.1:${port}`},body:"{}"});
  assert.equal(local.status,423);
  assert.equal((await send(port,{method:"POST",pathname:"/api/discovery-v4/webhooks/evolution",headers:{host:`app:${port}`,"content-type":"application/json"},body:"{}"})).status,423);
});
