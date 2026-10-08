import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";import path from "node:path";
import {HubDatabase} from "../db/database.mjs";
import {DiscoveryV4Repository} from "../repositories/discovery-v4-repository.mjs";

test("lead comunitário e vaga oficial reconciliam com duas proveniências lógicas",async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),"cross-source-")),db=await new HubDatabase(path.join(dir,"db.sqlite")).initialize();try{const repo=new DiscoveryV4Repository(db.connection,db),now=new Date().toISOString();db.connection.prepare("INSERT INTO jobs(id,source,title,company,description,url,status,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run("job-1","ashby","Backend Engineer","Acme","","https://jobs.ashbyhq.com/acme/1","salva","{}",now,now);const lead=repo.createLead({sourceClass:"COMMUNITY_WHATSAPP_GROUP",title:"Backend Engineer",company:"Acme",sourceRef:"group",provenance:{kind:"WHATSAPP_GROUP"}}),matches=repo.reconcileOfficialJob({id:"job-1",provider:"ashby",title:"Backend Engineer",company:"Acme",applicationUrl:"https://jobs.ashbyhq.com/acme/1"});assert.equal(matches.length,1);assert.equal(repo.listLeads().find(x=>x.id===lead.id).jobId,"job-1");assert.equal(matches[0].provenance.kind,"WHATSAPP_GROUP");}finally{db.close();await rm(dir,{recursive:true,force:true});}});
