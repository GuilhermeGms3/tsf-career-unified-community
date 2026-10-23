import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { isPublicAddress, publicUrl, resolvePublicTarget, installPublicBrowserGuard } from "../src/security/public-url-policy.mjs";
import { BrowserManager } from "../src/automation/browser/browser-manager.mjs";

test("public URL policy blocks private, shared, mapped, metadata and reserved addresses",()=>{
  for(const ip of ["0.0.0.0","127.1.2.3","10.2.3.4","100.100.100.101","169.254.169.254","172.16.0.1","192.168.1.1","198.18.0.1","224.0.0.1","255.255.255.255","::","::1","fe80::1","fd12::1","::ffff:127.0.0.1","::ffff:a00:1","2001:db8::1","2002:7f00:1::"]){assert.equal(isPublicAddress(ip),false,ip);}
  for(const ip of ["1.1.1.1","8.8.8.8","2001:4860:4860::8888","2606:4700:4700::1111"])assert.equal(isPublicAddress(ip),true,ip);
  for(const url of ["https://user:secret@example.com","file:///tmp/test","http://localhost/","http://127.1/","http://0x7f000001/","http://[::ffff:127.0.0.1]/","https://example.com:9000/"])assert.throws(()=>publicUrl(url),undefined,url);
});

test("DNS with any private answer is rejected, including mixed IPv4/IPv6",async()=>{
  for(const addresses of [[{address:"127.0.0.1"}],[{address:"1.1.1.1"},{address:"::ffff:10.0.0.1"}],[]])
    await assert.rejects(resolvePublicTarget("https://fixture.example",{lookupImpl:async()=>addresses}),e=>e.code==="PRIVATE_DISCOVERY_TARGET");
});

test("browser guard rechecks DNS at each request instead of trusting extraction-time validation",async()=>{
  let count=0,handler,aborted=false,continued=false;
  const lookupImpl=async()=>[{address:++count===1?"1.1.1.1":"127.0.0.1",family:4}];
  await resolvePublicTarget("https://fixture.example/job",{lookupImpl});
  await installPublicBrowserGuard({route:async(_pattern,callback)=>{handler=callback;}},{lookupImpl});
  await handler({request:()=>({url:()=>"https://fixture.example/apply"}),abort:async()=>{aborted=true;},continue:async()=>{continued=true;}});
  assert.equal(aborted,true);assert.equal(continued,false);
});

test("legitimate public third-party subresources pass the same request guard",async()=>{
  let handler,continued=0;
  await installPublicBrowserGuard({route:async(_pattern,callback)=>{handler=callback;}},{lookupImpl:async()=>[{address:"1.1.1.1",family:4}]});
  for(const url of ["https://jobs.example/apply","https://cdn.example/app.js","https://assets.example/font.woff2"])
    await handler({request:()=>({url:()=>url}),abort:async()=>{throw new Error("Unexpected block");},continue:async()=>{continued++;}});
  assert.equal(continued,3);
});

test("real browser fixture redirect cannot reach link-local metadata",async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),"browser-policy-")),server=createServer((_req,res)=>res.writeHead(302,{location:"http://169.254.169.254/latest/meta-data/"}).end());
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const manager=new BrowserManager({dataDir:dir,allowLocalFixtures:true,timeout:2000});let session;
  try{
    session=await manager.open("fixture","redirect",{trace:false});
    await assert.rejects(session.page.goto(`http://127.0.0.1:${server.address().port}/`));
    assert.ok(session.networkBlocks.includes("PRIVATE_DISCOVERY_TARGET"));
  }finally{if(session)await manager.close(session);await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
