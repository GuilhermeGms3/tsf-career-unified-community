import { benchmark, fixture, legacyDecision } from "./discovery-relevance-benchmark.mjs";
import { PreMatchPlausibility } from "../src/discovery/relevance/pre-match-plausibility.mjs";

const classifier=new PreMatchPlausibility({now:()=>new Date("2026-08-23T12:00:00Z")});
const baseline=benchmark(fixture.items,legacyDecision),after=benchmark(fixture.items,job=>classifier.evaluate(job,fixture.intent));
const result={dataset:"R1 regression benchmark",sampleSize:fixture.items.length,baseline:baseline.metrics,after:after.metrics,acceptance:{precisionAt5:after.metrics.precisionAt5>=0.8,recallNotRegressed:after.metrics.recall>=baseline.metrics.recall,ndcgImproved:after.metrics.ndcgAt10>baseline.metrics.ndcgAt10,falsePositiveRateReduced:after.metrics.falsePositiveRate<baseline.metrics.falsePositiveRate}};
console.log(JSON.stringify(result,null,2));
if(Object.values(result.acceptance).some(value=>!value))process.exitCode=1;
