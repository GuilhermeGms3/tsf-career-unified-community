export function parseGupyIdentity(value){
  const empty={companyKey:"",providerJobId:"",canonicalUrl:"",applicationUrl:""};
  try{
    const url=new URL(value),company=url.hostname.toLowerCase().match(/^([a-z0-9-]+)\.gupy\.io$/)?.[1],match=url.pathname.match(/^\/(?:candidates\/)?jobs\/(\d+)(?:\/apply)?\/?$/i);
    if(url.protocol!=="https:"||url.port||url.username||url.password||!company)return empty;
    let jobId=match?.[1]||"";
    const encoded=url.pathname.match(/^\/job\/([a-zA-Z0-9_=-]{1,1000})\/?$/)?.[1];
    if(!jobId&&encoded){const payload=JSON.parse(Buffer.from(encoded,"base64url").toString("utf8"));if(/^[1-9][0-9]{0,15}$/.test(String(payload.jobId)))jobId=String(payload.jobId);}
    if(!jobId)return empty;
    return {companyKey:company,providerJobId:jobId,canonicalUrl:`https://${company}.gupy.io/jobs/${jobId}`,applicationUrl:`https://${company}.gupy.io/candidates/jobs/${jobId}/apply`};
  }catch{return empty;}
}
