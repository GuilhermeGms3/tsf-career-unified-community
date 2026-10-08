import { api } from "../shared/data.js";
import {
  emptyState,
  escapeHtml,
  formatDate,
  icon,
  pageHeader,
  pill,
  statusLabel, humanText, technicalDetails,
  tabs,
  toast,
} from "../../app/ui.js";

const stages = [
  {
    id: "PREPARING",
    label: "Preparando",
    statuses: ["DISCOVERED", "MATCHED", "PLANNED"],
  },
  {
    id: "FORWARDING",
    label: "Encaminhamento",
    statuses: [
      "APPROVED",
      "QUEUED",
      "OPENING_PAGE",
      "FILLING",
      "VALIDATING",
      "SUBMITTING",
    ],
  },
  {
    id: "WAITING",
    label: "Aguardando você",
    statuses: [
      "WAITING_USER",
      "READY_TO_SUBMIT",
      "BLOCKED",
      "FAILED",
      "RETRYABLE",
      "SUBMISSION_UNCERTAIN",
    ],
  },
  { id: "SUBMITTED", label: "Enviadas", statuses: ["SUBMITTED"] },
];
const applicationTabs = [
    "summary",
    "form",
    "questions",
    "resume",
    "preflight",
    "review",
    "attempts",
    "timeline",
  ],
  labels = {
    summary: "Resumo",
    form: "Formulário",
    questions: "Perguntas",
    resume: "Currículo",
    preflight: "Preflight",
    review: "Revisão final",
    attempts: "Tentativas",
    timeline: "Linha do tempo",
  };
export async function renderApplications({ root }) {
  const { applications = [], funnel = {} } = await api("/api/experience/applications"),
    section = new URLSearchParams(location.search).get("section") || "overview";
  const waiting = applications.filter((item) => item.pendingQuestions > 0 || ["WAITING_USER", "READY_TO_SUBMIT", "BLOCKED", "FAILED", "RETRYABLE"].includes(item.application.status)).length;
  const normalizedFunnel = {
    interested: funnel.interested || [],
    prepared: funnel.prepared || [],
    active: funnel.active || [],
    submitted: funnel.submitted || [],
    recent: funnel.recent || [],
  };
  root.innerHTML = `<div class="page applications-page">${pageHeader({ eyebrow: "Seu funil", title: "Candidaturas", description: "Da vaga que chamou sua atenção ao envio e acompanhamento, sem perder o próximo passo." })}<section class="application-brief" aria-label="Resumo das candidaturas"><div><strong>${normalizedFunnel.interested.length}</strong><span>vagas de interesse</span></div><div><strong>${normalizedFunnel.prepared.length}</strong><span>com currículo preparado</span></div><div><strong>${normalizedFunnel.submitted.length}</strong><span>enviadas</span></div><div><strong>${waiting}</strong><span>precisam de você</span></div></section>${tabs(
    [
      ["overview", "Visão geral"],
      ["interest", `Eu aplicaria (${normalizedFunnel.interested.length})`],
      ["resumes", `Currículos (${normalizedFunnel.prepared.length})`],
      ["pipeline", "Em andamento"],
      ["submitted", `Enviadas (${normalizedFunnel.submitted.length})`],
      ["pending", `Precisa de você (${waiting})`],
      ["interviews", "Entrevistas"],
    ].map(([id, label]) => ({
      id,
      label,
      href: `/applications?section=${id}`,
    })),
    section,
  )}<details class="page-secondary-navigation" ${["followups", "history"].includes(section) ? "open" : ""}><summary>Mais opções de acompanhamento</summary><nav aria-label="Opções avançadas de candidaturas"><a data-link href="/applications?section=followups">Retornos pendentes</a><a data-link href="/applications?section=history">Histórico e canceladas</a><a data-link href="/application-batches">Preparar várias candidaturas</a></nav></details>${applicationsSection(section, applications, normalizedFunnel)}</div>`;
  bindApplicationListActions(root);
}
function applicationsSection(section, applications, funnel) {
  if (section === "overview") return funnelOverview(funnel);
  if (section === "interest") return funnelRecords(funnel.interested, "Nenhuma vaga marcada como aplicaria", "Use Aplicaria, Talvez aplicaria ou Salvar ao revisar uma oportunidade.");
  if (section === "resumes") return funnelRecords(funnel.prepared, "Nenhum currículo preparado", "Gere uma versão específica dentro de uma oportunidade para acompanhá-la aqui.");
  if (section === "submitted") return funnelRecords(funnel.submitted, "Nenhuma candidatura enviada", "Somente envios confirmados aparecem nesta área.");
  if (!applications.length)
    return emptyState(
      "Nenhuma candidatura iniciada",
      "Abra uma oportunidade analisada e prepare a candidatura a partir do workspace.",
      '<a class="button primary" data-link href="/opportunities">Ver oportunidades</a>',
    );
  if (section === "pending")
    return applicationRecords(
      applications.filter(
        (item) =>
          item.pendingQuestions > 0 ||
          [
            "WAITING_USER",
            "READY_TO_SUBMIT",
            "BLOCKED",
            "FAILED",
            "RETRYABLE",
          ].includes(item.application.status),
      ),
      "Nenhuma pendência exige sua atenção",
    );
  if (section === "interviews") {
    const interviews = applications.flatMap((item) =>
      (item.journey?.interviews || []).map((interview) => ({ item, interview })),
    );
    return interviews.length
      ? `<section class="compact-record-list" aria-label="Entrevistas">${interviews
          .map(
            ({ item, interview }) =>
              `<a class="compact-record" data-link href="/applications/${encodeURIComponent(item.application.id)}"><span><strong>${escapeHtml(item.job?.company || "Empresa")}</strong><small>${escapeHtml(item.job?.title || "Candidatura")} · ${escapeHtml(statusLabel(interview.type))}</small></span><span>${formatDate(interview.scheduledAt, { dateStyle: "medium", timeStyle: "short" })}</span>${pill(statusLabel(interview.status), "info")}${icon("arrow")}</a>`,
          )
          .join("")}</section>`
      : emptyState(
          "Nenhuma entrevista registrada",
          "A preparação só aparece quando uma data ou etapa de entrevista existe no processo.",
        );
  }
  if (section === "followups") {
    const stale = applications.filter((item) => item.journey?.followUpDue);
    return applicationRecords(
      stale,
      "Nenhum follow-up sugerido",
      "Somente processos pós-envio, sem interação significativa recente, aparecem aqui. Nenhum contato é enviado automaticamente.",
    );
  }
  if (section === "history")
    return applicationRecords(
      applications,
      "Nenhum histórico disponível",
      "O histórico preserva o estado técnico real e abre a timeline append-only.",
    );
  const activeApplications=applications.filter(item=>item.application.status!=="CANCELLED");
  return `<div class="kanban">${stages
    .map((stage) =>
      kanbanColumn(
        stage,
        activeApplications.filter((item) =>
          stage.statuses.includes(item.application.status),
        ),
      ),
    )
    .join("")}</div>`;
}
function funnelOverview(funnel) {
  const lanes = [
    ["Eu aplicaria", funnel.interested, "Vagas que você marcou para avançar."],
    ["Currículo", funnel.prepared, "Versões geradas, em revisão ou prontas."],
    ["Em andamento", funnel.active, "Processos já iniciados."],
    ["Enviadas", funnel.submitted, "Candidaturas com envio confirmado."],
  ];
  if (!lanes.some(([, items]) => items.length))
    return emptyState("Seu funil ainda está vazio", "Marque uma vaga como Aplicaria ou prepare um currículo para ela aparecer aqui.", '<a class="button primary" data-link href="/opportunities">Ver oportunidades</a>');
  return `<section class="application-funnel" aria-label="Funil de candidaturas">${lanes.map(([title, items, description]) => `<section class="application-funnel-lane"><header><div><h2>${title}</h2><p>${description}</p></div><strong>${items.length}</strong></header><div>${items.slice(0, 4).map(funnelCard).join("") || '<p class="column-empty">Nada aqui.</p>'}</div></section>`).join("")}</section>${funnel.recent.length ? `<section class="application-recent"><div class="section-heading"><div><h2>Atividade recente</h2><p>Vagas em que você decidiu, preparou currículo ou iniciou processo.</p></div></div>${funnelRecords(funnel.recent, "")}</section>` : ""}`;
}
function funnelRecords(items, emptyTitle, emptyDescription = "") {
  if (!items.length) return emptyState(emptyTitle, emptyDescription);
  return `<section class="application-funnel-records">${items.map(funnelCard).join("")}</section>`;
}
function funnelCard(item) {
  const job = item.job || {}, application = item.application,
    href = application ? `/applications/${encodeURIComponent(application.id)}` : `/opportunities/${encodeURIComponent(job.id)}`,
    decision = { APPLY: "Aplicaria", REVIEW: "Talvez aplicaria", SAVE: "Salva" }[item.feedback?.userDecision],
    resumeState = item.resumeVersion ? `Currículo ${statusLabel(item.resumeVersion.status)}` : item.tailoring ? `Currículo ${statusLabel(item.tailoring.state)}` : "",
    score = item.tailoring && item.tailoring.tailoredScore !== null ? `${item.tailoring.originalScore ?? "?"}% → ${item.tailoring.tailoredScore}%` : "",
    process = application ? statusLabel(application.status) : "";
  return `<a class="application-funnel-card" data-link href="${href}"><span>${escapeHtml(job.company || "Empresa não informada")}</span><h3>${escapeHtml(job.title || "Oportunidade")}</h3><div>${decision ? pill(decision, "info") : ""}${resumeState ? pill(resumeState, item.tailoring?.quality?.allowed === false ? "critical" : "success") : ""}${process ? pill(process, application?.status === "SUBMITTED" ? "success" : "neutral") : ""}</div>${score ? `<p><strong>${score}</strong> compatibilidade</p>` : ""}<footer><small>${formatDate(item.updatedAt)}</small>${icon("arrow")}</footer></a>`;
}
function applicationRecords(
  applications,
  emptyTitle,
  emptyDescription = "Nada precisa de intervenção nesta área.",
) {
  if (!applications.length) return emptyState(emptyTitle, emptyDescription);
  return `<section class="compact-record-list">${applications
    .map(
      (item) =>
        `<a class="compact-record" data-link href="/applications/${encodeURIComponent(item.application.id)}"><span><strong>${escapeHtml(item.job?.title || "Candidatura")}</strong><small>${escapeHtml(item.job?.company || "Empresa não informada")} · ${formatDate(item.application.updatedAt)}</small></span>${pill(statusLabel(item.application.status), item.pendingQuestions ? "attention" : "neutral")}<span>${escapeHtml(item.nextAction?.label || "Abrir processo")}</span>${icon("arrow")}</a>`,
    )
    .join("")}</section>`;
}
function kanbanColumn(stage, values) {
  return `<section class="kanban-column"><header><h2>${stage.label}</h2><span>${values.length}</span></header><div>${values.map(applicationCard).join("") || '<p class="column-empty">Nada aqui.</p>'}</div></section>`;
}
function applicationCard(item) {
  const { application: a, job } = item,
    tone = ["BLOCKED", "FAILED"].includes(a.status)
      ? "critical"
      : ["WAITING_USER", "READY_TO_SUBMIT", "RETRYABLE"].includes(a.status)
        ? "attention"
        : a.status === "SUBMITTED"
          ? "success"
          : "neutral";
  const canAdvance=["PLANNED","APPROVED"].includes(a.status),canCancel=!["SUBMITTED","CANCELLED"].includes(a.status);
  return `<article class="application-card"><a data-link href="/applications/${encodeURIComponent(a.id)}"><span>${escapeHtml(job?.company || "Empresa não informada")}</span><h3>${escapeHtml(job?.title || "Candidatura")}</h3>${pill(statusLabel(a.status), tone)}<p>${escapeHtml(item.nextAction?.label || a.nextAction || "Revisar processo")}</p><footer><small>${formatDate(a.updatedAt)}</small>${item.pendingQuestions ? `<strong>${item.pendingQuestions} pendência(s)</strong>` : icon("arrow")}</footer></a><div class="button-row">${canAdvance?`<button class="button" type="button" data-quick-application-action="ADVANCE_APPLICATION" data-application-id="${escapeHtml(a.id)}">Avançar</button>`:""}${canCancel?`<button class="button quiet" type="button" data-quick-application-action="CANCEL_APPLICATION" data-application-id="${escapeHtml(a.id)}">Tirar da fila</button>`:""}</div></article>`;
}

function bindApplicationListActions(root){
  root.querySelectorAll("[data-quick-application-action]").forEach(button=>button.addEventListener("click",async()=>{
    const action=button.dataset.quickApplicationAction;
    if(action==="CANCEL_APPLICATION"&&!confirm("Tirar esta candidatura da fila principal? O histórico continuará disponível."))return;
    button.disabled=true;
    try{
      await api(`/api/experience/applications/${encodeURIComponent(button.dataset.applicationId)}/actions`,{method:"POST",body:JSON.stringify({action})});
      toast(action==="CANCEL_APPLICATION"?"Candidatura retirada da fila.":"Candidatura avançada.");
      await renderApplications({root});
    }catch(error){button.disabled=false;toast(error.message,"error");}
  }));
}

export async function renderApplicationWorkspace({ root, route }) {
  const { workspace: w } = await api(
      `/api/experience/applications/${encodeURIComponent(route.id)}`,
    ),
    tab = applicationTabs.includes(route.tab) ? route.tab : "summary",
    a = w.application,
    job = w.job || {};
  root.innerHTML = `<div class="workspace-page"><header class="workspace-header"><a class="back-link" data-link href="/applications">← Candidaturas</a><div class="workspace-title"><div><h1>${escapeHtml(job.title || "Candidatura")}</h1><p>${escapeHtml(job.company || "Empresa não informada")} · ${escapeHtml(statusLabel(a.status))}</p></div>${pill(statusLabel(a.status), a.status === "READY_TO_SUBMIT" ? "success" : ["WAITING_USER", "BLOCKED"].includes(a.status) ? "attention" : "neutral")}</div>${tabs(
    applicationTabs.map((id) => ({
      id,
      label: labels[id],
      href: `/applications/${encodeURIComponent(a.id)}?tab=${id}`,
    })),
    tab,
  )}</header><div class="workspace-body"><div class="workspace-columns"><section class="workspace-main">${renderTab(tab, w)}</section><aside class="context-rail">${applicationAction(w)}${methodPanel(w)}${readinessPanel(w)}</aside></div></div></div>`;
  bindApplicationActions(root, w);
  const questionId = new URLSearchParams(location.search).get("question");
  if (questionId)
    root
      .querySelector(`#question-${CSS.escape(questionId)}`)
      ?.scrollIntoView({ block: "center" });
}
function renderTab(tab, w) {
  return (
    {
      summary: summaryTab,
      form: formTab,
      questions: questionsTab,
      resume: resumeTab,
      preflight: preflightTab,
      review: finalReviewTab,
      attempts: attemptsTab,
      timeline: timelineTab,
    }[tab] || summaryTab
  )(w);
}
function summaryTab(w) {
  const a = w.application;
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Estado real</p><h2>${statusLabel(a.status)}</h2><p>${escapeHtml(a.nextAction || w.nextAction.reason)}</p></div></div><dl class="definition-grid"><div><dt>Método</dt><dd>${escapeHtml(statusLabel(w.method.method))}</dd></div><div><dt>ATS</dt><dd>${escapeHtml(w.method.atsType)}</dd></div><div><dt>Capacidade</dt><dd>${escapeHtml(w.method.capability.label)}</dd></div><div><dt>Currículo base</dt><dd>${escapeHtml(a.resumeId || "Não selecionado")}</dd></div><div><dt>Versão exata</dt><dd>${escapeHtml(a.resumeVersionId || "Não preparada")}</dd></div><div><dt>Análise vinculada</dt><dd>${escapeHtml(w.plan?.analysisId || "Ainda não vinculada")}</dd></div><div><dt>Próxima ação</dt><dd>${escapeHtml(w.nextAction.label)}</dd></div></dl></section>${w.plan ? `<section class="content-card"><h2>Decisão do planner</h2><div class="metric-grid"><article><small>Decisão</small><strong>${escapeHtml(w.plan.decision)}</strong><span>Revisão humana obrigatória</span></article><article><small>Compatibilidade técnica</small><strong>${w.plan.matchScore}%</strong><span>Career Unified</span></article><article><small>Elegibilidade</small><strong>${escapeHtml(statusLabel(w.plan.eligibility))}</strong><span>Separada do match</span></article></div>${list("Bloqueios", w.plan.blockingIssues)}${list("Alertas", w.plan.warnings)}</section>` : `<section class="action-empty"><h2>Plano ainda não criado</h2><p>Crie o plano para selecionar currículo, verificar elegibilidade e preparar o próximo passo.</p><button class="button primary" type="button" data-plan-application>Gerar plano</button></section>`}${trackingPanel(w)}`;
}
function trackingPanel(w) {
  const j = w.journey || {};
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Acompanhamento humano</p><h2>${escapeHtml(statusLabel(j.stage || w.application.status))}</h2><p>Resultados e interações são eventos append-only; nenhuma mensagem é enviada.</p></div>${j.followUpDue ? pill("Follow-up devido", "attention") : ""}</div><div class="tracking-actions"><form data-application-action><input type="hidden" name="action" value="REGISTER_OUTCOME" /><label><span>Atualizar etapa</span><select name="outcome"><option value="SUBMITTED">Submitted</option><option value="SCREENING">Screening</option><option value="RECRUITER_INTERVIEW">Recruiter Interview</option><option value="TECHNICAL_INTERVIEW">Technical Interview</option><option value="FINAL_INTERVIEW">Final</option><option value="OFFER">Offer</option><option value="REJECTED">Rejected</option><option value="WITHDRAWN">Withdrawn</option><option value="ACCEPTED">Accepted</option></select></label><label><span>Nota opcional</span><input name="note" maxlength="1000" /></label><button class="button" type="submit">Registrar etapa</button></form><form data-application-action><input type="hidden" name="action" value="REGISTER_INTERVIEW" /><label><span>Entrevista</span><input name="scheduledAt" type="datetime-local" required /></label><label><span>Tipo</span><select name="type"><option value="RECRUITER_INTERVIEW">Recrutador</option><option value="TECHNICAL_INTERVIEW">Técnica</option><option value="FINAL_INTERVIEW">Final</option></select></label><label><span>Nota opcional</span><input name="note" maxlength="1000" /></label><button class="button" type="submit">Registrar entrevista</button></form><form data-application-action><label><span>Acompanhamento</span><select name="action"><option value="REGISTER_CONTACT">Registrar contato</option><option value="REGISTER_RESPONSE">Registrar resposta</option><option value="COMPLETE_FOLLOW_UP">Marcar acompanhamento feito</option><option value="DEFER_FOLLOW_UP">Adiar lembrete</option></select></label><label><span>Adiar até</span><input name="deferredUntil" type="datetime-local" /></label><label><span>Nota</span><input name="note" maxlength="1000" /></label><button class="button" type="submit">Salvar interação</button></form></div><p class="form-status" data-tracking-status role="status"></p></section>`;
}
function formTab(w) {
  const inspection = w.inspection;
  const controlled=w.method.capability.canSubmit,banner=controlled?'<div class="safety-banner"><strong>Envio controlado disponível</strong><p>O preenchimento não envia. O clique final exige revisão fresh, consentimento e confirmação observável na aba Revisão final.</p></div>':'<div class="safety-banner"><strong>Conclusão manual</strong><p>O preenchimento pode preparar campos suportados, mas não aciona o botão final deste portal.</p></div>';
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Formulário</p><h2>Mapa técnico traduzido</h2></div></div>${inspection ? `<dl class="definition-grid"><div><dt>Adaptador</dt><dd>${escapeHtml(inspection.adapterType || w.method.atsType)}</dd></div><div><dt>Saúde</dt><dd>${escapeHtml(statusLabel(inspection.health))}</dd></div><div><dt>Campos</dt><dd>${inspection.fields?.length || inspection.fieldCount || 0}</dd></div><div><dt>Última inspeção</dt><dd>${formatDate(inspection.createdAt)}</dd></div></dl>` : '<p class="muted">O formulário ainda não foi inspecionado. Use Dry Run ou Fill Only somente quando o adaptador informar suporte.</p>'}${banner}${w.method.capability.canFill ? '<button class="button primary" type="button" data-run-fill>Preencher formulário</button>' : `<a class="button primary" href="${escapeHtml(w.method.applicationUrl)}" target="_blank" rel="noreferrer">Abrir candidatura manual ${icon("external")}</a>`}<p class="form-status" data-fill-status role="status"></p></section>`;
}
function questionsTab(w) {
  const questions = w.questions || [];
  const generated = w.generatedContent || [];
  return `<section class="content-card"><div class="section-heading"><div><h2>Perguntas e respostas</h2><p>A Base de Conhecimento reutiliza apenas fatos permitidos. A IA pode redigir uma sugestão com evidências, mas você sempre revisa antes de usar.</p></div>${pill(`${questions.filter((q) => q.answerStatus === "USER_REQUIRED").length} pendentes`, "attention")}</div>${questions.length ? `<div class="question-list">${questions.map((q) => questionCard(q, generated)).join("")}</div>` : '<p class="muted">Nenhuma pergunta registrada.</p>'}</section>`;
}
function questionCard(q, generated) {
  const draft = generated.find((item) => item.questionId === q.id && item.contentType === "ANSWER_DRAFT" && item.state === "REVIEW_REQUIRED"),
    pending = q.answerStatus === "USER_REQUIRED",
    directAnswer = q.sensitive || q.consentType || /^(COMPENSATION\.|CONSENT\.|DEMOGRAPHIC\.|WORK_AUTHORIZATION\.|WORK_ARRANGEMENT\.|APPLICATION\.(NOTICE_PERIOD|START_DATE))/.test(q.semanticKey || ""),
    llmAllowed = pending && !directAnswer;
  const response = !pending
    ? `<p class="answer-source">Fonte: ${escapeHtml(humanText(q.answerSource || q.source || "Conhecimento confirmado"))}</p>`
    : draft
      ? `<section class="answer-draft" aria-label="Sugestão da inteligência local"><div><span class="eyebrow">Sugestão para revisar</span><p>${escapeHtml(draft.draft)}</p><small>Gerada somente com as evidências vinculadas. Não será reutilizada automaticamente.</small></div><div class="button-row"><button class="button primary" type="button" data-review-generated="${escapeHtml(draft.id)}" data-review-state="APPROVED">Usar sugestão</button><button class="button quiet" type="button" data-review-generated="${escapeHtml(draft.id)}" data-review-state="REJECTED">Descartar</button></div></section>`
      : `<form data-answer-question="${escapeHtml(q.id)}"><label><span>Sua resposta</span><textarea name="value" rows="3" required autocomplete="off"></textarea></label><label class="check"><input type="checkbox" name="reusable" /> Pode reutilizar quando for seguro</label><div class="button-row"><button class="button primary" type="submit">Salvar resposta</button>${llmAllowed ? `<button class="button" type="button" data-draft-answer="${escapeHtml(q.id)}">Pedir sugestão à IA</button>` : ""}</div><p class="form-status" data-question-status="${escapeHtml(q.id)}" role="status" aria-live="polite"></p></form>`;
  return `<article id="question-${escapeHtml(q.id)}"><div><span>${pill(statusLabel(q.answerStatus), pending ? "attention" : "success")}</span><h3>${escapeHtml(q.label || q.semanticKey)}</h3><p>${escapeHtml(humanText(q.reasonRequired || q.helpText || "Resposta vinculada ao processo."))}</p>${directAnswer ? '<small>Esta pergunta exige resposta direta sua; a IA não pode sugerir nem confirmar.</small>' : ""}</div>${response}</article>`;
}
function resumeTab(w) {
  const v = w.resumeVersion;
  return v
    ? `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Versão vinculada</p><h2>Currículo desta candidatura</h2>${technicalDetails({versionId:v.id,templateId:v.templateId,archetypeId:v.archetypeId})}</div>${pill(statusLabel(v.status), v.status === "REVIEW_REQUIRED" ? "attention" : "success")}</div><dl class="definition-grid"><div><dt>Modelo</dt><dd>${escapeHtml(statusLabel(v.templateId))}</dd></div><div><dt>Arquétipo</dt><dd>${escapeHtml(statusLabel(v.archetypeId || "GENERAL"))}</dd></div><div><dt>Idioma</dt><dd>${escapeHtml(statusLabel(v.language))}</dd></div><div><dt>Verificação das evidências</dt><dd>Conteúdo limitado às evidências</dd></div></dl><div class="artifact-list">${v.artifacts.map((artifact) => `<a class="button quiet" href="/api/resume-documents/artifacts/${encodeURIComponent(artifact.id)}/download">Baixar ${escapeHtml(artifact.artifactType)}</a>`).join("")}</div></section>`
    : `<section class="action-empty"><h2>Nenhuma versão específica vinculada</h2><p>Prepare e aprove o currículo na página da oportunidade antes de avançar.</p><a class="button primary" data-link href="/opportunities/${encodeURIComponent(w.job.id)}?tab=resume">Preparar currículo</a></section>`;
}
function gateTone(status) { return status === "READY" ? "success" : status === "BLOCKED" ? "critical" : "attention"; }
function preflightTab(w) {
  const p=w.submissionPreflight;
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Verificação antes do envio</p><h2>Verificações antes de qualquer envio</h2><p>O aplicativo reavalia a candidatura, as respostas, o currículo, a vaga, possíveis duplicatas e a segurança do formulário e do login.</p></div>${p?pill(statusLabel(p.status),gateTone(p.status)):""}</div>${p?`<div class="question-list">${p.gates.map(item=>`<article><div>${pill(statusLabel(item.status),gateTone(item.status))}<h3>${escapeHtml(gateLabel(item.id))}</h3><p>${escapeHtml(item.message)}</p></div></article>`).join("")}</div><a class="button primary" data-link href="/applications/${encodeURIComponent(w.application.id)}?tab=review">Abrir revisão final</a>`:`<div class="action-empty"><h3>Verificação ainda não executada</h3><p>A avaliação não envia nem altera o formulário externo.</p><button class="button primary" type="button" data-run-submission-preflight>Executar verificação</button></div>`}<p class="form-status" data-submission-status role="status" aria-live="polite"></p></section>`;
}
function finalReviewTab(w) {
  const p=w.submissionPreflight,a=w.application,receipt=w.submissionReceipt,attempt=w.submissionAttempt;
  if(a.status==="SUBMISSION_UNCERTAIN"||attempt?.status==="UNCERTAIN")return `<section class="content-card"><div class="safety-banner"><strong>Não conseguimos confirmar se a candidatura foi enviada.</strong><p>Nenhuma nova tentativa será feita automaticamente.</p></div><div class="dialog-actions"><button class="button" type="button" data-verify-submission>Verificar automaticamente</button><a class="button quiet" href="${escapeHtml(w.method.applicationUrl)}" target="_blank" rel="noreferrer">Abrir site</a><button class="button" type="button" data-reconcile-submission="SENT">Confirmar que foi enviada</button><button class="button quiet" type="button" data-reconcile-submission="NOT_SENT">Confirmar que NÃO foi enviada</button></div><p class="form-status" data-submission-status role="status" aria-live="polite"></p></section>`;
  if(a.status==="SUBMITTING")return `<section class="content-card" aria-live="polite"><p class="eyebrow">Envio controlado</p><h2>Enviando uma única vez…</h2><p>A proteção contra envio duplicado está ativa. Não feche nem repita a ação.</p></section>`;
  if(a.status==="SUBMITTED"&&receipt)return `<section class="content-card"><p class="eyebrow">Comprovante</p><h2>Candidatura enviada</h2><dl class="definition-grid"><div><dt>Empresa</dt><dd>${escapeHtml(w.job.company||"Empresa")}</dd></div><div><dt>Vaga</dt><dd>${escapeHtml(w.job.title||"Vaga")}</dd></div><div><dt>ATS</dt><dd>${escapeHtml(receipt.provider)}</dd></div><div><dt>Enviada em</dt><dd>${formatDate(receipt.submittedAt,{dateStyle:"medium",timeStyle:"short"})}</dd></div><div><dt>Referência</dt><dd>${escapeHtml(receipt.externalReference||"Não fornecida")}</dd></div><div><dt>Versão do currículo</dt><dd>${escapeHtml(receipt.resumeVersionId ? "Currículo aprovado para esta vaga" : "Não informado")}${technicalDetails({resumeVersionId:receipt.resumeVersionId})}</dd></div></dl>${receipt.confirmationUrl?`<a class="button" href="${escapeHtml(receipt.confirmationUrl)}" target="_blank" rel="noreferrer">Ver comprovante</a>`:""}</section>`;
  if(a.status==="FAILED"&&attempt?.status==="FAILED"&&attempt.phase==="PRE_ACTION")return `<section class="content-card"><div class="safety-banner"><strong>A tentativa parou antes do clique final.</strong><p>Nenhuma candidatura foi enviada. Prepare uma nova revisão para revalidar formulário, currículo e respostas e gerar um consentimento novo.</p></div><button class="button primary" type="button" data-retry-submission>Preparar nova tentativa</button><p class="form-status" data-submission-status role="status" aria-live="polite"></p></section>`;
  if(!p)return `<section class="action-empty"><h2>Execute a verificação primeiro</h2><p>A revisão final usa um registro confirmado pelo aplicativo.</p><a class="button primary" data-link href="/applications/${encodeURIComponent(a.id)}?tab=preflight">Ir para verificação</a></section>`;
  if(w.submissionPreviewStale)return `<section class="content-card"><div class="safety-banner"><strong>Esta revisão ficou desatualizada porque o formulário ou os dados mudaram.</strong><p>O consentimento anterior não pode ser reutilizado e nenhum envio foi executado.</p></div><button class="button primary" type="button" data-run-submission-preflight>Atualizar revisão</button><p class="form-status" data-submission-status role="status" aria-live="polite"></p></section>`;
  const freshness=p.gates.find(item=>item.id==="INSPECTION_FRESHNESS")?.details||{},jobGate=p.gates.find(item=>item.id==="JOB_OPEN"),session=w.submissionSession||{};
  const reviewable=!p.blockingReasons.length&&p.warnings.length&&p.warnings.every(item=>["ELIGIBILITY","EVIDENCE_GAPS"].includes(item));
  return `<section class="content-card"><div class="section-heading"><div><p class="eyebrow">Revisão final da candidatura</p><h2>${escapeHtml(w.job.company||"Empresa")} · ${escapeHtml(w.job.title||"Vaga")}</h2><p>Confira a candidatura inteira antes de autorizar.</p></div>${pill(p.readyForPreview?"Revisão atualizada":"Há bloqueios",p.readyForPreview?"success":"attention")}</div><dl class="definition-grid"><div><dt>Plataforma de recrutamento</dt><dd>${escapeHtml(p.adapterType)} · ${p.submissionEnabled?"Envio controlado":"Preenchimento assistido"}</dd></div><div><dt>Formulário verificado</dt><dd>${freshness.inspectedAt?formatDate(freshness.inspectedAt,{dateStyle:"short",timeStyle:"short"}):"Não verificado"}</dd></div><div><dt>Vaga</dt><dd>${escapeHtml(statusLabel(jobGate?.details?.status||"UNKNOWN"))} · ${jobGate?.details?.checkedAt?formatDate(jobGate.details.checkedAt,{dateStyle:"short",timeStyle:"short"}):"sem verificação recente"}</dd></div><div><dt>Formulário e integração</dt><dd>${escapeHtml(statusLabel(p.gates.find(item=>item.id==="ADAPTER_HEALTH")?.status))} · ${escapeHtml(statusLabel(p.gates.find(item=>item.id==="DOM_CONFIDENCE")?.status))}</dd></div><div><dt>Versão do currículo</dt><dd>${escapeHtml(a.resumeVersionId ? "Currículo aprovado para esta vaga" : "Não vinculado")}</dd></div><div><dt>Perguntas</dt><dd>${w.questions.filter(item=>!["KNOWN","ANSWERED_CONFIRMED","ANSWERED_REUSABLE"].includes(item.answerStatus)&&item.required).length?"Pendentes":"Resolvidas"}</dd></div><div><dt>Duplicata</dt><dd>${escapeHtml(statusLabel(p.gates.find(item=>item.id==="DUPLICATE")?.status))}</dd></div><div><dt>Envio externo</dt><dd>${p.submissionEnabled?"Habilitado":"Desabilitado"}</dd></div></dl>${session.status&&session.status!=="NONE"?`<div class="safety-banner"><strong>Sessão interativa: ${escapeHtml(statusLabel(session.status))}</strong><p>${session.interactiveAvailable?`Disponível até ${escapeHtml(session.expiresAt?formatDate(session.expiresAt,{dateStyle:"short",timeStyle:"short"}):"a expiração")}.`:"Esta etapa precisa ser concluída em uma sessão interativa com uma janela de navegador visível."}</p></div>`:""}<h3>Campos que serão utilizados</h3><div class="question-list">${technicalDetails({resumeVersionId:a.resumeVersionId,preflightId:p.id})}${p.formSnapshot.map(item=>`<article><div><strong>${escapeHtml(item.field)}</strong><p>${escapeHtml(item.presentation===null||item.presentation===undefined?"Não informado":Array.isArray(item.presentation)?item.presentation.join(", "):String(item.presentation))}</p><small>Fonte: ${escapeHtml(humanText(item.source||"Não informada"))} · ${escapeHtml(statusLabel(item.status))}</small></div></article>`).join("")||'<p class="muted">Nenhum campo inspecionado.</p>'}</div>${list("Bloqueios",p.blockingReasons)}${list("Alertas",p.warnings)}${p.readyForConsent?`<button class="button primary" type="button" data-open-submit-consent>Autorizar envio</button><dialog data-submit-consent-dialog><form method="dialog"><h2>Confirmação final</h2><p>Você está autorizando o Career Unified a enviar esta candidatura para <strong>${escapeHtml(w.job.company||"a empresa")}</strong>, vaga <strong>${escapeHtml(w.job.title||"selecionada")}</strong>, usando o currículo <strong>${escapeHtml("aprovado para esta vaga")}</strong> e as respostas acima.</p><div class="dialog-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" value="confirm" data-submit-application>Enviar candidatura</button></div><p class="form-status" data-submission-status role="status" aria-live="assertive"></p></form></dialog>`:reviewable?`<div class="safety-banner"><strong>Alertas dependem da sua decisão.</strong><p>Reconhecer não cria experiência nem altera sua base de conhecimento; apenas registra que você revisou estas lacunas nesta candidatura.</p></div><button class="button primary" type="button" data-acknowledge-submission-review>Reconhecer alertas e continuar</button>`:`<div class="safety-banner"><strong>${p.submissionEnabled?"Envio indisponível":"Envio controlado está instalado, mas o envio externo está desativado nesta instalação."}</strong><p>${p.submissionEnabled?"Resolva os bloqueios e atualize a revisão.":"A revisão final continua disponível; nenhum erro ou candidatura foi gerado."}</p></div>`}<p class="form-status" data-submission-status role="status" aria-live="polite"></p></section>`;
}
function gateLabel(id){return ({APPLICATION_STATE:"Estado da candidatura",ELIGIBILITY:"Elegibilidade",EVIDENCE_GAPS:"Evidências",QUESTIONS:"Perguntas obrigatórias",SENSITIVE_QUESTIONS:"Dados sensíveis",RESUME_ARTIFACT:"Currículo e verificação das evidências",DUPLICATE:"Candidatura duplicada",JOB_OPEN:"Vaga aberta",ADAPTER:"Capacidade da integração",INSPECTION_FRESHNESS:"Atualidade do formulário",ADAPTER_HEALTH:"Funcionamento da integração",DOM_CONFIDENCE:"Confiança do formulário",SESSION_AND_CHALLENGE:"Sessão e verificação humana",RATE_LIMIT:"Limite por hora",KILL_SWITCH:"Chave global de envio",CONSENT:"Consentimento final"})[id]||statusLabel(id);}
function attemptsTab(w) {
  return `<section class="content-card"><h2>Tentativas reais</h2>${w.attempts.length ? `<div class="attempt-list">${w.attempts.map((attempt) => `<article><div><strong>Tentativa ${attempt.attemptNumber}</strong>${pill(statusLabel(attempt.status), attempt.status === "FAILED" ? "critical" : "neutral")}</div><dl><div><dt>Adaptador</dt><dd>${escapeHtml(attempt.adapterType || "Não informado")}</dd></div><div><dt>Modo</dt><dd>${escapeHtml(humanText(attempt.mode || "Não informado"))}</dd></div><div><dt>Início</dt><dd>${formatDate(attempt.startedAt, { dateStyle: "short", timeStyle: "short" })}</dd></div><div><dt>Evidência</dt><dd>${escapeHtml(attempt.evidencePath || "Sem captura ou registro de execução")}</dd></div></dl>${attempt.errorMessage ? `<p class="error-copy">${escapeHtml(attempt.errorMessage)}</p>` : ""}</article>`).join("")}</div>` : '<p class="muted">Nenhuma tentativa executada. O sistema não inventa registros ou capturas.</p>'}</section>`;
}
function timelineTab(w) {
  return `<section class="content-card"><h2>Linha do tempo</h2><ol class="timeline">${w.timeline.map((event) => `<li><span></span><div><strong>${escapeHtml(event.label)}</strong><p>${formatDate(event.createdAt, { dateStyle: "medium", timeStyle: "short" })}${event.metadata?.reason ? ` · ${escapeHtml(humanText(event.metadata.reason))}` : ""}</p></div></li>`).join("")}</ol></section>`;
}
function applicationAction(w) {
  return `<section class="rail-panel action-panel"><p class="eyebrow">Próxima ação</p><h2>${escapeHtml(w.nextAction.label)}</h2><p>${escapeHtml(w.nextAction.reason)}</p><a class="button primary full" data-link href="/applications/${encodeURIComponent(w.application.id)}?tab=${w.nextAction.tab}">${escapeHtml(w.nextAction.label)} ${icon("arrow")}</a></section>`;
}
function methodPanel(w) {
  return `<section class="rail-panel"><h3>Método e capacidade</h3><dl class="compact-definition"><div><dt>Método</dt><dd>${escapeHtml(statusLabel(w.method.method))}</dd></div><div><dt>ATS</dt><dd>${escapeHtml(w.method.atsType)}</dd></div><div><dt>Adaptador</dt><dd>${escapeHtml(w.method.capability.label)}</dd></div></dl></section>`;
}
function readinessPanel(w) {
  const p = w.profileCompleteness || {};
  return `<section class="rail-panel"><h3>Seus dados e evidências</h3><p>${p.complete === false ? "Há dados essenciais ausentes ou pendentes." : "Base pronta para os campos conhecidos."}</p><a data-link href="/knowledge">Revisar conhecimento ${icon("arrow")}</a></section>`;
}
async function waitForIntelligenceJob(jobId, { attempts = 120, delayMs = 1000 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await api(`/api/intelligence/jobs/${encodeURIComponent(jobId)}`);
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(result.job.status)) return result.job;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error("A sugestão continua sendo preparada. Ela aparecerá aqui quando você voltar.");
}
function list(title, items = []) {
  return `<div class="inline-list"><strong>${title}</strong>${items.length ? `<ul>${items.map((x) => `<li>${escapeHtml(humanText(typeof x === "string" ? x : x.message || x.code || "Detalhes disponíveis no diagnóstico"))}</li>`).join("")}</ul>` : "<p>Nenhum.</p>"}</div>`;
}
function bindApplicationActions(root, w) {
  root.querySelectorAll("[data-application-action]").forEach((form) =>
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = root.querySelector("[data-tracking-status]"), values = Object.fromEntries(new FormData(form)), button = event.submitter;
      button.disabled = true;
      status.textContent = "Salvando evento…";
      try {
        await api(`/api/experience/applications/${encodeURIComponent(w.application.id)}/actions`, { method: "POST", body: JSON.stringify(values) });
        toast("Acompanhamento registrado.");
        location.reload();
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    }),
  );
  root
    .querySelector("[data-plan-application]")
    ?.addEventListener("click", async (event) => {
      const button=event.currentTarget;
      button.disabled = true;
      button.textContent="Gerando plano…";
      try {
        await api(
          `/api/unified/applications/${encodeURIComponent(w.application.id)}/plan`,
          { method: "POST", body: JSON.stringify({ analysisId: "" }) },
        );
        toast("Plano de candidatura criado.");
        location.reload();
      } catch(error) {
        button.disabled=false;
        button.textContent="Tentar gerar plano novamente";
        toast(error.message,"error");
      }
    });
  root
    .querySelector("[data-run-fill]")
    ?.addEventListener("click", async (event) => {
      const button=event.currentTarget,status=root.querySelector("[data-fill-status]");
      button.disabled = true;
      button.textContent="Inspecionando e preenchendo…";
      status.textContent="O navegador assistido está processando os campos suportados.";
      try {
        await api(
          `/api/unified/applications/${encodeURIComponent(w.application.id)}/run`,
          { method: "POST", body: JSON.stringify({ mode: "FILL_ONLY" }) },
        );
        status.textContent="Preenchimento concluído ou pausado para revisão humana.";
        toast("Preenchimento assistido concluído ou pausado com segurança.");
        location.reload();
      } catch(error) {
        status.textContent=error.message;
        button.disabled=false;
        button.textContent="Tentar preencher novamente";
      }
    });
  root.querySelectorAll("[data-answer-question]").forEach((form) =>
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      await api(
        `/api/unified/applications/${encodeURIComponent(w.application.id)}/questions/${encodeURIComponent(form.dataset.answerQuestion)}/answer`,
        {
          method: "POST",
          body: JSON.stringify({
            value: data.get("value"),
            reusable: data.get("reusable") === "on",
          }),
        },
      );
      toast("Resposta salva.");
      form.innerHTML =
        '<p class="form-status">Resposta salva. Você pode continuar a candidatura.</p>';
    }),
  );
  root.querySelectorAll("[data-draft-answer]").forEach((button) =>
    button.addEventListener("click", async () => {
      const questionId = button.dataset.draftAnswer,
        status = root.querySelector(`[data-question-status="${CSS.escape(questionId)}"]`);
      if (button.dataset.intelligenceJob) {
        const cancelled = await api(`/api/intelligence/jobs/${encodeURIComponent(button.dataset.intelligenceJob)}/cancel`, { method: "POST", body: "{}" }).catch(() => null);
        if (cancelled?.job?.status === "CANCELLED") {
          status.textContent = "Sugestão cancelada antes de iniciar.";
          button.textContent = "Pedir sugestão à IA";
          delete button.dataset.intelligenceJob;
        } else status.textContent = "A geração já havia começado e terminará em segundo plano.";
        return;
      }
      status.textContent = "A inteligência local está analisando a pergunta e suas evidências. Você pode navegar normalmente.";
      try {
        const result = await api("/api/intelligence/jobs", { method: "POST", body: JSON.stringify({ task: "APPLICATION_ANSWER_DRAFT", applicationId: w.application.id, questionId }) });
        if (result.generatedContent) {
          toast("Já existe uma sugestão pronta para revisar.");
          location.reload();
          return;
        }
        button.dataset.intelligenceJob = result.job.id;
        button.textContent = "Cancelar sugestão";
        const job = await waitForIntelligenceJob(result.job.id);
        delete button.dataset.intelligenceJob;
        if (job.status === "COMPLETED") {
          toast("Sugestão pronta para sua revisão.");
          location.reload();
        } else if (job.status === "CANCELLED") {
          status.textContent = "Sugestão cancelada.";
          button.textContent = "Pedir sugestão à IA";
        } else {
          status.textContent = job.errorMessage || "A IA não conseguiu criar uma sugestão segura.";
          button.textContent = "Tentar novamente";
        }
      } catch (error) {
        delete button.dataset.intelligenceJob;
        status.textContent = error.message;
        button.textContent = "Tentar novamente";
      }
    }),
  );
  root.querySelectorAll("[data-review-generated]").forEach((button) =>
    button.addEventListener("click", async () => {
      const state = button.dataset.reviewState;
      button.disabled = true;
      try {
        await api(`/api/intelligence/generated/${encodeURIComponent(button.dataset.reviewGenerated)}/review`, { method: "POST", body: JSON.stringify({ state }) });
        toast(state === "APPROVED" ? "Sugestão aprovada e vinculada somente a esta candidatura." : "Sugestão descartada.");
        location.reload();
      } catch (error) {
        button.disabled = false;
        toast(error.message, "error");
      }
    }),
  );
  root.querySelector("[data-run-submission-preflight]")?.addEventListener("click",async event=>{const button=event.currentTarget,status=root.querySelector("[data-submission-status]");button.disabled=true;status.textContent="Reavaliando todos os gates…";try{await api(`/api/applications/${encodeURIComponent(w.application.id)}/submission/preflight`,{method:"POST",body:"{}"});location.reload();}catch(error){status.textContent=error.message;button.disabled=false;}});
  root.querySelector("[data-acknowledge-submission-review]")?.addEventListener("click",async event=>{if(!confirm("Você revisou os alertas e quer continuar sem transformar as lacunas em experiência comprovada?"))return;const button=event.currentTarget,status=root.querySelector("[data-submission-status]");button.disabled=true;status.textContent="Registrando sua revisão e revalidando…";try{await api(`/api/applications/${encodeURIComponent(w.application.id)}/submission/review`,{method:"POST",body:JSON.stringify({confirmed:true})});location.reload();}catch(error){status.textContent=error.message;button.disabled=false;}});
  root.querySelector("[data-retry-submission]")?.addEventListener("click",async event=>{if(!confirm("Preparar uma nova revisão? O consentimento anterior não será reutilizado."))return;const button=event.currentTarget,status=root.querySelector("[data-submission-status]");button.disabled=true;status.textContent="Reabrindo a candidatura e executando uma verificação nova…";try{await api(`/api/applications/${encodeURIComponent(w.application.id)}/submission/retry`,{method:"POST",body:JSON.stringify({confirmed:true})});location.reload();}catch(error){status.textContent=error.message;button.disabled=false;}});
  const dialog=root.querySelector("[data-submit-consent-dialog]");root.querySelector("[data-open-submit-consent]")?.addEventListener("click",()=>dialog?.showModal());root.querySelector("[data-submit-application]")?.addEventListener("click",async event=>{event.preventDefault();const button=event.currentTarget,status=dialog.querySelector("[data-submission-status]");button.disabled=true;status.textContent="Registrando consentimento específico e revalidando…";try{const granted=await api(`/api/applications/${encodeURIComponent(w.application.id)}/submission/consent`,{method:"POST",body:JSON.stringify({confirmed:true,preflightId:w.submissionPreflight.id})}),key=crypto.randomUUID();status.textContent="Enviando uma única vez…";await api(`/api/applications/${encodeURIComponent(w.application.id)}/submission/submit`,{method:"POST",headers:{"x-idempotency-key":key},body:JSON.stringify({consentToken:granted.consentToken})});dialog.close();location.reload();}catch(error){status.textContent=error.message;button.disabled=false;}});
  root.querySelector("[data-verify-submission]")?.addEventListener("click",async event=>{const button=event.currentTarget,status=root.querySelector("[data-submission-status]");button.disabled=true;try{const result=await api(`/api/applications/${encodeURIComponent(w.application.id)}/submission/verify`,{method:"POST",body:"{}"});status.textContent=result.message;}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
  root.querySelectorAll("[data-reconcile-submission]").forEach(button=>button.addEventListener("click",async()=>{const status=root.querySelector("[data-submission-status]"),resolution=button.dataset.reconcileSubmission;if(!confirm(resolution==="SENT"?"Confirma que a candidatura foi enviada?":"Confirma que a candidatura NÃO foi enviada?"))return;button.disabled=true;status.textContent="Reconciliando sem nova tentativa…";try{await api(`/api/applications/${encodeURIComponent(w.application.id)}/submission/reconcile`,{method:"POST",body:JSON.stringify({resolution})});location.reload();}catch(error){status.textContent=error.message;button.disabled=false;}}));
}
