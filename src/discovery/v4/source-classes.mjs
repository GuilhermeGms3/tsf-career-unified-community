export const SOURCE_CLASSES=Object.freeze([
  "STRUCTURED_ATS","JOB_BOARD","OFFICIAL_CAREER_PAGE","PUBLIC_WEB","PUBLIC_SOCIAL_SIGNAL",
  "RECRUITER_PUBLIC_SIGNAL","COMMUNITY_WHATSAPP_GROUP","INTERNSHIP_PORTAL","CONSULTANCY_STAFFING",
  "NEWS_BLOG_HIRING_SIGNAL","EXTERNAL_FORM","MANUAL_LEAD_CAPTURE"
]);
export const APPLICATION_METHODS_V4=Object.freeze(["ATS","EMAIL","WHATSAPP","DIRECT_MESSAGE","EXTERNAL_FORM","CAREER_PAGE","MANUAL","UNKNOWN"]);
const classSet=new Set(SOURCE_CLASSES);
export function normalizeSourceClasses(values=[]){return [...new Set((Array.isArray(values)?values:[]).map(value=>String(value).toUpperCase()).filter(value=>classSet.has(value)))];}
export function sourceAvailability({publicWebConfigured=false,evolutionConfigured=false,brazilianSourcesReady=false}={}){
  const status={STRUCTURED_ATS:"SUPPORTED",JOB_BOARD:"SUPPORTED",OFFICIAL_CAREER_PAGE:"PARTIAL",PUBLIC_WEB:publicWebConfigured?"SUPPORTED":"OPTIONAL_DISABLED",PUBLIC_SOCIAL_SIGNAL:"MANUAL_ONLY",RECRUITER_PUBLIC_SIGNAL:"MANUAL_ONLY",COMMUNITY_WHATSAPP_GROUP:evolutionConfigured?"SUPPORTED":"CONFIG_REQUIRED",INTERNSHIP_PORTAL:brazilianSourcesReady?"SUPPORTED":"UNSUPPORTED",CONSULTANCY_STAFFING:"UNSUPPORTED",NEWS_BLOG_HIRING_SIGNAL:publicWebConfigured?"PARTIAL":"OPTIONAL_DISABLED",EXTERNAL_FORM:"MANUAL_ONLY",MANUAL_LEAD_CAPTURE:"SUPPORTED"};
  return SOURCE_CLASSES.map(sourceClass=>({sourceClass,status:status[sourceClass],operational:["SUPPORTED","PARTIAL","MANUAL_ONLY"].includes(status[sourceClass])}));
}
