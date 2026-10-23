import {WhatsappMenuRepository} from "../../../repositories/whatsapp-menu-repository.mjs";
import {rememberOutboundText} from "./outbound-message-guard.mjs";

const categories = [
  ["pending", "Pendentes de aprovação"], ["results", "Resultados das candidaturas"],
  ["automatic", "Enviadas automaticamente"], ["attention", "Precisa da sua ação"],
  ["running", "Em andamento"], ["history", "Histórico completo"],
];
const labels = {PLANNED:"Currículo em revisão",APPROVED:"Aprovada",QUEUED:"Na fila",OPENING_PAGE:"Abrindo portal",FILLING:"Preenchendo",VALIDATING:"Validando",WAITING_USER:"Aguardando você",READY_TO_SUBMIT:"Preenchida; não enviada",SUBMITTING:"Envio em andamento",SUBMITTED:"Enviada",SUBMISSION_UNCERTAIN:"Envio incerto; não repetir",CANCELLED:"Encerrada",BLOCKED:"Bloqueada",FAILED:"Falha",RETRYABLE:"Nova tentativa necessária"};
const short = text => String(text || "").replace(/\s+/g," ").slice(0,130);

export class WhatsappMenu {
  constructor(gateway, {clock = () => Date.now()} = {}) {
    this.gateway = gateway; this.clock = clock;
    this.repository = new WhatsappMenuRepository(gateway.store.database.connection);
    this.state = null;
  }
  async send(text, state) {
    rememberOutboundText(this.gateway.evolutionService.instance, text);
    await this.gateway.evolutionService.client.sendText(this.gateway.evolutionService.instance, this.gateway.target, text);
    this.state = {...state, expires: this.clock() + 15 * 60 * 1000};
    return {handled:true,outcome:"MENU_SENT"};
  }
  root() {
    return this.send(["Central TSF", ...categories.map(([,label],i)=>`${i+1}. ${label}`), "", "Responda com o número. MENU ou 0 volta ao início.", "Os avisos automáticos continuam chegando normalmente."].join("\n"), {view:"ROOT"});
  }
  async list(category, targetHash, offset=0) {
    const page = this.repository.list({category,targetHash,offset});
    const label = categories.find(([id])=>id===category)[1];
    const lines = [`${label} · ${page.total}`, ...page.items.map((item,i)=>`${i+1}. ${short(item.title)} — ${short(item.company)}\n   ${item.manualSent?"Envio manual informado por você":["FAILED","WAITING_USER","BLOCKED"].includes(item.runStatus)&&!["SUBMITTED","CANCELLED"].includes(item.status)?"AutoApply precisa da sua ação":labels[item.status]||"Consultar processo"}${item.token?` · ID ${item.token}`:""}`)];
    if (!page.items.length) lines.push("Nenhuma vaga nesta seção agora.");
    else lines.push("", "Responda com o número para abrir a vaga.");
    if (page.offset+page.items.length<page.total) lines.push("MAIS: próxima página.");
    if (offset) lines.push("ANTERIOR: página anterior.");
    lines.push("MENU ou 0: início.");
    return this.send(lines.join("\n"), {view:"LIST",category,page});
  }
  async detail(item, category, targetHash) {
    // Re-read on selection; a notification or worker may have changed the process.
    const app = this.gateway.store.applications.findById(item.applicationId);
    if (!app || app.jobId!==item.jobId) return this.list(category,targetHash);
    const version = app.resumeVersionId && this.gateway.store.resumeVersions.findById(app.resumeVersionId);
    const base = version && this.gateway.store.resumes.findById(version.resumeId);
    const lines = [short(item.title),short(item.company),`Estado: ${labels[app.status]||"Consultar processo"}`,`Próxima ação: ${short(app.nextAction)||"Ver detalhes no TSF"}`];
    if (version) lines.push(`Currículo: ${short(base?.title)||"Base"} · versão ${version.id.slice(-8)} · nota ${version.atsAfter?.overallScore??"não calculada"}`);
    if (["FAILED","WAITING_USER","BLOCKED"].includes(item.runStatus) && !["SUBMITTED","CANCELLED"].includes(app.status)) lines.push("O AutoApply encontrou uma pendência; não há envio confirmado nesta tentativa.");
    if (item.receiptId) lines.push(`Envio confirmado pelo portal. Recibo: ${item.receiptId}`);
    else if (item.manualSent) lines.push("Envio manual informado por você; não é recibo do portal.");
    if (item.questionToken) lines.push(`Pergunta pendente: envie ${item.questionToken} para ver como responder.`);
    lines.push(`Abrir vaga: ${this.gateway.applicationBaseUrl}/opportunities/${encodeURIComponent(app.jobId)}`,`Abrir candidatura: ${this.gateway.applicationBaseUrl}/applications/${encodeURIComponent(app.id)}`);
    if (item.token) lines.push("", "1. Consultar status", "2. Receber currículo", "3. Analisar / alterar currículo", "4. Aprovar envio", "5. Negar", "6. Envio manual / retomada", "7. Verificar disponibilidade");
    lines.push("VOLTAR: lista. MENU ou 0: início.");
    return this.send(lines.join("\n"), {view:"DETAIL",item,category});
  }
  async handle(text, targetHash) {
    const input = String(text).trim().normalize("NFD").replace(/\p{Diacritic}/gu,"").toUpperCase();
    if (!this.state || this.state.expires<=this.clock() || ["MENU","AJUDA","INICIO","0"].includes(input)) return this.root();
    const state = this.state;
    if (state.view==="ROOT" && /^[1-6]$/.test(input)) return this.list(categories[Number(input)-1][0],targetHash);
    if (state.view==="LIST") {
      if(input==="MAIS" && state.page.offset+state.page.items.length<state.page.total) return this.list(state.category,targetHash,state.page.offset+5);
      if(input==="ANTERIOR") return this.list(state.category,targetHash,Math.max(0,state.page.offset-5));
      if(/^[1-5]$/.test(input) && state.page.items[Number(input)-1]) return this.detail(state.page.items[Number(input)-1],state.category,targetHash);
    }
    if (state.view==="DETAIL") {
      if(input==="VOLTAR") return this.list(state.category,targetHash);
      const token=state.item.token;
      if(token && ["1","2","3","7"].includes(input)) return {command:`${{"1":"STATUS","2":"CURRICULO","3":"ANALISAR","7":"VERIFICAR"}[input]} ${token}`};
      if(token && ["4","5","6"].includes(input)) {
        const lines=input==="4"?[`Para aprovar o currículo e autorizar AutoApply: ENVIAR ${token}`,`Apenas aprovar sem enviar: SALVAR ${token}`]:input==="5"?[`Para negar esta vaga: NEGAR ${token}`]:[`Receber link e pendências: MANUAL ${token}`,`Após resolver a pendência: CONTINUAR ${token}`,`Se já enviou no portal: JÁ ENVIEI ${token}`,`Parar o processo: CANCELAR ${token}`];
        return this.send([`Vaga ${token}: ${short(state.item.title)}`,...lines,"Nenhuma decisão foi executada por abrir esta opção.","VOLTAR: lista. MENU: início."].join("\n"),state);
      }
    }
    return this.root();
  }
}
