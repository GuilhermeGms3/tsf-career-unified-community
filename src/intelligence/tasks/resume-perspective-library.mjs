export const RESUME_PERSPECTIVE_LIBRARY_VERSION = "role-texts-v2";

// Saved editorial text, not candidate facts. Bind only to verified source content.
export const RESUME_PERSPECTIVES = Object.freeze({
  SUPPORT: {
    focus: "Atuação voltada a suporte técnico e operações de TI, com foco em atendimento, diagnóstico e resolução de incidentes",
    contribution: "suporte técnico e operações de TI",
    bullets: [
      [/^Atendimento (?:técnico )?a (usuários|colaboradores)(.*)$/i, "Suporte a $1$2"],
      [/^Resolução de (incidentes|problemas)(.*)$/i, "Diagnóstico e resolução de $1$2"],
    ],
  },
  NETWORK: {
    focus: "Foco em conectividade, redes e acompanhamento de ambientes de TI",
    contribution: "redes e conectividade",
    bullets: [
      [/^Monitoramento de (redes|conectividade)(.*)$/i, "Acompanhamento de $1$2"],
      [/^Configuração de (redes|switches|roteadores|VPN|DNS|DHCP)(.*)$/i, "Configuração técnica de $1$2"],
    ],
  },
  NOC: {
    focus: "Foco em monitoramento e acompanhamento da disponibilidade dos ambientes",
    contribution: "monitoramento e operações de TI",
    bullets: [[/^Monitoramento de (.*)$/i, "Acompanhamento operacional de $1"]],
  },
  CLOUD_INFRA: {
    focus: "Atuação voltada a operação, automação e sustentação de ambientes",
    contribution: "infraestrutura e automação",
    bullets: [
      [/^Atendimento de (incidentes em servidores|incidentes de infraestrutura)(.*)$/i, "Diagnóstico e resolução de $1$2"],
      [/^Manutenção de (servidores|máquinas virtuais|ambientes)(.*)$/i, "Sustentação de $1$2"],
    ],
  },
  CLOUD: {
    focus: "Foco em operação de ambientes cloud e automação de rotinas técnicas",
    contribution: "cloud e automação",
    bullets: [[/^Suporte a ambientes (Microsoft Azure|AWS)(.*)$/i, "Suporte à operação de ambientes $1$2"]],
  },
  DEVELOPMENT: {
    focus: "Atuação voltada a desenvolvimento, integração e entrega de software",
    contribution: "desenvolvimento de software",
    bullets: [
      [/^Desenvolvimento de (.*)$/i, "Construção de $1"],
      [/^Automação de (.*) com (Python|PowerShell|JavaScript)(.*)$/i, "Desenvolvimento de automações de $1 com $2$3"],
      [/^Implementação de (APIs?|integrações)(.*)$/i, "Desenvolvimento de $1$2"],
    ],
  },
  SECURITY: {
    focus: "Foco em segurança da informação e acompanhamento de ambientes de TI",
    contribution: "segurança da informação",
    bullets: [[/^Monitoramento de (alertas de segurança|eventos de segurança)(.*)$/i, "Acompanhamento de $1$2"]],
  },
  DATA: {
    focus: "Atuação voltada a automação, tratamento e análise de dados",
    contribution: "dados e automação",
    bullets: [[/^Automação da coleta de (dados.*)$/i, "Coleta automatizada de $1"]],
  },
  QUALITY: {
    focus: "Atuação voltada a testes e melhoria contínua",
    contribution: "qualidade de software",
    bullets: [[/^Automação de (testes.*)$/i, "Desenvolvimento de automações de $1"]],
  },
});

export function rewriteSavedExperience(original, domain) {
  for (const [pattern, replacement] of RESUME_PERSPECTIVES[domain]?.bullets || [])
    if (pattern.test(original)) return original.replace(pattern, replacement);
  return original;
}

export const SAVED_SUMMARY_TEXTS = Object.freeze([
  { perspective: "Técnica", render: ({ activities, facts, contribution }) => activities.length
    ? activities.map((item, index) => `${item.section === "projects" ? index === 0 ? `Projetos em ${contribution}, com` : "Projetos também envolvendo" : index === 0 ? `Experiência em ${contribution}, com` : "Atuação em"} ${item.text}.`).join(" ")
    : `Conhecimentos técnicos em ${facts}, relevantes para ${contribution}.` },
  { perspective: "Experiência", render: ({ activities, facts, contribution }) => activities.length
    ? activities.map((item, index) => `${item.section === "projects" ? index === 0 ? `Projetos técnicos em ${contribution}, incluindo` : "Projetos envolvendo" : index === 0 ? `Experiência em ${contribution}, incluindo` : "Experiência também com"} ${item.text}.`).join(" ")
    : `Base de conhecimentos em ${facts} para ${contribution}.` },
  { perspective: "Contribuição", render: ({ activities, facts, contribution }) => activities.length
    ? activities.map((item, index) => `${item.section === "projects" ? index === 0 ? `Projetos de ${contribution} envolvendo` : "Projetos também com" : index === 0 ? `Atuação em ${contribution}, com` : "Experiência com"} ${item.text}.`).join(" ")
    : `Conhecimentos em ${facts}, com base técnica para ${contribution}.` },
]);
