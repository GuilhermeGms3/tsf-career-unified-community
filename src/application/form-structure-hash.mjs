import {snapshotHash} from "./submission-snapshot.mjs";

const CORE_SUBMISSION_FIELDS=new Set(["RESUME.FILE","IDENTITY.FULL_NAME","PERSON.FULL_NAME","CONTACT.EMAIL"]);

export function submissionCriticalFields(fields=[]){
  return fields.filter(field=>field.required||CORE_SUBMISSION_FIELDS.has(field.semanticKey));
}

export function formStructureHash(fields=[],{criticalOnly=false}={}){
  const selected=criticalOnly?submissionCriticalFields(fields):fields.filter(field=>!field.hidden||field.required);
  return snapshotHash(selected.map(field=>({externalKey:field.externalKey,semanticKey:field.semanticKey,label:field.label,type:field.type,required:Boolean(field.required),options:(field.options||[]).map(option=>({value:option.value,label:option.label}))})));
}
