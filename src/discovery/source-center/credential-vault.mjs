import { createCipheriv,createDecipheriv,randomBytes } from "node:crypto";
import { chmod,mkdir,readFile,rename,writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const KEY_BYTES=32,VERSION=1;
const secretError=(message,code,status=500)=>Object.assign(new Error(message),{code,status});

export class CredentialVault {
  constructor({vaultPath,keyPath,envKey=process.env.CAREER_CREDENTIAL_MASTER_KEY||""}={}){
    this.vaultPath=path.resolve(vaultPath||path.join(process.env.HUB_DATA_DIR||"data","source-credentials.vault.json"));
    this.keyPath=path.resolve(keyPath||process.env.CAREER_CREDENTIAL_KEY_PATH||path.join(os.homedir(),".career-unified","source-credentials.key"));
    this.envKey=String(envKey||"");this.key=null;this.entries={};
  }
  async initialize(){await mkdir(path.dirname(this.vaultPath),{recursive:true});this.key=await this.loadKey();if(existsSync(this.vaultPath)){const parsed=JSON.parse(await readFile(this.vaultPath,"utf8"));if(parsed.version!==VERSION||!parsed.entries||typeof parsed.entries!=="object")throw secretError("Formato do cofre de credenciais inválido.","CREDENTIAL_VAULT_INVALID");this.entries=parsed.entries;}return this;}
  async loadKey(){if(this.envKey){const key=Buffer.from(this.envKey,"base64");if(key.length!==KEY_BYTES)throw secretError("CAREER_CREDENTIAL_MASTER_KEY deve conter 32 bytes em base64.","CREDENTIAL_KEY_INVALID");return key;}await mkdir(path.dirname(this.keyPath),{recursive:true});if(!existsSync(this.keyPath)){const key=randomBytes(KEY_BYTES);await writeFile(this.keyPath,key.toString("base64"),{encoding:"utf8",mode:0o600});await chmod(this.keyPath,0o600);return key;}const key=Buffer.from((await readFile(this.keyPath,"utf8")).trim(),"base64");if(key.length!==KEY_BYTES)throw secretError("Chave do cofre inválida.","CREDENTIAL_KEY_INVALID");return key;}
  async put(ref,value){const plaintext=String(value||"");if(!plaintext)throw secretError("Credencial vazia.","CREDENTIAL_REQUIRED",400);const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",this.key,iv);cipher.setAAD(Buffer.from(`${VERSION}:${ref}`));const ciphertext=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]);this.entries[ref]={iv:iv.toString("base64"),tag:cipher.getAuthTag().toString("base64"),ciphertext:ciphertext.toString("base64")};await this.persist();}
  get(ref){const entry=this.entries[ref];if(!entry)return "";try{const decipher=createDecipheriv("aes-256-gcm",this.key,Buffer.from(entry.iv,"base64"));decipher.setAAD(Buffer.from(`${VERSION}:${ref}`));decipher.setAuthTag(Buffer.from(entry.tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(entry.ciphertext,"base64")),decipher.final()]).toString("utf8");}catch{throw secretError("A credencial protegida não pôde ser aberta.","CREDENTIAL_DECRYPT_FAILED");}}
  async remove(ref){if(!this.entries[ref])return false;delete this.entries[ref];await this.persist();return true;}
  async persist(){const temporary=`${this.vaultPath}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify({version:VERSION,entries:this.entries}),{encoding:"utf8",mode:0o600});await rename(temporary,this.vaultPath);await chmod(this.vaultPath,0o600);}
}
