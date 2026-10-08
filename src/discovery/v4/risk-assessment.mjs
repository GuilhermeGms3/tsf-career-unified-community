export function assessDiscoveryRisk(input={}){
  const text=`${input.title||""} ${input.excerpt||""}`.toLowerCase(),contact=String(input.applicationContact||"");
  const risky=/pagamento antecipado|taxa para participar|pix para|depósito obrigatório|compre o kit/.test(text);
  const sensitive=/documento|cpf|rg|dados bancários/.test(text);
  const verified=input.official===true||input.sourceClass==="STRUCTURED_ATS";
  const state=risky?"RISKY":sensitive?"REVIEW_REQUIRED":verified?"VERIFIED":input.company&&input.title?"LIKELY_LEGITIMATE":"UNVERIFIED";
  return {state,signals:[...(risky?["SOLICITA_PAGAMENTO"]:[]),...(sensitive?["SOLICITA_DADO_SENSIVEL"]:[]),...(contact?["CONTATO_EXPLICITO"]:[])],automaticFraudDecision:false};
}
