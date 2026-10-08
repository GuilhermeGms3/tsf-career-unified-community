import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {once} from "node:events";
import path from "node:path";
import {chromium} from "playwright";

test("GitHub sync UI explicit action updates mounted DOM without remote reads on revisit",async()=>{
  const root=path.resolve("public"),server=createServer(async(req,res)=>{const pathname=new URL(req.url,"http://fixture").pathname;
    if(pathname==="/knowledge"){res.setHeader("Content-Type","text/html");res.end('<main id="fixture"></main>');return;}
    const file=path.resolve(root,`.${pathname}`);if(!file.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
    try{res.setHeader("Content-Type",pathname.endsWith(".js")?"text/javascript":"text/css");res.end(await readFile(file));}catch{res.writeHead(404);res.end();}
  });server.listen(0,"127.0.0.1");await once(server,"listening");const browser=await chromium.launch({headless:true});
  try{const page=await browser.newPage({viewport:{width:390,height:844}});let syncCalls=0,lastSyncAt=null;
    await page.route("**/api/**",async route=>{const url=new URL(route.request().url());if(url.pathname.endsWith(".js")){await route.continue();return;}let result={};
      if(url.pathname.endsWith("/sync")){syncCalls++;await new Promise(resolve=>setTimeout(resolve,30));lastSyncAt="2026-08-27T12:00:00Z";result={sync:{status:"READY"}};}
      else if(url.pathname==="/api/source-center")result={sources:[{providerId:"github",credentialStatus:"CONNECTED",syncStatus:lastSyncAt?"READY":"NOT_SYNCED",sync:{details:{lastSyncAt,repositories:lastSyncAt?2:0,evidenceItems:lastSyncAt?3:0,technologies:lastSyncAt?["docker"]:[]}}}]};
      else if(url.pathname.endsWith("/inventory"))result={inventory:{skills:[],experiences:[],projects:[],education:[],pendingReviews:[],evidenceGaps:[],overview:{}}};
      await route.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,...result})});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/knowledge?section=connections`);
    const render=()=>page.evaluate(async()=>{const {renderKnowledge}=await import("/features/knowledge/page.js");await renderKnowledge({root:document.querySelector("#fixture")});});
    await render();assert.equal(syncCalls,0);await page.locator('[data-github-action="sync"]').click();await page.getByText("Última sincronização: 2026-08-27T12:00:00Z").waitFor();assert.equal(syncCalls,1);assert.match(await page.locator("#fixture").innerText(),/Docker: Detectado/);assert.match(await page.locator("#fixture").innerText(),/Não detectado não significa/);
    await render();assert.equal(syncCalls,1);
    assert.equal(await page.evaluate(()=>document.querySelector("#fixture").isConnected),true);
  }finally{await browser.close();server.close();await once(server,"close");}
});
