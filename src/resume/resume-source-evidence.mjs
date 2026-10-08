function flattenEvidenceValue(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(flattenEvidenceValue).join(" ");
  if (value && typeof value === "object")
    return Object.values(value).map(flattenEvidenceValue).join(" ");
  return "";
}

export function buildResumeSourceEvidence(resume = {}, profile = {}) {
  const values = [];
  for (const [section, value] of Object.entries(resume.sections || {})) {
    if (typeof value === "string" && value.trim())
      values.push({
        id: `resume:${resume.id}:${section}`,
        text: value,
        sourceSection: section,
        type: "RESUME_SOURCE",
      });
    else if (Array.isArray(value))
      for (const [index, item] of value.entries()) {
        const text = flattenEvidenceValue(item).replace(/\s+/g, " ").trim();
        if (text)
          values.push({
            id: `resume:${resume.id}:${section}:${index}`,
            text,
            sourceSection: section,
            type: "RESUME_SOURCE",
          });
      }
  }
  if (resume.text && !values.length)
    values.push({
      id: `resume:${resume.id}:text`,
      text: resume.text,
      sourceSection: "document",
      type: "RESUME_SOURCE",
    });

  const add = (id, text, section) => {
      if (String(text || "").trim())
        values.push({
          id: `profile:${id}`,
          text: String(text),
          sourceSection: section,
          type: "CANDIDATE_PROFILE",
        });
    },
    asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);
  add("summary", profile.career?.summary, "summary");
  for (const [index, item] of asList(profile.career?.skills).entries())
    add(`skill:${index}`, typeof item === "string" ? item : item?.name, "skills");
  for (const [index, item] of asList(profile.experience).entries())
    add(`experience:${index}`, flattenEvidenceValue(item), "experience");
  for (const [index, item] of asList(profile.education).entries())
    add(`education:${index}`, flattenEvidenceValue(item), "education");
  for (const [index, item] of asList(profile.certifications).entries())
    add(
      `certification:${index}`,
      typeof item === "string" ? item : item?.name,
      "certifications",
    );
  for (const [section, items] of Object.entries(profile.resumeData || {}))
    for (const [index, item] of asList(items).entries())
      add(`resume-data:${section}:${index}`, flattenEvidenceValue(item), section);
  return values;
}
