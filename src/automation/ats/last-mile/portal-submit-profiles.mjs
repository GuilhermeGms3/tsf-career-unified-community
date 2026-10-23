import { SESSION_PROVIDER_IDS, sessionProviderById } from "../../../source-connections/session-provider-registry.mjs";

// Perfil de ultima milha de um portal com Cofre: o que identifica o botao final, o avanco de etapa
// e o texto de confirmacao que aparece so depois do envio. Nome e hosts vem do registro de Cofres.
// Um perfil sem botao final ou sem confirmacao fica INCOMPLETE e nunca clica: estes textos devem
// vir de fixtures capturadas do formulario real (logado), nunca de suposicao.
const SUBMIT_TEXT_FIELDS = Object.freeze(["finalButton", "successText"]);

function profile(provider, { codePrefix = provider.toUpperCase(), finalButton = null, progressionButton = null, successText = null, receiptText = "" } = {}) {
  const session = sessionProviderById(provider);
  if (!session) throw new Error(`Portal sem Cofre: ${provider}`);
  const missing = SUBMIT_TEXT_FIELDS.filter((field) => !{ finalButton, successText }[field]);
  return Object.freeze({
    provider, label: session.name, codePrefix, hosts: session.allowedHosts,
    finalButton, progressionButton, successText, receiptText,
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
