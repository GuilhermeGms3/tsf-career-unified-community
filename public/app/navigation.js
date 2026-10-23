const item = (label, path, icon, section = "") => {
  const routePath = path.split("?")[0];
  return {
    label,
    path,
    icon,
    section,
    matches: (route) =>
      (route.path === routePath || route.path.startsWith(`${routePath}/`)) &&
      (!section || (route.section || defaultSection(routePath)) === section),
  };
};
const defaultSection = (path) =>
  ({
    "/opportunities": "discover",
    "/applications": "pipeline",
    "/resumes": "library",
    "/knowledge": "overview",
    "/autopilot": "profiles",
    "/settings": "general",
  })[path] || "";

export const navigationGroups = Object.freeze([
  {
    label: "Trabalho",
    items: [
      item("Hoje", "/", "home"),
      item("Vagas", "/opportunities", "briefcase"),
      item("Candidaturas", "/applications", "send"),
      item("Processos", "/processes", "clock"),
      item("Currículos", "/resumes", "document"),
    ],
  },
  {
    label: "Automação",
    items: [
      item("Busca automática", "/autopilot", "spark", "profiles"),
      item("WhatsApp", "/autopilot?section=notifications", "send", "notifications"),
      item("Fontes", "/connections", "connection"),
      item("Cofres", "/vaults", "lock"),
    ],
  },
  {
    label: "Conhecimento",
    items: [
      item("Meu perfil", "/knowledge", "book"),
      item("Laboratório de qualidade", "/quality-lab", "search"),
    ],
  },
  {
    label: "Sistema",
    items: [
      item("Observabilidade", "/observability", "search"),
      item("Configurações", "/settings", "settings"),
    ],
  },
]);

export const navigation = Object.freeze(
  navigationGroups.flatMap((group) => group.items),
);
