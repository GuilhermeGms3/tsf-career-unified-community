const fields=["decision","reasons","score","primaryJobFamily","secondaryJobFamilies","familyConfidence","familyEvidence","negativeOccupationalEvidence","jobLocation","geographicMatch","workModelMatch","geographyAccepted","geographyReviewRequired","workModel","remoteScope","seniority","seniorityConfidence","opportunityType","freshness","sourceClass","algorithmVersion"];

export function serializePreMatchDecision(preMatch={},provenance={}){
  const snapshot={jobId:String(provenance.jobId||preMatch.jobId||"")};
  for(const field of fields)if(preMatch[field]!==undefined)snapshot[field]=structuredClone(preMatch[field]);
  snapshot.profileId=String(provenance.profileId||preMatch.profileId||"");
  snapshot.searchIntentId=String(provenance.searchIntentId||preMatch.searchIntentId||"");
  snapshot.searchIntentVersion=Number(provenance.searchIntentVersion??preMatch.searchIntentVersion??0);
  snapshot.jobHuntRunId=String(provenance.jobHuntRunId||preMatch.jobHuntRunId||"");
  snapshot.queryProvenance=provenance.queryProvenance??preMatch.queryProvenance??null;
  return snapshot;
}
