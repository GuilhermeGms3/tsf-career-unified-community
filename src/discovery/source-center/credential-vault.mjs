import { createCipheriv,createDecipheriv,randomBytes,randomUUID } from "node:crypto";
import { chmod,mkdir,open,readFile,rename,rm,writeFile } from "node:fs/promises";
import { existsSync,readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { withVaultFileLock } from "./vault-file-lock.mjs";

const KEY_BYTES=32,VERSION=1;
const secretError=(message,code,status=500)=>Object.assign(new Error(message),{code,status});
async function syncDirectory(file){
  if(process.platform==="win32")return;
  const handle=await open(path.dirname(file),"r");
  try{await handle.sync();}finally{await handle.close();}
}

export class CredentialVault {
  constructor({vaultPath,keyPath,envKey=process.env.CAREER_CREDENTIAL_MASTER_KEY||""}={}){
    this.vaultPath=path.resolve(vaultPath||path.join(process.env.HUB_DATA_DIR||"data","source-credentials.vault.json"));
    this.keyPath=path.resolve(keyPath||process.env.CAREER_CREDENTIAL_KEY_PATH||path.join(os.homedir(),".career-unified","source-credentials.key"));
    this.envKey=String(envKey||"");this.key=null;this.entries={};this.writeQueue=Promise.resolve();
  }
  readEntries(){
    if(!existsSync(this.vaultPath))return {};
    let parsed;try{parsed=JSON.parse(readFileSync(this.vaultPath,"utf8"));}catch{throw secretError("Formato do cofre invalido.","CREDENTIAL_VAULT_INVALID");}
    if(parsed.version!==VERSION||!parsed.entries||typeof parsed.entries!=="object"||Array.isArray(parsed.entries))throw secretError("Formato do cofre invalido.","CREDENTIAL_VAULT_INVALID");
    return parsed.entries;
  }
  async initialize(){await mkdir(path.dirname(this.vaultPath),{recursive:true});this.entries=this.readEntries();this.key=await this.loadKey();return this;}
  async loadKey(){
    if(this.envKey){const key=Buffer.from(this.envKey,"base64");if(key.length!==KEY_BYTES)throw secretError("Chave base64 de 32 bytes obrigatoria.","CREDENTIAL_KEY_INVALID");return key;}
    await mkdir(path.dirname(this.keyPath),{recursive:true});
    if(!existsSync(this.keyPath)&&Object.keys(this.entries).length)throw secretError("A chave correspondente ao cofre precisa ser restaurada do backup.","CREDENTIAL_KEY_MISSING");
    return withVaultFileLock(this.keyPath,async()=>{
      if(!existsSync(this.keyPath)){
        const key=randomBytes(KEY_BYTES),handle=await open(this.keyPath,"wx",0o600);
        try{await handle.writeFile(key.toString("base64"));await handle.sync();}finally{await handle.close();}
        await syncDirectory(this.keyPath);
      }
      const key=Buffer.from((await readFile(this.keyPath,"utf8")).trim(),"base64");
      if(key.length!==KEY_BYTES)throw secretError("Chave do cofre invalida.","CREDENTIAL_KEY_INVALID");
      await chmod(this.keyPath,0o600);return key;
    });
  }
  enqueue(operation){const queued=this.writeQueue.then(operation,operation);this.writeQueue=queued.catch(()=>undefined);return queued;}
  async put(ref,value){const plaintext=String(value||"");if(!plaintext)throw secretError("Credencial vazia.","CREDENTIAL_REQUIRED",400);return this.enqueue(()=>withVaultFileLock(this.vaultPath,async()=>{this.entries=this.readEntries();const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",this.key,iv);cipher.setAAD(Buffer.from(`${VERSION}:${ref}`));const ciphertext=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]),next={...this.entries,[ref]:{iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:ciphertext.toString("base64")}};await this.persist(next);this.entries=next;}));}
  get(ref){this.entries=this.readEntries();const entry=Object.hasOwn(this.entries,ref)?this.entries[ref]:null;if(!entry)return "";try{const decipher=createDecipheriv("aes-256-gcm",this.key,Buffer.from(entry.iv,"base64"));decipher.setAAD(Buffer.from(`${VERSION}:${ref}`));decipher.setAuthTag(Buffer.from(entry.tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext,"base64")),decipher.final()]).toString("utf8");}catch{throw secretError("A credencial protegida não pôde ser aberta.","CREDENTIAL_DECRYPT_FAILED");}}
  async remove(ref){return this.enqueue(()=>withVaultFileLock(this.vaultPath,async()=>{this.entries=this.readEntries();if(!Object.hasOwn(this.entries,ref))return false;const next={...this.entries};delete next[ref];await this.persist(next);this.entries=next;return true;}));}
  async persist(entries=this.entries){const temporary=`${this.vaultPath}.${process.pid}.${randomUUID()}.tmp`;try{await writeFile(temporary,JSON.stringify({version:VERSION,entries}),{encoding:"utf8",mode:0o600});const handle=await open(temporary,"r+");try{await handle.sync();}finally{await handle.close();}await rename(temporary,this.vaultPath);await chmod(this.vaultPath,0o600);await syncDirectory(this.vaultPath);}finally{await rm(temporary,{force:true}).catch(()=>undefined);}}
}
