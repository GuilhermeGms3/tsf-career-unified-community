// Capability is not runtime authorization. V1 and guarded V2 are distinct paths.
export const GUPY_CAPABILITY_TRUTH=Object.freeze({
  legacy:Object.freeze({generation:"LEGACY_V1",level:"READY_TO_SUBMIT_MANUAL",implemented:true,canInspect:true,canFill:true,canValidate:true,canSubmit:false,canReceipt:false,authHandoff:true,challengeHandoff:true,label:"Gupy V1 inspeciona e preenche componentes suportados; envio final permanece manual"}),
  v2:Object.freeze({generation:"APPLICATION_V2",DISCOVERY:"NOT_SUPPORTED",JOB_DETAILS:"SUPPORTED_LIMITED",APPLICATION_PARSE:"SUPPORTED_LIMITED",APPLICATION_FILL:"REQUIRES_AUTH",RESUME_UPLOAD:"REQUIRES_AUTH",READY_TO_SUBMIT:"REQUIRES_AUTH",CONTROLLED_SUBMIT:"SUPPORTED_LIMITED",AUTH_SESSION_REUSE:"SUPPORTED_LIMITED"}),
  submitNote:"Somente Application V2: flag habilitada, consentimento humano, preflight e gates obrigatórios. V1 não submete; fluxo real não homologado.",
});
// Source catalog persists its older vocabulary; map, do not broaden its schema.
export const gupyCatalogStatus=key=>({SUPPORTED_LIMITED:"PARTIAL",REQUIRES_AUTH:"CREDENTIAL_REQUIRED",NOT_SUPPORTED:"UNSUPPORTED"})[GUPY_CAPABILITY_TRUTH.v2[key]];
