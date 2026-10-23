import {normalizeQuestionText,questionFingerprint} from "../application/question-semantics.mjs";

export async function classifyFormQuestions(fields,classifier,{ats,timeoutMs=3000}={}) {
  if(!classifier)return {fields,timedOut:false,failed:false};
  const result=[...fields],deadline=Date.now()+Math.max(1,Math.min(10000,timeoutMs));
  let timedOut=false,failed=false;
  for(let index=0;index<result.length;index++){
    const field=result[index];
    if(field.confidence>=.75||field.sensitive||field.consentType||field.hidden)continue;
    const remaining=deadline-Date.now();if(remaining<=0){timedOut=true;break;}
    let timer;
    const work=Promise.resolve().then(()=>classifier.classify(field)).catch(()=>({failed:true}));
    let enhanced;
    try{enhanced=await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>resolve({timedOut:true}),remaining);})]);}finally{clearTimeout(timer);}
    if(enhanced?.timedOut){timedOut=true;break;}
    if(!enhanced||enhanced.failed){failed=true;break;}
    result[index]={...field,...enhanced,normalizedQuestion:normalizeQuestionText(field.label),fingerprint:questionFingerprint({ats,semanticKey:enhanced.semanticKey,label:field.label,fieldType:field.type,options:field.options})};
  }
  return {fields:result,timedOut,failed};
}
