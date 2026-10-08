import { findCertificationMentions, findSkillMentions, foldText, normalizeSkillName } from "./normalization.mjs";

function supportedConcepts(analysis) {
  return new Set((analysis?.candidateEvidence || [])
    .filter((item) => item.type !== "role")
    .map((item) => item.normalizedName));
}

function hasUnsupportedConcept(value, supported, analysis) {
  const text = String(Array.isArray(value) ? value.join("\n") : value || "");
  const concepts = [
    ...findSkillMentions(text).map((item) => item.name),
    ...findCertificationMentions(text).map((item) => item.name)
  ];
  for (const requirement of analysis?.requirements || []) {
    if (!["skill", "tool", "framework", "platform", "cloud", "operating_system", "methodology", "certification"].includes(requirement.type)) continue;
    if (foldText(text).includes(foldText(requirement.normalizedName).replaceAll("-", " ")) || foldText(text).includes(foldText(requirement.originalText))) {
      concepts.push(requirement.normalizedName);
    }
  }
  return concepts.some((concept) => !supported.has(concept));
}

function safeArray(value, fallback, supported, analysis) {
  if (!Array.isArray(value)) return fallback;
  const filtered = value.filter((item) => {
    const normalized = normalizeSkillName(item, item);
    return normalized && supported.has(normalized) && !hasUnsupportedConcept(item, supported, analysis);
  });
  return filtered.length ? filtered : fallback;
}

export function guardGeneratedResumeSections({ generated = {}, fallback, analysis }) {
  const supported = supportedConcepts(analysis);
  return {
    sections: {
      summary: fallback.summary,
      skills: safeArray(generated.skills, fallback.skills, supported, analysis),
      experience: fallback.experience,
      education: fallback.education,
      certifications: safeArray(generated.certifications, fallback.certifications, supported, analysis),
      projects: fallback.projects,
      languages: safeArray(generated.languages, fallback.languages, supported, analysis)
    },
    rejectedUnsupportedContent: ["summary", "skills", "certifications", "languages"]
      .filter((key) => hasUnsupportedConcept(generated[key], supported, analysis))
  };
}
