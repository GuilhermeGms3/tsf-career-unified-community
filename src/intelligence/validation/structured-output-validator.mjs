function fail(path,message){return {valid:false,error:`${path}: ${message}`};}
function check(value,schema,path="$ "){
  if(schema.type==="object"){if(!value||typeof value!=="object"||Array.isArray(value))return fail(path,"objeto esperado");for(const key of schema.required||[])if(!(key in value))return fail(`${path}.${key}`,"campo obrigatorio ausente");for(const [key,child] of Object.entries(schema.properties||{}))if(key in value){const result=check(value[key],child,`${path}.${key}`);if(!result.valid)return result;}}
  if(schema.type==="array"){if(!Array.isArray(value))return fail(path,"array esperado");if(schema.minItems!==undefined&&value.length<schema.minItems)return fail(path,"itens insuficientes");if(schema.maxItems!==undefined&&value.length>schema.maxItems)return fail(path,"itens em excesso");for(let i=0;i<value.length;i++){const result=check(value[i],schema.items||{},`${path}[${i}]`);if(!result.valid)return result;}}
  if(schema.type==="string"&&typeof value!=="string")return fail(path,"string esperada");
  if(schema.type==="number"&&(typeof value!=="number"||!Number.isFinite(value)))return fail(path,"numero esperado");
  if(schema.type==="boolean"&&typeof value!=="boolean")return fail(path,"boolean esperado");
  if(schema.enum&&!schema.enum.includes(value))return fail(path,"valor fora do enum");
  if(typeof value==="number"&&schema.minimum!==undefined&&value<schema.minimum)return fail(path,"abaixo do minimo");
  if(typeof value==="number"&&schema.maximum!==undefined&&value>schema.maximum)return fail(path,"acima do maximo");
  if(typeof value==="string"&&schema.maxLength!==undefined&&value.length>schema.maxLength)return fail(path,"texto muito extenso");
  return {valid:true};
}
function withoutTrailingCommas(value){let output="",inString=false,escaped=false;for(let index=0;index<value.length;index+=1){const current=value[index];if(inString){output+=current;if(escaped)escaped=false;else if(current==="\\")escaped=true;else if(current==='"')inString=false;continue;}if(current==='"'){inString=true;output+=current;continue;}if(current===","){let next=index+1;while(/\s/.test(value[next]||""))next+=1;if(["}","]"].includes(value[next]))continue;}output+=current;}return output;}
export function parseStructuredOutput(raw){if(raw&&typeof raw==="object")return raw;const text=String(raw||"").replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim(),parse=value=>{try{return JSON.parse(value);}catch{return null;}},direct=parse(text);if(direct!==null)return direct;const start=text.indexOf("{"),end=text.lastIndexOf("}");if(start>=0&&end>start){const isolated=text.slice(start,end+1),parsed=parse(isolated)??parse(withoutTrailingCommas(isolated));if(parsed!==null)return parsed;}throw Object.assign(new Error("Resposta JSON invalida."),{code:"INVALID_JSON"});}
export function validateStructuredOutput(value,schema){const result=check(value,schema,"$");if(!result.valid)throw Object.assign(new Error(`Schema invalido: ${result.error}`),{code:"INVALID_SCHEMA"});return value;}
