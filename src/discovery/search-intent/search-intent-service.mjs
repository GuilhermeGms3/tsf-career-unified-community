import {jobFamilyCatalog} from "./job-family-catalog.mjs";
import {QueryBudgetPolicy} from "./query-budget-policy.mjs";

const allowedSeniorities=new Set(["INTERNSHIP","JUNIOR","MID","SENIOR"]),allowedModels=new Set(["ONSITE","HYBRID","REMOTE"]);
const clean=value=>String(value||"").trim().replace(/\s+/g," ").slice(0,160);
const unique=(values,max=50)=>[...new Set((Array.isArray(values)?values:[]).map(clean).filter(Boolean))].slice(0,max);
const broadQuery=/^(est[aá]gio|intern(ship)?|t[eé]cnico|analista|engenharia|suporte|operations?)$/i;

export function normalizeLocationPolicy(input={}){
  const priorities=(Array.isArray(input.priorities)?input.priorities:[]).slice(0,8).map((item,index)=>({
    priority:Math.max(1,Math.min(9,Number(item.priority)||index+1)),location:clean(item.location),workModel:allowedModels.has(item.workModel)?item.workModel:"ONSITE",remoteScope:item.workModel==="REMOTE"?clean(item.remoteScope||"BRASIL"):"",accepted:item.accepted!==false
  })).filter(item=>item.location||item.workModel==="REMOTE");
  return {priorities,allowOnsiteOutsideArea:input.allowOnsiteOutsideArea===true};
}

export class SearchIntentService{
  constructor({intents=null,expandedQueries=null,families=jobFamilyCatalog,budget=new QueryBudgetPolicy()}={}){Object.assign(this,{intents,expandedQueries,families,budget});}
  normalize(input={}){return {
    name:clean(input.name||"Busca de vagas"),
    families:unique(input.families,12).map(value=>value.toUpperCase()).filter(id=>this.families.get(id)),
    customTerms:unique(input.customTerms||input.queries,20),
    seniorities:unique(input.seniorities,4).map(value=>value.toUpperCase()).filter(value=>allowedSeniorities.has(value)),
    locationPolicy:normalizeLocationPolicy(input.locationPolicy),
    languages:unique(input.languages||["pt-BR","en"],4),
    semanticExpansion:input.semanticExpansion===true
  };}
  expand(input={},budgetInput={}){
    const intent=this.normalize(input),items=[];
    const add=(query,reason,source,familyId="",tier="TIER_2")=>{query=clean(query);if(query)items.push({query,reason,source,familyId,tier});};
    for(const familyId of intent.families){const family=this.families.get(familyId);for(const alias of [...family.aliases,...(family.ambiguousAliases||[])])add(alias,`Alias da família ${family.label}`,"TAXONOMY",familyId,"TIER_1");}
    for(const term of intent.customTerms){
      if(broadQuery.test(term))for(const familyId of intent.families.slice(0,4)){const family=this.families.get(familyId);add(`${family.aliases[0]} ${term}`,`Termo amplo contextualizado pela família ${family.label}`,"ORIGINAL",familyId,"TIER_2");}
      add(term,"Termo informado pelo usuário", "ORIGINAL","",broadQuery.test(term)?"TIER_3":"TIER_2");
    }
    const senioritySuffix={INTERNSHIP:["estágio","intern"],JUNIOR:["júnior","junior"],MID:["pleno","mid-level"],SENIOR:["sênior","senior"]};
    const seeds=[...items].filter(item=>item.tier!=="TIER_3");for(const seniority of intent.seniorities)for(const seed of seeds.slice(0,8))for(const suffix of senioritySuffix[seniority]||[])add(`${seed.query} ${suffix}`,`Variação de senioridade ${seniority}`,"ALIAS",seed.familyId,seed.tier);
    const tierOrder={TIER_1:1,TIER_2:2,TIER_3:3};items.sort((a,b)=>tierOrder[a.tier]-tierOrder[b.tier]);
    const dedup=new Map();for(const item of items){const key=item.query.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();if(!dedup.has(key))dedup.set(key,item);}
    const candidates=[...dedup.values()],constrained=this.budget.constrain(candidates,[],budgetInput);return {intent,candidates,queries:constrained.queries.map(query=>candidates.find(item=>item.query===query)),budget:constrained.policy,truncated:constrained.truncated};
  }
  save(profileId,input={},budgetInput={}){const expanded=this.expand(input,budgetInput),current=this.intents?.forProfile(profileId),version=(current?.version||0)+1,intent=this.intents?.save({profileId,version,originalIntent:expanded.intent,locationPolicy:expanded.intent.locationPolicy,seniorities:expanded.intent.seniorities});if(intent)this.expandedQueries?.replace(intent.id,version,expanded.candidates);return {...expanded,intent:{...intent,version}};}
  preview(input={},budgetInput={}){return this.expand(input,budgetInput);}
}
