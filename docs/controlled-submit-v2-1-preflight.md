# Controlled Submit V2.1 - preflight

Data: 2026-08-23. Baseline: `22f78f41cb09576115bed2dfc84215aad6f0cf44`.

Escopo travado: fechar o caminho Greenhouse, manter os demais ATS sem submit, não executar candidatura externa e não refatorar globalmente `server.mjs`.

| Problem | Current behavior | Risk | Production fix | Test | Frontend impact |
|---|---|---|---|---|---|
| Transport | `ControlledSubmissionService` recebe somente `DisabledSubmissionTransport` no runtime | Nenhum provider alcança o boundary real | Transport roteado pelo `AdapterRegistry`, com Greenhouse como único provider habilitável | Target Greenhouse local controlado percorre o serviço real | Estado disponível/desabilitado vem do backend |
| Kill switch | Variável lida no Node, ausente no Compose | Configuração operacional incompleta | `CAREER_SUBMISSION_ENABLED=${CAREER_SUBMISSION_ENABLED:-false}` e exigência adicional de runtime de produção | Default OFF e test mode bloqueado mesmo com env true | Mensagem de instalação desabilitada, sem tratar como erro |
| Job open | Gate usa lifecycle persistido | Vaga pode fechar após o preview | Consulta pontual à API pública oficial Greenhouse no preview final e antes do click | OPEN, CLOSED, UNKNOWN e ERROR | Exibe autoridade e instante da verificação |
| Inspection | Health/DOM não expiram | Formulário antigo pode mudar | Inspeção fresh documentada em 5 minutos para preview e repetida no submit | DOM alterado invalida preview sem click | Mostra freshness e CTA para atualizar revisão |
| Consent | Snapshot não explicita todas as referências live | Mudança de target/form pode escapar da revisão | Hash inclui identidade do job/target, referência do job check, ResumeVersion/artefato, DOM e form snapshot; o inspection ID volátil fica apenas na auditoria | Resume, answers, target e DOM stale | Confirmação continua específica e inequívoca |
| Idempotency | Reuso global da key não confere application | Key pode devolver attempt de outro escopo | Reuso somente na mesma application; conflito retorna 409 | Double click e scope conflict | Um clique fica loading; erro de conflito é explícito |
| Receipt | URL/metadata entram com validação mínima | Scheme perigoso ou payload excessivo | URL parser, HTTPS externo, HTTP somente loopback/fixture, allowlist e texto minimizado | `javascript:`/`file:` rejeitados; token/cookie descartados | Link aparece somente quando sanitizado |
| Uncertain | Verify não encerra o attempt | Lock e estado podem ficar indefinidos | Verificação conservadora e reconciliação manual SENT/NOT_SENT | Dois caminhos E2E, nunca retry automático | Quatro ações claras e feedback de resolução |
| WAITING_USER | Browser fecha salvo em READY não headless | Login/challenge não é retomável | Registry de sessão em memória, TTL de 10 minutos e resume; headless explica handoff indisponível | Preserve/resume/expire | Mostra disponibilidade, expiração e orientação |
| CI deploy | Push em main atualiza checkout antes de testes | Commit quebrado pode chegar ao runtime | Job `test` independente; deploy depende dele e só então atualiza checkout | Validação estrutural do workflow | Sem impacto visual |
| ZIP ignore | Regra final `.zip` é incorreta e pouco específica | Export pode ser commitado | Regras para `tmp/audit-export`, `artifacts`, exports e ZIPs gerados, preservando fixtures deliberadas | Audit export limpo | Sem impacto visual |

## Arquitetura preservada

`Application Workspace -> SubmissionPreflight -> SubmissionConsentService -> ControlledSubmissionService -> AdapterSubmissionTransport -> GreenhouseAdapter`.

O backend deriva application, target, adapter e Resume Artifact. O frontend não envia URL, path, adapter nem HTML. O transport de teste aceita somente loopback/fixture e o runtime externo exige kill switch, modo de produção e host Greenhouse oficial.

## Schema

A migration 019 já possui preflights versionados, consent hash, attempts, lock, receipt e JSON minimizado. V2.1 guarda referências fresh dentro do snapshot versionado e dos gates. A reconciliação negativa usa `FAILED` com `failureClass=RECONCILED_NOT_SUBMITTED`; a positiva usa `SUBMITTED` e receipt `MANUAL_VERIFIED`. Portanto migration 020 não é necessária.

## Trust boundaries

- Entrada HTTP: somente application ID, consent token e idempotency key com limites.
- Target: resolvido no backend e validado contra identidade Greenhouse persistida/oficial.
- Browser: sem stealth, export de cookie, CAPTCHA/MFA bypass ou persistência de sessão.
- Receipt/eventos: allowlist, hashes e referências; sem respostas, cookies, headers, tokens ou HTML bruto.
- Testes: target local controlado; rede externa nunca recebe ação de submit.
