import { mapSemanticField } from "../field-ontology.mjs";
import { classifyQuestion, FIELD_CONFIDENCE, normalizeQuestionText, questionFingerprint } from "../../../application/question-semantics.mjs";
import { canAutofillApplicationField } from "../../../candidate-knowledge/candidate-knowledge-policy.mjs";
import { validateFormAnswer } from "../../../application/form-answer-format.mjs";
import { reusableFormAnswer, requiresApplicationConfirmation } from "../../../application/answer-reuse-policy.mjs";
import { isItAnswerKey, itAnswerForField } from "../../../application/it-question-answers.mjs";

function authorizedFrame(page, frame) {
  if (frame === page.mainFrame()) return true;
  if (frame.url() === "about:blank" || frame.url() === "about:srcdoc") return Boolean(frame.parentFrame()) && authorizedFrame(page, frame.parentFrame());
  try { const root=new URL(page.url()),child=new URL(frame.url());return root.protocol === child.protocol && root.origin === child.origin && ["https:","http:","file:"].includes(root.protocol); }
  catch { return false; }
}

function frameForField(page, field) {
  const frames=page.frames();
  const frame=Number.isInteger(field.frameIndex)?frames[field.frameIndex]:field.frameUrl?frames.find(candidate=>candidate.url()===field.frameUrl):page.mainFrame();
  if (!frame || field.frameUrl && frame.url()!==field.frameUrl || !authorizedFrame(page,frame)) throw Object.assign(new Error("O frame do formulario mudou; inspecione novamente."),{code:"FORM_FRAME_CHANGED"});
  return frame;
}

function hasAnswer(value){return value!==undefined&&value!==null&&value!==""&&(!Array.isArray(value)||value.length>0)}
const confirmedQuestionSources=new Set(["USER_CONFIRMED","LLM_APPROVED","LLM_EXTRACTIVE","user","CANDIDATE_PROFILE"]);

export class GenericAdapter {
  static type="generic"; static version="generic-adapter-v2";
  async inspectApplicationForm(page) {
    try { return await this.inspectFormSnapshot(page); }
    catch (error) {
      if (!/execution context was destroyed|frame was detached/i.test(String(error.message))) throw error;
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
      return this.inspectFormSnapshot(page);
    }
  }
  async inspectFormSnapshot(page) {
    const fields=[],blockedFrames=[];
    for(const frame of page.frames()){
      if(!authorizedFrame(page,frame)){
        const element=await frame.frameElement();
        if(await element.isVisible()&&await frame.locator("input:not([type=hidden]):visible,textarea:visible,select:visible,[role=combobox]:visible").count())blockedFrames.push({index:page.frames().indexOf(frame),reason:"CROSS_ORIGIN_FORM"});
        continue;
      }
      const raw=await frame.locator("input:not([type=submit]):not([type=button]):not([aria-hidden='true']), textarea, select, [role=combobox]:not(input):not(select)").evaluateAll((elements)=>{
        const labelFor=(el)=>{const id=el.id||"";const explicit=id?document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent:"";const labelled=String(el.getAttribute("aria-labelledby")||"").split(/\s+/).filter(Boolean).map(key=>document.getElementById(key)?.textContent||"").join(" ");return String(explicit||el.closest("label")?.textContent||el.getAttribute("aria-label")||labelled||el.closest("fieldset")?.querySelector("legend")?.textContent||"").trim()};
        const descriptionFor=(el)=>{const described=String(el.getAttribute("aria-describedby")||"").split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||"").join(" ");return String(described||el.closest("fieldset,.field,.application-question,.question")?.querySelector("small,.description,.help-text")?.textContent||"").trim()};
        const groups=new Map();
        elements.forEach((el,index)=>{const rawType=el.type||el.tagName.toLowerCase();const groupable=(rawType==="radio"||rawType==="checkbox")&&el.name;const key=groupable?`${rawType}:${el.name}`:`single:${index}`;const current=groups.get(key)||[];current.push(el);groups.set(key,current)});
        return [...groups.values()].map((group,index)=>{
          const el=group[0],rawType=el.type||el.tagName.toLowerCase(),id=el.id||"",name=el.name||"";
          const grouped=group.length>1||rawType==="radio"&&Boolean(name);
          const type=el.tagName==="SELECT"?(el.multiple?"select-multiple":"select-one"):el.getAttribute("role")==="combobox"?"combobox":grouped?`${rawType}-group`:rawType;
          const label=grouped?String(el.closest("fieldset")?.querySelector("legend")?.textContent||labelFor(el)).trim():labelFor(el);
          const listId=el.getAttribute("aria-controls")||el.getAttribute("aria-owns"),list=listId?document.getElementById(listId):null;
          const options=el.tagName==="SELECT"?[...el.options].filter(option=>!option.disabled&&option.value!=="").map(option=>({value:option.value,label:String(option.textContent||"").trim()})):grouped?group.map(option=>({value:option.value,label:labelFor(option)})):type==="combobox"&&list?[...list.querySelectorAll('[role=option]:not([aria-disabled=true])')].slice(0,100).map(option=>({value:option.getAttribute("data-value")||String(option.textContent||"").trim(),label:String(option.textContent||"").trim()})):[];
          const selector=grouped&&name?`[name="${CSS.escape(name)}"]`:id?`#${CSS.escape(id)}`:name?`[name="${CSS.escape(name)}"]`:`:nth-match(:is(input:not([type=submit]):not([type=button]):not([aria-hidden='true']),textarea,select,[role=combobox]:not(input):not(select)),${elements.indexOf(el)+1})`;
          const visible=element=>Boolean(element.getClientRects().length)&&getComputedStyle(element).visibility!=="hidden";
          const hidden=rawType==="hidden"||Boolean(el.closest("[hidden],[aria-hidden='true']"))||rawType!=="file"&&!group.some(option=>visible(option)||[...(option.labels||[])].some(visible));
          const declaredRequired=group.some(x=>x.required||x.getAttribute("aria-required")==="true")||/\*|obrigat[oó]ri[oa]/i.test(label);
          return {externalKey:id||name||`field-${index}`,selector,id,name,type,label,description:descriptionFor(el),placeholder:el.getAttribute("placeholder")||"",ariaLabel:el.getAttribute("aria-label")||"",autocomplete:el.getAttribute("autocomplete")||"",nearbyText:"",declaredRequired,required:!hidden&&declaredRequired,multiple:type==="checkbox-group"||Boolean(el.multiple),options,hidden,source:"DOM_VISIBLE_AUTHORITY"};
        });
      });
      for(const item of raw){const mapped=mapSemanticField(item);const classification=classifyQuestion({...item,...mapped});const field={...item,...mapped,...classification,frameUrl:frame.url(),frameIndex:page.frames().indexOf(frame)};field.confidence=Math.max(mapped.confidence||0,classification.confidence||0);field.signals=[...(mapped.signals||[]),...(classification.signals||[])];field.normalizedQuestion=normalizeQuestionText(field.label);field.fingerprint=questionFingerprint({ats:this.constructor.type,semanticKey:field.semanticKey,label:field.label,fieldType:field.type,options:field.options});field.answerStatus=field.required?"USER_REQUIRED":"UNKNOWN";field.reasonRequired=field.sensitive?"Pergunta sensivel exige decisao do usuario.":field.consentType?"Consentimento exige confirmacao explicita.":field.confidence<FIELD_CONFIDENCE.REVIEW?"Campo obrigatorio com classificacao de baixa confianca.":"Resposta confirmada nao encontrada.";fields.push(field);}
    }
    if(!fields.length)throw Object.assign(new Error("Formulario de candidatura nao encontrado."),{code:"FORM_NOT_FOUND"});
    return {fields,blockedFrames,submitVisible:await page.locator("button[type=submit],input[type=submit]").count()>0};
  }
  mapFields(inspected,knowledge,questions=[],candidateAnswers=knowledge.confirmedAnswers||[]) {
    return inspected.fields.map(field=>{const question=questions.find(x=>x.fingerprint&&x.fingerprint===field.fingerprint)||questions.find(x=>x.externalKey===field.externalKey&&!x.fingerprint);const memory=reusableFormAnswer(field,candidateAnswers);const candidateFact=knowledge.get(field.semanticKey),known=candidateFact?.sourceType==="APPLICATION_ANSWER"?null:candidateFact;let answer;let answerSource="";let answerStatus=field.required?"USER_REQUIRED":"UNKNOWN";
      let autofillAuthority=null,explicitConfirmation=false,fromKnowledge=false;
      if(question?.answerStatus==="KNOWN"&&confirmedQuestionSources.has(question.answerSource)){answer=question.answerValue;answerSource=question.answerSource;answerStatus="KNOWN";explicitConfirmation=["USER_CONFIRMED","LLM_APPROVED","user"].includes(question.answerSource);autofillAuthority={verificationStatus:explicitConfirmation?"USER_CONFIRMED":"IMPORTED_CONFIRMED",verified:true,reusePolicy:"REUSABLE"};}
      else if(!field.sensitive&&!field.consentType&&memory){answer=memory.answerValue;answerSource="USER_CONFIRMED";answerStatus="KNOWN";}
      else if(!field.sensitive&&!field.consentType&&field.confidence>=FIELD_CONFIDENCE.AUTO_FILL&&known){answer=known.value;answerSource=known.source;answerStatus=known.verified?"KNOWN":"DERIVED";fromKnowledge=true;}
      if(field.required&&field.confidence<FIELD_CONFIDENCE.REVIEW&&!hasAnswer(question?.answerValue)){answer=undefined;answerStatus="USER_REQUIRED";}
      if(!autofillAuthority)autofillAuthority=memory&&answerSource==="USER_CONFIRMED"?{verificationStatus:"USER_CONFIRMED",verified:true,reusePolicy:"REUSABLE"}:known;
      const autofillEligible=(!requiresApplicationConfirmation(field)||explicitConfirmation)&&canAutofillApplicationField(autofillAuthority,field,{explicit:explicitConfirmation});
      if(answer!==undefined&&!autofillEligible)answerStatus="USER_REQUIRED";
      // Perguntas de TI: anos, Sim/Nao e nivel de idioma viram a opcao do formulario sem exagerar; sem opcao unica, fica com voce.
      const format=!hasAnswer(answer)?{valid:true,value:answer}:fromKnowledge&&isItAnswerKey(field.semanticKey)?itAnswerForField(field,answer)||{valid:false,reason:"Nenhuma opção corresponde ao seu histórico confirmado; responda esta pergunta."}:validateFormAnswer(field,answer);
      if(!format.valid)answerStatus="USER_REQUIRED";
      else answer=format.value;
      return {...field,answer,answerSource,answerStatus,autofillAuthority,explicitConfirmation,autofillEligible,answerFormatInvalid:!format.valid,...(!format.valid?{reasonRequired:format.reason}:{})};
    });
  }
  locatorForField(frame,field){if(field.type==="radio-group"||field.type==="checkbox-group")return frame.locator(field.selector);if(field.label){const byLabel=frame.getByLabel(field.label,{exact:true});return byLabel;}return frame.locator(field.selector);}
  frameForField(page,field){return frameForField(page,field);}
  async fill(page,mapped,{resumePath="",coverLetterPath=""}={}){
    const audit=[];
    for(const field of mapped){const base={field:field.semanticKey,externalKey:field.externalKey,source:field.answerSource||""};if(field.hidden){audit.push({...base,status:"SKIPPED"});continue;}if(!hasAnswer(field.answer)){audit.push({...base,status:field.required?"USER_REQUIRED":"SKIPPED"});continue;}
      const selectedUpload=field.type==="file"&&["RESUME.FILE","COVER_LETTER.FILE"].includes(field.semanticKey)&&field.answerStatus==="KNOWN";
      if(!selectedUpload&&(field.answerStatus!=="KNOWN"||!canAutofillApplicationField(field.autofillAuthority,field,{explicit:field.explicitConfirmation===true}))){audit.push({...base,status:"USER_REQUIRED",code:"AUTOFILL_AUTHORITY_REQUIRED"});continue;}
      try{const frame=frameForField(page,field);let locator=this.locatorForField(frame,field);if(await locator.count()===0)locator=frame.locator(field.selector);
        if(field.type==="file"){const upload=field.semanticKey==="COVER_LETTER.FILE"?coverLetterPath:resumePath;if(!upload){audit.push({...base,status:field.required?"USER_REQUIRED":"SKIPPED"});continue;}await locator.first().setInputFiles(upload);}
        else if(field.type==="combobox"){
          const control=locator.first();await control.click();
          if(await control.evaluate(el=>el.tagName==="INPUT"&&!el.readOnly))await control.fill(String(field.answer));
          const listId=await control.getAttribute("aria-controls")||await control.getAttribute("aria-owns");
          if(!listId)throw Object.assign(new Error("Lista de opcoes nao identificada."),{code:"COMBOBOX_OPTIONS_UNAVAILABLE"});
          const list=frame.locator(`[id=${JSON.stringify(listId)}]`),option=list.getByRole("option",{name:String(field.options?.find(item=>String(item.value)===String(field.answer))?.label||field.answer),exact:true});
          if(await option.count()!==1||!await option.isVisible()||await option.getAttribute("aria-disabled")==="true")throw Object.assign(new Error("Opcao exata nao encontrada."),{code:"OPTION_NOT_FOUND"});
          await option.click();
        }
        // A resposta mapeada e o value da opcao; buscar primeiro pelo rotulo esperava 30 s em toda lista com value diferente do texto.
        else if(field.type==="select-one"){const control=locator.first(),value=String(field.answer),byValue=await control.evaluate((el,value)=>[...el.options].some(option=>option.value===value),value);await control.selectOption(byValue?value:{label:value});}
        else if(field.type==="select-multiple")await locator.first().selectOption(Array.isArray(field.answer)?field.answer.map(String):[String(field.answer)]);
        else if(field.type==="checkbox"){if(Boolean(field.answer))await locator.first().check();else await locator.first().uncheck();}
        else if(field.type==="checkbox-group"||field.type==="radio-group"){const values=Array.isArray(field.answer)?field.answer.map(x=>String(x).toLowerCase()):[String(field.answer).toLowerCase()];let selected=0;for(let i=0;i<await locator.count();i++){const option=locator.nth(i);const value=String(await option.getAttribute("value")||"").toLowerCase();const label=String(await option.evaluate(el=>el.closest("label")?.textContent||"")).trim().toLowerCase();if(values.some(x=>x===value||x===label||(x==="true"&&/yes|sim|true|1/.test(value+" "+label)))){await option.check();selected++;if(field.type==="radio-group")break;}}if(!selected)throw Object.assign(new Error("Opcao conhecida nao encontrada."),{code:"OPTION_NOT_FOUND"});}
        else await locator.first().fill(String(field.answer));audit.push({...base,status:"FILLED"});
      }catch(error){audit.push({...base,status:"FAILED",code:error.name==="TimeoutError"?"FIELD_TIMEOUT":error.code||"FILL_FAILED"});}
    }return audit;
  }
  async validate(page,mapped){
    const unknown=mapped.filter(f=>f.required&&!f.hidden&&(f.answerStatus==="USER_REQUIRED"||!hasAnswer(f.answer))),invalid=[];
    for(const field of mapped.filter(f=>!f.hidden)){
      try{
        const frame=frameForField(page,field);let locator=this.locatorForField(frame,field);
        if(await locator.count()===0)locator=frame.locator(field.selector);
        const ok=await locator.first().evaluate((el,field)=>{
          if(el.getAttribute("aria-invalid")==="true")return false;
          if(field.type==="combobox"){
            const option=field.options?.find(item=>String(item.value)===String(field.answer));
            const actual=String(el.value??el.getAttribute("data-value")??el.textContent??"").trim();
            if(![String(field.answer),String(option?.label??field.answer)].includes(actual))return false;
          }
          return typeof el.checkValidity==="function"?el.checkValidity():field.type==="combobox";
        },field).catch(()=>false);
        if(!ok)invalid.push(field.semanticKey);
      }catch{invalid.push(field.semanticKey);}
    }
    return {valid:!unknown.length&&!invalid.length,unknown,invalid};
  }
}
