import { TASK_TYPES } from "../runtime/task-types.mjs";
import { EvidenceGuard } from "../validation/evidence-guard.mjs";
import { buildResumeSourceEvidence } from "../../resume/resume-source-evidence.mjs";
import { buildDeterministicTailoringVariants } from "./deterministic-resume-tailor.mjs";
import {ResumeQualityGate} from "../../resume/validation/resume-quality-gate.mjs";

const numericScore = (value, fallback = null) => {
  const candidate =
      value && typeof value === "object"
        ? value.overallScore ?? value.score
        : value,
    parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function mergeEvidence(primary = [], resume = {}) {
  return [
    ...new Map(
      [...primary, ...buildResumeSourceEvidence(resume)].map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  ];
}

const normalizeText = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const STOP_WORDS = new Set([
  "com", "das", "dos", "para", "por", "uma", "que", "the", "and", "de",
  "da", "do", "em", "na", "no", "e", "a", "o",
]);

function requirementLabel(item) {
  return typeof item === "string"
    ? item
    : item?.normalizedName || item?.label || item?.name || item?.text || item?.originalText || "";
}

function relevantEvidenceForJob(evidence, job, requirements) {
  const terms = new Set(
    normalizeText([
      job?.title,
      job?.description,
      ...requirements.map(requirementLabel),
    ].join(" "))
      .split(/[^a-z0-9+#.]+/)
      .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)),
  );
  const sectionWeight = { experience: 12, projects: 10, skills: 6, summary: 4 };
  const ranked = evidence
    .map((item, index) => {
      const text = normalizeText(item.text), overlap = [...terms].reduce(
        (score, term) => score + (text.includes(term) ? 1 : 0),
        0,
      );
      return {
        item,
        index,
        score: overlap * 4 + (sectionWeight[item.sourceSection] || 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index),
    unique = new Map();
  for (const candidate of ranked) {
    const key = [
      candidate.item.normalizedName || "",
      normalizeText(candidate.item.text),
      candidate.item.source || "",
      candidate.item.metadata?.contextType || "",
    ].join("|");
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].slice(0, 10).map(({ item }) => item);
}

function evidenceForChunk(prioritizedEvidence, allEvidence, targets) {
  const selected = new Map(prioritizedEvidence.map((item) => [item.id, item]));
  for (const target of targets) {
    const targetTerms = normalizeText(target.original)
      .split(/[^a-z0-9+#.]+/)
      .filter((term) => term.length >= 4 && !STOP_WORDS.has(term));
    const supporting = allEvidence
      .map((item, index) => ({
        item,
        index,
        overlap: targetTerms.reduce(
          (score, term) => score + (normalizeText(item.text).includes(term) ? 1 : 0),
          0,
        ),
      }))
      .filter(({ overlap }) => overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || a.index - b.index)[0]?.item;
    if (supporting) selected.set(supporting.id, supporting);
  }
  return [...selected.values()].slice(0, 16);
}

function compactRequirements(requirements = []) {
  return requirements.slice(0, 12).map((item) =>
    typeof item === "string"
      ? item.slice(0, 300)
      : {
          id: item?.id || item?.requirementId || "",
          name: requirementLabel(item).slice(0, 300),
          importance: item?.importance || item?.criticality || "",
        },
  );
}

function bulletTargets(value, section) {
  if (Array.isArray(value))
    return value.flatMap((item) =>
      item?.bullets
        ? item.bullets.map((bullet) => ({ section, original: String(bullet?.text || bullet) }))
        : bulletTargets(item, section),
    );
  if (value && typeof value === "object")
    return Object.values(value).flatMap((item) => bulletTargets(item, section));
  if (typeof value !== "string") return [];
  const targets = [], lines = value.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*[•*-]\s+/.test(lines[index])) continue;
    const parts = [lines[index].replace(/^\s*[•*-]\s+/, "")];
    while (index + 1 < lines.length && !/[.!?]\s*$/.test(parts.at(-1))) {
      if (/^\s*[•*-]\s+/.test(lines[index + 1])) break;
      parts.push(lines[++index]);
    }
    targets.push({ section, original: parts.join("\n").trim() });
  }
  return targets;
}

function editableTargets(sections = {}) {
  return [
    ...(sections.summary ? [{ section: "summary", original: String(sections.summary) }] : []),
    ...bulletTargets(sections.experience, "experience"),
    ...bulletTargets(sections.projects, "projects"),
  ].slice(0, 12).map((item, index) => ({ ...item, id: `target-${index + 1}` }));
}

function prioritizeTargets(targets, job, requirements) {
  if (targets.length <= 6) return targets;
  const terms = normalizeText([
    job?.title,
    job?.description,
    ...requirements.map(requirementLabel),
  ].join(" "))
    .split(/[^a-z0-9+#.]+/)
    .filter((term) => (term.length >= 4 || ["ai", "ci", "cd", "qa"].includes(term)) && !STOP_WORDS.has(term));
  const summary = targets.find((target) => target.section === "summary"),
    ranked = targets
      .filter((target) => target !== summary)
      .map((target, index) => ({
        target,
        index,
        score: terms.reduce(
          (value, term) => value + (normalizeText(target.original).includes(term) ? 1 : 0),
          target.section === "experience" ? 3 : target.section === "projects" ? 2 : 0,
        ),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, summary ? 5 : 6)
      .map(({ target }) => target);
  return [summary, ...ranked]
    .filter(Boolean)
    .map((target, index) => ({ ...target, id: `target-${index + 1}` }));
}

function uniqueProviderChanges(changes = []) {
  const targets = new Set();
  return changes.filter((change) => {
    const key = change.type === "REWRITE_SUMMARY"
      ? "REWRITE_SUMMARY"
      : `${change.type}:${String(change.original || "").trim()}`;
    if (targets.has(key)) return false;
    targets.add(key);
    return true;
  });
}

function isUsableProviderChange(change = {}) {
  const proposed = normalizeText(change.proposed);
  return Boolean(proposed) && !/\b(?:nao ha evidencia|sem evidencia|nao se aplica|deve ser omitid|melhor omitir|omita)\b/.test(proposed);
}

export class ResumeTailor {
  constructor(service, { guard = new EvidenceGuard(), qualityGate = new ResumeQualityGate() } = {}) {
    this.service = service;
    this.guard = guard;
    this.qualityGate = qualityGate;
  }

  async tailor({
    job,
    requirements = [],
    resume,
    evidence = [],
    originalScore = null,
    scoreEvaluator = null,
    userInstruction = "",
  }) {
    await this.service.refreshAvailability?.();
    const allEvidence = mergeEvidence(evidence, resume),
      prioritizedEvidence = relevantEvidenceForJob(
        allEvidence,
        job,
        requirements,
      ),
      targets = prioritizeTargets(
        editableTargets(resume?.sections || {}),
        job,
        requirements,
      ),
      targetChunks = [targets],
      responses = [];
    for (const [index, chunk] of targetChunks.entries()) {
      if (!chunk.length) continue;
      const localTargets = chunk.map((target, targetIndex) => ({
          ...target,
          id: `target-${targetIndex + 1}`,
        })),
        chunkEvidence = evidenceForChunk(
          prioritizedEvidence,
          allEvidence,
          chunk,
        );
      responses.push({
        targets: localTargets,
        response: await this.service.execute(
        TASK_TYPES.RESUME_TAILORING,
        {
          tailoringGoal: {
            targetRole: job?.title || "",
            targetCompany: job?.company || "",
            objective: "Reposicionar resumo e experiencias para o foco da vaga usando somente fatos comprovados.",
            block: `${index + 1}/${targetChunks.length}`,
            expectedChanges: "Até quatro mudanças relevantes e concisas neste bloco.",
            candidateFeedback: String(userInstruction || "").slice(0, 800),
          },
          job: {
            title: job?.title || "",
            company: job?.company || "",
            description: String(job?.description || "").slice(0, 2800),
          },
          requirements: compactRequirements(requirements),
          editableTargets: localTargets,
          evidence: chunkEvidence.map(({ id, text, type, sourceSection, source, strength, metadata }) => ({
            id,
            text: String(text || "").slice(0, 320),
            type,
            sourceSection,
            source: source || "",
            contextType: metadata?.contextType || "",
            depth: metadata?.depth || strength || "",
          })),
        },
        { fallback: { changes: [] } },
        ),
      });
    }
    const providerResponse = responses[0]?.response || {
        meta: {
          promptVersion: "resume-tailor-v9",
          schemaVersion: "resume-tailor-schema-v5",
          fallback: true,
        },
        result: { changes: [] },
      },
      providerChanges = this.guard.validateChanges(
        uniqueProviderChanges(
          responses.flatMap(({ response, targets: chunk }) => {
            const targetById = new Map(chunk.map((target) => [target.id, target]));
            return (response.result.changes || [])
              .map((change) => {
                const target = targetById.get(change.targetId);
                return {
                  ...change,
                  targetSection: target?.section || "",
                  type: target?.section === "summary"
                    ? "REWRITE_SUMMARY"
                    : change.type === "REWRITE_SUMMARY"
                      ? "REWRITE_BULLET"
                      : change.type,
                  original: target?.original || "",
                };
              })
              .filter((change) => change.original && isUsableProviderChange(change));
          }),
        ),
        allEvidence,
      ),
      deterministic = buildDeterministicTailoringVariants({
        job,
        requirements,
        resume,
        evidence: allEvidence,
      }),
      candidates = [];

    for (const variant of deterministic)
      candidates.push({
        ...variant,
        changes: this.guard.validateChanges(variant.changes, allEvidence),
      });
    if (providerChanges.length)
      candidates.push({
        id: "semantic-provider",
        perspective: "Semântica local",
        relevance: 100,
        changes: providerChanges,
      });
    if (!candidates.length)
      candidates.push({
        id: "unchanged",
        perspective: "Base original",
        relevance: 0,
        changes: providerChanges,
      });

    for (const candidate of candidates) {
      const validChanges = candidate.changes.filter(
          (change) => change.validationStatus === "VALID",
        ),
        tailored = applyChanges(resume, validChanges);
      candidate.tailoredResume = tailored;
      candidate.score = scoreEvaluator
        ? numericScore(
            await scoreEvaluator(tailored),
            numericScore(originalScore),
          )
        : numericScore(originalScore);
      candidate.valid = validChanges.length === candidate.changes.length;
      candidate.directionalDepth = validChanges.reduce(
        (score, change) => score +
          (change.type === "REWRITE_SUMMARY" ? 2 : 0) +
          (change.type === "REWRITE_BULLET" ? 3 : 0),
        0,
      );
      candidate.quality = this.qualityGate.evaluate({
        resume: candidate.tailoredResume,
        baselineResume: resume,
        tailoringChanges: candidate.changes,
        job,
        originalScore,
        tailoredScore: candidate.score,
      });
    }
    candidates.sort(
      (a, b) =>
        Number(b.valid) - Number(a.valid) ||
        Number(b.quality?.status === "PASS") - Number(a.quality?.status === "PASS") ||
        numericScore(b.score, -1) - numericScore(a.score, -1) ||
        Number(b.directionalDepth || 0) - Number(a.directionalDepth || 0) ||
        Number(b.relevance || 0) - Number(a.relevance || 0),
    );
    const selected = candidates[0],
      changes = selected.changes,
      tailoredScore = selected.score,
      quality = selected.quality;
    return {
      state: "REVIEW_REQUIRED",
      requiresReview: true,
      changes,
      evidenceStatus: changes.every(
        (change) => change.validationStatus === "VALID",
      )
        ? "VALID"
        : "EVIDENCE_VIOLATION",
      tailoredResume: selected.tailoredResume,
      originalScore,
      tailoredScore,
      quality,
      variantCount: deterministic.length,
      selectedPerspective: selected.perspective,
      promptVersion: providerResponse.meta.promptVersion,
      schemaVersion: providerResponse.meta.schemaVersion,
      meta: {
        ...providerResponse.meta,
        providerCalls: responses.length,
        providerFallbacks: responses.filter((item) => item.response.meta.fallback).length,
        variantCount: deterministic.length,
        selectedPerspective: selected.perspective,
        generationMode: selected.id === "semantic-provider" ? "LLM" : selected.id === "unchanged" ? "BASE_UNCHANGED" : "OFFLINE_LIBRARY",
        libraryVersion: selected.libraryVersion || "",
        selectedDomain: selected.domain || "",
      },
    };
  }
}

export function tailoringQuality(run = {}) {
  const reasons = [];
  if (run.evidenceStatus && run.evidenceStatus !== "VALID")
    reasons.push("EVIDENCE_GUARD_FAILED");
  if (
    (run.changes || []).some(
      (change) =>
        change.validationStatus && change.validationStatus !== "VALID",
    )
  )
    reasons.push("EVIDENCE_CHANGE_INVALID");
  const hasScores =
      run.originalScore !== null &&
      run.originalScore !== undefined &&
      run.originalScore !== "" &&
      run.tailoredScore !== null &&
      run.tailoredScore !== undefined &&
      run.tailoredScore !== "",
    before = Number(run.originalScore),
    after = Number(run.tailoredScore);
  if (hasScores && Number.isFinite(before) && Number.isFinite(after) && after < before)
    reasons.push("ATS_MATCH_REGRESSION");
  if(run.quality?.status==="BLOCKED")reasons.push(...(run.quality.blockingReasons?.length?run.quality.blockingReasons:["RESUME_QUALITY_BLOCKED"]));
  return {
    allowed: reasons.length === 0,
    reasons,
    delta:
      hasScores && Number.isFinite(before) && Number.isFinite(after)
        ? after - before
        : null,
    status: reasons.length ? "BLOCKED" : "PASS",
  };
}

export function assertTailoringApprovable(run = {}) {
  const quality = tailoringQuality(run);
  if (!quality.allowed)
    throw Object.assign(
      new Error(
        quality.reasons.includes("ATS_MATCH_REGRESSION")
          ? "O currículo gerado reduziu a compatibilidade e não pode ser aprovado."
          : "O currículo gerado não passou pela validação de evidências.",
      ),
      { code: quality.reasons[0], quality },
    );
  return quality;
}

function applyChanges(resume, changes) {
  const output = structuredClone(resume || {}),
    replace = (value, original, proposed) => {
      if (typeof value === "string")
        return value.includes(original)
          ? value.replaceAll(original, proposed)
          : value;
      if (Array.isArray(value))
        return value.map((item) => replace(item, original, proposed));
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            replace(item, original, proposed),
          ]),
        );
      return value;
    };
  output.sections ||= {};
  for (const change of changes) {
    if (change.type === "REWRITE_SUMMARY") {
      output.sections.summary = change.proposed;
      continue;
    }
    if (change.original)
      output.sections = replace(
        output.sections,
        change.original,
        change.proposed,
      );
  }
  return output;
}
