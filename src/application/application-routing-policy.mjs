export const APPLICATION_ROUTING_DEFAULTS = Object.freeze({ minimumAtsScore:80, whatsappMinimumAtsScore:60, whatsappMaximumAtsScore:79 });

export function applicationRoutingThresholds(policy={}) {
  const values=Object.fromEntries(Object.entries(APPLICATION_ROUTING_DEFAULTS).map(([key,fallback])=>[key,Number(policy[key]??fallback)]));
  const {minimumAtsScore:auto,whatsappMinimumAtsScore:min,whatsappMaximumAtsScore:max}=values;
  return {...values,valid:Object.values(values).every(Number.isInteger)&&auto>=0&&auto<=100&&min>=0&&min<=max&&max<auto};
}

export function resumeAtsScore(version={}) {
  const raw=version.atsAfter?.overallScore??version.atsAfter?.score??version.atsAfter?.comparison?.afterScore;
  if(raw===null||raw===undefined||raw==="")return null;
  const score=Number(raw);return Number.isFinite(score)&&score>=0&&score<=100?score:null;
}

export const tailoringAllowsAutoApply=run=>run?.evidenceStatus==="VALID"&&run.quality?.status==="PASS"&&run.quality?.autoApplyEligible===true;

// Routing expresses intent, not permission to click. Unknown submission gates
// are false even when the score puts the job in the automatic band.
export function evaluateApplicationRoutingPolicy({score,policy={},qualityApproved=false,descriptionSufficient=true,eligibility="UNKNOWN",humanApproved=false,gates={}}={}) {
  const thresholds=applicationRoutingThresholds(policy),known=score!==null&&score!==undefined&&score!==""&&Number.isFinite(Number(score))&&Number(score)>=0&&Number(score)<=100;
  const reasons=[];
  let band="UNKNOWN",route="PLATFORM_ANALYSIS";
  if(!thresholds.valid)reasons.push("ROUTING_POLICY_INVALID");
  else if(eligibility==="NOT_ELIGIBLE")reasons.push("NOT_ELIGIBLE");
  else if(!descriptionSufficient&&policy.enabled===true)reasons.push("JOB_DESCRIPTION_INSUFFICIENT");
  else if(!known){reasons.push("ATS_SCORE_UNAVAILABLE");if(policy.enabled!==true)route="WHATSAPP_REVIEW";}
  else if(Number(score)<thresholds.whatsappMinimumAtsScore){band="LOW";reasons.push("BELOW_REVIEW_THRESHOLD");}
  else if(Number(score)>=thresholds.minimumAtsScore){
    band="AUTO_ELIGIBLE";
    route=policy.enabled===true&&qualityApproved?"AUTO_APPLY":"WHATSAPP_REVIEW";
    if(!qualityApproved)reasons.push("RESUME_QUALITY_REVIEW_REQUIRED");
    if(policy.enabled!==true)reasons.push("AUTOMATIC_POLICY_DISABLED");
  }else if(Number(score)<=thresholds.whatsappMaximumAtsScore){band="HUMAN_REVIEW";route="WHATSAPP_REVIEW";}
  else{band="CONFIGURED_REVIEW_GAP";reasons.push("OUTSIDE_CONFIGURED_WHATSAPP_BAND");}
  const authorization=humanApproved||route==="AUTO_APPLY";
  const automaticSubmitAllowed=thresholds.valid&&authorization&&(humanApproved||gates.portalHomologated===true)&&qualityApproved&&descriptionSufficient&&["ELIGIBLE","ELIGIBLE_WITH_WARNINGS"].includes(eligibility)&&
    ["resumeApproved","factsVerified","questionsAnswered","sessionValid","portalCanSubmit","submissionEnabled","noPriorSubmission"].every(key=>gates[key]===true);
  return {band,route,automaticSubmitAllowed,requiresHumanApproval:route==="WHATSAPP_REVIEW"&&!humanApproved,thresholds,reasons};
}
