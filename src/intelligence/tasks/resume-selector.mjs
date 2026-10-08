import { ResumeArchetypeSelector } from "../../resume/archetypes/resume-archetype-selector.mjs";

export class ResumeSelector {
  select({ resumes = [], resumeVersions = null, analyses = [], job = {}, requirements = [], evidence = [], archetypes = [], assignments = [] }) {
    const archetypeSelection = archetypes.length ? new ResumeArchetypeSelector().select({ job, requirements, evidence, archetypes, assignments, resumes, analyses }) : null;
    const approved = Array.isArray(resumeVersions)
      ? resumeVersions.filter(
          (x) =>
            ["APPROVED", "READY"].includes(x.status) &&
            !x.jobId &&
            !x.tailoringRunId,
        )
      : null;
    let eligible = approved
      ? resumes.filter((resume) =>
          approved.some((version) => version.resumeId === resume.id),
        )
      : resumes;
    if (archetypeSelection?.baseResumeId && eligible.some(item=>item.id===archetypeSelection.baseResumeId)) eligible=eligible.filter(item=>item.id===archetypeSelection.baseResumeId);
    if (!eligible.length)
      return {
        selectedResumeId: "",
        selectedResumeVersionId: "",
        score: 0,
        reasons: [
          approved
            ? "Nenhuma versao base aprovada disponivel."
            : "Nenhum curriculo disponivel.",
        ],
        fallback: true,
      };
    const jobLanguage = /\b(the|and|experience|required|preferred)\b/i.test(
      job.description || "",
    )
      ? "en"
      : "pt-BR";
    const ranked = eligible
      .map((resume) => {
        const version =
            approved
              ?.filter((x) => x.resumeId === resume.id)
              .sort(
                (a, b) =>
                  Number(b.status === "READY") - Number(a.status === "READY") ||
                  Date.parse(b.createdAt) - Date.parse(a.createdAt),
              )[0] || null,
          analysis = analyses
            .filter(
              (x) =>
                x.resumeId === resume.id && (x.jobId === job.id || !x.jobId),
            )
            .sort(
              (a, b) =>
                Number(b.overallScore || b.score || 0) -
                Number(a.overallScore || a.score || 0),
            )[0];
        const ats =
            Number(analysis?.overallScore || analysis?.score || 0) / 100,
          focus = String(
            `${resume.focus || ""} ${resume.text || ""}`,
          ).toLowerCase(),
          titleWords = String(job.title || "")
            .toLowerCase()
            .split(/\W+/)
            .filter((x) => x.length > 3),
          area = titleWords.length
            ? titleWords.filter((x) => focus.includes(x)).length /
              titleWords.length
            : 0,
          language = resume.language
            ? Number(resume.language === jobLanguage)
            : 0.5,
          evidenceCoverage = analysis?.items?.length
            ? analysis.items.filter((x) => x.status === "MATCH").length /
              analysis.items.length
            : 0,
          score =
            0.55 * ats + 0.2 * evidenceCoverage + 0.15 * area + 0.1 * language;
        return {
          resume,
          version,
          score,
          reasons: [
            `ATS ${Math.round(ats * 100)}`,
            `Cobertura ${Math.round(evidenceCoverage * 100)}`,
            `Idioma ${jobLanguage}`,
          ],
        };
      })
      .sort((a, b) => b.score - a.score);
    return {
      selectedResumeId: ranked[0].resume.id,
      selectedResumeVersionId: ranked[0].version?.id || "",
      selectedArchetypeId: archetypeSelection?.archetypeId || "GENERAL",
      archetypeSelection,
      score: Number(ranked[0].score.toFixed(3)),
      reasons: [...(archetypeSelection?.reasons||[]),...ranked[0].reasons],
      fallback: false,
      candidates: ranked.map((x) => ({
        resumeId: x.resume.id,
        resumeVersionId: x.version?.id || "",
        score: Number(x.score.toFixed(3)),
      })),
    };
  }
}
