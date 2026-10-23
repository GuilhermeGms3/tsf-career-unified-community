import {GenericAdapter} from "../generic/generic-adapter.mjs";import {buildDomSignature} from "../greenhouse/dom-signature.mjs";import {assessAdapterHealth} from "../greenhouse/adapter-health.mjs";
export class HostedAtsAdapter extends GenericAdapter{
  constructor(type,version){super();this.type=type;this.version=version;}
  async inspectApplicationForm(page,{questions=[]}={}){
    let inspected;
    try{inspected=await super.inspectApplicationForm(page);}catch(error){if(error.code!=="FORM_NOT_FOUND")throw error;inspected={fields:[],submitVisible:false};}
    const confirmed=field=>Boolean(field.fingerprint&&questions.some(question=>question.fingerprint===field.fingerprint&&question.answerStatus==="KNOWN"&&["USER_CONFIRMED","LLM_APPROVED","LLM_EXTRACTIVE","user"].includes(question.answerSource)));
    const unknownRequired=inspected.fields.filter(field=>field.required&&field.confidence<.7&&!confirmed(field));
    const materialFields=inspected.fields.filter(field=>!field.hidden||field.required);
    const hasApplicationIdentity=inspected.fields.some(field=>!field.hidden&&/^(IDENTITY\.|CONTACT\.EMAIL$|RESUME\.FILE$)/.test(field.semanticKey||""));
    const unsupportedSignals=inspected.fields.length?[]:["NO_FORM_FIELDS"];
    if(inspected.fields.length&&!hasApplicationIdentity)unsupportedSignals.push("NO_APPLICATION_IDENTITY_FIELDS");
    // Unknown questions need answers, not a declaration that the whole layout is unsupported.
    const assessmentFields=inspected.fields.map(field=>confirmed(field)?{...field,semanticKey:field.semanticKey==="CUSTOM.QUESTION"?"CONFIRMED.QUESTION":field.semanticKey,confidence:Math.max(.9,field.confidence)}:field);
    const warnings=unknownRequired.map(field=>({code:"UNKNOWN_REQUIRED_QUESTION",field:field.label}));
    const health=assessAdapterHealth({fields:assessmentFields,warnings,unsupportedSignals});
    const schema={ats:this.type,variant:/\/apply\/?$/i.test(new URL(page.url()).pathname)?"hosted-apply":"hosted-job",fields:inspected.fields,warnings,domSignature:buildDomSignature(materialFields,[this.type]),...health};
    return {...inspected,schema};
  }
}
