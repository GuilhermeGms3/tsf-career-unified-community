import {createHash} from "node:crypto";

function normalize(value){if(Array.isArray(value))return value.map(normalize);if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])]));return value;}
export function canonicalJson(value){return JSON.stringify(normalize(value));}
export function snapshotHash(value){return createHash("sha256").update(canonicalJson(value)).digest("hex");}
export function buildAnswerSnapshot(questions=[]){return questions.map(question=>({id:question.id,semanticKey:question.semanticKey,required:Boolean(question.required),sensitive:Boolean(question.sensitive),answerStatus:question.answerStatus,answerSource:question.answerSource||"",answerValue:question.answerValue}));}
export function sanitizeFormSnapshot(questions=[]){return questions.map(question=>{const answered=question.answerValue!==null&&question.answerValue!==undefined&&question.answerValue!=="";return {field:question.label||question.semanticKey,presentation:question.sensitive&&answered?"Resposta fornecida (oculta)":answered?question.answerValue:null,source:question.answerSource||"",confidence:Number(question.confidence||0),requiresConsent:Boolean(question.sensitive||question.consentType),evidenceRef:question.evidenceRef||"",status:question.answerStatus};});}
