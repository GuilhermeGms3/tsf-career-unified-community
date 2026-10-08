export const COMPILER_HEALTH=Object.freeze({HEALTHY:"HEALTHY",NOT_INSTALLED:"NOT_INSTALLED",MISCONFIGURED:"MISCONFIGURED",FAILED:"FAILED"});
export function compilerHealth(status,details={}){if(!Object.values(COMPILER_HEALTH).includes(status))throw new Error("Status de compilador invalido.");return {status,checkedAt:new Date().toISOString(),...details};}
