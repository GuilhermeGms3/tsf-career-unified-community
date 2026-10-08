export class ApplicationService {
  constructor(applicationRepository) {
    this.applications = applicationRepository;
  }

  transitionApplication(applicationId, targetStatus, metadata = {}) {
    return this.applications.transitionApplication(applicationId, targetStatus, metadata);
  }
}
