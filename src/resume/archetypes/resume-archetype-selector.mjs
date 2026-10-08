const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
const tokens = (value) =>
  new Set(
    normalize(value)
      .split(/[^a-z0-9+#/.-]+/)
      .filter((item) => item.length > 1),
  );
const clamp = (value) => Math.max(0, Math.min(1, Number(value || 0)));
const evidenceText = (evidence) =>
  normalize(
    (evidence || [])
      .map(
        (item) =>
          `${item.normalizedName || ""} ${item.text || ""} ${item.value || ""}`,
      )
      .join(" "),
  );
const coverage = (needles, haystack) => {
  const items = (needles || []).map(normalize).filter(Boolean);
  return items.length
    ? items.filter((item) => haystack.includes(item)).length / items.length
    : 0;
};
const titleCoverage = (titles, title) => {
  const titleTokens = tokens(title);
  if (!titleTokens.size) return 0;
  return Math.max(
    0,
    ...(titles || []).map((candidate) => {
      const candidateTokens = tokens(candidate);
      return candidateTokens.size
        ? [...candidateTokens].filter((token) => titleTokens.has(token))
            .length / candidateTokens.size
        : 0;
    }),
  );
};

export class ResumeArchetypeSelector {
  select({
    job = {},
    requirements = [],
    evidence = [],
    archetypes = [],
    assignments = [],
    resumes = [],
    analyses = [],
  } = {}) {
    const factual = evidenceText(evidence),
      jobText = normalize(
        `${job.title || ""} ${job.description || ""} ${(requirements || []).map((item) => item.normalizedName || item.name || item.text || "").join(" ")}`,
      ),
      hard = (requirements || []).filter(
        (item) => normalize(item.priority || item.importance) === "required" || item.required === true,
      ),
      scored = (archetypes || [])
        .filter((item) => item.enabled !== false)
        .map((archetype) => {
          const title = titleCoverage(archetype.targetTitles, job.title),
            domain = coverage(archetype.targetDomains, jobText),
            jobSkill = coverage(archetype.prioritySkills, jobText),
            candidateSkill = coverage(archetype.prioritySkills, factual),
            hardNames = hard.map(
              (item) => item.normalizedName || item.name || item.text,
            ),
            hardEvidence = hardNames.length
              ? coverage(hardNames, factual)
              : candidateSkill,
            score =
              archetype.id === "GENERAL"
                ? 0.24
                : 0.3 * title +
                  0.15 * domain +
                  0.2 * jobSkill +
                  0.25 * hardEvidence +
                  0.1 * candidateSkill,
            matchedSkills = (archetype.prioritySkills || []).filter((skill) =>
              factual.includes(normalize(skill)),
            ),
            matchingAssignments = assignments.filter(
              (item) =>
                item.archetypeId === archetype.id && item.status === "APPROVED",
            ),
            rankedBases = matchingAssignments
              .map((assignment) => {
                const resume = resumes.find(
                    (item) => item.id === assignment.resumeId,
                  ),
                  analysis = analyses
                    .filter(
                      (item) =>
                        item.resumeId === assignment.resumeId &&
                        (item.jobId === job.id || !item.jobId),
                    )
                    .sort(
                      (a, b) =>
                        Number(b.overallScore || b.score || 0) -
                        Number(a.overallScore || a.score || 0),
                    )[0];
                return {
                  assignment,
                  resume,
                  score:
                    0.65 * assignment.evidenceCoverage +
                    0.35 *
                      (Number(analysis?.overallScore || analysis?.score || 0) /
                        100),
                };
              })
              .filter((item) => item.resume)
              .sort((a, b) => b.score - a.score);
          return {
            archetype,
            score: clamp(score),
            titleCoverage: title,
            domainCoverage: domain,
            jobSkillCoverage: jobSkill,
            evidenceCoverage: candidateSkill,
            hardEvidenceCoverage: hardEvidence,
            matchedSkills,
            base: rankedBases[0] || null,
          };
        })
        .sort((a, b) => b.score - a.score),
      best = scored[0] || null,
      second = scored[1] || null,
      ambiguous = Boolean(
        best &&
          second &&
          best.archetype.id !== "GENERAL" &&
          best.score - second.score < 0.08,
      ),
      selected =
        best?.score >= 0.3
          ? best
          : scored.find((item) => item.archetype.id === "GENERAL") || best,
      confidence = selected
        ? clamp(selected.score * (ambiguous ? 0.72 : 1))
        : 0;
    if (!selected)
      return {
        archetypeId: "GENERAL",
        archetypeVersion: "general-v1",
        baseResumeId: "",
        confidence: 0,
        reasons: ["Nenhum archetype habilitado."],
        evidenceCoverage: 0,
        requiresIntelligence: false,
        candidates: [],
      };
    return {
      archetypeId: selected.archetype.id,
      archetypeVersion: selected.archetype.version,
      baseResumeId: selected.base?.resume.id || "",
      confidence: Number(confidence.toFixed(3)),
      reasons: [
        `Cargo ${Math.round(selected.titleCoverage * 100)}%`,
        `Dominio ${Math.round(selected.domainCoverage * 100)}%`,
        `Hard requirements com evidencia ${Math.round(selected.hardEvidenceCoverage * 100)}%`,
        `Skills comprovadas ${Math.round(selected.evidenceCoverage * 100)}%`,
        ...(selected.matchedSkills.length
          ? [`Evidencias: ${selected.matchedSkills.slice(0, 6).join(", ")}`]
          : []),
      ],
      evidenceCoverage: Number(selected.evidenceCoverage.toFixed(3)),
      requiresIntelligence: ambiguous && confidence < 0.7,
      candidates: scored.map((item) => ({
        archetypeId: item.archetype.id,
        score: Number(item.score.toFixed(3)),
        evidenceCoverage: Number(item.evidenceCoverage.toFixed(3)),
        baseResumeId: item.base?.resume.id || "",
      })),
    };
  }
}
