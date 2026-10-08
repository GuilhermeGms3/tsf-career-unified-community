import { parseGreenhouseIdentity } from "./greenhouse-identity.mjs";
import { buildDomSignature } from "./dom-signature.mjs";
import { assessAdapterHealth } from "./adapter-health.mjs";

const normalized=(value)=>String(value||"").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/\W+/g," ").trim();
const metadataSemanticKey=(label)=>{const value=normalized(label);if(/\b(resume|curriculo|cv)\b/.test(value))return "RESUME.FILE";if(/cover letter|carta de apresentacao/.test(value))return "COVER_LETTER.FILE";return "";};
const metadataMatchesField=(question,field)=>{const label=normalized(question?.label),semanticKey=metadataSemanticKey(question?.label);return Boolean(label&&label===normalized(field?.label)||semanticKey&&semanticKey===field?.semanticKey);};

export class GreenhouseSchemaResolver {
  async resolve({page,fields=[],metadata=null,job={}}={}) {
    const frameUrls=page.frames().map(frame=>frame.url());let identity=parseGreenhouseIdentity(page.url());
    for(const url of frameUrls){const candidate=parseGreenhouseIdentity(url);if(candidate.confidence>identity.confidence)identity=candidate;}
    const dom=await page.locator("html").first().evaluate((html)=>({language:html.lang||document.documentElement.lang||"",title:document.querySelector("h1, [data-mapped='job-title'], .app-title")?.textContent?.trim()||"",location:document.querySelector("[data-mapped='job-location'], .location")?.textContent?.trim()||"",boardToken:document.querySelector("[data-board-token]")?.getAttribute("data-board-token")||"",jobPostId:document.querySelector("[data-job-id]")?.getAttribute("data-job-id")||""})).catch(()=>({}));
    if(!identity.boardToken&&dom.boardToken)identity={...identity,boardToken:dom.boardToken,signals:[...identity.signals,"board-token-dom"],confidence:0.9};
    if(!identity.jobPostId&&dom.jobPostId)identity={...identity,jobPostId:dom.jobPostId,signals:[...identity.signals,"job-post-id-dom"],confidence:0.9};
    if(identity.boardToken&&identity.jobPostId&&!identity.canonicalUrl)identity.canonicalUrl=`https://job-boards.greenhouse.io/${encodeURIComponent(identity.boardToken)}/jobs/${encodeURIComponent(identity.jobPostId)}`;
    const warnings=[];for(const [key,domValue,metadataValue] of [["title",dom.title,metadata?.title],["location",dom.location,metadata?.location]])if(domValue&&metadataValue&&domValue.trim().toLowerCase()!==String(metadataValue).trim().toLowerCase())warnings.push({code:"DOM_METADATA_DIVERGENCE",field:key,dom:domValue,metadata:String(metadataValue)});
    const requiredQuestions=(metadata?.questions||[]).filter(question=>question.required),reconciledFields=fields.map(field=>requiredQuestions.some(question=>metadataMatchesField(question,field))?{...field,required:true,requiredSource:field.required?field.requiredSource||"DOM":"GREENHOUSE_METADATA"}:field),requiredDivergences=[];
    for(const question of requiredQuestions){const label=normalized(question.label);if(label&&!reconciledFields.some(field=>metadataMatchesField(question,field))){warnings.push({code:"DOM_METADATA_DIVERGENCE_REQUIRED",field:question.label});requiredDivergences.push(`MISSING_REQUIRED_METADATA_FIELD:${label.slice(0,60)}`);}}
    const hasEmbed=await page.locator("iframe[src*='greenhouse'], script[src*='greenhouse']").count();const variant=hasEmbed||frameUrls.some(x=>x!==page.url()&&parseGreenhouseIdentity(x).confidence)?"embedded":/boards\.greenhouse\.io|job-boards\.greenhouse\.io/.test(new URL(page.url()).hostname)?"hosted":"custom-career-page";
    const categories={questions:[],locationQuestions:[],complianceQuestions:[],demographicQuestions:[],consents:[]};
    for(const field of reconciledFields){if(field.consentType)categories.consents.push(field);else if(field.sensitive)categories.demographicQuestions.push(field);else if(field.semanticKey?.startsWith("LOCATION."))categories.locationQuestions.push(field);else if(/WORK_AUTHORIZATION|SPONSORSHIP/.test(field.questionClass||""))categories.complianceQuestions.push(field);else categories.questions.push(field);}
    const health=assessAdapterHealth({fields:reconciledFields,warnings,unsupportedSignals:reconciledFields.length?requiredDivergences:["NO_FORM_FIELDS"]});
    return {ats:"greenhouse",identity:{...identity,boardName:job.company||"",language:dom.language||"",title:dom.title||metadata?.title||job.title||"",location:dom.location||metadata?.location||job.location||"",aggregatorUrl:job.url&&job.url!==identity.canonicalUrl?job.url:""},variant,fields:reconciledFields,...categories,metadata:metadata||null,warnings,domSignature:buildDomSignature(reconciledFields,identity.signals),...health};
  }
}
