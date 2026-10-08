import { hashResumeSpec } from "./resume-spec-builder.mjs";

export class ResumeVersionService{
  constructor({versions}={}){this.versions=versions;}
  createDraft(input){const contentHash=input.contentHash||hashResumeSpec(input.resumeSpec),existing=this.versions.findEquivalent({...input,contentHash});if(existing)return {...existing,reused:true};return this.versions.create({...input,contentHash,status:input.status||"REVIEW_REQUIRED"});}
  createRevision(parent,input){
    if(!parent)throw Object.assign(new Error("Versao de curriculo nao encontrada."),{code:"RESUME_VERSION_NOT_FOUND"});
    const contentHash=input.contentHash||hashResumeSpec(input.resumeSpec);
    if(contentHash===parent.contentHash)throw Object.assign(new Error("Nenhuma alteracao foi feita no curriculo."),{code:"RESUME_SPEC_UNCHANGED"});
    return this.versions.create({...parent,...input,id:undefined,parentVersionId:parent.id,contentHash,status:"REVIEW_REQUIRED",approvedAt:null,createdAt:undefined,updatedAt:undefined});
  }
  approve(id){const version=this.versions.findById(id);if(!version)throw Object.assign(new Error("Versao de curriculo nao encontrada."),{code:"RESUME_VERSION_NOT_FOUND"});if(!["DRAFT","REVIEW_REQUIRED"].includes(version.status))throw Object.assign(new Error("Versao nao esta disponivel para aprovacao."),{code:"RESUME_VERSION_REVIEW_NOT_AVAILABLE"});return this.versions.transition(id,"APPROVED");}
  reject(id){const version=this.versions.findById(id);if(!version)throw Object.assign(new Error("Versao de curriculo nao encontrada."),{code:"RESUME_VERSION_NOT_FOUND"});if(!["DRAFT","REVIEW_REQUIRED"].includes(version.status))throw Object.assign(new Error("Versao nao esta disponivel para rejeicao."),{code:"RESUME_VERSION_REVIEW_NOT_AVAILABLE"});return this.versions.transition(id,"REJECTED");}
  archive(id){return this.versions.transition(id,"ARCHIVED");}
}
