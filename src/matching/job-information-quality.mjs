import { normalizeJobDescription } from "./job-description-normalizer.mjs";

export function jobInformationQuality(job = {}) {
  const text = normalizeJobDescription(job.description);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const sufficient = text.length >= 100 && wordCount >= 15;
  return {
    sufficient,
    status: sufficient ? "SUFFICIENT" : text ? "INSUFFICIENT" : "MISSING",
    characterCount: text.length,
    wordCount,
    reasonCode: sufficient ? "" : "JOB_DESCRIPTION_INSUFFICIENT",
    message: sufficient ? "" : "A descrição da vaga está ausente ou incompleta. Atualize os detalhes antes de confiar na nota ou enviar automaticamente.",
  };
}
