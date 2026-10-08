export const BUILTIN_RESUME_TEMPLATES=Object.freeze([
  Object.freeze({id:"BASE_01",name:"BASE 01 fiel",version:"base-01-v4",purpose:"Reproduz a estrutura aprovada do PDF BASE 01, com links clicaveis",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"OVERLEAF_BLUE",name:"Overleaf Azul",version:"overleaf-blue-v2",purpose:"Cabecalho editorial azul e secoes lineares preenchidas com a BASE 01",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"OVERLEAF_CLASSIC",name:"Overleaf Classico",version:"overleaf-classic-v3",purpose:"Secoes em faixas discretas e leitura linear preenchida com a BASE 01",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"ATS_CLEAN",name:"ATS Clean",version:"ats-clean-v1",purpose:"Compatibilidade historica",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"ATS_STRICT",name:"ATS Strict",version:"ats-strict-v1",purpose:"Compatibilidade ATS maxima",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"ATS_TECH",name:"ATS Tech",version:"ats-tech-v1",purpose:"Vagas tecnicas com competencias priorizadas",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"ATS_BALANCED",name:"ATS Balanced",version:"ats-balanced-v1",purpose:"Equilibrio entre competencias, experiencia e projetos",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"ATS_EARLY_CAREER",name:"ATS Early Career",version:"ats-early-career-v1",purpose:"Estagio e inicio de carreira com projetos e formacao em destaque",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"ATS_IMPACT",name:"ATS Impact",version:"ats-impact-v1",purpose:"Experiencia, resultados e lideranca em primeiro plano",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"PROFESSIONAL",name:"Professional",version:"professional-v1",purpose:"Versao historica",supportedLanguages:["pt-BR","en"],atsOptimized:false,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"PROFESSIONAL",name:"Professional",version:"professional-v2",purpose:"Hierarquia profissional discreta e ATS-safe",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"COMPACT",name:"Compact",version:"compact-v1",purpose:"Versao historica",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true}),
  Object.freeze({id:"COMPACT",name:"Compact",version:"compact-v2",purpose:"Conteudo denso com fonte minima de 10pt",supportedLanguages:["pt-BR","en"],atsOptimized:true,layoutType:"ONE_COLUMN",maxRecommendedPages:2,enabled:true})
]);

export class TemplateRegistry{
  constructor(templates=BUILTIN_RESUME_TEMPLATES){this.templates=new Map(templates.map(item=>[`${item.id}:${item.version}`,structuredClone(item)]));}
  get(id="ATS_STRICT",version=""){const candidates=[...this.templates.values()].filter(item=>item.id===id&&item.enabled);const found=version?candidates.find(item=>item.version===version):candidates.at(-1);if(!found)throw Object.assign(new Error("Template de curriculo nao encontrado."),{code:"RESUME_TEMPLATE_NOT_FOUND"});return structuredClone(found);}
  list({enabledOnly=true}={}){return [...this.templates.values()].filter(item=>!enabledOnly||item.enabled).map(item=>structuredClone(item));}
}
