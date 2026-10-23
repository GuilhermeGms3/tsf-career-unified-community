export const submissionRuntimeEnabled=(env=process.env)=>env.NODE_ENV==="production"&&String(env.CAREER_SUBMISSION_ENABLED||"false").toLowerCase()==="true";
