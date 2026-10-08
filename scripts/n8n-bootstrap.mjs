import {spawnSync} from "node:child_process";

if(!process.argv.includes("--confirm")){console.error("Bootstrap nao executado. Revise automation/n8n/README.md e repita com --confirm depois de criar o owner do n8n.");process.exit(2);}
for(const name of ["CAREER_N8N_WEBHOOK_SECRET","N8N_ENCRYPTION_KEY","EVOLUTION_API_KEY","EVOLUTION_POSTGRES_PASSWORD","EVOLUTION_INSTANCE_NAME","CAREER_WHATSAPP_TARGET"])if(!process.env[name]){console.error(`Variavel obrigatoria ausente: ${name}`);process.exit(2);}
const result=spawnSync("docker",["compose","--profile","automation","exec","-T","n8n","n8n","import:workflow","--input=/opt/career-workflows/career-whatsapp-alerts.json"],{stdio:"inherit",shell:process.platform==="win32"});
process.exit(result.status??1);
