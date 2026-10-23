import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { createPinnedPublicFetch } from "../src/security/pinned-public-fetch.mjs";

test("public transport pins socket DNS to the approved addresses and preserves TLS hostname",async()=>{
  const addresses=[{address:"93.184.216.34",family:4}];let lookups=0;
  const fetch=createPinnedPublicFetch({
    resolveTarget:async value=>{lookups++;return {url:new URL(value),addresses};},
    requestImpl:(url,options,respond)=>{
      assert.equal(url.hostname,"public.example");assert.equal(options.rejectUnauthorized,undefined);
      assert.equal(options.headers.host,"public.example");assert.equal(options.headers["accept-encoding"],"identity");
      options.lookup("public.example",{all:true},(error,results)=>{assert.equal(error,null);assert.deepEqual(results,addresses);});
      options.lookup("public.example",{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,addresses[0].address);assert.equal(family,4);});
      const request=new EventEmitter();request.end=()=>{
        const response=new PassThrough();response.statusCode=200;
        response.headers={"content-encoding":"gzip","content-type":"application/json"};
        respond(response);response.end(gzipSync('{"ok":true}'));
      };return request;
    },
  });
  const response=await fetch("https://public.example/jobs",{headers:{host:"169.254.169.254","accept-encoding":"gzip"}});
  assert.deepEqual(await response.json(),{ok:true});assert.equal(lookups,1);
  assert.equal(response.headers.has("content-encoding"),false);
});

test("public transport does not construct a socket when resolution is forbidden",async()=>{
  let sockets=0;
  const fetch=createPinnedPublicFetch({resolveTarget:async()=>{throw Object.assign(new Error("blocked"),{code:"PRIVATE_DISCOVERY_TARGET"});},requestImpl:()=>{sockets++;}});
  await assert.rejects(fetch("https://public.example"),e=>e.code==="PRIVATE_DISCOVERY_TARGET");assert.equal(sockets,0);
  await assert.rejects(fetch("https://public.example",{method:"POST"}),e=>e.code==="PUBLIC_FETCH_METHOD_NOT_ALLOWED");
});
