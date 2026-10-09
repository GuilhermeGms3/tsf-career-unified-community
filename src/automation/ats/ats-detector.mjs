export class AtsDetector {
  async detect(page) {
    const hostname=new URL(page.url()).hostname;
    const signals=[];
    if(/(^|\.)greenhouse\.io$/i.test(hostname)) signals.push("greenhouse-hostname");
    if(await page.locator("form#application_form, [data-source='greenhouse'], #grnhse_app").count()) signals.push("greenhouse-form-structure");
    if(await page.locator("iframe[src*='greenhouse.io'], script[src*='greenhouse.io'], a[href*='greenhouse.io'][href*='/jobs/']").count()) signals.push("greenhouse-embed-or-link");
    if(page.frames().some(frame=>/greenhouse\.io/i.test(frame.url())))signals.push("greenhouse-frame-url");
    if(signals.length) return {type:"greenhouse",confidence:Math.min(0.99,0.72+signals.length*0.09),signals};
    if(/(^|\.)lever\.co$/i.test(hostname)||await page.locator("form[data-qa='application-form'], .application-form, a[href*='lever.co'][href*='/apply']").count())return {type:"lever",confidence:.9,signals:["lever-host-or-form"]};
    if(/(^|\.)ashbyhq\.com$/i.test(hostname)||await page.locator("form[data-testid*='application'], [data-ashby-job-posting], a[href*='ashbyhq.com'][href*='/apply']").count())return {type:"ashby",confidence:.9,signals:["ashby-host-or-form"]};
    if(/(^|\.)gupy\.io$/i.test(hostname)||await page.locator("[data-testid*='gupy'], a[href*='.gupy.io/candidates/jobs/']").count())return {type:"gupy",confidence:.92,signals:["gupy-host-or-application"],applicationSupport:"READY_TO_SUBMIT_MANUAL"};
    if(/(^|\.)smartrecruiters\.com$/i.test(hostname))return {type:"smartrecruiters",confidence:.9,signals:["smartrecruiters-hostname"],applicationSupport:"CONTROLLED_SUBMIT"};
    if(/(^|\.)workable\.com$/i.test(hostname))return {type:"workable",confidence:.9,signals:["workable-hostname"],applicationSupport:"CONTROLLED_SUBMIT"};
    if(/(^|\.)nerdin\.com\.br$/i.test(hostname))return {type:"nerdin",confidence:.95,signals:["nerdin-hostname"],applicationSupport:"CONTROLLED_SUBMIT"};
    if(/(^|\.)(teamtailor\.com|careers-page\.com)$/i.test(hostname))return {type:"teamtailor",confidence:.9,signals:["teamtailor-hostname"],applicationSupport:"CONTROLLED_SUBMIT"};
    if(/myworkdayjobs\.com$|myworkdaysite\.com$/i.test(hostname))return {type:"workday",confidence:.9,signals:["workday-hostname"],applicationSupport:"ASSISTED_FILL"};
    const assisted=[
      {type:"indeed",host:/(^|\.)(indeed\.com|indeed\.com\.br)$/i,selector:"#indeedApplyButton, [data-testid='indeedApplyButton'], form[action*='indeed']"},
      {type:"icims",host:/(^|\.)(icims\.com|icims\.eu)$/i,selector:"form[action*='icims'], [class*='iCIMS'], [id*='icims']"},
      {type:"taleo",host:/(^|\.)taleo\.net$/i,selector:"form[action*='taleo'], [id*='requisitionDescriptionInterface'], [class*='taleo']"},
      {type:"oracle",host:/(^|\.)oraclecloud\.com$/i,selector:"[data-bind*='CandidateExperience'], [class*='candidate-experience'], form[action*='CandidateExperience']"},
      {type:"successfactors",host:/(^|\.)successfactors\.com$/i,selector:"form[action*='successfactors'], [id*='careerSite'], [class*='careerSite']"},
      {type:"personio",host:/(^|\.)(personio\.de|personio\.com)$/i,selector:"form[action*='personio'], [data-test-id='application-form'], [data-testid='application-form']"},
    ];
    for(const candidate of assisted){
      const signals=[];
      if(candidate.host.test(hostname))signals.push(`${candidate.type}-hostname`);
      if(await page.locator(candidate.selector).count())signals.push(`${candidate.type}-form-structure`);
      if(signals.length)return {type:candidate.type,confidence:signals.length>1?.96:.9,signals,applicationSupport:"ASSISTED_FILL"};
    }
    const nativePlatforms=[
      ["iel",/(^|\.)carreiras\.iel\.org\.br$/i],
      ["solides",/(^|\.)(vagas\.solides\.com\.br|solides\.jobs)$/i],
      ["recrutei",/(^|\.)recrutei\.com\.br$/i],
      ["programathor",/(^|\.)programathor\.com\.br$/i],
      ["remotar",/(^|\.)remotar\.com\.br$/i],
      ["pandape",/(^|\.)pandape\.infojobs\.com\.br$/i],
      ["infojobs",/(^|\.)infojobs\.com\.br$/i],
      ["vagas",/(^|\.)vagas\.com\.br$/i],
      ["catho",/(^|\.)catho\.com\.br$/i],
      ["geekhunter",/(^|\.)geekhunter\.com\.br$/i],
      ["abler",/(^|\.)abler\.com\.br$/i],
      ["quickin",/(^|\.)jobs\.quickin\.io$/i],
    ];
    for(const [type,host] of nativePlatforms)if(host.test(hostname))return {type,confidence:.9,signals:[`${type}-hostname`],applicationSupport:"ASSISTED_FILL"};
    return {type:"unknown",confidence:0,signals:[]};
  }
}
