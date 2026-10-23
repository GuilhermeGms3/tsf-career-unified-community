export const QUESTION_FALLBACK_DEFAULTS = Object.freeze({enabled:false,waitMinutes:20,autoFillEnabled:false,researchEnabled:false,model:""});
const key="application_question_fallback_v1";
export class QuestionFallbackPolicyRepository {
  constructor(database) { this.database=database; }
  get() {
    let saved={};
    try { saved=JSON.parse(this.database.getMetadata(key,"{}")); } catch {}
    return {...QUESTION_FALLBACK_DEFAULTS,...saved};
  }
  save(input={}) {
    const policy={...this.get(),...input};
    if(["enabled","autoFillEnabled","researchEnabled"].some(k=>typeof policy[k]!=="boolean")||
      !Number.isInteger(policy.waitMinutes)||policy.waitMinutes<1||policy.waitMinutes>120||
      typeof policy.model!=="string"||policy.model.length>200)
      throw Object.assign(new Error("Use um prazo de 1 a 120 minutos e opcoes validas para as perguntas."),{code:"QUESTION_FALLBACK_POLICY_INVALID",status:400});
    const saved=Object.fromEntries(Object.keys(QUESTION_FALLBACK_DEFAULTS).map(k=>[k,policy[k]]));
    this.database.setMetadata(key,JSON.stringify(saved));
    return saved;
  }
}
