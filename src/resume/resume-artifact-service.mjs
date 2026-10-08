import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const TYPES=Object.freeze({LATEX_SOURCE:{name:"resume.tex",mime:"application/x-tex"},PDF:{name:"resume.pdf",mime:"application/pdf"},EXTRACTED_TEXT:{name:"extracted.txt",mime:"text/plain; charset=utf-8"},EXPORT_BUNDLE:{name:"overleaf-export.zip",mime:"application/zip"}});
export const sha256=value=>createHash("sha256").update(value).digest("hex");

export class ResumeArtifactService{
  constructor({dataDir,artifactRepository}={}){this.root=path.resolve(dataDir,"resumes");this.artifacts=artifactRepository;}
  versionDir(resumeId,versionId){const safe=value=>{const v=String(value||"");if(!/^[A-Za-z0-9._-]{1,200}$/.test(v)||v.includes(".."))throw Object.assign(new Error("Identificador de artefato invalido."),{code:"ARTIFACT_PATH_INVALID"});return v;};return path.join(this.root,safe(resumeId),"versions",safe(versionId));}
  async write({resumeId,resumeVersionId,artifactType,content,status="READY",validation={}}){const config=TYPES[artifactType];if(!config)throw Object.assign(new Error("Tipo de artefato invalido."),{code:"INVALID_ARTIFACT_TYPE"});const dir=this.versionDir(resumeId,resumeVersionId);await mkdir(dir,{recursive:true});const data=Buffer.isBuffer(content)?content:Buffer.from(String(content),"utf8"),hash=sha256(data),target=path.join(dir,config.name),temp=path.join(dir,`.write-${randomUUID()}`);await writeFile(temp,data);await rename(temp,target);return this.artifacts.create({resumeVersionId,artifactType,storagePath:target,contentHash:hash,sizeBytes:data.length,mimeType:config.mime,status,validation});}
  async importFile({resumeId,resumeVersionId,artifactType,sourcePath,status="READY",validation={}}){const data=await readFile(sourcePath);return this.write({resumeId,resumeVersionId,artifactType,content:data,status,validation});}
  async readAllowed(artifact,resumeId){if(!artifact?.storagePath)throw Object.assign(new Error("Artefato nao encontrado."),{code:"ARTIFACT_MISSING"});const resolved=path.resolve(artifact.storagePath),root=this.versionDir(resumeId,artifact.resumeVersionId)+path.sep;if(!resolved.startsWith(root))throw Object.assign(new Error("Caminho de artefato fora da raiz permitida."),{code:"ARTIFACT_PATH_NOT_ALLOWED"});const data=await readFile(resolved);if(sha256(data)!==artifact.contentHash)throw Object.assign(new Error("Hash do artefato diverge do registro."),{code:"ARTIFACT_HASH_MISMATCH"});return data;}
  async createRenderWorkDir(resumeId,versionId){const dir=path.join(this.versionDir(resumeId,versionId),`.render-${randomUUID()}`);await mkdir(dir,{recursive:true});return dir;}
  async writeManifest(resumeId,versionId,manifest){const dir=this.versionDir(resumeId,versionId);await mkdir(dir,{recursive:true});const target=path.join(dir,"render.json");await writeFile(target,`${JSON.stringify(manifest,null,2)}\n`,"utf8");return target;}
  async cleanupWorkDir(dir){const target=path.resolve(dir);if(!target.startsWith(this.root+path.sep)||!/^\.render-[a-z0-9-]+$/i.test(path.basename(target)))throw Object.assign(new Error("Render cleanup outside workspace"),{code:"ARTIFACT_PATH_NOT_ALLOWED"});await rm(target,{recursive:true,force:true});}
}
