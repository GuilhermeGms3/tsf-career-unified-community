import {SourceResolver} from "../source-resolver.mjs";

const emailPattern=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const applicationContext=/(envie|encaminhe|mandar|enviar).{0,80}(curr[ií]culo|cv)|(?:curr[ií]culo|cv).{0,80}(?:para|em)|candidaturas?\s*:|recrutamento\s*:|rh\s*:/i;
const personalMailbox=/@(gmail|hotmail|outlook|yahoo|icloud)\./i;

export class ApplicationMethodDetector{
  constructor(){this.sources=new SourceResolver();}
  detect(job={}){
    const applicationUrl=String(job.applicationUrl||job.url||""),sourceUrl=String(job.sourceUrl||job.canonicalUrl||job.url||""),text=[job.title,job.description,job.applicationInstructions].filter(Boolean).join("\n").slice(0,100000),source=this.sources.resolve(applicationUrl||sourceUrl);
    if(source.canonicalTarget&&["greenhouse","lever","ashby","smartrecruiters","workable","gupy","workday"].includes(source.atsType))return {method:"ATS",email:"",instructions:"",subjectHint:"",evidence:{strategy:"KNOWN_ATS_URL",provider:source.atsType,confidence:.99}};
    if(source.canonicalTarget&&["iel","programathor","solides","recrutei","nerdin","remotar","abler","quickin","pandape"].includes(source.atsType))return {method:"CAREER_PAGE",email:"",instructions:"",subjectHint:"",evidence:{strategy:"KNOWN_PUBLIC_PLATFORM_URL",provider:source.atsType,platform:true,confidence:.97}};
    const emails=[...new Set(text.match(emailPattern)||[])];if(emails.length&&applicationContext.test(text)){
      const email=emails.find(value=>!personalMailbox.test(value))||emails[0];return {method:"EMAIL",email:email.toLowerCase(),instructions:this.extractInstruction(text,email),subjectHint:cleanSubject(job.title),evidence:{strategy:"PUBLIC_APPLICATION_INSTRUCTION",signals:["APPLICATION_CONTEXT","EMAIL_NEAR_CONTEXT"],confidence:personalMailbox.test(email)?.72:.9}};
    }
    if(emails.length)return {method:"MANUAL",email:"",instructions:"E-mail encontrado sem contexto suficiente de candidatura.",subjectHint:"",evidence:{strategy:"AMBIGUOUS_EMAIL",confidence:.35,reviewRequired:true}};
    if(applicationUrl&&applicationUrl!==sourceUrl)return {method:"EXTERNAL_FORM",email:"",instructions:"",subjectHint:"",evidence:{strategy:"DISTINCT_APPLICATION_URL",confidence:.8}};
    if(applicationUrl||sourceUrl)return {method:"CAREER_PAGE",email:"",instructions:"",subjectHint:"",evidence:{strategy:"PUBLIC_JOB_PAGE",confidence:.65}};
    return {method:"UNKNOWN",email:"",instructions:"",subjectHint:"",evidence:{strategy:"NO_APPLICATION_SIGNAL",confidence:0}};
  }
  extractInstruction(text,email){const at=text.toLowerCase().indexOf(email.toLowerCase()),start=Math.max(0,at-100),end=Math.min(text.length,at+email.length+140);return text.slice(start,end).replace(/\s+/g," ").trim();}
}
const cleanSubject=value=>String(value||"").replace(/[\r\n]/g," ").trim().slice(0,120);
