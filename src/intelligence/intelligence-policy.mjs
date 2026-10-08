export const INTELLIGENCE_POLICIES = Object.freeze({
  semanticEnhancementEnabled:true,questionClassificationEnabled:true,answerDraftingEnabled:true,resumeTailoringEnabled:true,coverLetterEnabled:true,
  minimumDeterministicConfidenceBeforeLlm:0.75,requireReviewForGeneratedAnswers:true,requireReviewForResumeChanges:true,maxConcurrentLocalRequests:1,allowCloudProvider:false
});

export function normalizeIntelligencePolicies(input={}){return Object.freeze({...INTELLIGENCE_POLICIES,...input,allowCloudProvider:Boolean(input.allowCloudProvider),requireReviewForGeneratedAnswers:true,requireReviewForResumeChanges:true,maxConcurrentLocalRequests:Math.max(1,Math.min(4,Number(input.maxConcurrentLocalRequests||1)))});}
