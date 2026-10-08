import { GenericAdapter } from "./generic/generic-adapter.mjs";
import { GreenhouseAdapter } from "./greenhouse/greenhouse-adapter.mjs";
import {LeverAdapter} from "./lever/lever-adapter.mjs";
import {AshbyAdapter} from "./ashby/ashby-adapter.mjs";
import {SmartRecruitersAdapter} from "./smartrecruiters/smartrecruiters-adapter.mjs";
import {WorkableAdapter} from "./workable/workable-adapter.mjs";
import {NerdinAdapter} from "./nerdin/nerdin-adapter.mjs";
import { WorkdayAdapter } from "./workday/workday-adapter.mjs";
import {GupyAdapter} from "./gupy/gupy-adapter.mjs";
import {GUPY_CAPABILITY_TRUTH} from "../../application/gupy-capability-truth.mjs";
import { assistedAtsAdapterTypes } from "./assisted/assisted-ats-adapters.mjs";

const assistedFillCapability=Object.freeze({level:"ASSISTED_FILL",implemented:true,canInspect:true,canFill:true,canValidate:true,canSubmit:false,canReceipt:false,authHandoff:true,challengeHandoff:true,label:"Inspeção e preenchimento genéricos; conclusão manual obrigatória"});

export const APPLICATION_ADAPTER_CAPABILITIES=Object.freeze({
  greenhouse:Object.freeze({level:"CONTROLLED_SUBMIT",implemented:true,canInspect:true,canFill:true,canValidate:true,canSubmit:true,canReceipt:true,authHandoff:true,challengeHandoff:true,label:"Controlled Submit disponível quando o runtime e todos os gates estiverem habilitados"}),
  lever:Object.freeze({level:"CONTROLLED_SUBMIT",implemented:true,canInspect:true,canFill:true,canValidate:true,canSubmit:true,canReceipt:true,authHandoff:true,challengeHandoff:true,label:"Controlled Submit disponível quando o runtime e todos os gates estiverem habilitados"}),
  ashby:Object.freeze({level:"CONTROLLED_SUBMIT",implemented:true,canInspect:true,canFill:true,canValidate:true,canSubmit:true,canReceipt:true,authHandoff:true,challengeHandoff:true,label:"Controlled Submit disponível quando o runtime e todos os gates estiverem habilitados"}),
  smartrecruiters:Object.freeze({level:"CONTROLLED_SUBMIT",implemented:true,canInspect:true,canFill:true,canValidate:true,canSubmit:true,canReceipt:true,authHandoff:true,challengeHandoff:true,label:"Controlled Submit disponível quando o runtime e todos os gates estiverem habilitados"}),
  workable:Object.freeze({level:"CONTROLLED_SUBMIT",implemented:true,canInspect:true,canFill:true,canValidate:true,canSubmit:true,canReceipt:true,authHandoff:true,challengeHandoff:true,label:"Controlled Submit disponível quando o runtime e todos os gates estiverem habilitados"}),
  generic:assistedFillCapability,
  iel:assistedFillCapability,
  solides:assistedFillCapability,
  recrutei:assistedFillCapability,
  nerdin:Object.freeze({level:"CONTROLLED_SUBMIT",implemented:true,canInspect:true,canFill:true,canValidate:true,canSubmit:true,canReceipt:true,authHandoff:false,challengeHandoff:true,label:"Controlled Submit público em três etapas, sujeito a preflight fresh, consentimento e recibo observável"}),
  programathor:assistedFillCapability,
  remotar:assistedFillCapability,
  infojobs:assistedFillCapability,
  vagas:assistedFillCapability,
  catho:assistedFillCapability,
  geekhunter:assistedFillCapability,
  unknown:Object.freeze({level:"MANUAL",implemented:false,canInspect:false,canFill:false,canSubmit:false,label:"Abertura e acompanhamento manuais"}),
  gupy:GUPY_CAPABILITY_TRUTH.legacy,
  workday:Object.freeze({level:"ASSISTED_FILL",implemented:true,canInspect:true,canFill:true,canValidate:true,canSubmit:false,canReceipt:false,authHandoff:true,challengeHandoff:true,label:"Preenchimento assistido por etapa; autenticação, transições e envio final permanecem sob controle do usuário"}),
  indeed:assistedFillCapability,
  icims:assistedFillCapability,
  taleo:assistedFillCapability,
  oracle:assistedFillCapability,
  successfactors:assistedFillCapability,
  personio:assistedFillCapability,
  teamtailor:assistedFillCapability,
  abler:assistedFillCapability,
  quickin:assistedFillCapability,
  pandape:assistedFillCapability
});

export class AdapterRegistry {
  get(type){const normalized=String(type||"unknown").toLowerCase(),AssistedAdapter=assistedAtsAdapterTypes[normalized];return normalized==="greenhouse"?new GreenhouseAdapter():normalized==="lever"?new LeverAdapter():normalized==="ashby"?new AshbyAdapter():normalized==="smartrecruiters"?new SmartRecruitersAdapter():normalized==="workable"?new WorkableAdapter():normalized==="nerdin"?new NerdinAdapter():normalized==="workday"?new WorkdayAdapter():normalized==="gupy"?new GupyAdapter():AssistedAdapter?new AssistedAdapter():new GenericAdapter();}
  supports(type){return Object.hasOwn(APPLICATION_ADAPTER_CAPABILITIES,String(type||"unknown").toLowerCase());}
  version(type){return this.get(type).constructor.version;}
  describe(type){const normalized=String(type||"unknown").toLowerCase();return structuredClone(APPLICATION_ADAPTER_CAPABILITIES[normalized]||APPLICATION_ADAPTER_CAPABILITIES.unknown);}
  listCapabilities(){return Object.entries(APPLICATION_ADAPTER_CAPABILITIES).map(([atsType,capability])=>({atsType,...structuredClone(capability)}));}
}
