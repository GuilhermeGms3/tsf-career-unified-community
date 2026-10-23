import {DatabaseSync,backup} from "node:sqlite";
import {copyFile,mkdir,stat} from "node:fs/promises";
import {constants} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {HubDatabase} from "../db/database.mjs";

// Snapshot only. No UnifiedStateStore, workers, vault decryption or browser.
export async function rehearseDataUpgrade(sourceFile,outputDirectory) {
  const source=path.resolve(sourceFile),directory=path.resolve(outputDirectory);
  await stat(source);
  await mkdir(directory,{recursive:true});
  const snapshot=path.join(directory,"source-snapshot.sqlite"),candidate=path.join(directory,"upgrade-candidate.sqlite");
  for(const target of [snapshot,candidate]) {
    try{await stat(target);throw Object.assign(new Error("O destino ja existe; use outra pasta de ensaio."),{code:"UPGRADE_TARGET_EXISTS"});}
    catch(error){if(error.code!=="ENOENT")throw error;}
  }
  const reader=new DatabaseSync(source,{readOnly:true});
  try{await backup(reader,snapshot);}finally{reader.close();}
  await copyFile(snapshot,candidate,constants.COPYFILE_EXCL);
  const database=await new HubDatabase(candidate).initialize();
  try {
    const connection=database.connection;
    const integrity=connection.prepare("PRAGMA integrity_check").get().integrity_check;
    const foreignKeyViolations=connection.prepare("PRAGMA foreign_key_check").all().length;
    const version=connection.prepare("SELECT max(version) AS version FROM schema_migrations").get().version;
    if(integrity!=="ok"||foreignKeyViolations)throw Object.assign(new Error("A copia migrada nao passou na integridade."),{code:"UPGRADE_INTEGRITY_FAILED"});
    return {status:"PASS",schemaVersion:version,integrity,foreignKeyViolations,snapshot,candidate,sourceModified:false,
      warning:"Ensaio local de banco; nao inclui chave, cofre, PDFs, Evolution ou n8n e nao e backup operacional completo."};
  }finally{database.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length!==4){console.error("Uso: node scripts/prepare-data-upgrade.mjs <banco-origem> <nova-pasta-ensaio>");process.exitCode=2;}
  else try{console.log(JSON.stringify(await rehearseDataUpgrade(process.argv[2],process.argv[3]),null,2));}
  catch(error){console.error(JSON.stringify({status:"FAILED",code:error.code||"UPGRADE_REHEARSAL_FAILED"}));process.exitCode=1;}
}
