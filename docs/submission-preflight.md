# Submission Preflight

O preflight central persiste uma avaliação versionada e um hash do snapshot. Os gates são: estado, elegibilidade, gaps de evidência, perguntas, perguntas sensíveis, ResumeVersion/artefato/EvidenceGuard, duplicata, vaga aberta, capability e saúde do adapter, confiança do DOM, sessão/challenges, rate limit, kill switch e consentimento.

`BLOCKED` representa impedimento objetivo; `WAITING_USER` representa confirmação ou dado ausente; `READY` representa evidência suficiente. A preview pode ser produzida mesmo com submit externo indisponível, mas consentimento só é oferecido quando adapter e runtime permitem o envio.

Para Greenhouse, o preflight final é fresh: consulta o estado público da vaga, abre o formulário novamente, recalcula assinatura/estrutura e só aceita inspection dentro da janela de cinco minutos. `UNKNOWN`, `ERROR`, vaga fechada, DOM divergente, baixa confiança ou challenge bloqueiam o clique.

Qualquer mudança nas respostas, currículo, artefato, vaga, estrutura do formulário ou gates altera o hash e invalida consentimento anterior. Timestamps e IDs voláteis não entram no hash semântico.
