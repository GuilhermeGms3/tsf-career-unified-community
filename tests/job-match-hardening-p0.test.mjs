import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {normalizeJobDescription} from "../src/matching/job-description-normalizer.mjs";
import {extractJobRequirements} from "../src/matching/job-requirement-extractor.mjs";
import {calculateDimensionScores,calculateEvidenceQuality,calculateOverallScore,calibrateMatchScore} from "../src/matching/scoring-engine.mjs";
import {assessJobAnalyzability,buildProviderQualityReport} from "../src/discovery/provider-quality-service.mjs";
import {calculateOpportunityPriority} from "../src/opportunities/opportunity-priority.mjs";
import {isExcludedOpportunity} from "../public/features/opportunities/page.js";

const requirement=(name,{required=true,importance=required?"required":"preferred"}={})=>({id:`req-${name}`,type:"skill",normalizedName:name,originalText:name,required,importance,weight:required?1:.55,confidence:.95,metadata:{provenance:"EXPLICIT_REQUIREMENT"}});
const item=(name,status,score,options={})=>({requirement:requirement(name,options),status,score,evidence:score===null?[]:[{strengthScore:score||.8}]});

test("P0 normaliza HTML estrutural e preserva required versus preferred",()=>{
  const html="<h3>Requirements</h3><ul><li>Docker</li><li>Linux</li></ul><h3>Nice to have</h3><ul><li>Kubernetes</li></ul>";
  assert.equal(normalizeJobDescription(html),"Requirements:\nDocker\nLinux\nNice to have:\nKubernetes");
  const requirements=extractJobRequirements({id:"html",title:"Engineer",description:html});
  assert.equal(requirements.find(x=>x.normalizedName==="docker").required,true);
  assert.equal(requirements.find(x=>x.normalizedName==="linux").required,true);
  assert.equal(requirements.find(x=>x.normalizedName==="kubernetes").importance,"preferred");
});

test("P0 heading de responsabilidades encerra estado required",()=>{
  const requirements=extractJobRequirements({id:"sections",title:"Engineer",description:"Requirements:\nDocker\nResponsibilities:\nWork with Kubernetes to maintain services."});
  assert.equal(requirements.find(x=>x.normalizedName==="docker").required,true);
  assert.equal(requirements.find(x=>x.normalizedName==="kubernetes").required,false);
});

test("P0 fallback não cria skill sobreposta ou sufixo gramatical",()=>{
  const requirements=extractJobRequirements({id:"skills",title:"Engineer",description:"Nice to have:\nFamiliarity with Kubernetes is a plus.\nExperience with Node.js"});
  assert.equal(requirements.filter(x=>x.normalizedName==="kubernetes").length,1);
  assert.equal(requirements.find(x=>x.normalizedName==="kubernetes").importance,"preferred");
  assert.equal(requirements.filter(x=>x.normalizedName==="nodejs").length,1);
  assert.ok(!requirements.some(x=>/kubernetes-is|experience-with-node|node-js-experience/.test(x.normalizedName)));
});

test("P0 calibração aproxima match conhecido alto da incerteza quando cobertura é baixa",()=>{
  const items=[item("docker","MATCH",.95),...['kubernetes','terraform','aws','linux'].map(name=>item(name,"UNKNOWN",null))];
  const dimensions=calculateDimensionScores(items,{score:0,status:"NOT_EVALUATED"});
  const known=calculateOverallScore(dimensions),quality=calculateEvidenceQuality(items),calibrated=calibrateMatchScore(known,quality);
  assert.equal(known,95);
  assert.equal(quality.evidenceCoverage,20);
  assert.ok(calibrated.calibratedMatchScore<70);
});

test("P0 calibração é monotônica por cobertura e hard requirements não duplicam o score",()=>{
  const low=calibrateMatchScore(90,{evidenceCoverage:20,matchConfidence:20});
  const high=calibrateMatchScore(90,{evidenceCoverage:90,matchConfidence:90});
  assert.ok(high.calibratedMatchScore>low.calibratedMatchScore);
  const requiredDocker=[item("docker","MATCH",.95)];
  const dimensions=calculateDimensionScores(requiredDocker,{score:0,status:"NOT_EVALUATED"});
  assert.equal(dimensions.hardRequirements.score,95);
  assert.equal(calculateOverallScore(dimensions),95);
  dimensions.hardRequirements.score=0;
  assert.equal(calculateOverallScore(dimensions),95);
});

test("P0 qualidade semântica distingue vaga analisável de anúncio insuficiente",()=>{
  const valid={id:"valid",provider:"greenhouse",title:"Platform Engineer",company:"Acme",location:"Brasil",canonicalUrl:"https://example.com/1",description:"Requirements:\nExperience with Docker and Kubernetes in production environments. Knowledge of Linux, networking and cloud infrastructure for distributed services."};
  assert.equal(assessJobAnalyzability(valid).isAnalyzable,true);
  assert.deepEqual(assessJobAnalyzability({id:"empty",provider:"greenhouse",title:"Vaga",description:"Clique para saber mais."}).reasons,["DESCRIPTION_INSUFFICIENT","REQUIREMENTS_NOT_EXTRACTABLE"]);
});

test("P0 relatório por provider mede duplicação e qualidade semântica",()=>{
  const now=new Date().toISOString(),description="Requirements:\nExperience with Docker and Kubernetes in production environments. Knowledge of Linux, networking and cloud infrastructure for distributed services.";
  const report=buildProviderQualityReport({jobs:[
    {id:"1",provider:"greenhouse",title:"Engineer",company:"Acme",location:"Brasil",canonicalUrl:"https://example.com/1",description,lifecycleStatus:"OPEN",lastSeenAt:now},
    {id:"2",provider:"greenhouse",title:"Engineer",company:"Acme",location:"Brasil",canonicalUrl:"https://example.com/2",description,lifecycleStatus:"OPEN",lastSeenAt:now},
    {id:"3",provider:"lever",title:"Vaga",description:"Poucos dados",lifecycleStatus:"UNKNOWN"},
  ]});
  const greenhouse=report.providers.find(item=>item.providerId==="greenhouse"),lever=report.providers.find(item=>item.providerId==="lever");
  assert.equal(greenhouse.duplicateRate,50);
  assert.equal(greenhouse.analyzableRate,100);
  assert.equal(lever.analyzableRate,0);
  assert.ok(greenhouse.semanticQualityScore>lever.semanticQualityScore);
});

test("P0 ranking incorpora qualidade real da fonte sem substituir match",()=>{
  const input={job:{id:"1",title:"Engineer",company:"Acme",location:"Brasil",description:"Descrição completa ".repeat(30),canonicalUrl:"https://example.com/1",lifecycleStatus:"OPEN",lastSeenAt:new Date().toISOString()},analysis:{calibratedMatchScore:70,matchConfidence:70},profile:{},requirements:[requirement("docker")],items:[]};
  const high=calculateOpportunityPriority({...input,sourceQuality:{semanticQualityScore:100}}),low=calculateOpportunityPriority({...input,sourceQuality:{semanticQualityScore:0}});
  assert.equal(high.technicalMatch,low.technicalMatch);
  assert.ok(high.score>low.score);
});

test("P0 interface explicita score calibrado, cobertura e aviso de baixa cobertura",async()=>{
  const opportunityPage=await readFile(new URL("../public/features/opportunities/page.js",import.meta.url),"utf8"),analysisPage=await readFile(new URL("../public/features/analyze-job/page.js",import.meta.url),"utf8"),sourcePage=await readFile(new URL("../public/features/autopilot/page.js",import.meta.url),"utf8");
  assert.match(opportunityPage,/Compatibilidade estimada/);
  assert.match(opportunityPage,/Cobertura limitada/);
  assert.match(analysisPage,/Match conhecido/);
  assert.match(sourcePage,/Qualidade semântica/);
});

test("P0 filas principais separam oportunidades excluídas sem apagar o inventário",()=>{
  assert.equal(isExcludedOpportunity({decision:{disposition:"BLOCKED"}}),true);
  assert.equal(isExcludedOpportunity({decision:{disposition:"SKIP"}}),true);
  assert.equal(isExcludedOpportunity({job:{lifecycleStatus:"CLOSED"},decision:{disposition:"REVIEW"}}),true);
  assert.equal(isExcludedOpportunity({job:{lifecycleStatus:"OPEN"},decision:{disposition:"REVIEW"}}),false);
});

test("P0 interface oferece fila Excluídas e navegação sem rolagem horizontal",async()=>{
  const opportunityPage=await readFile(new URL("../public/features/opportunities/page.js",import.meta.url),"utf8"),features=await readFile(new URL("../public/styles/features.css",import.meta.url),"utf8"),responsive=await readFile(new URL("../public/styles/responsive.css",import.meta.url),"utf8");
  assert.match(opportunityPage,/\["excluded", "Excluídas"\]/);
  assert.match(opportunityPage,/const active = opportunities\.filter/);
  assert.match(features,/\.opportunity-view-tabs \.tabs[\s\S]*flex-wrap: wrap/);
  assert.match(responsive,/\.opportunity-view-tabs \.tabs[\s\S]*grid-template-columns: repeat\(2/);
});
