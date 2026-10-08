import { PreMatchPlausibility } from "../src/discovery/relevance/pre-match-plausibility.mjs";
import { fixture } from "./discovery-relevance-benchmark.mjs";

const baseUrl=String(process.env.CAREER_BASE_URL||"http://127.0.0.1:7123").replace(/\/$/,"");
const runIndex=process.argv.indexOf("--run-id"),runId=runIndex>=0?process.argv[runIndex+1]:"";
const response=await fetch(`${baseUrl}/api/opportunities`);
if(!response.ok)throw new Error(`Opportunity API returned HTTP ${response.status}`);
const body=await response.json(),allItems=body.opportunities||[],items=runId?allItems.filter(item=>item.preMatch?.runId===runId):allItems,classifier=new PreMatchPlausibility(),counts={PASS:0,PASS_WITH_WARNINGS:0,REVIEW:0,REJECT:0},reasons={};
const evaluated=items.map(item=>{const result=classifier.evaluate(item.job,fixture.intent);counts[result.decision]++;for(const reason of result.reasons)reasons[reason]=(reasons[reason]||0)+1;return {id:item.job.id,title:item.job.title,company:item.job.company,provider:item.job.provider||item.job.source,decision:result.decision,reasons:result.reasons,score:result.score,family:result.primaryJobFamily,location:item.job.location};}).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title));
console.log(JSON.stringify({mode:"READ_ONLY_SHADOW",runId:runId||null,sampleSize:evaluated.length,counts,reasons,top10:evaluated.slice(0,10)},null,2));
