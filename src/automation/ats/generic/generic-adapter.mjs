import { mapSemanticField } from "../field-ontology.mjs";
import { classifyQuestion, FIELD_CONFIDENCE, normalizeQuestionText, questionFingerprint } from "../../../application/question-semantics.mjs";
import { canAutofillApplicationField } from "../../../candidate-knowledge/candidate-knowledge-policy.mjs";

function hasAnswer(value){return value!==undefined&&value!==null&&value!==""&&(!Array.isArray(value)||value.length>0)}
const confirmedQuestionSources=new Set(["USER_CONFIRMED","LLM_APPROVED","user","CANDIDATE_PROFILE"]);

export class GenericAdapter {
  static type="generic"; static version="generic-adapter-v2";
  async inspectApplicationForm(page) {
    const fields=[];
    for(const frame of page.frames()){
      const raw=await frame.locator("input:not([type=submit]):not([type=button]):not([aria-hidden='true']), textarea, select").evaluateAll((elements)=>{
        const labelFor=(el)=>{const id=el.id||"";const explicit=id?document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent:"";const labelled=String(el.getAttribute("aria-labelledby")||"").split(/\s+/).filter(Boolean).map(key=>document.getElementById(key)?.textContent||"").join(" ");return String(explicit||el.closest("label")?.textContent||el.getAttribute("aria-label")||labelled||"").trim()};
        const descriptionFor=(el)=>{const described=String(el.getAttribute("aria-describedby")||"").split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||"").join(" ");return String(described||el.closest("fieldset,.field,.application-question,.question")?.querySelector("small,.description,.help-text")?.textContent||"").trim()};
        const groups=new Map();
        elements.forEach((el,index)=>{const rawType=el.type||el.tagName.toLowerCase();const groupable=(rawType==="radio"||rawType==="checkbox")&&el.name;const key=groupable?`${rawType}:${el.name}`:`single:${index}`;const current=groups.get(key)||[];current.push(el);groups.set(key,current)});
        return [...groups.values()].map((group,index)=>{const el=group[0];const rawType=el.type||el.tagName.toLowerCase();const grouped=group.length>1;const id=el.id||"";const name=el.name||"";const type=el.tagName==="SELECT"?(el.multiple?"select-multiple":"select-one"):grouped?`${rawType}-group`:rawType;const label=grouped?String(el.closest("fieldset")?.querySelector("legend")?.textContent||labelFor(el)).trim():labelFor(el);const nearby=String(el.closest("fieldset,.field,.application-question,.question,div")?.textContent||"").trim().slice(0,500);const options=el.tagName==="SELECT"?[...el.options].map(o=>({value:o.value,label:String(o.textContent||"").trim()})):grouped?group.map(option=>({value:option.value,label:labelFor(option)})):[];const selector=id?`#${CSS.escape(id)}`:name?`[name="${CSS.escape(name)}"]`:`input:nth-of-type(${index+1})`;return {externalKey:id||name||`field-${index}`,selector,id,name,type,label,description:descriptionFor(el),placeholder:el.getAttribute("placeholder")||"",ariaLabel:el.getAttribute("aria-label")||"",autocomplete:el.getAttribute("autocomplete")||"",nearbyText:nearby,required:group.some(x=>x.required||x.getAttribute("aria-required")==="true"),multiple:Boolean(el.multiple||grouped),options,hidden:rawType==="hidden",source:"DOM_VISIBLE_AUTHORITY"};});
      });
      for(const item of raw){const mapped=mapSemanticField(item);const classification=classifyQuestion({...item,...mapped});const field={...item,...mapped,...classification,frameUrl:frame.url()};field.confidence=Math.max(mapped.confidence||0,classification.confidence||0);field.signals=[...(mapped.signals||[]),...(classification.signals||[])];field.normalizedQuestion=normalizeQuestionText(field.label);field.fingerprint=questionFingerprint({ats:this.constructor.type,semanticKey:field.semanticKey,label:field.label,fieldType:field.type,options:field.options});field.answerStatus=field.required?"USER_REQUIRED":"UNKNOWN";field.reasonRequired=field.sensitive?"Pergunta sensivel exige decisao do usuario.":field.consentType?"Consentimento exige confirmacao explicita.":field.confidence<FIELD_CONFIDENCE.REVIEW?"Campo obrigatorio com classificacao de baixa confianca.":"Resposta confirmada nao encontrada.";fields.push(field);}
    }
    if(!fields.length)throw Object.assign(new Error("Formulario de candidatura nao encontrado."),{code:"FORM_NOT_FOUND"});
    return {fields,submitVisible:await page.locator("button[type=submit],input[type=submit]").count()>0};
  }
  mapFields(inspected,knowledge,questions=[],candidateAnswers=[]) {
    return inspected.fields.map(field=>{const question=questions.find(x=>x.fingerprint&&x.fingerprint===field.fingerprint)||questions.find(x=>x.externalKey===field.externalKey);const memory=candidateAnswers.find(x=>x.fingerprint===field.fingerprint&&x.verified&&x.reusable&&!x.sensitive);const known=knowledge.get(field.semanticKey);let answer;let answerSource="";let answerStatus=field.required?"USER_REQUIRED":"UNKNOWN";
      let autofillAuthority=null,explicitConfirmation=false;
      if(question?.answerStatus==="KNOWN"&&confirmedQuestionSources.has(question.answerSource)){answer=question.answerValue;answerSource=question.answerSource;answerStatus="KNOWN";explicitConfirmation=["USER_CONFIRMED","LLM_APPROVED","user"].includes(question.answerSource);autofillAuthority={verificationStatus:explicitConfirmation?"USER_CONFIRMED":"IMPORTED_CONFIRMED",verified:true,reusePolicy:"REUSABLE"};}
      else if(!field.sensitive&&!field.consentType&&memory){answer=memory.answerValue;answerSource="USER_CONFIRMED";answerStatus="KNOWN";}
      else if(!field.sensitive&&!field.consentType&&field.confidence>=FIELD_CONFIDENCE.AUTO_FILL&&known){answer=known.value;answerSource=known.source;answerStatus=known.verified?"KNOWN":"DERIVED";}
      if(field.required&&field.confidence<FIELD_CONFIDENCE.REVIEW&&!question?.answerValue){answer=undefined;answerStatus="USER_REQUIRED";}
      if(!autofillAuthority)autofillAuthority=memory&&answerSource==="USER_CONFIRMED"?{verificationStatus:"USER_CONFIRMED",verified:true,reusePolicy:"REUSABLE"}:known;
      const autofillEligible=canAutofillApplicationField(autofillAuthority,field,{explicit:explicitConfirmation});
      if(answer!==undefined&&!autofillEligible)answerStatus="USER_REQUIRED";
      return {...field,answer,answerSource,answerStatus,autofillAuthority,explicitConfirmation,autofillEligible};
    });
  }
  locatorForField(frame,field){if(field.label){const byLabel=frame.getByLabel(field.label,{exact:true});return byLabel;}return frame.locator(field.selector);}
  async fill(page,mapped,{resumePath="",coverLetterPath=""}={}){
    const audit=[];
    for(const field of mapped){const base={field:field.semanticKey,externalKey:field.externalKey,source:field.answerSource||""};if(field.hidden){audit.push({...base,status:"SKIPPED"});continue;}if(!hasAnswer(field.answer)){audit.push({...base,status:field.required?"USER_REQUIRED":"SKIPPED"});continue;}
      const selectedUpload=field.type==="file"&&["RESUME.FILE","COVER_LETTER.FILE"].includes(field.semanticKey)&&field.answerStatus==="KNOWN";
      if(!selectedUpload&&(field.answerStatus!=="KNOWN"||!canAutofillApplicationField(field.autofillAuthority,field,{explicit:field.explicitConfirmation===true}))){audit.push({...base,status:"USER_REQUIRED",code:"AUTOFILL_AUTHORITY_REQUIRED"});continue;}
      const frame=page.frames().find(f=>f.url()===field.frameUrl)||page.mainFrame();let locator=this.locatorForField(frame,field);if(await locator.count()===0)locator=frame.locator(field.selector);try{
        if(field.type==="file"){const upload=field.semanticKey==="COVER_LETTER.FILE"?coverLetterPath:resumePath;if(!upload){audit.push({...base,status:field.required?"USER_REQUIRED":"SKIPPED"});continue;}await locator.first().setInputFiles(upload);}
        else if(field.type==="select-one")await locator.first().selectOption({label:String(field.answer)}).catch(()=>locator.first().selectOption(String(field.answer)));
        else if(field.type==="select-multiple")await locator.first().selectOption(Array.isArray(field.answer)?field.answer.map(String):[String(field.answer)]);
        else if(field.type==="checkbox"){if(Boolean(field.answer))await locator.first().check();else await locator.first().uncheck();}
        else if(field.type==="checkbox-group"||field.type==="radio-group"){const values=Array.isArray(field.answer)?field.answer.map(x=>String(x).toLowerCase()):[String(field.answer).toLowerCase()];let selected=0;for(let i=0;i<await locator.count();i++){const option=locator.nth(i);const value=String(await option.getAttribute("value")||"").toLowerCase();const label=String(await option.evaluate(el=>el.closest("label")?.textContent||"")).trim().toLowerCase();if(values.some(x=>x===value||x===label||(x==="true"&&/yes|sim|true|1/.test(value+" "+label)))){await option.check();selected++;if(field.type==="radio-group")break;}}if(!selected)throw Object.assign(new Error("Opcao conhecida nao encontrada."),{code:"OPTION_NOT_FOUND"});}
        else await locator.first().fill(String(field.answer));audit.push({...base,status:"FILLED"});
      }catch(error){audit.push({...base,status:"FAILED",code:error.code||"FILL_FAILED"});}
    }return audit;
  }
  async validate(page,mapped){const unknown=mapped.filter(f=>f.required&&!f.hidden&&(f.answerStatus==="USER_REQUIRED"||!hasAnswer(f.answer)));const invalid=[];for(const field of mapped.filter(f=>!f.hidden)){const frame=page.frames().find(x=>x.url()===field.frameUrl)||page.mainFrame();let locator=this.locatorForField(frame,field);if(await locator.count()===0)locator=frame.locator(field.selector);const ok=await locator.first().evaluate(el=>el.checkValidity()).catch(()=>false);if(!ok)invalid.push(field.semanticKey);}return {valid:!unknown.length&&!invalid.length,unknown,invalid};}
}
