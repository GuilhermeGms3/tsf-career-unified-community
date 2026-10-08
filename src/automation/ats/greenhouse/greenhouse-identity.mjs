function safeUrl(value){try{return new URL(value)}catch{return null}}

export function parseGreenhouseIdentity(value) {
  const url=safeUrl(value);if(!url)return {boardToken:"",jobPostId:"",canonicalUrl:"",signals:[],confidence:0};
  const signals=[];let boardToken="";let jobPostId="";const host=url.hostname.toLowerCase();const parts=url.pathname.split("/").filter(Boolean);
  if(/(^|\.)greenhouse\.io$/.test(host)){signals.push("greenhouse-hostname");const jobs=parts.indexOf("jobs");if(jobs>0){boardToken=parts[jobs-1];jobPostId=parts[jobs+1]||"";}if(parts[0]==="embed"&&url.searchParams.get("for")){boardToken=url.searchParams.get("for")||"";jobPostId=url.searchParams.get("token")||url.searchParams.get("job_id")||"";}}
  if(url.searchParams.get("gh_jid")){jobPostId=url.searchParams.get("gh_jid")||"";signals.push("gh-jid-query");}
  if(boardToken)signals.push("board-token-url");if(jobPostId)signals.push("job-post-id-url");
  const canonicalUrl=boardToken&&jobPostId?`https://job-boards.greenhouse.io/${encodeURIComponent(boardToken)}/jobs/${encodeURIComponent(jobPostId)}`:"";
  return {boardToken,jobPostId,canonicalUrl,sourceUrl:url.href,signals,confidence:boardToken&&jobPostId?0.99:signals.length?0.7:0};
}

export function canonicalGreenhouseKey(identity){return identity?.boardToken&&identity?.jobPostId?`greenhouse:${identity.boardToken.toLowerCase()}:${identity.jobPostId}`:"";}
