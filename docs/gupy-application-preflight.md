# Gupy Application Preflight

A auditoria pública confirmou o padrão de URL da vaga e da página de candidatura e que a jornada completa usa conta individual do candidato. Isso permite detecção e handoff, não automação de credenciais nem autorização de envio.

No preflight, Gupy V1 exige identidade canônica, formulário suportado, confiança alta, perguntas resolvidas, currículo exato e ausência de challenge. Mesmo quando esses itens passam, o gate `ADAPTER` fica em revisão porque submit externo e receipt real não foram homologados. A parada correta é a preview/`READY_TO_SUBMIT_MANUAL`.
