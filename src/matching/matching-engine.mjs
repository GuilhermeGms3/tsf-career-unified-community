import { MATCH_STATUS } from "./constants.mjs";
import { foldText, languageLevel, seniorityLevel, slugify } from "./normalization.mjs";

const skillTypes = new Set(["skill", "tool", "framework", "platform", "cloud", "operating_system", "methodology"]);

function comparableEvidence(requirement, evidence) {
  if (skillTypes.has(requirement.type)) {
    return evidence.filter((item) => skillTypes.has(item.type) && item.normalizedName === requirement.normalizedName);
  }
  return evidence.filter((item) => item.type === requirement.type && item.normalizedName === requirement.normalizedName);
}

function result(requirement, status, score, evidence, explanation) {
  return {
    requirementId: requirement.id,
    requirement,
    status,
    score,
    evidence: evidence.map((item) => ({
      source: item.source,
      section: item.sourceSection,
      text: item.text,
      strength: item.strength,
      strengthScore: item.strengthScore,
      metadata: item.metadata || {}
    })),
    explanation
  };
}

function evidenceStrengthMatch(requirement, evidence) {
  const candidates = comparableEvidence(requirement, evidence).sort((left, right) => right.strengthScore - left.strengthScore);
  if (!candidates.length) {
    return result(requirement, MATCH_STATUS.UNKNOWN, null, [], `Nao ha evidencia suficiente para confirmar ${requirement.normalizedName}.`);
  }
  const positive=candidates.filter(item=>!item.metadata?.explicitNegative);
  if(positive.length&&candidates.some(item=>item.metadata?.explicitNegative))return result(requirement,MATCH_STATUS.UNKNOWN,null,candidates.slice(0,3),`Ha evidencias conflitantes sobre ${requirement.normalizedName}.`);
  if(!positive.length&&candidates.some(item=>item.metadata?.explicitNegative))return result(requirement,MATCH_STATUS.NO_MATCH,0,candidates.slice(0,3),`O candidato confirmou que ainda não utiliza ${requirement.normalizedName}.`);
  const best = positive[0];
  if (best.strengthScore >= 0.8) {
    return result(requirement, MATCH_STATUS.MATCH, best.strengthScore, positive.slice(0, 3), `Evidencia forte encontrada em ${best.sourceSection || best.source}.`);
  }
  return result(requirement, MATCH_STATUS.PARTIAL_MATCH, best.strengthScore, positive.slice(0, 3), `O termo aparece em ${best.sourceSection || best.source}, mas a evidencia e apenas ${best.strength.toLowerCase()}.`);
}

function matchYears(requirement, evidence) {
  const candidate = evidence.find((item) => item.type === "experience_years");
  if (!candidate || candidate.value === null) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], "Os anos de experiencia do candidato nao foram informados.");
  const minimum = Number(requirement.metadata?.minimumYears || 0);
  if (Number(candidate.value) >= minimum) return result(requirement, MATCH_STATUS.MATCH, 1, [candidate], `${candidate.value} ano(s) informado(s), atendendo ao minimo de ${minimum}.`);
  if (Number(candidate.value) > 0) return result(requirement, MATCH_STATUS.NO_MATCH, 0, [candidate], `${candidate.value} ano(s) informado(s), abaixo do minimo de ${minimum}.`);
  return result(requirement, MATCH_STATUS.NO_MATCH, 0, [candidate], `O perfil informa zero anos, abaixo do minimo de ${minimum}.`);
}

function matchSeniority(requirement, evidence) {
  const candidates = evidence.filter((item) => item.type === "seniority" && item.value !== null);
  if (!candidates.length) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], "A senioridade do candidato nao pode ser confirmada.");
  const required = Number(requirement.metadata?.level ?? requirement.normalizedName);
  const candidate = candidates.sort((left, right) => Number(right.value) - Number(left.value))[0];
  if (Number(candidate.value) >= required) return result(requirement, MATCH_STATUS.MATCH, 1, [candidate], "A senioridade declarada atende ao nivel da vaga.");
  if (Number(candidate.value) === required - 1) return result(requirement, MATCH_STATUS.PARTIAL_MATCH, 0.5, [candidate], "A senioridade declarada esta um nivel abaixo da vaga.");
  return result(requirement, MATCH_STATUS.NO_MATCH, 0, [candidate], "A senioridade declarada esta abaixo da exigida.");
}

function matchEducation(requirement, evidence) {
  const candidate = evidence.find((item) => item.type === "education" && item.value !== null);
  const equivalentExperience = requirement.metadata?.equivalentExperienceAccepted
    ? evidence.filter((item) => item.type === "specific_experience" || (item.type === "experience_years" && Number(item.value) > 0))
    : [];
  if (!candidate && equivalentExperience.length) return result(requirement, MATCH_STATUS.PARTIAL_MATCH, 0.6, equivalentExperience.slice(0, 2), "A vaga aceita experiencia equivalente; existe evidencia profissional, mas a equivalencia precisa de revisao.");
  if (!candidate) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], "Nao foi possivel identificar o nivel de formacao.");
  const minimum = Number(requirement.metadata?.minimumLevel ?? requirement.normalizedName);
  if (Number(candidate.value) >= minimum) return result(requirement, MATCH_STATUS.MATCH, 1, [candidate], "A formacao identificada atende ao nivel solicitado.");
  if (equivalentExperience.length) return result(requirement, MATCH_STATUS.PARTIAL_MATCH, 0.6, [candidate, ...equivalentExperience].slice(0, 3), "A formacao esta abaixo do nivel, mas a vaga aceita experiencia equivalente que precisa de revisao.");
  return result(requirement, MATCH_STATUS.NO_MATCH, 0, [candidate], "A formacao identificada esta abaixo do nivel solicitado.");
}

function matchLanguage(requirement, evidence) {
  const candidate = evidence.find((item) => item.type === "language" && item.normalizedName === requirement.normalizedName);
  if (!candidate) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], `O nivel de ${requirement.normalizedName} nao foi informado.`);
  const required = Number(requirement.metadata?.level || 0);
  const level = Number(candidate.value ?? languageLevel(candidate.text));
  if (!required) return result(requirement, MATCH_STATUS.MATCH, candidate.strengthScore, [candidate], "O idioma solicitado aparece nas evidencias do candidato.");
  if (level >= required) return result(requirement, MATCH_STATUS.MATCH, 1, [candidate], "O nivel de idioma informado atende ao solicitado.");
  if (level > 0) return result(requirement, MATCH_STATUS.NO_MATCH, 0, [candidate], "O nivel de idioma informado esta abaixo do solicitado.");
  return result(requirement, MATCH_STATUS.UNKNOWN, null, [candidate], "O idioma aparece, mas o nivel nao pode ser confirmado.");
}

function matchRoleOrDomain(requirement, evidence) {
  const candidateRoles = evidence.filter((item) => item.type === "role");
  if (!candidateRoles.length) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], "Nenhum cargo alvo foi informado.");
  const requiredWords = requirement.normalizedName.split("-").filter((word) => word.length > 2);
  const matches = candidateRoles.filter((item) => requiredWords.some((word) => item.normalizedName.includes(word)));
  if (matches.length) return result(requirement, MATCH_STATUS.MATCH, 0.85, matches.slice(0, 2), "O cargo ou dominio esta alinhado aos objetivos declarados.");
  return result(requirement, MATCH_STATUS.NO_MATCH, 0, candidateRoles.slice(0, 2), "O cargo nao aparece entre os objetivos declarados.");
}

function matchLocation(requirement, evidence) {
  const location = evidence.find((item) => item.type === "location");
  const rule = evidence.find((item) => item.type === "location_rule");
  if (!location && !rule) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], "A localizacao aceita pelo candidato nao foi informada.");
  const requested = foldText(requirement.metadata?.location || requirement.originalText);
  const candidate = foldText(`${location?.text || ""} ${rule?.text || ""}`);
  const broadCountryMatch = /\bbrasil\b/.test(requested) && /\b(brasil|brazil)\b/.test(candidate);
  const requestedTokens = slugify(requested).split("-").filter((token) => token.length > 2 && !["brasil", "brazil"].includes(token));
  if (broadCountryMatch || requestedTokens.some((token) => slugify(candidate).includes(token))) {
    return result(requirement, MATCH_STATUS.MATCH, 1, [location || rule], "A localizacao da vaga esta dentro das informacoes declaradas.");
  }
  if (rule && /somente|apenas|only|exclusivamente/.test(foldText(rule.text))) {
    return result(requirement, MATCH_STATUS.NO_MATCH, 0, [rule], "A regra de localizacao declarada e incompatível com a vaga.");
  }
  return result(requirement, MATCH_STATUS.UNKNOWN, null, [location || rule], "As cidades diferem e nao ha informacao suficiente sobre disponibilidade para deslocamento ou mudanca.");
}

function matchWorkModel(requirement, evidence) {
  const models = evidence.filter((item) => item.type === "work_model");
  if (!models.length) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], "Os modelos de trabalho aceitos nao foram informados.");
  const exact = models.find((item) => item.normalizedName === requirement.normalizedName);
  if (exact) return result(requirement, MATCH_STATUS.MATCH, 1, [exact], "A modalidade esta entre as preferencias declaradas.");
  return result(requirement, MATCH_STATUS.NO_MATCH, 0, models, "A modalidade obrigatoria nao esta entre as preferencias declaradas.");
}

function matchBoolean(requirement, evidence) {
  const candidate = evidence.find((item) => item.type === requirement.type);
  if (!candidate || candidate.value === null) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], `Nao foi possivel confirmar ${requirement.originalText}.`);
  return candidate.value
    ? result(requirement, MATCH_STATUS.MATCH, 1, [candidate], "O candidato declarou atender a este requisito.")
    : result(requirement, MATCH_STATUS.NO_MATCH, 0, [candidate], "O candidato declarou nao atender a este requisito.");
}

function matchAvailability(requirement, evidence) {
  const candidate = evidence.find((item) => item.type === "availability");
  if (!candidate) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], "A disponibilidade correspondente nao foi informada.");
  const requiredWords = foldText(requirement.originalText).split(/\W+/).filter((word) => word.length > 4);
  const overlap = requiredWords.some((word) => foldText(candidate.text).includes(word));
  return overlap
    ? result(requirement, MATCH_STATUS.MATCH, 0.85, [candidate], "A disponibilidade declarada e compativel com o requisito.")
    : result(requirement, MATCH_STATUS.UNKNOWN, null, [candidate], "Existe disponibilidade declarada, mas a compatibilidade exata precisa ser confirmada.");
}

function matchSpecificExperience(requirement, evidence) {
  const candidates = evidence.filter((item) => item.type === "specific_experience");
  if (!candidates.length) return result(requirement, MATCH_STATUS.UNKNOWN, null, [], "Nao ha experiencia profissional estruturada suficiente para confirmar este requisito.");
  const keywords = requirement.metadata?.keywords || [];
  if (!keywords.length) return result(requirement, MATCH_STATUS.UNKNOWN, null, candidates.slice(0, 2), "A experiencia especifica precisa de confirmacao manual.");
  const ranked = candidates.map((candidate) => {
    const text = foldText(candidate.text);
    const matches = keywords.filter((keyword) => text.includes(keyword));
    return { candidate, coverage: matches.length / keywords.length };
  }).sort((left, right) => right.coverage - left.coverage);
  if (ranked[0].coverage >= 0.7) return result(requirement, MATCH_STATUS.MATCH, Math.max(0.8, ranked[0].coverage), [ranked[0].candidate], "A experiencia profissional contem o contexto especifico solicitado.");
  if (ranked[0].coverage >= 0.35) return result(requirement, MATCH_STATUS.PARTIAL_MATCH, ranked[0].coverage, [ranked[0].candidate], "Parte do contexto solicitado aparece na experiencia profissional.");
  return result(requirement, MATCH_STATUS.NO_MATCH, 0, candidates.slice(0, 2), "O contexto especifico nao foi encontrado na experiencia profissional.");
}

export function matchRequirement(requirement, evidence) {
  if (skillTypes.has(requirement.type) || requirement.type === "certification") return evidenceStrengthMatch(requirement, evidence);
  if (requirement.type === "experience_years") return matchYears(requirement, evidence);
  if (requirement.type === "seniority") return matchSeniority(requirement, evidence);
  if (requirement.type === "education") return matchEducation(requirement, evidence);
  if (requirement.type === "language") return matchLanguage(requirement, evidence);
  if (requirement.type === "role" || requirement.type === "domain") return matchRoleOrDomain(requirement, evidence);
  if (requirement.type === "location") return matchLocation(requirement, evidence);
  if (requirement.type === "work_model") return matchWorkModel(requirement, evidence);
  if (["work_authorization", "travel", "relocation"].includes(requirement.type)) return matchBoolean(requirement, evidence);
  if (requirement.type === "availability") return matchAvailability(requirement, evidence);
  if (requirement.type === "specific_experience") return matchSpecificExperience(requirement, evidence);
  if (["salary", "employment_type"].includes(requirement.type)) {
    const candidate = comparableEvidence(requirement, evidence);
    return candidate.length
      ? result(requirement, MATCH_STATUS.PARTIAL_MATCH, 0.6, candidate, "Existe uma preferencia declarada; confirme os valores e condicoes.")
      : result(requirement, MATCH_STATUS.UNKNOWN, null, [], "Nao ha informacao suficiente para comparar este requisito.");
  }
  return result(requirement, MATCH_STATUS.UNKNOWN, null, [], "Este requisito precisa de confirmacao do usuario.");
}

function resolutionFor(item,providerDiagnostics=[]){const providersChecked=providerDiagnostics.map(item=>({provider:item.provider,status:item.status})),failed=providerDiagnostics.some(item=>["ERROR","DEGRADED"].includes(item.status)),notIndexed=providerDiagnostics.some(item=>item.status==="NOT_INDEXED"),aliasMissing=providerDiagnostics.some(provider=>(provider.details?.unresolvedAliases||[]).some(value=>foldText(value)===foldText(item.requirement.originalText)||foldText(value)===foldText(item.requirement.normalizedName)));let reason="EVIDENCE_FOUND";if(item.status===MATCH_STATUS.PARTIAL_MATCH)reason="INSUFFICIENT_EVIDENCE";else if(item.status===MATCH_STATUS.NO_MATCH)reason="EXPLICIT_NEGATIVE_OR_INCOMPATIBLE";else if(item.status===MATCH_STATUS.UNKNOWN){if(/conflitantes/i.test(item.explanation))reason="CONFLICTING_EVIDENCE";else if(aliasMissing)reason="ALIAS_MISSING";else if(item.evidence.length)reason="AMBIGUOUS";else if(failed)reason="EXTRACTION_FAILURE";else if(notIndexed)reason="NOT_INDEXED";else reason="NO_EVIDENCE";}return {reason,providersChecked};}

export function matchRequirements(requirements, evidence, providerDiagnostics=[]) {
  return requirements.map((requirement) => {const item=matchRequirement(requirement,evidence);return {...item,resolution:resolutionFor(item,providerDiagnostics)};});
}
