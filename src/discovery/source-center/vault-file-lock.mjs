import { open, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

export async function withVaultFileLock(file, operation, { timeoutMs=3000 }={}) {
  const lock=`${file}.writer.lock`, token=randomUUID(), deadline=Date.now()+timeoutMs;
  let owned=false;
  while(!owned){
    try{
      const handle=await open(lock,"wx",0o600);
      try{await handle.writeFile(JSON.stringify({token,pid:process.pid,hostname:hostname()}));await handle.sync();owned=true;}
      finally{await handle.close();}
    }catch(error){
      if(error.code!=="EEXIST")throw error;
      // Do not steal locks by timeout: checking a token then unlinking is not
      // an atomic compare-and-delete across processes. Orphans need inspection.
      if(Date.now()>=deadline)throw Object.assign(new Error("O cofre esta em uso; tente novamente apos verificar o processo proprietario."),{code:"CREDENTIAL_VAULT_BUSY"});
      await delay(20);
    }
  }
  try{return await operation();}
  finally{
    let current;try{current=JSON.parse(await readFile(lock,"utf8"));}catch{}
    if(current?.token===token)await unlink(lock).catch(e=>{if(e.code!=="ENOENT")throw e;});
  }
}
