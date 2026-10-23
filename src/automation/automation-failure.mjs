export function classifyAutomationFailure(error) {
  const code=String(error?.code||""), message=String(error?.message||"");
  if(code==="PORTAL_TEMPORARILY_UNAVAILABLE"||/Timeout|Navigation|Target closed|browser has been closed|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ETIMEDOUT/i.test(code+" "+message))return "RETRYABLE";
  if(["FORM_NOT_FOUND","ADAPTER_UNSUPPORTED_LAYOUT","OPTION_NOT_FOUND"].includes(code))return "UNSUPPORTED";
  return "USER_REQUIRED";
}
