import path from "node:path";
import {lstat} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {fileURLToPath} from "node:url";

const sourceRoots=["D:/TSF/career-unified/data/","D:/dsf/tsf-career-unified/data/","C:/TSF/projects/tsf-career-unified/data/"];

// Run only on the disposable/promoted copy, before starting the application.
export async function rebaseDeploymentPaths(databaseFile,dataDir,{apply=false}={}) {
  const root=path.resolve(dataDir),database=path.resolve(databaseFile);
  if(database!==path.join(root,"career-hub.sqlite"))throw Error("DEPLOYMENT_DATABASE_PATH_INVALID");
  if(apply&&sourceRoots.some(prefix=>(database.replaceAll("\\","/").toLowerCase())===prefix.toLowerCase()+"career-hub.sqlite"))throw Error("DEPLOYMENT_ORIGINAL_DATA_FORBIDDEN");
  const db=new DatabaseSync(database,{readOnly:!apply});
  try{
    const changes=[];
    for(const [table,column] of [["resumes","stored_path"],["resume_artifacts","storage_path"]]){
      for(const row of db.prepare(`SELECT id,${column} value FROM ${table}`).all()){
        const old=String(row.value||"").replaceAll("\\","/");
        if(!/^[a-z]:\//i.test(old))continue;
        const prefix=sourceRoots.find(p=>old.toLowerCase().startsWith(p.toLowerCase()));
        if(!prefix)throw Error("UNRECOGNIZED_LEGACY_DATA_ROOT");
        const relative=old.slice(prefix.length);
        if(relative.split("/").some(p=>!p||p===".."||p===".")||relative.includes(":"))throw Error("DEPLOYMENT_PATH_OUTSIDE_ROOT");
        const file=path.resolve(root,...relative.split("/"));
        if(!file.startsWith(root+path.sep)||!(await lstat(file)).isFile())throw Error("DEPLOYMENT_REFERENCED_FILE_MISSING");
        changes.push({table,column,id:row.id,oldValue:row.value,newValue:"/app/data/"+relative});
      }
    }
    if(apply){
      db.exec("BEGIN IMMEDIATE");
      try{for(const c of changes){const result=db.prepare(`UPDATE ${c.table} SET ${c.column}=? WHERE id=? AND ${c.column}=?`).run(c.newValue,c.id,c.oldValue);if(result.changes!==1)throw Error("DEPLOYMENT_PATH_CHANGED");}db.exec("COMMIT");}
      catch(error){db.exec("ROLLBACK");throw error;}
    }
    return {applied:apply,changedPaths:changes.length,changes,integrity:db.prepare("PRAGMA integrity_check").get().integrity_check,foreignKeyViolations:db.prepare("PRAGMA foreign_key_check").all().length};
  }finally{db.close();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [,,databaseFile,dataDir,flag]=process.argv;
  if(!databaseFile||!dataDir||flag&&flag!=="--apply")throw Error("Usage: rebase-deployment-paths.mjs <copy-database> <copy-data-dir> [--apply]");
  const result=await rebaseDeploymentPaths(databaseFile,dataDir,{apply:flag==="--apply"});
  console.log(JSON.stringify({applied:result.applied,changedPaths:result.changedPaths,integrity:result.integrity,foreignKeyViolations:result.foreignKeyViolations}));
}
