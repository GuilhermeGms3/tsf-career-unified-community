# Evidence Gap Resolution

Depois de uma análise ATS V2, requisitos de skill/tool em `UNKNOWN` geram `evidence_gaps` ligados ao job, análise e requisito. Obrigatórios recebem prioridade maior, sem transformar desconhecimento em ausência.

O gap aparece na aba Análise da oportunidade e em Revisões pendentes. O usuário escolhe: nunca usou, apenas conhece, curso, laboratório, projeto ou profissional; pode descrever onde e como. A escolha cria evidência contextual ou negativa confirmada, resolve o gap e marca a análise como desatualizada. A UI solicita uma nova análise, preservando a anterior.

Coverage e Confidence podem aumentar quando uma lacuna recebe evidência pertinente. “Nunca usei” pode produzir `NO_MATCH`; curso/lab permanecem mais fracos que produção profissional.
