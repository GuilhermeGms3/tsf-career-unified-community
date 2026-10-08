const hiringPatterns=[
  /\bmeu time (?:est[aá] buscando|busca)\b/i,/\b(?:estamos|estou) (?:buscando|procurando)\b/i,
  /\bprocuro (?:um |uma )?(?:profissional|dev|desenvolvedor|desenvolvedora)\b/i,/\bprecisamos de\b/i,
  /\bposi[cç][aã]o aberta\b/i,/\baumentando (?:o |nosso )?time\b/i,/\btemos (?:uma )?(?:posi[cç][aã]o|oportunidade)\b/i,
  /\bvaga(?:s)? para\b/i,/\bcontratando\b/i,/\bhiring\b/i,/\blooking for\b/i,/\bmy team is (?:hiring|looking for)\b/i,
  /\b(?:vaga|vagas|oportunidade|processo seletivo|est[aá]gio|job opening|join our team)\b/i
];
const applicationPatterns=[/\b(?:curr[ií]culo|cv|candidatar|apply|inscri[cç][aã]o|enviar para|whats(?:app)?|e-?mail)\b/i,/\bchama (?:no )?(?:privado|inbox)\b/i,/\bmanda (?:uma )?dm\b/i,/\bdm me\b/i,/\bmessage me\b/i,/\breach out to me\b/i];
const noise=/\b(bom dia|boa tarde|parab[eé]ns|figurinha|promo[cç][aã]o)\b/i;
const directMessage=/\b(?:chama (?:no )?(?:privado|inbox)|manda (?:uma )?dm|dm me|message me|reach out to me)\b/i;
const titleWords=/\b(?:backend|back-end|frontend|front-end|full\s*stack|devops|sre|dados|data|suporte|infraestrutura|redes|network|security|seguran[cç]a|software|developer|desenvolvedor(?:a)?|engineer|analista|est[aá]gio|intern(?:ship)?)\b/ig;
const knownSkills=["Python","FastAPI","Java","Spring","JavaScript","TypeScript","React","Node.js","AWS","Azure","GCP","Docker","Kubernetes","Terraform","Ansible","Linux","Grafana","Prometheus","Zabbix","SQL","PostgreSQL","MySQL","Git","PowerShell"];
const tidy=value=>String(value||"").replace(/\s+/g," ").trim();
const titleCase=value=>value.toLocaleLowerCase("pt-BR").replace(/(^|\s|[-/])\p{L}/gu,letter=>letter.toLocaleUpperCase("pt-BR")).replace(/Backend/i,"Backend").replace(/Frontend/i,"Frontend").replace(/Devops/i,"DevOps").replace(/Sre/i,"SRE");

export function detectHiringMessage(text=""){
  const normalized=tidy(text).slice(0,6000),intentHits=hiringPatterns.filter(pattern=>pattern.test(normalized)).length,hasApplication=applicationPatterns.some(pattern=>pattern.test(normalized)),score=Math.min(1,(intentHits?0.62+Math.min(.18,(intentHits-1)*.06):0)+(hasApplication?.2:0)-(noise.test(normalized)&&!intentHits?.4:0));
  return {relevant:score>=.55,ambiguous:score>.25&&score<.55,score:Math.max(0,score),normalized};
}

function inferTitle(value){
  const firstSentence=value.split(/[!?\n]|\.(?=\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/u).map(tidy).find(Boolean)||"";
  if(/^(?:estamos\s+)?aumentando\s+(?:o\s+|nosso\s+)?time\b/i.test(firstSentence))return "";
  const explicit=firstSentence.match(/^(?:estamos\s+contratando|contratamos|buscamos|procuramos)\s+(.+)$/i)?.[1];
  if(explicit){
    const candidate=tidy(explicit).replace(/[.,;:]+$/g,"");
    if((candidate.match(titleWords)||[]).length)return candidate.slice(0,180);
  }
  const candidate=firstSentence.replace(/^(?:vaga(?:s)?(?: para)?|oportunidade(?: para)?|estamos (?:buscando|procurando)|procuro|precisamos de)\s*/i,"").replace(/\s+em\s+[\p{L}\s-]+$/u,"").trim(),terms=candidate.match(titleWords)||[];
  if(!terms.length)return "";
  const internship=/est[aá]gio|intern/i.test(candidate),role=terms.filter(term=>!/est[aá]gio|intern/i.test(term)).slice(0,3).join(" ");
  return titleCase([internship?"Estágio":"",role].filter(Boolean).join(" ")).slice(0,180);
}
function inferLocation(value){const explicit=value.match(/\b(?:em|local(?:iza[cç][aã]o)?[:\s]+)\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}.-]+(?:\s+(?:de|do|da|dos|das|[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\p{L}.-]+)){0,3})(?=[.,;!\n]|\s+-\s)/u)?.[1]||"";return tidy(explicit).slice(0,160);}
function inferCompany(value){const match=value.match(/\b(?:empresa|companhia|company)\s+([A-Z][\w&.-]+(?:\s+[A-Z][\w&.-]+){0,3})/);return tidy(match?.[1]||"").slice(0,160);}

export function extractLeadFacts(text=""){
  const value=String(text),email=value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]||"",url=value.match(/https?:\/\/[^\s<>()]+/i)?.[0]||"",phone=value.match(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}/)?.[0]||"",isDirect=directMessage.test(value),skills=knownSkills.filter(skill=>new RegExp(`(^|[^\\p{L}\\d])${skill.replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace("Node\\.js","Node(?:\\.js|js)")}([^\\p{L}\\d]|$)`,"iu").test(value)),applicationMethod=email?"EMAIL":phone?"WHATSAPP":url?"EXTERNAL_FORM":isDirect?"DIRECT_MESSAGE":"UNKNOWN",applicationTarget=email||phone||url||(isDirect?"PRIVATE_MESSAGE":"");
  return {title:inferTitle(value),company:inferCompany(value),location:inferLocation(value),seniority:/\b(?:est[aá]gio|estagi[aá]ri[oa]|intern(?:ship)?)\b/i.test(value)?"INTERNSHIP":/\b(?:j[uú]nior|jr\.?|entry.level)\b/i.test(value)?"JUNIOR":/\b(?:s[eê]nior|sr\.?|lead|principal)\b/i.test(value)?"SENIOR":/\b(?:pleno|mid.level)\b/i.test(value)?"MID":"UNKNOWN",skills,workModel:/\bremot[oa]\b/i.test(value)?"REMOTE":/\bh[ií]brid[oa]\b/i.test(value)?"HYBRID":/\bpresencial\b/i.test(value)?"ONSITE":"",applicationMethod,applicationTarget,applicationContact:applicationTarget,sourceUrl:url,excerpt:tidy(value).slice(0,500)};
}
