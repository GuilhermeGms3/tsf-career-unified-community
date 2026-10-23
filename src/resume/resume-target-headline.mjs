import { classifyJobFamily } from "../discovery/relevance/pre-match-plausibility.mjs";

const headlines = Object.freeze({
  INFRASTRUCTURE: "Infraestrutura de TI",
  NETWORK_NOC: "Redes e monitoramento",
  SUPPORT: "Suporte de TI",
  SOFTWARE_INTERNSHIP: "Desenvolvimento de software",
  BACKEND: "Desenvolvimento backend",
  FRONTEND: "Desenvolvimento frontend",
  FULLSTACK: "Desenvolvimento full stack",
  DEVOPS_SRE: "DevOps e confiabilidade de sistemas",
  DATA: "Dados e análise",
  SECURITY: "Segurança da informação",
});

export function withTargetedResumeHeadline(spec, job) {
  if (!job?.title) return spec;
  // This is the target area, not a claim of previously holding the vacancy's title.
  const family = classifyJobFamily({ title: job.title }).primaryJobFamily;
  const headline = headlines[family];
  return headline ? { ...spec, candidate: { ...spec.candidate, headline } } : spec;
}
