import { LocalLatexCompiler } from "../src/resume/compiler/latex-compiler.mjs";

const base=String(process.env.CAREER_HUB_URL||"http://127.0.0.1:7123").replace(/\/$/,"");
const [command="list",argument=""]=process.argv.slice(2);
async function request(route,options={}){const response=await fetch(`${base}${route}`,options),data=await response.json();if(!response.ok)throw new Error(`${data.code||response.status}: ${data.error||"Falha na API"}`);return data;}
try{
  if(command==="compiler"){console.log(JSON.stringify(await new LocalLatexCompiler().health(),null,2));}
  else if(command==="render"){if(!argument)throw new Error("Use: npm run resume:render -- <resume-version-id>");const data=await request(`/api/resume-documents/versions/${encodeURIComponent(argument)}/render`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});console.log(JSON.stringify(data.job,null,2));}
  else if(command==="show"){if(!argument)throw new Error("Use: npm run resume -- show <resume-version-id>");console.log(JSON.stringify(await request(`/api/resume-documents/versions/${encodeURIComponent(argument)}`),null,2));}
  else if(command==="list"){const data=await request("/api/resume-documents/versions");console.log(JSON.stringify(data.versions,null,2));}
  else throw new Error("Comando invalido. Use list, show, render ou compiler.");
}catch(error){console.error(error.message);process.exitCode=1;}
