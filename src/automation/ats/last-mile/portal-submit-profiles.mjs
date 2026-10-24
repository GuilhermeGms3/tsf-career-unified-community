import { SESSION_PROVIDER_IDS, sessionProviderById } from "../../../source-connections/session-provider-registry.mjs";

// Perfil de ultima milha de um portal com Cofre: o que identifica o botao final, o avanco de etapa
// e o texto de confirmacao que aparece so depois do envio. Nome e hosts vem do registro de Cofres.
// Um perfil sem botao final ou sem confirmacao fica INCOMPLETE e nunca clica: estes textos devem
// vir de fixtures capturadas do formulario real (logado), nunca de suposicao.
const SUBMIT_TEXT_FIELDS = Object.freeze(["finalButton", "successText"]);

// Botao que abre a candidatura na pagina da vaga. Rotulos vistos nas paginas publicas dos portais
// (InfoJobs "Candidatar-me", ProgramaThor/Catho "Quero me candidatar", Vagas "Tenho interesse nessa vaga",
// Solides "Candidatura rapida", GeekHunter "Candidatar para a vaga", IEL "Quero esta vaga", Indeed "Candidatar-se").
// Logado, este clique pode ja ser o envio: por isso entryMayDeliver e o clique so ocorre com consentimento.
export const DEFAULT_ENTRY_BUTTON = /^(?:candidatar-?(?:se|me)(?: com o indeed)?|candidate-se|quero me candidatar|quero esta vaga|tenho interesse nessa vaga|candidatura (?:r[aá]pida|f[aá]cil)|candidatar para a vaga|aplicar(?: para a vaga)?|apply(?: now)?|easy apply)$/i;
// Padroes usados enquanto o perfil do portal nao tem os textos capturados. Botao final segundo paginas
// publicas e ajuda dos portais (Recrutei/Empregare "Confirmar candidatura", Indeed "Enviar sua candidatura",
// Catho "Enviar meu curriculo", GeekHunter "Finalizar candidatura"). Sem successText do perfil so ha SUBMITTED
// quando a IA local confirma um texto novo (CAREER_LAST_MILE_LLM). "Seguir" fica de fora: e seguir empresa.
export const DEFAULT_PROGRESSION_BUTTON = /^(?:pr[oó]xima etapa|pr[oó]ximo|continuar|avan[cç]ar|prosseguir|next|continue)$/i;
export const DEFAULT_FINAL_BUTTON = /^(?:enviar (?:sua |minha )?candidatura|confirmar candidatura|finalizar candidatura|concluir candidatura|enviar meu curr[ií]culo|enviar|submit(?: application)?)$/i;

function profile(provider, { codePrefix = provider.toUpperCase(), entryButton = DEFAULT_ENTRY_BUTTON, finalButton = null, progressionButton = null, successText = null, receiptText = "" } = {}) {
  const session = sessionProviderById(provider);
  if (!session) throw new Error(`Portal sem Cofre: ${provider}`);
  const missing = SUBMIT_TEXT_FIELDS.filter((field) => !{ finalButton, successText }[field]);
  return Object.freeze({
    provider, label: session.name, codePrefix, hosts: session.allowedHosts,
    entryButton, entryMayDeliver: true, finalButton, progressionButton, successText, receiptText,
    status: missing.length ? "INCOMPLETE" : "COMPLETE", missing: Object.freeze(missing),
  });
}

export const PORTAL_SUBMIT_PROFILES = Object.freeze({
  gupy: profile("gupy", {
    finalButton: /^(?:enviar candidatura|finalizar candidatura|concluir inscrição|submit application)$/i,
    progressionButton: /^(?:pr[oó]xima etapa|pr[oó]ximo|continuar|avançar|next|continue)$/i,
    successText: /^(?:Candidatura enviada!|Sua candidatura foi enviada com sucesso\.?|Application submitted successfully\.?)$/i,
    receiptText: "Candidatura enviada",
  }),
  // Aguardando captura do formulario logado (botao final e texto de confirmacao).
  indeed: profile("indeed"),
  solides: profile("solides"),
  recrutei: profile("recrutei"),
  iel: profile("iel"),
  infojobs: profile("infojobs"),
  catho: profile("catho"),
  vagas: profile("vagas"),
  programathor: profile("programathor"),
  geekhunter: profile("geekhunter"),
  empregare: profile("empregare"),
});

export const portalSubmitProfile = (provider) => PORTAL_SUBMIT_PROFILES[String(provider || "").toLowerCase()] || null;

// Todo Cofre precisa de perfil; o teste de contrato garante que nenhum fique de fora.
export const vaultProvidersWithoutProfile = () => SESSION_PROVIDER_IDS.filter((id) => !PORTAL_SUBMIT_PROFILES[id]);

// Envio controlado dos Cofres e opt-in por portal: CAREER_VAULT_SUBMIT_PROVIDERS=catho,vagas. Varios portais
// proibem automacao nos termos de uso, entao nenhum e liberado por padrao. O Gupy envia pelo Application Batch.
export const vaultSubmitEnabled = (provider, env = process.env) => {
  const id = String(provider || "").toLowerCase();
  return id !== "gupy" && Boolean(PORTAL_SUBMIT_PROFILES[id]) && String(env.CAREER_VAULT_SUBMIT_PROVIDERS || "").split(",").map((value) => value.trim().toLowerCase()).includes(id);
};
