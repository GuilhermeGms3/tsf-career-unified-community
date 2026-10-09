const sessionProvider = ({
  id,
  name,
  accountScope,
  loginUrl,
  signupUrl,
  allowedHosts,
  cookieDomains,
  authenticatedPaths = [],
  authenticatedText = [],
  sessionHours = 12,
  notes = "",
}) => Object.freeze({
  id,
  name,
  accountScope,
  loginUrl,
  signupUrl,
  allowedHosts: Object.freeze(allowedHosts),
  cookieDomains: Object.freeze(cookieDomains),
  authenticatedPaths: Object.freeze(authenticatedPaths),
  authenticatedText: Object.freeze(authenticatedText),
  sessionHours,
  notes,
});

const providers = [
  sessionProvider({
    id: "gupy",
    name: "Gupy",
    accountScope: "gupy.io",
    loginUrl: "https://login.gupy.io/candidates/signin",
    signupUrl: "https://portal.gupy.io/candidates/sign-up",
    allowedHosts: ["login.gupy.io", "portal.gupy.io", "*.gupy.io"],
    cookieDomains: ["gupy.io", ".gupy.io"],
    authenticatedPaths: [/^https:\/\/portal\.gupy\.io\/my\/applications/i],
    authenticatedText: [/Minhas candidaturas/i],
    sessionHours: 24,
    notes: "Uma sessão da conta pode ser reutilizada entre empresas Gupy.",
  }),
  sessionProvider({
    id: "indeed",
    name: "Indeed",
    accountScope: "indeed.com",
    loginUrl: "https://secure.indeed.com/auth",
    signupUrl: "https://secure.indeed.com/account/register",
    allowedHosts: ["secure.indeed.com", "*.indeed.com", "*.indeed.com.br"],
    cookieDomains: ["indeed.com", ".indeed.com", "indeed.com.br", ".indeed.com.br"],
    authenticatedPaths: [/\/myjobs/i, /\/profile/i, /\/account/i],
    authenticatedText: [/Minhas vagas/i, /My jobs/i, /Perfil/i],
    notes: "A disponibilidade pode variar quando o Indeed apresenta verificação adicional.",
  }),
  sessionProvider({
    id: "solides",
    name: "Sólides Vagas",
    accountScope: "solides.com.br",
    loginUrl: "https://auth.vagas.solides.com.br/",
    signupUrl: "https://auth.vagas.solides.com.br/sign-up",
    allowedHosts: ["*.solides.com.br"],
    cookieDomains: ["solides.com.br", ".solides.com.br"],
    authenticatedPaths: [/\/candidate/i, /\/profile/i, /\/applications/i],
    authenticatedText: [/Minhas candidaturas/i, /Meu perfil/i],
  }),
  sessionProvider({
    id: "recrutei",
    name: "Recrutei",
    accountScope: "recrutei.com.br",
    loginUrl: "https://talent.recrutei.com.br/recrutei-empregos/signin",
    signupUrl: "https://talent.recrutei.com.br/recrutei-empregos/signup",
    allowedHosts: ["*.recrutei.com.br"],
    cookieDomains: ["recrutei.com.br", ".recrutei.com.br"],
    authenticatedPaths: [/\/recrutei-empregos\/(dashboard|profile|applications)/i],
    authenticatedText: [/Minhas candidaturas/i, /Meu perfil/i, /Sair/i],
  }),
  sessionProvider({
    id: "iel",
    name: "IEL Carreiras",
    accountScope: "carreiras.iel.org.br",
    loginUrl: "https://carreiras.iel.org.br/",
    signupUrl: "https://carreiras.iel.org.br/",
    allowedHosts: ["carreiras.iel.org.br", "*.iel.org.br"],
    cookieDomains: ["carreiras.iel.org.br", ".iel.org.br"],
    authenticatedPaths: [/\/(candidato|estudante)\/(perfil|inscricoes|curriculo)/i],
    authenticatedText: [/Minhas inscrições/i, /Meu perfil/i, /Sair/i],
  }),
  sessionProvider({
    id: "infojobs",
    name: "InfoJobs",
    accountScope: "infojobs.com.br",
    loginUrl: "https://www.infojobs.com.br/Login.aspx",
    signupUrl: "https://www.infojobs.com.br/Candidate/",
    allowedHosts: ["*.infojobs.com.br"],
    cookieDomains: ["infojobs.com.br", ".infojobs.com.br"],
    authenticatedPaths: [/\/Candidate\/(Applications|Curriculum|Profile)/i],
    authenticatedText: [/Minhas candidaturas/i, /Meu currículo/i, /Sair/i],
  }),
  sessionProvider({
    id: "catho",
    name: "Catho",
    accountScope: "catho.com.br",
    loginUrl: "https://login.catho.com.br/",
    signupUrl: "https://www.catho.com.br/cadastro/",
    allowedHosts: ["*.catho.com.br"],
    cookieDomains: ["catho.com.br", ".catho.com.br"],
    authenticatedPaths: [/\/minhas-candidaturas/i, /\/meu-curriculo/i, /\/area-candidato/i],
    authenticatedText: [/Minhas candidaturas/i, /Meu currículo/i, /Sair/i],
  }),
  sessionProvider({
    id: "vagas",
    name: "Vagas.com.br",
    accountScope: "vagas.com.br",
    loginUrl: "https://www.vagas.com.br/login-candidatos",
    signupUrl: "https://www.vagas.com.br/cadastro-candidatos",
    allowedHosts: ["*.vagas.com.br"],
    cookieDomains: ["vagas.com.br", ".vagas.com.br"],
    authenticatedPaths: [/\/painel/i, /\/candidato/i, /\/curriculo/i],
    authenticatedText: [/Minhas candidaturas/i, /Meu currículo/i, /Sair/i],
  }),
  sessionProvider({
    id: "programathor",
    name: "ProgramaThor",
    accountScope: "programathor.com.br",
    loginUrl: "https://programathor.com.br/users/sign_in",
    signupUrl: "https://programathor.com.br/users/sign_up",
    allowedHosts: ["programathor.com.br", "www.programathor.com.br"],
    cookieDomains: ["programathor.com.br", ".programathor.com.br"],
    authenticatedPaths: [/\/users\/edit/i, /\/dashboard/i, /\/applications/i],
    authenticatedText: [/Meu perfil/i, /Minhas candidaturas/i, /Sair/i],
  }),
  sessionProvider({
    id: "geekhunter",
    name: "GeekHunter",
    accountScope: "geekhunter.com.br",
    loginUrl: "https://www.geekhunter.com.br/login",
    signupUrl: "https://www.geekhunter.com.br/cadastro",
    allowedHosts: ["*.geekhunter.com.br"],
    cookieDomains: ["geekhunter.com.br", ".geekhunter.com.br"],
    authenticatedPaths: [/\/dashboard/i, /\/profile/i, /\/applications/i],
    authenticatedText: [/Meu perfil/i, /Minhas candidaturas/i, /Sair/i],
  }),
];

const registry = new Map(providers.map((provider) => [provider.id, provider]));

export const SESSION_PROVIDER_IDS = Object.freeze(providers.map(({ id }) => id));
export const sessionProviders = () => providers;
export const sessionProviderById = (id) => registry.get(String(id || "").toLowerCase()) || null;

export function hostAllowed(provider, hostname) {
  const host = String(hostname || "").toLowerCase();
  return provider.allowedHosts.some((entry) =>
    entry.startsWith("*.") ? host === entry.slice(2) || host.endsWith(entry.slice(1)) : host === entry,
  );
}

export function sessionProviderFromUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return providers.find((provider) => hostAllowed(provider, url.hostname)) || null;
}
