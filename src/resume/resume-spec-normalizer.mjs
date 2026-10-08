const clean = (value) =>
  String(value ?? "")
    .replace(/^\s*[-_=]{3,}\s*$/gm, "")
    .replace(/\r/g, "")
    .trim();
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const splitLines = (value) =>
  clean(value)
    .split(/\n+/)
    .map((x) => x.replace(/^\s*[•*-]\s*/, "").trim())
    .filter(Boolean);
const objects = (value, mapper) =>
  list(value).flatMap((item, index) =>
    typeof item === "object" && item
      ? [{ ...item }]
      : mapper(clean(item), index),
  );
const hasCollapsedWords = (value) => /\p{L}{28,}/u.test(clean(value));
const hasContent = (value) =>
  Array.isArray(value) ? value.length > 0 : Boolean(clean(value));
const splitAtHeading = (value, heading) => {
  if (typeof value !== "string") return [value, ""];
  const source = clean(value), match = heading.exec(source);
  if (!match) return [source, ""];
  return [source.slice(0, match.index).trim(), source.slice(match.index + match[0].length).trim()];
};

function safeSummary(sections, profile, warnings) {
  const imported = clean(sections.summary),
    confirmed = clean(profile.career?.summary);
  if (!hasCollapsedWords(imported)) return imported || confirmed;
  warnings.push({ section: "summary", code: "COLLAPSED_WORD_SPACING" });
  return hasCollapsedWords(confirmed) ? "" : confirmed;
}

function parseExperience(value, index) {
  const rawLines = clean(value)
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean),
    starts = rawLines
      .map((line, lineIndex) =>
        !/^\s*[•*-]/.test(line) && /\b(?:19|20)\d{2}\b/.test(line)
          ? lineIndex
          : -1,
      )
      .filter((x) => x >= 0);
  if (!rawLines.length) return [];
  const groups =
    starts.length > 1
      ? starts.map((start, pos) =>
          rawLines.slice(start, starts[pos + 1] ?? rawLines.length),
        )
      : [rawLines];
  return groups.map((group, groupIndex) => {
    const raw = group.map((x) => x.trim()).filter(Boolean),
      header = raw.shift(),
      dateStart = header.search(/\b(?:(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?:eiro|vereiro|ço|il|o|ho|h[oa]|sto|embro|ubro|embro|embro)?\/?|(?:19|20))\d{4}\b/i),
      name = (dateStart >= 0 ? header.slice(0, dateStart) : header).trim(),
      dates = (dateStart >= 0 ? header.slice(dateStart) : "").trim(),
      dateParts = dates.split(/\s+(?:-|–|—|a|to)\s+/i),
      role = raw[0] && !/^\s*[•*-]\s*/.test(raw[0]) ? raw.shift() : "",
      bullets = [];
    for (const line of raw) {
      if (/^\s*[•*-]\s*/.test(line)) bullets.push(line.replace(/^\s*[•*-]\s*/, "").trim());
      else if (bullets.length) bullets[bullets.length - 1] += ` ${line}`;
      else if (line) bullets.push(line);
    }
    return {
      id: `experience-${index + 1}-${groupIndex + 1}`,
      title: role.replace(/\s*\|.*$/, "").trim(),
      company: name,
      startDate: dateParts[0] || "",
      endDate: dateParts.slice(1).join(" - "),
      bullets,
      rawText: group.join("\n"),
      normalizationConfidence: name && role ? 0.82 : 0.62,
    };
  });
}
function parseEducation(value, index) {
  const lines = splitLines(value), items = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex], next = lines[lineIndex + 1] || "",
      dated = /\b(?:19|20)\d{2}\b|conclus[aã]o\s*:/i.test(line);
    if (dated && next && !/\b(?:19|20)\d{2}\b|conclus[aã]o\s*:/i.test(next)) {
      const conclusion = line.match(/conclus[aã]o\s*:\s*(.+)$/i)?.[1]?.trim() || "",
        years = [...line.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => match[0]);
      items.push({
        id: `education-${index + 1}-${items.length + 1}`,
        institution: line.replace(/\s+(?:conclus[aã]o\s*:.*|(?:19|20)\d{2}.*)$/i, "").trim(),
        degree: next,
        field: "",
        startDate: conclusion ? "" : years[0] || "",
        endDate: conclusion || years.at(-1) || "",
        rawText: `${line}\n${next}`,
        normalizationConfidence: 0.76,
      });
      lineIndex += 1;
      continue;
    }
    items.push({id:`education-${index + 1}-${items.length + 1}`,institution:line,degree:"",field:"",rawText:line,normalizationConfidence:0.58});
  }
  return items;
}
function parseProjects(value, index) {
  const lines = clean(value).split(/\n+/).map((line) => line.trim()).filter(Boolean), projects = [];
  for (const line of lines) {
    const bullet = /^\s*[•*-]\s*/.test(line),
      heading = !bullet && /\s+(?:Infraestrutura|Desenvolvimento)\s*\/\s*[^/]+$/i.test(line);
    if (heading || (!projects.length && !bullet)) {
      const label = line.replace(/\s+(?:Infraestrutura|Desenvolvimento)\s*\/\s*[^/]+$/i, "").trim();
      projects.push({id:`project-${index + 1}-${projects.length + 1}`,name:label,description:"",bullets:[],rawText:line,normalizationConfidence:0.72});
    } else if (bullet && projects.length) projects.at(-1).bullets.push(line.replace(/^\s*[•*-]\s*/, "").trim());
    else if (projects.length && projects.at(-1).bullets.length) projects.at(-1).bullets[projects.at(-1).bullets.length - 1] += ` ${line}`;
  }
  return projects;
}
function parseSkills(value, index) {
  return splitLines(value).flatMap((line, lineIndex) => {
    const payload = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line;
    return payload.split(/,|\s+e\s+/i).map((name, itemIndex) => name.trim().replace(/\.$/, "")).filter(Boolean).map((name, itemIndex) => ({id:`skill-${index + 1}-${lineIndex + 1}-${itemIndex + 1}`,name,rawText:name,normalizationConfidence:0.8}));
  });
}
function named(value, index, prefix) {
  return splitLines(value).map((name, lineIndex) => ({
    id: `${prefix}-${index + 1}-${lineIndex + 1}`,
    name,
    rawText: name,
    normalizationConfidence: 0.72,
  }));
}

export class ResumeSpecNormalizer {
  normalize({ profile = {}, resume = {} } = {}) {
    const structured = profile.resumeData || {},
      sections = resume.sections || {},
      [experienceSection, embeddedProjects] = splitAtHeading(sections.experience, /\bPROJETOS?\s+T[ÉE]CNICOS?\b/i),
      [educationSection, embeddedSkillsBlock] = splitAtHeading(sections.education, /\bCOMPET[ÊE]NCIAS?\s+T[ÉE]CNICAS?\b/i),
      embeddedLanguageLines = splitLines(embeddedSkillsBlock).filter((line) => /^idiomas?\s*:/i.test(line)),
      embeddedSkills = splitLines(embeddedSkillsBlock).filter((line) => !/^idiomas?\s*:/i.test(line)).join("\n"),
      embeddedLanguages = embeddedLanguageLines.map((line) => line.replace(/^idiomas?\s*:\s*/i, "")).join("\n");
    const experiences = objects(
      hasContent(experienceSection)
        ? experienceSection
        : structured.experience?.length ? structured.experience : profile.experience,
      parseExperience,
    );
    const education = objects(
      hasContent(educationSection)
        ? educationSection
        : structured.education?.length ? structured.education : profile.education,
      parseEducation,
    );
    const projects = objects(
      hasContent(sections.projects || embeddedProjects)
        ? sections.projects || embeddedProjects
        : structured.projects?.length ? structured.projects : profile.projects,
      parseProjects,
    );
    const certifications = objects(
      hasContent(sections.certifications)
        ? sections.certifications
        : resume.id ? [] : structured.certifications?.length ? structured.certifications : profile.certifications,
      (value, index) => named(value, index, "certification"),
    );
    const languages = objects(
      hasContent(sections.languages || embeddedLanguages)
        ? sections.languages || embeddedLanguages
        : structured.languages?.length ? structured.languages : profile.languages,
      (value, index) => named(value, index, "language"),
    );
    const skills = objects(
      hasContent(sections.skills || embeddedSkills)
        ? sections.skills || embeddedSkills
        : structured.skills?.length ? structured.skills : profile.career?.skills,
      parseSkills,
    );
    const collections = {
      experience: experiences,
      education,
      projects,
      certifications,
      languages,
      skills,
    };
    const all = Object.values(collections).flat();
    const confidence = all.length
      ? all.reduce(
          (sum, item) => sum + Number(item.normalizationConfidence ?? 0.95),
          0,
        ) / all.length
      : 1;
    const warnings = [];
    for (const [section, items] of Object.entries(collections))
      if (items.some((x) => Number(x.normalizationConfidence ?? 1) < 0.7))
        warnings.push({ section, code: "LOW_NORMALIZATION_CONFIDENCE" });
    return {
      resume: {
        ...resume,
        sections: {
          ...sections,
          summary: safeSummary(sections, profile, warnings),
          ...collections,
        },
      },
      confidence: Number(confidence.toFixed(2)),
      warnings,
      requiresReview: warnings.length > 0,
    };
  }
}
