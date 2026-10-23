import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {HubDatabase} from "../db/database.mjs";
import {rehearseDataUpgrade} from "../scripts/prepare-data-upgrade.mjs";

test("ensaio usa backup SQLite, preserva origem e recusa sobrescrever snapshot",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"upgrade-rehearsal-")),source=path.join(directory,"source.sqlite"),output=path.join(directory,"rehearsal");
  const db=await new HubDatabase(source).initialize();db.close();const before=await readFile(source);
  try{
    const result=await rehearseDataUpgrade(source,output);assert.equal(result.status,"PASS");assert.equal(result.schemaVersion,58);
    assert.deepEqual(await readFile(source),before);
    await assert.rejects(rehearseDataUpgrade(source,output),error=>error.code==="UPGRADE_TARGET_EXISTS");
    const read=new DatabaseSync(result.snapshot,{readOnly:true});assert.equal(read.prepare("PRAGMA integrity_check").get().integrity_check,"ok");read.close();
  }finally{await rm(directory,{recursive:true,force:true});}
});
