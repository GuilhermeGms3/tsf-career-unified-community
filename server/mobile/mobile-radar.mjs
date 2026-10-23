import { AppError } from '../errors.mjs';
import { JOB_HUNT_SOURCE_IDS } from '../../src/automation/job-hunt-policy.mjs';

export const MOBILE_SEARCH_PROFILE = 'job-hunt-mobile-manual';
const names={indeed:'Indeed',linkedin:'LinkedIn',glassdoor:'Glassdoor',google:'Google Jobs',greenhouse:'Greenhouse',lever:'Lever',ashby:'Ashby',smartrecruiters:'SmartRecruiters',workable:'Workable',gupy:'Gupy',iel:'IEL',programathor:'ProgramaThor',solides:'Sólides',recrutei:'Recrutei',nerdin:'Nerdin',remotar:'Remotar',monitored_companies:'Empresas acompanhadas'};
export function radarOptions(profiles=[], readiness=[]) {
  const profile=profiles.find(p=>p.id===MOBILE_SEARCH_PROFILE)||profiles.find(p=>p.enabled)||profiles[0]||{};
  return {
    search:{queries:profile.queries||[],locations:profile.locations||[],workModels:profile.workModels||['REMOTE','HYBRID','ONSITE'],seniorities:profile.seniorities||['INTERNSHIP','JUNIOR'],sourcePreferences:profile.sourcePreferences?.length?profile.sourcePreferences:[...JOB_HUNT_SOURCE_IDS],prepareResume:profile.prepareResume===true},
    sources:JOB_HUNT_SOURCE_IDS.map(id=>{const r=readiness.find(item=>item.providerId===id);return {id,name:names[id]||id,canDiscover:r?.canDiscover??true,sessionManaged:r?.sessionManaged===true,authentication:r?.authentication||'NOT_CHECKED',availability:r?.availability||'NOT_CHECKED'};}),
    vaults:readiness.filter(r=>r.sessionManaged).map(r=>({id:r.providerId,name:r.displayName,canDiscover:r.canDiscover===true,authentication:r.authentication,canSubmit:r.canSubmit===true})),
  };
}
export function mobileSearchInput(input, baseline={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError('Informe os critérios da busca.',{status:400,code:'MOBILE_SEARCH_INVALID'});
  const list=(key,max,allowed)=>{
    const values=input[key];
    const label={queries:'cargo e termos',locations:'localidades',workModels:'modalidades',seniorities:'senioridades',sourcePreferences:'fontes'}[key];
    if(!Array.isArray(values)||values.length>max||values.some(v=>typeof v!=='string'||!v.trim()||v.length>120||allowed&&!allowed.includes(v)))throw new AppError(`Revise ${label} da busca.`,{status:400,code:'MOBILE_SEARCH_INVALID'});
    return [...new Set(values.map(v=>v.trim()))];
  };
  const queries=list('queries',20),locations=list('locations',12),workModels=list('workModels',3,['REMOTE','HYBRID','ONSITE']),seniorities=list('seniorities',4,['INTERNSHIP','JUNIOR','MID','SENIOR']),sourcePreferences=list('sourcePreferences',JOB_HUNT_SOURCE_IDS.length,JOB_HUNT_SOURCE_IDS);
  if(!queries.length||!workModels.length||!sourcePreferences.length||(!locations.length&&workModels.some(v=>v!=='REMOTE')))throw new AppError('Informe cargo, fontes, modalidade e localidade para vagas presenciais ou híbridas.',{status:400,code:'MOBILE_SEARCH_REQUIRED'});
  if(typeof input.prepareResume!=='boolean')throw new AppError('Confirme se deseja preparar currículos.',{status:400,code:'MOBILE_SEARCH_INVALID'});
  return {...baseline,name:'Minha busca no celular',enabled:false,massHunt:true,queries,locations,jobFamilies:[],workModels,seniorities,sourcePreferences,prepareResume:input.prepareResume,locationPolicy:{priorities:locations.flatMap((location,index)=>workModels.map(workModel=>({location,workModel,priority:index+1,remoteScope:workModel==='REMOTE'?location:'',accepted:true}))),allowOnsiteOutsideArea:false}};
}

export function applicationRecovery(store,applicationId) {
  const inspection=store.applicationInspections?.latest(applicationId),attempts=store.applicationAttempts?.forApplication(applicationId)||[],events=store.applications.events(applicationId),lastFill=events.findLastIndex(e=>e.eventType==='FORM_FILL_STARTED');
  const audits=events.slice(Math.max(0,lastFill)).filter(e=>e.eventType==='FIELD_AUDIT');
  const fields=new Map(audits.map(e=>[e.metadata?.field,e.metadata?.status]));
  const last=attempts[0],submission=store.submissionAttempts?.latest(applicationId),receipt=store.submissionReceipts?.latest(applicationId);
  const versionId=store.applications.findById(applicationId)?.resumeVersionId;
  return {inspectedAt:inspection?.createdAt||'',fieldsFound:Number(inspection?.fieldsFound||0),filledFields:[...fields.values()].filter(s=>s==='FILLED').length,failedFields:[...fields.values()].filter(s=>s==='FAILED').length,resumeUploaded:store.resumeUploadAudits?.forApplication(applicationId)?.some(a=>a.status==='UPLOADED'&&a.resumeVersionId===versionId)||false,attemptCount:attempts.length,lastErrorCode:String(last?.errorCode||submission?.failureClass||'').slice(0,100),receiptConfirmed:Boolean(receipt),browserContinuationAvailable:false,browserNotice:'O link abre o portal no celular, não a sessão do navegador do servidor. Respostas já salvas podem ser reaplicadas ao continuar; o formulário visual não está preservado neste acesso.'};
}
