import {WorkableMetadataClient} from "../automation/ats/workable/workable-metadata-client.mjs";
import {parseWorkableIdentity,validateWorkableSubmissionTarget} from "../automation/ats/workable/workable-target-policy.mjs";
import {HostedFinalRevalidator} from "./hosted-final-revalidator.mjs";
export class WorkableFinalRevalidator extends HostedFinalRevalidator{constructor(options={}){super({...options,provider:"workable",metadataClient:options.metadataClient||new WorkableMetadataClient(),parseIdentity:parseWorkableIdentity,validateTarget:validateWorkableSubmissionTarget});}}
