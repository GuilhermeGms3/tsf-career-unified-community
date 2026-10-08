const integer=(value,fallback,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Math.trunc(Number(value)):fallback));

export class QueryBudgetPolicy{
  normalize(input={}){return {
    maxQueries:integer(input.maxQueries,24,1,60),
    maxQueriesPerProvider:integer(input.maxQueriesPerProvider,12,1,30),
    maxRequests:integer(input.maxRequests,80,1,240),
    concurrency:1
  };}
  constrain(queries=[],providers=[],input={}){const policy=this.normalize(input),unique=[...new Set(queries.map(item=>String(item.query||item).trim()).filter(Boolean))].slice(0,policy.maxQueries),providerList=[...new Set(providers.map(String).filter(Boolean))];return {policy,queries:unique,providers:providerList,plannedRequests:Math.min(policy.maxRequests,unique.length*Math.max(1,providerList.length)),truncated:unique.length<queries.length};}
}
