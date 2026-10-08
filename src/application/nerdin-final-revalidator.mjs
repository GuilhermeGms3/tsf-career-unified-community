import {NerdinMetadataClient} from "../automation/ats/nerdin/nerdin-metadata-client.mjs";
import {parseNerdinIdentity,validateNerdinSubmissionTarget} from "../automation/ats/nerdin/nerdin-target-policy.mjs";
import {HostedFinalRevalidator} from "./hosted-final-revalidator.mjs";
export class NerdinFinalRevalidator extends HostedFinalRevalidator{constructor(options={}){super({...options,provider:"nerdin",metadataClient:options.metadataClient||new NerdinMetadataClient(),parseIdentity:parseNerdinIdentity,validateTarget:validateNerdinSubmissionTarget});}}
