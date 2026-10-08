import { ResumeArchetypeSelector } from "./resume-archetype-selector.mjs";

const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
const textOf = (value) =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map(textOf).join(" ")
      : value && typeof value === "object"
        ? Object.values(value).map(textOf).join(" ")
        : "";

export class ResumeBaseService {
  constructor({ store, evidenceProvider } = {}) {
    this.store = store;
    this.evidenceProvider = evidenceProvider;
    this.selector = new ResumeArchetypeSelector();
  }
  async prepareDrafts() {
    const archetypes = this.store.resumeArchetypes.list(),
      resumes = this.store.resumes.allActive?.() || this.store.resumes.all(),
      evidence = await this.evidenceProvider({ resumes }),
      factual = normalize(
        evidence
          .map((item) => `${item.normalizedName || ""} ${item.text || ""}`)
          .join(" "),
      ),
      results = [];
    for (const archetype of archetypes) {
      const evidenceIds = evidence
          .filter((item) =>
            (archetype.prioritySkills || []).some((skill) =>
              normalize(
                `${item.normalizedName || ""} ${item.text || ""}`,
              ).includes(normalize(skill)),
            ),
          )
          .map((item) => item.id),
        coverage = archetype.prioritySkills.length
          ? archetype.prioritySkills.filter((skill) =>
              factual.includes(normalize(skill)),
            ).length / archetype.prioritySkills.length
          : 1,
        resume = resumes
          .map((item) => ({
            item,
            score: (archetype.prioritySkills || []).filter((skill) =>
              normalize(textOf(item)).includes(normalize(skill)),
            ).length,
          }))
          .sort((a, b) => b.score - a.score)[0]?.item;
      if (!resume) continue;
      results.push(
        this.store.resumeArchetypeAssignments.save({
          archetypeId: archetype.id,
          archetypeVersion: archetype.version,
          resumeId: resume.id,
          status: "REVIEW_REQUIRED",
          evidenceCoverage: coverage,
          evidenceIds,
          reasons: [
            `${evidenceIds.length} evidencias relacionadas`,
            "Base preparada para revisao; nenhum fato foi copiado para o archetype.",
          ],
          contentSelection: {
            preferredSections: archetype.preferredSections,
            priorityEvidenceIds: evidenceIds,
          },
        }),
      );
    }
    return results;
  }
  list() {
    const archetypes = this.store.resumeArchetypes.list(),
      assignments = this.store.resumeArchetypeAssignments.list(),
      resumes = this.store.resumes.allActive?.() || this.store.resumes.all();
    return archetypes.map((archetype) => ({
      archetype,
      assignments: assignments
        .filter((item) => item.archetypeId === archetype.id)
        .map((item) => ({
          ...item,
          resumeTitle:
            resumes.find((resume) => resume.id === item.resumeId)?.title ||
            "Base indisponivel",
        })),
    }));
  }
}
