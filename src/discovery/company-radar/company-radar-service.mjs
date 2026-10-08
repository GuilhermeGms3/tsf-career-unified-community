import {assertSafeDiscoveryUrl} from "../safe-http-client.mjs";
import {SourceResolver} from "../source-resolver.mjs";

const supportedBoards=new Set(["greenhouse","lever","ashby","smartrecruiters","workable","gupy"]);
const clean=(value,max)=>String(value||"").trim().slice(0,max);

export class CompanyRadarService{
  constructor({watchlists,providerTestService=null,careerPageDiscovery=null,urlGuard=assertSafeDiscoveryUrl}={}){Object.assign(this,{watchlists,providerTestService,careerPageDiscovery,urlGuard});this.resolver=new SourceResolver();}
  async detect(input={}){
    const careerUrl=clean(input.careerUrl||input.url,500);if(!careerUrl)throw Object.assign(new Error("Informe uma URL pública de carreiras."),{code:"CAREER_URL_REQUIRED"});
    const safe=await this.urlGuard(careerUrl),detected=this.resolver.resolve(safe.toString()),company=clean(input.name||input.company,160),domain=safe.hostname.toLowerCase();
    if(detected.canonicalTarget&&supportedBoards.has(detected.atsType)&&detected.organizationKey)return {provider:detected.atsType,company,careerUrl:safe.toString(),domain,organizationKey:detected.organizationKey,status:"READY",confidence:.98,humanMessage:`${detected.atsType} detectado. A identidade pública foi extraída da URL.`};
    if(detected.canonicalTarget)return {provider:detected.atsType,company,careerUrl:safe.toString(),domain,organizationKey:detected.organizationKey||"",status:"REVIEW_REQUIRED",confidence:.7,humanMessage:"A plataforma foi reconhecida, mas não há discovery direto comprovado para esta capacidade."};
    const inspection=this.careerPageDiscovery?await this.careerPageDiscovery.inspect(safe.toString(),{company,limit:5}):null;return {provider:"career-page",company,careerUrl:safe.toString(),domain,organizationKey:"",status:inspection?.structuredDataFound?"MANUAL_PUBLIC":"REVIEW_REQUIRED",confidence:inspection?.structuredDataFound?.8:.5,humanMessage:inspection?.structuredDataFound?`${inspection.jobs.length} vaga(s) estruturada(s) encontrada(s) na página pública.`:"Página pública válida; ATS não identificado. Monitoramento requer revisão.",inspection:inspection?{structuredDataFound:inspection.structuredDataFound,jobsFound:inspection.jobs.length,strategy:inspection.strategy}:null};
  }
  async save(input={}){const detection=await this.detect(input),existing=this.watchlists.all().find(item=>item.domain===detection.domain&&item.careerUrl.replace(/\/$/,"")===detection.careerUrl.replace(/\/$/,"")),entry=this.watchlists.save({...input,id:existing?.id,name:detection.company||existing?.name||new URL(detection.careerUrl).hostname,careerUrl:detection.careerUrl,domain:detection.domain,providerHint:detection.provider,detectionStatus:detection.status,detection});if(detection.status==="READY")this.watchlists.saveBoard({watchlistId:entry.id,company:entry.name,provider:detection.provider,organizationKey:detection.organizationKey,careerUrl:detection.careerUrl,source:"url_detection",confidence:detection.confidence,enabled:true,validatedAt:new Date().toISOString()});return {...entry,detection};}
  async bulk(items=[]){const results=[];for(const item of items.slice(0,50)){try{results.push({ok:true,item:await this.save(item)});}catch(error){results.push({ok:false,input:{name:clean(item?.name,160),careerUrl:clean(item?.careerUrl||item?.url,500)},errorCode:error.code||"COMPANY_RADAR_FAILED",message:error.message});}}return results;}
}
