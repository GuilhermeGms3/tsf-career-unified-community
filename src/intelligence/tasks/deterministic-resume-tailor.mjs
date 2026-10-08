const normalize = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const unique = (items) => [...new Set(items.filter(Boolean))];
const STOP_WORDS = new Set(["com", "das", "dos", "para", "por", "uma", "que", "the", "and", "de", "da", "do", "em", "na", "no", "e", "a", "o"]);
const readableList = (items) =>
  items.length < 2
    ? items[0] || ""
    : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
const requirementText = (item) =>
  clean(
    typeof item === "string"
      ? item
      : item?.normalizedName || item?.label || item?.name || item?.text || item?.originalText,
  );

const DOMAINS = [
  {
    id: "DEVELOPMENT",
    label: "desenvolvimento de software",
    signals: /\b(desenvolvedor|desenvolvimento|developer|software|backend|frontend|full[ -]?stack|aplicac(?:ao|oes)|api)\b/g,
  },
  {
    id: "CLOUD_INFRA",
    label: "cloud, infraestrutura e automação",
    signals: /\b(cloud|nuvem|infraestrutura|redes?|devops|platform|sre|servidores?|azure|aws|gcp)\b/g,
  },
  {
    id: "SUPPORT",
    label: "suporte técnico e operações de TI",
    signals: /\b(suporte|service desk|help desk|support|n[12]|incidentes?|atendimento tecnico)\b/g,
  },
  {
    id: "SECURITY",
    label: "segurança da informação",
    signals: /\b(seguranca|security|soc|siem|vulnerabilidade|incidentes de seguranca)\b/g,
  },
  {
    id: "DATA",
    label: "dados e automação",
    signals: /\b(dados|data|sql|etl|analytics|power bi|business intelligence)\b/g,
  },
  {
    id: "QUALITY",
    label: "qualidade de software",
    signals: /\b(qa|qualidade|testes?|quality assurance|automacao de testes)\b/g,
  },
];

const FACTS = [
  ["Active Directory", /\bactive directory\b/i, ["CLOUD_INFRA", "SUPPORT", "SECURITY"]],
  ["Microsoft Azure", /\b(?:microsoft\s+)?azure\b/i, ["CLOUD_INFRA", "DEVELOPMENT"]],
  ["AWS", /\baws\b/i, ["CLOUD_INFRA", "DEVELOPMENT"]],
  ["Linux", /\blinux\b/i, ["CLOUD_INFRA", "SUPPORT", "DEVELOPMENT", "SECURITY"]],
  ["Windows", /\bwindows\b/i, ["CLOUD_INFRA", "SUPPORT"]],
  ["Docker", /\bdocker\b/i, ["CLOUD_INFRA", "DEVELOPMENT"]],
  ["Kubernetes", /\bkubernetes\b/i, ["CLOUD_INFRA", "DEVELOPMENT"]],
  ["Python", /\bpython\b/i, ["DEVELOPMENT", "DATA", "QUALITY"]],
  ["Java", /\bjava\b/i, ["DEVELOPMENT"]],
  ["JavaScript", /\bjavascript\b/i, ["DEVELOPMENT"]],
  ["TypeScript", /\btypescript\b/i, ["DEVELOPMENT"]],
  ["React", /\breact\b/i, ["DEVELOPMENT"]],
  ["Node.js", /\bnode(?:\.js|js)?\b/i, ["DEVELOPMENT"]],
  ["Spring", /\bspring(?: boot)?\b/i, ["DEVELOPMENT"]],
  ["SQL", /\bsql\b/i, ["DEVELOPMENT", "DATA"]],
  ["PowerShell", /\bpowershell\b/i, ["CLOUD_INFRA", "SUPPORT", "DEVELOPMENT"]],
  ["APIs REST", /\bapi(?:s)?\s+rest|\brestful\b/i, ["DEVELOPMENT"]],
  ["CI/CD", /\bci\s*\/\s*cd\b|\bpipelines?\b/i, ["DEVELOPMENT", "CLOUD_INFRA"]],
  ["Git", /\bgit\b|\bgithub\b|\bgitlab\b/i, ["DEVELOPMENT", "CLOUD_INFRA"]],
  ["monitoramento", /\bmonitoramento\b|\bobservabilidade\b|\bgrafana\b|\bzabbix\b/i, ["CLOUD_INFRA", "SUPPORT"]],
  ["troubleshooting", /\btroubleshooting\b|\bdiagnostico\b|\bresolucao de (?:problemas|incidentes)\b/i, ["SUPPORT", "CLOUD_INFRA"]],
  ["automação de processos", /\bautomacao\b|\bscripts?\b/i, ["DEVELOPMENT", "CLOUD_INFRA", "SUPPORT", "QUALITY", "DATA"]],
  ["implantação de aplicações", /\bimplantacao de aplicacoes\b|\bdeploy(?:ment)?\b/i, ["DEVELOPMENT", "CLOUD_INFRA"]],
  ["Service Desk N2", /\bservice desk\s*n2\b|\bsuporte\s*n2\b/i, ["SUPPORT", "CLOUD_INFRA"]],
  ["Inglês B2", /\bingl[eê]s\s*b2\b|\benglish\s*b2\b/i, ["SUPPORT", "DEVELOPMENT", "CLOUD_INFRA"]],
];

function signalCount(value, pattern) {
  pattern.lastIndex = 0;
  return (normalize(value).match(pattern) || []).length;
}

function domainFor({ title = "", body = "" } = {}) {
  return DOMAINS.map((domain) => ({
    ...domain,
    score: signalCount(title, domain.signals) * 12 + signalCount(body, domain.signals),
  })).sort((a, b) => b.score - a.score)[0];
}

function evidenceFor(pattern, evidence) {
  return evidence.filter((item) => pattern.test(String(item.text || "")));
}

function domainFactBoost(label, domainId) {
  const priorities = {
    SUPPORT: ["service desk n2", "troubleshooting", "ingles b2", "active directory"],
    CLOUD_INFRA: ["linux", "monitoramento", "microsoft azure", "docker", "terraform", "powershell"],
    DEVELOPMENT: ["apis rest", "java", "python", "javascript", "typescript", "node.js", "spring", "ci/cd"],
  };
  const index = (priorities[domainId] || []).indexOf(normalize(label));
  return index < 0 ? 0 : Math.max(1, 6 - index);
}

function availableFacts(jobText, domain, evidence) {
  const normalizedJob = normalize(jobText);
  return FACTS.map(([label, pattern, domains]) => {
    const sources = evidenceFor(pattern, evidence);
    return {
      label,
      sources,
      score:
        (normalize(label).split(/\s+/).some((term) => term.length > 2 && normalizedJob.includes(term)) ? 5 : 0) +
        (domains.includes(domain.id) ? 2 : 0) +
        domainFactBoost(label, domain.id) +
        Math.min(sources.length, 2),
    };
  })
    .filter((fact) => fact.sources.length)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "pt-BR"));
}

function contextualFact(pattern, evidence) {
  const sources = evidenceFor(pattern, evidence);
  return sources.length ? sources : [];
}

function bulletTargets(value, section = "experience") {
  if (Array.isArray(value))
    return value.flatMap((item) =>
      item?.bullets
        ? item.bullets.map((bullet) => ({ section, original: String(bullet?.text || bullet).trim() }))
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

function activeVoice(value) {
  const original = clean(value), rules = [
    [/^Suporte a ambientes Microsoft Azure, incluindo provisionamento, monitoramento e manutenção de máquinas virtuais/i, "Provisionamento, monitoramento e manutenção de máquinas virtuais em ambientes Microsoft Azure"],
    [/^Atendimento N1\/N2, com diagnóstico, registro e resolução de incidentes em ambiente corporativo/i, "Diagnóstico, registro e resolução de incidentes no atendimento técnico N1/N2 em ambiente corporativo"],
    [/^Atendimento a colaboradores, com registro, acompanhamento e resolução de solicitações por meio da\s+/i, "Registro, acompanhamento e resolução de solicitações de colaboradores pela "],
    [/^Administração de\s+/i, "Administração de "],
    [/^Automação de\s+/i, "Automação de "],
    [/^Desenvolvimento de\s+/i, "Desenvolvimento de "],
    [/^Implementação de\s+/i, "Implementação de "],
    [/^Organização e execução de\s+/i, "Organização e execução de "],
    [/^Estruturação de\s+/i, "Estruturação de "],
    [/^Implantação de\s+/i, "Implantação de "],
    [/^Configuração de\s+/i, "Configuração de "],
  ];
  for (const [pattern, replacement] of rules)
    if (pattern.test(original)) return original.replace(pattern, replacement);
  return original;
}

function targetedBulletChanges({ resume, evidence, domain, jobText }) {
  const normalizedJob = normalize(jobText), jobTerms = normalizedJob
      .split(/[^a-z0-9+#.]+/)
      .filter((term) => term.length >= 4 && !STOP_WORDS.has(term)),
    candidates = [
      ...bulletTargets(resume.sections?.experience, "experience"),
      ...bulletTargets(resume.sections?.projects, "projects"),
    ].map((target, index) => {
      const normalizedBullet = normalize(target.original),
        jobOverlap = jobTerms.reduce((score, term) => score + (normalizedBullet.includes(term) ? 1 : 0), 0),
        domainOverlap = signalCount(target.original, domain.signals),
        sectionEvidence = evidence.filter((item) => item.sourceSection === target.section),
        exactEvidence = sectionEvidence.filter((item) => normalize(item.text).includes(normalizedBullet.slice(0, Math.min(48, normalizedBullet.length)))),
        sources = exactEvidence.length ? exactEvidence : sectionEvidence;
      return { ...target, index, sources, score: domainOverlap * 8 + jobOverlap * 3 + (target.section === "experience" ? 4 : 0) };
    })
      .filter((item) => item.sources.length && item.score > 4)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 3);
  return candidates.flatMap((target) => {
    const proposed = activeVoice(target.original);
    if (!proposed || normalize(proposed) === normalize(target.original)) return [];
    return [{
      type: "REWRITE_BULLET",
      targetSection: target.section,
      sourceEvidenceIds: unique(target.sources.map((item) => item.id)).slice(0, 8),
      original: target.original,
      proposed,
      reason: `Reescrita em voz ativa para priorizar a experiência comprovada mais aderente a ${domain.label}.`,
    }];
  });
}

export function buildDeterministicTailoringVariants({
  job = {},
  requirements = [],
  resume = {},
  evidence = [],
} = {}) {
  const jobText = [
      job.title,
      job.description,
      ...requirements.map(requirementText),
    ].join(" "),
    domain = domainFor({
      title: job.title,
      body: [job.description, ...requirements.map(requirementText)].join(" "),
    }),
    facts = availableFacts(jobText, domain, evidence).slice(0, 5),
    formationSources = contextualFact(
      /\b(?:analise e desenvolvimento de sistemas|analise e desenvolvimento de software|ciencia da computacao|engenharia de software|sistemas de informacao)\b/i,
      evidence.map((item) => ({ ...item, text: normalize(item.text) })),
    ),
    corporateSources = contextualFact(
      /\b(?:ambiente corporativo|service desk|suporte tecnico|equipe de ti)\b/i,
      evidence,
    ),
    collaboratorSources = contextualFact(
      /\batendimento a colaboradores\b/i,
      evidence,
    ),
    ids = unique([
      ...facts.flatMap((fact) => fact.sources.map((item) => item.id)),
      ...formationSources.map((item) => item.id),
      ...corporateSources.map((item) => item.id),
    ]).slice(0, 30),
    original = clean(resume.sections?.summary),
    factList = readableList(facts.map((fact) => fact.label).slice(0, 4)),
    supportFactList = readableList(
      facts
        .filter((fact) => !/^(?:Service Desk N2|Inglês B2|troubleshooting)$/i.test(fact.label))
        .map((fact) => fact.label)
        .slice(0, 3),
    ),
    hasFormation = formationSources.length > 0,
    hasCorporateExperience = corporateSources.length > 0,
    bulletChanges = targetedBulletChanges({ resume, evidence, domain, jobText });
  if (!ids.length || !factList) return [];

  const lead = hasFormation
      ? "Profissional de tecnologia com formação em Análise e Desenvolvimento de Software"
      : "Profissional de tecnologia",
    experience = hasCorporateExperience
      ? "experiência em suporte técnico e operações em ambiente corporativo"
      : "experiência prática construída em atividades e projetos de tecnologia",
    focusSentence = {
      SUPPORT: "Atuação voltada a suporte técnico e operações de TI, com foco em atendimento, diagnóstico e resolução de incidentes",
      CLOUD_INFRA: "Atuação voltada a operação, automação e sustentação de ambientes",
      DEVELOPMENT: "Atuação voltada a desenvolvimento, integração e entrega de software",
      SECURITY: "Atuação voltada a análise e resposta a riscos técnicos",
      DATA: "Atuação voltada a automação, tratamento e análise de dados",
      QUALITY: "Atuação voltada a testes e melhoria contínua",
    }[domain.id] || `Atuação voltada a ${domain.label}`,
    supportActivity = collaboratorSources.length
      ? "Atuação em suporte técnico e operações de TI, com atendimento a colaboradores, diagnóstico e resolução de incidentes"
      : "Atuação em suporte técnico e operações de TI, com foco no diagnóstico e na resolução de incidentes",
    supportSummary = hasCorporateExperience
      ? `${lead} e experiência em Service Desk N2 em ambiente corporativo. ${supportActivity}${supportFactList ? `, além de experiência em ${supportFactList}` : ""}.`
      : `${lead} e experiência prática em suporte técnico. ${supportActivity}${supportFactList ? `, com experiência em ${supportFactList}` : ""}.`,
    proposals = [
      {
        perspective: "Técnica",
        text: domain.id === "SUPPORT"
          ? supportSummary
          : `${lead}${hasCorporateExperience ? ` e ${experience}` : ""}. Experiência prática com ${factList}. ${focusSentence}.`,
      },
      {
        perspective: "Experiência",
        text: `${lead} e ${experience}. No dia a dia, trabalha com ${factList}. ${focusSentence}.`,
      },
      {
        perspective: "Contribuição",
        text: `${experience[0].toUpperCase()}${experience.slice(1)}. Vivência com ${factList}, com foco em ${domain.label}.`,
      },
    ];
  return proposals.map((variant, index) => ({
    id: `${domain.id.toLowerCase()}-${index + 1}`,
    perspective: variant.perspective,
    domain: domain.id,
    relevance: facts.reduce((sum, fact) => sum + fact.score, 0) - index,
    changes: [
      {
        type: "REWRITE_SUMMARY",
        targetSection: "summary",
        sourceEvidenceIds: ids,
        original,
        proposed: variant.text,
        reason: `Perspectiva ${variant.perspective.toLowerCase()} selecionada entre 3 variações factuais para destacar ${domain.label} sem repetir objetivos genéricos.`,
      },
      ...bulletChanges,
    ],
  }));
}
