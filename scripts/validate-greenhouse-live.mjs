import { readFile } from "node:fs/promises";
import { LiveInspector } from "../src/automation/live-inspector.mjs";

const args=process.argv.slice(2);const url=args.find(arg=>!arg.startsWith("--"));if(!url){console.error("Uso: npm run validate:greenhouse:live -- <URL> [--fill] [--profile=arquivo.json] [--resume=arquivo]");process.exit(2);}const fill=args.includes("--fill");const profileArg=args.find(x=>x.startsWith("--profile="));const resumeArg=args.find(x=>x.startsWith("--resume="));const profile=profileArg?JSON.parse(await readFile(profileArg.slice(10),"utf8")):{};const report=await new LiveInspector({headless:!fill,publicOnly:true}).inspect(url,{fill,profile,resumePath:resumeArg?.slice(9)||""});process.stdout.write(`${JSON.stringify(report,null,2)}\n`);
