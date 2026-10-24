import { TASK_TYPES } from "../runtime/task-types.mjs";

// Lexicos deterministicos que toda escolha da IA precisa respeitar.
export const FINAL_LEXICON = /enviar|confirmar|finalizar|concluir|candidat|aplicar|submit|apply|send|finish/i;
export const NEXT_LEXICON = /pr[oó]xim|continuar|avan[cç]|prosseguir|next|continue/i;
// "Seguir" (empresa), filtros, alertas e indicacoes tambem ficam de fora; login e cadastro nunca sao clicados.
export const DENY_LEXICON = /cancel|voltar|sair|excluir|remover|apagar|rascunho|compartilh|denunci|desist|\bseguir\b|filtr|alerta|newsletter|amigo|indicar|entrar|login|cadastr|criar conta|back|delete|remove|share|report|logout|sign ?in|sign ?up|register/i;
const MIN_CONFIDENCE = 0.7;

// IA local (Ollama/LM Studio) na ultima milha dos Cofres. Ela so escolhe entre o que o codigo listou e
// toda resposta passa por travas: id listado, rotulo com cara de envio ou avanco, nada de cancelar ou
// voltar, confianca minima. Sem IA, com timeout ou fora das travas: NONE/UNKNOWN e a ultima milha
// segue deterministica (o envio fica incerto ate a pessoa confirmar).
export class LastMileAssistant {
  constructor(serviceProvider) { this.serviceProvider = typeof serviceProvider === "function" ? serviceProvider : () => serviceProvider; }

  async run(task, input, fallback) {
    const service = this.serviceProvider();
    if (!service) return { result: fallback, meta: { fallback: true } };
    try { return await service.execute(task, input, { fallback, cache: false }); } catch { return { result: fallback, meta: { fallback: true } }; }
  }

  // candidates: [{label, inForm, inDialog, ...}] listados pelo codigo; devolve o proprio candidato escolhido.
  async chooseAction({ provider, step = 1, candidates = [] } = {}) {
    const listed = candidates.slice(0, 25).map((candidate, index) => ({ id: `b${index + 1}`, label: String(candidate.label || "").slice(0, 80), inForm: Boolean(candidate.inForm), inDialog: Boolean(candidate.inDialog) }));
    if (!listed.length) return { action: "NONE", candidate: null, source: "NO_CANDIDATES" };
    const { result, meta } = await this.run(TASK_TYPES.LAST_MILE_ACTION, { portal: provider, step, candidates: listed }, { action: "NONE", candidateId: "", confidence: 0, reason: "" });
    if (meta?.fallback) return { action: "NONE", candidate: null, source: "FALLBACK" };
    if (result.action === "NONE") return { action: "NONE", candidate: null, source: "MODEL_NONE" };
    const index = listed.findIndex((candidate) => candidate.id === result.candidateId), label = listed[index]?.label || "";
    const lexicon = result.action === "FINAL" ? FINAL_LEXICON : NEXT_LEXICON;
    if (index < 0 || Number(result.confidence) < MIN_CONFIDENCE || DENY_LEXICON.test(label) || !lexicon.test(label)) return { action: "NONE", candidate: null, source: "GUARD_REJECTED", rejected: { action: result.action, label } };
    return { action: result.action, candidate: candidates[index], source: "MODEL", model: meta?.model || "" };
  }

  // texts: textos de sucesso que surgiram depois do clique (ja filtrados pelo codigo).
  async classifyConfirmation({ provider, texts = [] } = {}) {
    const listed = texts.slice(0, 10).map((text, index) => ({ id: `t${index + 1}`, text: String(text).slice(0, 300) }));
    if (!listed.length) return { status: "UNKNOWN", text: "", source: "NO_TEXTS" };
    const { result, meta } = await this.run(TASK_TYPES.LAST_MILE_CONFIRMATION, { portal: provider, texts: listed }, { status: "UNKNOWN", textId: "", confidence: 0, reason: "" });
    if (meta?.fallback) return { status: "UNKNOWN", text: "", source: "FALLBACK" };
    if (result.status !== "CONFIRMED") return { status: result.status, text: "", source: "MODEL" };
    const index = listed.findIndex((item) => item.id === result.textId);
    if (index < 0 || Number(result.confidence) < MIN_CONFIDENCE) return { status: "UNKNOWN", text: "", source: "GUARD_REJECTED" };
    return { status: "CONFIRMED", text: texts[index], source: "MODEL", model: meta?.model || "" };
  }
}
