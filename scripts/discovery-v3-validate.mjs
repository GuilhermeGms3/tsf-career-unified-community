import {SearchIntentService} from "../src/discovery/search-intent/search-intent-service.mjs";
import {ApplicationMethodDetector} from "../src/discovery/application-method/application-method-detector.mjs";
import {capabilitiesFor} from "../src/discovery/source-capability-catalog.mjs";
const preview=new SearchIntentService().preview({families:["SOFTWARE_INTERNSHIP","INFRASTRUCTURE"],seniorities:["INTERNSHIP","JUNIOR"],customTerms:["Suporte N1"]},{maxQueries:24,maxRequests:80}),email=new ApplicationMethodDetector().detect({description:"Envie seu currículo para recrutamento@empresa.example"}),providers=["greenhouse","lever","ashby","smartrecruiters","workable","gupy"];
if(!preview.queries.length||email.method!=="EMAIL"||providers.some(id=>!capabilitiesFor(id).length))throw new Error("Discovery V3 validator falhou.");
console.log(JSON.stringify({ok:true,queries:preview.queries.length,emailMethod:email.method,providers:providers.length,autoSubmit:false}));
