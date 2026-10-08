import { CandidateKnowledgeBase } from "./candidate-knowledge-base.mjs";

const fields=[
  ["IDENTITY.FIRST_NAME","Nome"],["IDENTITY.LAST_NAME","Sobrenome"],["CONTACT.EMAIL","Email"],["CONTACT.PHONE","Telefone"],
  ["LOCATION.CITY","Cidade"],["LOCATION.COUNTRY","Pais"],["PROFILE.LINKEDIN","LinkedIn"],["PROFILE.GITHUB","GitHub"],
  ["PROFILE.PORTFOLIO","Portfolio"],["WORK_AUTHORIZATION.AUTHORIZED","Autorizacao de trabalho"],
  ["WORK_AUTHORIZATION.REQUIRES_SPONSORSHIP","Sponsorship"],["APPLICATION.NOTICE_PERIOD","Disponibilidade"],
  ["PREFERENCES.RELOCATION","Relocation"],["PREFERENCES.SALARY_EXPECTATION","Pretensao salarial"],["language.*","Idiomas"]
];

export function analyzeProfileCompleteness(profile={}) {
  const kb=CandidateKnowledgeBase.fromProfile(profile);const known=[];const missing=[];
  for(const [key,label] of fields){const present=key.endsWith(".*")?kb.all().some(item=>item.key.startsWith(key.slice(0,-1))):Boolean(kb.get(key));(present?known:missing).push({key,label});}
  return {completionScore:Math.round(known.length/fields.length*100),known,missing,recommended:missing.map(x=>({...x,optional:true}))};
}
