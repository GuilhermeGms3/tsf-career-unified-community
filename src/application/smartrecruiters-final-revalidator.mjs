import {SmartRecruitersMetadataClient} from "../automation/ats/smartrecruiters/smartrecruiters-metadata-client.mjs";
import {parseSmartRecruitersIdentity,validateSmartRecruitersSubmissionTarget} from "../automation/ats/smartrecruiters/smartrecruiters-target-policy.mjs";
import {HostedFinalRevalidator} from "./hosted-final-revalidator.mjs";
export class SmartRecruitersFinalRevalidator extends HostedFinalRevalidator{constructor(options={}){super({...options,provider:"smartrecruiters",metadataClient:options.metadataClient||new SmartRecruitersMetadataClient(),parseIdentity:parseSmartRecruitersIdentity,validateTarget:validateSmartRecruitersSubmissionTarget});}}
