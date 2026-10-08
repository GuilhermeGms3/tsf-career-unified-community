const TERMINAL_APPLICATION_STATUSES = new Set(["SUBMITTED", "CANCELLED"]);

export class NextActionEngine {
  forOpportunity({
    analysis = null,
    resumeTailoring = null,
    resumeVersion = null,
    application = null,
    questions = [],
  } = {}) {
    if (application) return this.forApplication({ application, questions });
    if (!analysis)
      return action(
        "ANALYZE",
        "Analisar oportunidade",
        "Confirme aderência, elegibilidade e lacunas antes de preparar materiais.",
        "analysis",
      );
    if (!resumeVersion && resumeTailoring?.state === "REVIEW_REQUIRED")
      return action(
        "REVIEW_TAILORING",
        "Revisar ajustes do currículo",
        "O changeset factual está pronto e precisa da sua decisão antes de gerar a versão.",
        "resume",
      );
    if (!resumeVersion && resumeTailoring?.state === "APPROVED")
      return action(
        "BUILD_RESUME_VERSION",
        "Gerar versão específica",
        "Os ajustes foram aprovados; gere a ResumeVersion imutável para revisão final.",
        "resume",
      );
    if (!resumeVersion)
      return action(
        "PREPARE_RESUME",
        "Preparar currículo",
        "Use a base recomendada e preserve somente evidências reais.",
        "resume",
      );
    if (resumeVersion.status === "REVIEW_REQUIRED")
      return action(
        "REVIEW_RESUME",
        "Revisar currículo",
        "A versão preparada precisa de aprovação humana.",
        "resume",
      );
    if (["APPROVED", "READY"].includes(resumeVersion.status))
      return action(
        "PREPARE_APPLICATION",
        "Preparar candidatura",
        "Crie o plano e revise os dados antes de qualquer preenchimento.",
        "application",
      );
    return action(
      "RESOLVE_RESUME",
      "Resolver currículo",
      `A versão está em ${resumeVersion.status}.`,
      "resume",
    );
  }

  forApplication({ application, questions = [] } = {}) {
    if (!application)
      return action(
        "CREATE_APPLICATION",
        "Preparar candidatura",
        "Inicie um plano usando o currículo aprovado.",
        "application",
      );
    const pending = questions.filter(
      (item) => item.answerStatus === "USER_REQUIRED",
    );
    if (pending.length)
      return action(
        "ANSWER_QUESTIONS",
        "Responder pendências",
        `${pending.length} resposta(s) precisam da sua confirmação.`,
        "questions",
      );
    if (application.status === "READY_TO_SUBMIT")
      return action(
        "REVIEW_SUBMISSION",
        "Revisar antes de enviar",
        "O preenchimento terminou; execute o preflight e confira o snapshot final.",
        "preflight",
      );
    if(application.status==="SUBMISSION_UNCERTAIN")return action("VERIFY_SUBMISSION","Verificar envio","Não foi possível confirmar o resultado. Não tente novamente antes de verificar.","review");
    if(application.status==="SUBMITTING")return action("WAIT_SUBMISSION","Envio em andamento","A tentativa está protegida por lock e idempotência.","review");
    if (
      ["WAITING_USER", "BLOCKED", "FAILED", "RETRYABLE"].includes(
        application.status,
      )
    )
      return action(
        "RESOLVE_APPLICATION",
        "Resolver candidatura",
        application.nextAction || "Revise o bloqueio e escolha como continuar.",
        "summary",
      );
    if (TERMINAL_APPLICATION_STATUSES.has(application.status))
      return action(
        "TRACK",
        "Acompanhar histórico",
        application.status === "SUBMITTED"
          ? "Registre retornos, entrevistas e follow-ups."
          : "Consulte a linha do tempo desta candidatura.",
        "timeline",
      );
    return action(
      "CONTINUE_APPLICATION",
      "Continuar preparação",
      application.nextAction || "Revise o plano e avance com segurança.",
      "summary",
    );
  }
}

function action(code, label, reason, tab) {
  return { code, label, reason, tab };
}
