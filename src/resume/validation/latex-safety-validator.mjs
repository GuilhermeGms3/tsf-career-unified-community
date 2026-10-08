const forbiddenCommands=/\\(?:input|include|includeonly|write18|write|immediate|openout|openin|read|usepackage|RequirePackage|catcode|csname|newread|newwrite|special|directlua|pdfobj|pdfxform)\b/i;
const renderedForbidden=/\\(?:input|include|includeonly|write18|write|immediate|openout|openin|read|catcode|csname|newread|newwrite|special|directlua|pdfobj|pdfxform)\b/i;
const pathInjection=/(?:\.\.[\\/]|(?:^|\s)[A-Za-z]:[\\/]|file:\/\/|https?:\/\/)/i;

export class LatexSafetyValidator{
  validateSource(source,{systemGenerated=false}={}){const text=String(source||""),violations=[];if((systemGenerated?renderedForbidden:forbiddenCommands).test(text))violations.push("FORBIDDEN_LATEX_COMMAND");if(!systemGenerated&&pathInjection.test(text))violations.push("EXTERNAL_OR_PARENT_PATH");if(text.includes("\0"))violations.push("NULL_BYTE");if(systemGenerated){const packages=[...text.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)].flatMap(match=>match[1].split(",").map(x=>x.trim()));const allowed=new Set(["geometry","enumitem","hyperref","titlesec","parskip","xcolor","fontspec"]);if(packages.some(name=>!allowed.has(name)))violations.push("PACKAGE_NOT_ALLOWED");}return {valid:violations.length===0,status:violations.length?"REJECTED":"VALID",violations};}
  assertSafeSource(source,options={}){const result=this.validateSource(source,options);if(!result.valid)throw Object.assign(new Error("Conteudo LaTeX inseguro foi bloqueado."),{code:"LATEX_SOURCE_REJECTED",violations:result.violations});return result;}
}

const LATEX_ESCAPES=Object.freeze({"\\":"\\textbackslash{}","#":"\\#","$":"\\$","%":"\\%","&":"\\&","_":"\\_","{":"\\{","}":"\\}","~":"\\textasciitilde{}","^":"\\textasciicircum{}","<":"\\textless{}",">":"\\textgreater{}"});
export function escapeLatex(value){return String(value??"").replace(/[\\#$%&_{}~^<>]/g,char=>LATEX_ESCAPES[char]);}
