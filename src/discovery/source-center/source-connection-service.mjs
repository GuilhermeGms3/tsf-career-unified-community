import { randomUUID } from "node:crypto";
import {
  SOURCE_SURFACES,
  projectSourceSurface,
  sourceSurfacesForProvider,
} from "../source-authority.mjs";

const mask=value=>{const clean=String(value||"").trim();return clean.length<8?"••••":`${clean.slice(0,3)}••••${clean.slice(-3)}`;};
const normalizeCredential=value=>{const credential=String(value||"").trim();if(credential.length<8||credential.length>500)throw Object.assign(new Error("Informe uma credencial válida entre 8 e 500 caracteres."),{code:"CREDENTIAL_FORMAT_INVALID",status:400});return credential;};
const publicError=error=>error?.status===401||error?.status===403?Object.assign(new Error("A credencial foi recusada pelo provedor."),{code:"CREDENTIAL_INVALID",status:400}):error?.status===429?Object.assign(new Error("O provedor limitou os testes. Aguarde e tente novamente."),{code:"CREDENTIAL_RATE_LIMITED",status:429}):Object.assign(new Error("Não foi possível validar a credencial agora."),{code:"CREDENTIAL_PROVIDER_UNAVAILABLE",status:503});
const boundedStatus=async(load,timeoutMs)=>{let timer;try{return await Promise.race([Promise.resolve().then(load),new Promise(resolve=>{timer=setTimeout(()=>resolve({}),timeoutMs);})]);}catch{return {};}finally{clearTimeout(timer);}};
const operationalStatusFor=(item,publicItem,surfaces)=>{
  if(item.providerId==="github"){
    if(publicItem.syncStatus==="READY")return "OPERATIONAL_REAL";
    if(["SYNCING","DEGRADED","ERROR"].includes(publicItem.syncStatus))return publicItem.syncStatus;
    return publicItem.credentialStatus==="CONNECTED"?"CONNECTED":"NOT_CONFIGURED";
  }
  if(surfaces.length===1)return surfaces[0].status;
  if(surfaces.some(surface=>surface.status==="OPERATIONAL_REAL"))return "OPERATIONAL_REAL";
  if(surfaces.some(surface=>["DEGRADED","BLOCKED"].includes(surface.status)))return "DEGRADED";
  if(surfaces.length&&surfaces.every(surface=>surface.status==="SUCCESS_EMPTY"))return "SUCCESS_EMPTY";
  return "UNKNOWN";
};

export class SourceConnectionService {
  constructor({registry,credentials,events,vault,providerTestService,braveProvider,githubClient=null,githubEvidenceProvider=null,targets=null,jobHuntRuns=null,sourceHealthRepository=null,whatsappStatus=async()=>({}),statusTimeoutMs=1500}={}){Object.assign(this,{registry,credentials,events,vault,providerTestService,braveProvider,githubClient,githubEvidenceProvider,targets,jobHuntRuns,sourceHealthRepository,whatsappStatus});this.statusTimeoutMs=Math.max(50,Math.min(5000,Number(statusTimeoutMs)||1500));}
  async list({refreshLive=false}={}){
    const legacy=new Map(this.providerTestService.list().map(item=>[item.providerId,item])),whatsapp=refreshLive?await boundedStatus(this.whatsappStatus,this.statusTimeoutMs):{},boards=this.targets?.boards?.()||[];
    const registryItems=this.registry.list(),registryIds=new Set(registryItems.map(item=>item.providerId));
    const projectSurfaces=(providerId,{configuration=null,credential=null,runtime={},targetCount=0}={})=>sourceSurfacesForProvider(providerId).map(definition=>{
      const observation=this.sourceHealthRepository?.latest?.(definition.id)||null;
      const configured=definition.requires_known_board?targetCount>0:definition.requires_authentication?Boolean(credential?.status==="CONNECTED"||runtime?.configured||runtime?.connected):true;
      const enabled=configuration?.enabled??(definition.provider_id==="brave-public-web"?configured:definition.enabled),projected=projectSourceSurface(definition,{observation,configured,targetCount,enabled});
      return {...projected,history:this.sourceHealthRepository?.history?.(definition.id,5)||[]};
    });
    const configuredItems=registryItems.map(item=>{
      const old=legacy.get(item.providerId),providerBoards=boards.filter(board=>board.provider===item.providerId&&board.enabled),savedConfiguration=this.providerTestService.configurations?.get(item.providerId),configuration=item.providerId==="brave-public-web"?null:savedConfiguration||(providerBoards[0]?{enabled:true,identity:{careerUrl:providerBoards[0].careerUrl||"",organizationKey:providerBoards[0].organizationKey||""}}:null),credential=this.credentials.get(item.providerId),runtime=item.providerId==="brave-public-web"?this.braveProvider.capability():item.providerId==="whatsapp"?{connected:whatsapp?.whatsapp?.connectionState==="CONNECTED",status:whatsapp?.api?.online===false?"DEGRADED":undefined}:old?{configured:old.setupStatus!=="OFFLINE",status:["ERROR","DEGRADED"].includes(old.lastTest?.healthStatus)?old.lastTest.healthStatus:undefined}:{},sync=item.providerId==="github"?this.githubEvidenceProvider?.evidence?.()||{status:"NOT_INDEXED",details:{}}:null,surfaces=projectSurfaces(item.providerId,{configuration,credential,runtime,targetCount:providerBoards.length});
      const publicItem=this.registry.publicItem(item,{configuration,credential,runtime,sync});
      return {...publicItem,targetCount:providerBoards.length,lastTest:old?.lastTest||null,lastDiagnostic:old?.lastDiagnostic||null,surfaces,operationalStatus:operationalStatusFor(item,publicItem,surfaces),subSources:surfaces.map(surface=>({source:surface.id.replace(/^jobspy:/,""),status:surface.status,attempted:surface.observation?.realQuery===true,rawResults:surface.observation?.lastRawCount||0,acceptedResults:surface.observation?.lastValidCount||0,durationMs:surface.observation?.durationMs||0})),supportsSearch:Boolean(old?.supportsSearch||item.providerId==="brave-public-web"),supportsTest:Boolean(old?.supportsTest||item.providerId==="brave-public-web"||item.providerId==="github")};
    });
    const authorityOnly=[...new Set(SOURCE_SURFACES.filter(item=>!registryIds.has(item.provider_id)).map(item=>item.provider_id))].map(providerId=>{
      const surfaces=projectSurfaces(providerId),definition=surfaces[0];
      return {providerId,displayName:definition.display_name,category:"DESCOBERTA",onboardingType:definition.discovery_mode==="MANUAL_ONLY"?"MANUAL":"UNSUPPORTED",status:definition.status,statusLabel:definition.status,availabilityStatus:"LIMITED",credentialStatus:"NOT_REQUIRED",accountSessionStatus:"NOT_MANAGED",syncStatus:"NOT_APPLICABLE",costClass:"FREE",setupType:"MANUAL",requiredForCoreProduct:false,nextAction:definition.status==="MANUAL_ONLY"?"Abra o portal e importe uma oportunidade quando necessário.":"Nenhum adapter de discovery está implementado.",helpText:"Classificação canônica da capacidade atual de descoberta.",description:"Classificação canônica da capacidade atual de descoberta.",enabled:definition.enabled,surfaces,operationalStatus:definition.status,subSources:[],supportsSearch:false,supportsTest:false,officialDocsUrl:""};
    });
    return [...configuredItems,...authorityOnly];
  }
  async validateCredential(providerId,value){const item=this.registry.get(providerId);if(!item||!["API_KEY","TOKEN"].includes(item.onboardingType))throw Object.assign(new Error("Esta fonte não aceita credencial direta neste build."),{code:"CREDENTIAL_ONBOARDING_UNAVAILABLE",status:400});const credential=normalizeCredential(value),started=Date.now();try{if(providerId==="brave-public-web")await this.braveProvider.testCredential(credential);else if(providerId==="github"&&this.githubClient)await this.githubClient.validateCredential(credential);else throw Object.assign(new Error("Teste de credencial não implementado."),{code:"CREDENTIAL_TEST_UNSUPPORTED",status:400});this.events.record({providerId,eventType:"CREDENTIAL_VALIDATED",outcome:"SUCCESS",metadata:{latencyMs:Date.now()-started,status:"CONNECTED"}});return {valid:true,status:"CONNECTED",maskedHint:providerId==="github"?"Configurado":mask(credential),latencyMs:Date.now()-started};}catch(error){const mapped=publicError(error);this.events.record({providerId,eventType:"CREDENTIAL_VALIDATED",outcome:"FAILED",errorCode:mapped.code,metadata:{latencyMs:Date.now()-started,status:"ERROR"}});throw mapped;}}
  async connect(providerId,value){const credential=String(value||"").trim(),validation=await this.validateCredential(providerId,credential),item=this.registry.get(providerId),credentialRef=`credential-${randomUUID()}`,previous=this.credentials.get(providerId);await this.vault.put(credentialRef,credential);let metadata;try{metadata=this.credentials.save({credentialRef,providerId,credentialKind:item.credentialKind||item.onboardingType,maskedHint:validation.maskedHint,status:"CONNECTED",validatedAt:new Date().toISOString()});}catch(error){await this.vault.remove(credentialRef);throw error;}if(previous?.credentialRef&&previous.credentialRef!==credentialRef)await this.vault.remove(previous.credentialRef);this.events.record({providerId,eventType:previous?"CREDENTIAL_REPLACED":"CREDENTIAL_CONNECTED",outcome:"SUCCESS",metadata:{status:"CONNECTED"}});return {providerId,status:metadata.status,maskedHint:metadata.maskedHint,validatedAt:metadata.validatedAt};}
  secret(providerId){const metadata=this.credentials.get(providerId);return metadata?.status==="CONNECTED"?this.vault.get(metadata.credentialRef):"";}
  async remove(providerId){const metadata=this.credentials.get(providerId);if(!metadata)return false;await this.vault.remove(metadata.credentialRef);this.credentials.remove(providerId);this.events.record({providerId,eventType:"CREDENTIAL_REMOVED",outcome:"SUCCESS",metadata:{status:"REMOVED"}});return true;}
}
