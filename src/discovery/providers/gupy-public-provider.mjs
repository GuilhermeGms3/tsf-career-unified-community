import {PROVIDER_CAPABILITIES as C,PROVIDER_CATEGORIES as K,normalizeDiscoveryJob,providerDiagnostic} from "../types.mjs";
import {boundedListing} from "./listing-metadata.mjs";

const organizationPattern=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const reservedOrganizations=new Set(["auth","developers","info","portal","public-pages-temp","s6","www"]);
const cleanOrganization=value=>String(value||"").trim().toLowerCase();
const employmentType=value=>({vacancy_type_apprentice:"APPRENTICESHIP",vacancy_type_effective:"FULL_TIME",vacancy_type_internship:"INTERNSHIP",vacancy_type_temporary:"TEMPORARY"})[String(value||"").toLowerCase()]||String(value||"");
const workModel=value=>({home_office:"REMOTE",hybrid:"HYBRID","on-site":"ONSITE",remote:"REMOTE"})[String(value||"").toLowerCase().replace(/\s+/g,"_")]||String(value||"").toUpperCase();

export function parseGupyPublicBoard(html,{organizationKey,company="",limit=50}={}){
  const match=String(html||"").match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(!match)throw Object.assign(new Error("A página pública Gupy não expôs o catálogo esperado."),{code:"GUPY_PUBLIC_BOARD_NOT_FOUND"});
  let pageProps;
  try{pageProps=JSON.parse(match[1]).props?.pageProps||{};}catch{throw Object.assign(new Error("O catálogo público Gupy retornou dados inválidos."),{code:"GUPY_PUBLIC_BOARD_INVALID"});}
  const boardOrganization=cleanOrganization(pageProps.subdomain||pageProps.careerPage?.subdomain);
  if(boardOrganization!==organizationKey)throw Object.assign(new Error("A identidade retornada pela Gupy não corresponde ao tenant solicitado."),{code:"GUPY_PUBLIC_BOARD_IDENTITY_MISMATCH"});
  const companyName=String(company||pageProps.careerPage?.name||organizationKey).trim(),jobs=Array.isArray(pageProps.jobs)?pageProps.jobs:[];
  const normalized=jobs.map(item=>{
    const id=String(item.id||""),address=item.workplace?.address||{},location=[address.city,address.stateShortName||address.state,address.country].filter(Boolean).join(", "),url=`https://${organizationKey}.gupy.io/jobs/${encodeURIComponent(id)}`;
    return normalizeDiscoveryJob({provider:"gupy",providerCategory:K.ATS,providerJobId:id,companyIdentity:organizationKey,company:companyName,title:item.title,description:[item.department,item.type].filter(Boolean).join("\n"),location,city:address.city,state:address.stateShortName||address.state,country:address.country,remote:workModel(item.workplace?.workplaceType)==="REMOTE",workModel:workModel(item.workplace?.workplaceType),employmentType:employmentType(item.type),sourceUrl:url,canonicalUrl:url,applicationUrl:url,atsType:"gupy",lifecycleStatus:"OPEN",metadata:{department:item.department||"",quickApply:Boolean(item.quickApply)}});
  }).filter(item=>item.providerJobId&&item.title);
  return boundedListing(normalized,Math.max(1,Math.min(50,Number(limit)||50)));
}

export class GupyPublicProvider{
  constructor({client}){this.id="gupy";this.client=client;this.category=K.ATS;this.capabilities=[C.COMPANY_BOARD,C.JOB_DETAILS,C.CANONICAL_ID,C.REMOTE_FILTER];}
  async health(){return providerDiagnostic("CONFIG_REQUIRED",{scope:"COMPANY_BOARD",message:"Informe uma empresa Gupy para consultar a página pública de carreiras."});}
  async search(){return {jobs:[],diagnostic:await this.health()};}
  organization(value){const key=cleanOrganization(value);if(!organizationPattern.test(key)||reservedOrganizations.has(key))throw Object.assign(new Error("Identidade pública Gupy inválida."),{code:"GUPY_PUBLIC_BOARD_IDENTITY_INVALID"});return key;}
  async listCompanyJobs({organizationKey,company="",limit=50}){const key=this.organization(organizationKey),expectedHost=`${key}.gupy.io`,{data,url}=await this.client.getText(`https://${expectedHost}/`,{maxBytes:1000000});if(new URL(url).hostname!==expectedHost)throw Object.assign(new Error("A página Gupy redirecionou para outro tenant."),{code:"GUPY_PUBLIC_BOARD_REDIRECTED"});return parseGupyPublicBoard(data,{organizationKey:key,company,limit});}
  async resolveJob(job){return normalizeDiscoveryJob(job);}
  async resolveCanonicalIdentity(job){return {provider:this.id,organizationKey:job.companyIdentity,providerJobId:job.providerJobId};}
}
