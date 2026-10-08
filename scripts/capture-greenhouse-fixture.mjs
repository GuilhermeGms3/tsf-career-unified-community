import { writeFile } from "node:fs/promises";
import { LiveInspector } from "../src/automation/live-inspector.mjs";
import { renderSanitizedFixture } from "../src/automation/fixture-sanitizer.mjs";
const [url,output]=process.argv.slice(2);if(!url||!output){console.error("Uso: npm run capture:greenhouse:fixture -- <URL publica> <fixture.html>");process.exit(2);}const report=await new LiveInspector({headless:true,publicOnly:true}).inspect(url,{fill:false});await writeFile(output,renderSanitizedFixture(report.structure),"utf8");console.log(`Fixture sanitizada criada em ${output}`);
