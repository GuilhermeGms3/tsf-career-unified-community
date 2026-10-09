import {applicationProvider} from "./source-attribution.mjs";

const workableRouteMarkers=new Set(["j","job","jobs","view","apply","www"]);
const workableOrganization=value=>{const candidate=String(value||"").toLowerCase();return workableRouteMarkers.has(candidate)?"":candidate;};

export class SourceResolver{
  resolve(value){
    try{
      const url=new URL(value),parts=url.pathname.split("/").filter(Boolean),hostParts=url.hostname.split("."),atsType=applicationProvider(url.toString()).toLowerCase();
      if(atsType==="unknown")return {atsType:"unknown",canonicalTarget:false,url:url.toString(),organizationKey:"",providerJobId:""};
      let organizationKey="",providerJobId="";
      if(atsType==="greenhouse"){organizationKey=url.searchParams.get("for")||parts[0]||"";providerJobId=parts.at(-1)||url.searchParams.get("token")||"";}
      else if(["lever","ashby","smartrecruiters"].includes(atsType)){organizationKey=parts[0]||"";providerJobId=atsType==="ashby"&&["application","apply"].includes(parts.at(-1))?parts.at(-2)||"":parts.at(-1)||"";}
      else if(atsType==="workable"){organizationKey=workableOrganization(url.hostname==="apply.workable.com"?parts[0]:hostParts[0]);providerJobId=parts.includes("j")?parts[parts.indexOf("j")+1]||"":parts.at(-1)||"";}
      else if(atsType==="gupy"){organizationKey=hostParts[0]==="portal"?parts[0]||"":hostParts[0]||parts[0]||"";providerJobId=parts.at(-1)||"";}
      else if(atsType==="teamtailor"){organizationKey=hostParts[0]||"portal";providerJobId=parts[0]==="jobs"?(parts[1]?.match(/^\d+/)?.[0]||""):"";}
      else if(["iel","programathor","solides","recrutei","nerdin","remotar"].includes(atsType)){organizationKey=atsType==="iel"?(parts[0]||"nacional"):atsType==="solides"?(hostParts[0]||"portal"):atsType==="recrutei"?(parts[1]||"portal"):"portal";providerJobId=atsType==="nerdin"?(url.searchParams.get("id")||parts.at(-1)?.match(/-(\d{4,})\.php$/i)?.[1]||""):atsType==="remotar"?(parts.find(part=>/^\d+$/.test(part))||""):parts.map(part=>part.match(/^(\d{4,})(?:-|$)/)?.[1]).find(Boolean)||"";}
      else if(atsType==="quickin"){organizationKey=parts[0]||"portal";providerJobId=parts.includes("jobs")?parts[parts.indexOf("jobs")+1]||"":parts.at(-1)||"";}
      else if(atsType==="pandape"){organizationKey=hostParts[0]||"portal";providerJobId=parts.find(part=>/^\d+$/.test(part))||"";}
      else if(atsType==="abler"){organizationKey="portal";providerJobId=parts.find(part=>/^[a-z0-9-]{6,}$/i.test(part))||parts.at(-1)||"";}
      return {atsType,canonicalTarget:true,url:url.toString(),organizationKey,providerJobId};
    }catch{return {atsType:"unknown",canonicalTarget:false,url:"",organizationKey:"",providerJobId:""};}
  }
}
