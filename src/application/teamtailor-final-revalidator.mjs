import { TeamtailorMetadataClient } from "../automation/ats/teamtailor/teamtailor-metadata-client.mjs";
import { parseTeamtailorIdentity, validateTeamtailorSubmissionTarget } from "../automation/ats/teamtailor/teamtailor-target-policy.mjs";
import { HostedFinalRevalidator } from "./hosted-final-revalidator.mjs";

export class TeamtailorFinalRevalidator extends HostedFinalRevalidator {
  constructor(options = {}) {
    super({
      ...options,
      provider: "teamtailor",
      metadataClient: options.metadataClient || new TeamtailorMetadataClient(),
      parseIdentity: parseTeamtailorIdentity,
      validateTarget: validateTeamtailorSubmissionTarget,
    });
  }
}
