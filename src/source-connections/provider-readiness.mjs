import { sourceOnboardingRegistry } from '../discovery/source-center/source-onboarding-registry.mjs';
import { APPLICATION_ADAPTER_CAPABILITIES } from '../automation/ats/adapter-registry.mjs';
import {GUPY_CAPABILITY_TRUTH} from '../application/gupy-capability-truth.mjs';
export const CAPABILITIES=Object.freeze(['DISCOVERY','JOB_DETAILS','DESCRIPTION_ENRICHMENT','RECRUITER_POST_CAPTURE','EVIDENCE_SYNC','APPLICATION_PARSE','APPLICATION_FILL','RESUME_UPLOAD','READY_TO_SUBMIT','CONTROLLED_SUBMIT','AUTH_SESSION_REUSE']);
const publicDiscovery=new Set(['jobspy','indeed','linkedin','glassdoor','google','greenhouse','lever','ashby','smartrecruiters','workable','gupy','iel','programathor','solides','recrutei','nerdin','remotar']);
const authRequired=new Set(['NOT_CONFIGURED','AUTH_REQUIRED','SESSION_EXPIRED']);
const availabilityFor=snapshot=>{
  const reported=String(snapshot?.availabilityStatus||'NOT_CHECKED').toUpperCase();
  if(['DISABLED','OPTIONAL','UNAVAILABLE','LIMITED'].includes(reported))return reported;
  if(['AVAILABLE','READY'].includes(reported)&&snapshot?.lastTest)return 'AVAILABLE';
  return 'NOT_CHECKED';
};
const configurationFor=(item,snapshot,availability)=>{
  if(['DISABLED','OPTIONAL'].includes(availability))return availability;
  if(!snapshot)return 'NOT_CHECKED';
  if(snapshot.setupType==='TARGET')return Number(snapshot.targetCount||0)>0?'CONFIGURED':'CONFIG_REQUIRED';
  if(snapshot.credentialStatus==='NOT_CONFIGURED')return 'NOT_CONFIGURED';
  if(['NONE','MANUAL'].includes(snapshot.setupType)||item.authMode==='NONE')return 'NOT_REQUIRED';
  return 'CONFIGURED';
};
const healthFor=availability=>({AVAILABLE:'READY',LIMITED:'LIMITED',UNAVAILABLE:'UNAVAILABLE',DISABLED:'DISABLED',OPTIONAL:'OPTIONAL'})[availability]||'UNKNOWN';
// Projection of current onboarding and adapter registries; not a second discovery engine.
export function connectionCapabilities(){
  const entries=[...sourceOnboardingRegistry.list(),...['indeed','linkedin','glassdoor','google'].map(id=>({providerId:id,displayName:{indeed:'Indeed',linkedin:'LinkedIn',glassdoor:'Glassdoor',google:'Google Jobs'}[id],description:'Descoberta pública limitada via JobSpy.'})),{providerId:'workday',displayName:'Workday',description:'Preenchimento assistido por etapa e sessão por tenant; envio final manual.'},{providerId:'generic',displayName:'Páginas de carreira',description:'Inspeção genérica limitada; compatibilidade por página.'}];
  return entries.map(item=>{
    const id=item.providerId,a=APPLICATION_ADAPTER_CAPABILITIES[id],c=Object.fromEntries(CAPABILITIES.map(k=>[k,'NOT_SUPPORTED']));
    if(publicDiscovery.has(id)){c.DISCOVERY='SUPPORTED_LIMITED';c.JOB_DETAILS='SUPPORTED_LIMITED';}
    if(a?.canInspect)c.APPLICATION_PARSE='SUPPORTED_LIMITED';
    if(a?.canFill)for(const k of ['APPLICATION_FILL','RESUME_UPLOAD','READY_TO_SUBMIT'])c[k]=id==='gupy'?'REQUIRES_AUTH':'SUPPORTED_LIMITED';
    if(a?.canSubmit)c.CONTROLLED_SUBMIT='SUPPORTED_LIMITED';
    if(id==='gupy')for(const key of CAPABILITIES)if(GUPY_CAPABILITY_TRUTH.v2[key])c[key]=GUPY_CAPABILITY_TRUTH.v2[key];
    if(id==='github')c.EVIDENCE_SYNC='REQUIRES_AUTH';
    if(id==='linkedin'){c.DESCRIPTION_ENRICHMENT='SUPPORTED_LIMITED';c.RECRUITER_POST_CAPTURE='SUPPORTED_LIMITED';}
    return {providerId:id,displayName:item.displayName,description:id==='gupy'?'Parser e preenchimento assistido Gupy V2; sessão isolada da conta, envio sujeito a todos os gates.':item.description,group:id==='github'?'EVIDÊNCIAS':['gupy','workday'].includes(id)?'CANDIDATURAS':publicDiscovery.has(id)?'DESCOBERTA':'OUTRAS FONTES',authMode:id==='github'?'TOKEN':id==='gupy'?'INTERACTIVE_SESSION':id==='workday'?'PER_TENANT_SESSION':id==='linkedin'?'NOT_MANAGED':publicDiscovery.has(id)||id==='generic'?'NONE':'NOT_MANAGED',capabilities:c,manualCapture:id==='linkedin',optional:id==='brave-public-web',requiredForCoreProduct:false};
  });
}
export class SourceReadinessService {
  constructor({connections,auth,submissionEnabled=false}){Object.assign(this,{connections,auth,submissionEnabled});}
  async list(){
    const snapshots=new Map((await this.connections.list()).map(s=>[s.providerId,s]));
    return connectionCapabilities().map(item=>{
      const parentSnapshot=['indeed','linkedin','glassdoor','google'].includes(item.providerId)?snapshots.get('jobspy'):null,snapshot=snapshots.get(item.providerId)||parentSnapshot,session=this.auth.status(item.providerId),authenticated=['CONNECTED','SESSION_ACTIVE'].includes(session.status),c=item.capabilities,authentication=item.authMode==='NONE'?'NOT_REQUIRED':item.authMode==='NOT_MANAGED'?'NOT_MANAGED':session.status,availability=availabilityFor(snapshot),configuration=configurationFor(item,snapshot,availability),health=healthFor(availability),surfaces=(snapshot?.surfaces||[]).filter(surface=>!parentSnapshot||surface.id===`jobspy:${item.providerId}`),discoveryState=surfaces.length===1?surfaces[0].status:snapshot?.operationalStatus,operationalReadiness=authRequired.has(authentication)?authentication:discoveryState||health;
      return {...item,authMode:item.providerId==='github'&&this.auth.githubClientId?'DEVICE_FLOW':item.authMode,configuration,authentication,availability,health,operationalReadiness,session,surfaces,canAuthenticate:['gupy','github'].includes(item.providerId),canSyncEvidence:item.providerId==='github'&&authenticated,persistedEvidenceAvailable:item.providerId==='github'&&['READY','DEGRADED'].includes(snapshot?.syncStatus),evidence:item.providerId==='github'?snapshot?.sync:null,canDiscover:c.DISCOVERY!=='NOT_SUPPORTED',canEnrich:c.DESCRIPTION_ENRICHMENT!=='NOT_SUPPORTED',canCaptureRecruiterPost:item.manualCapture,canParse:c.APPLICATION_PARSE!=='NOT_SUPPORTED',canFill:c.APPLICATION_FILL!=='NOT_SUPPORTED'&&(item.providerId!=='gupy'||authenticated),canUploadResume:c.RESUME_UPLOAD!=='NOT_SUPPORTED'&&(item.providerId!=='gupy'||authenticated),canReachReadyToSubmit:c.READY_TO_SUBMIT!=='NOT_SUPPORTED'&&(item.providerId!=='gupy'||authenticated),canSubmit:this.submissionEnabled&&c.CONTROLLED_SUBMIT!=='NOT_SUPPORTED'&&(item.providerId!=='gupy'||authenticated),lastCheck:surfaces[0]?.observation||snapshot?.lastTest||null};
    });
  }
  forApplication(draft){const session=this.auth.status('gupy',new URL(draft.applicationUrl).hostname);return {provider:'gupy',authentication:session.status,canParse:true,canFill:session.status==='SESSION_ACTIVE',canSubmit:this.submissionEnabled&&session.status==='SESSION_ACTIVE',sessionScope:'PER_HOST',action:'/connections'};}
}
