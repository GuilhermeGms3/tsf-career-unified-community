# Application Engine V2 + Gupy V1 — Homologação

Data: 2026-08-23. Veredito: **COMPLETE WITH ADAPTER BLOCKERS**.

## 1. Escopo

Fundação de controlled submission, Gupy V1 assistida e paridade do workspace. LinkedIn, Workday, discovery novo, outreach e submit real ficaram fora.

## 2. Baseline preservada

Planner, Application, ResumeVersion, Candidate Knowledge, perguntas, inspeções, fila e eventos foram estendidos; nenhum motor paralelo foi criado.

## 3. Migration

Schema 019 aditivo com preflight, consent, attempt/lock e receipt. Upgrade 18→19 preserva Application/eventos e mantém `foreign_key_check=0`.

## 4. Preflight central

Uma avaliação server-side versionada compõe todos os gates e persiste snapshot/hash sem dados secretos.

## 5. Elegibilidade e conhecimento

`NOT_ELIGIBLE` bloqueia; dúvida exige usuário. Gaps de evidência permanecem visíveis e respostas sem base não são inventadas.

## 6. Perguntas

Required desconhecida e knockout permanecem `USER_REQUIRED`. Resposta alterada invalida consentimento anterior.

## 7. Dados sensíveis

Exigem resposta humana específica; a preview mostra somente “Resposta fornecida (oculta)”.

## 8. Currículo

A Application fixa ResumeVersion. Hash, raiz, status do PDF e EvidenceGuard são revalidados antes da preview.

## 9. Duplicidade e vaga aberta

Receipt/Application submetida com mesma identidade bloqueia. Vaga fechada bloqueia; estado desconhecido exige revisão.

## 10. Adapter e DOM

Capability, saúde, inspeção recente e confiança alta são gates separados. DOM desconhecido degrada sem adivinhação.

## 11. Sessão e challenges

Login, MFA, CAPTCHA, anti-bot e verificação geram handoff humano; não há bypass nem armazenamento de sessão.

## 12. Kill switch e rate limit

Envio é false por padrão e limitado a cinco tentativas/hora. A preview continua disponível para diagnóstico mesmo quando o transporte está desligado.

## 13. Consentimento

Token aleatório de uso único, TTL, escopo por Application/ResumeVersion/snapshots e persistência apenas de SHA-256.

## 14. Idempotência e lock

Chave repetida reutiliza a tentativa. Um lock impede double click e concorrência por candidatura.

## 15. Estado incerto

Falha/crash pós-ação vira `SUBMISSION_UNCERTAIN`; não há retry automático. Pré-ação vira `FAILED` e libera lock.

## 16. Receipt

Só nasce após confirmação; liga provider, horário, ResumeVersion e hash de respostas. Fixture positiva foi validada.

## 17. Frontend

Resumo, Formulário, Perguntas, Currículo, Preflight, Revisão final, Tentativas e Timeline usam contratos reais. Consentimento e enviar são ações separadas.

## 18. Greenhouse, Lever e Ashby

Detect/inspect/fill/validate continuam cobertos até `READY_TO_SUBMIT`; `canSubmit=false` e transporte real ausente.

## 19. Gupy sintética

Quinze testes cobrem identidade, detect, campos, multi-step, upload, sensitive, knockout, CAPTCHA, DOM alterado e confirmação. Nenhum teste clica submit.

## 20. Gupy pública real

Target auditado: `https://vempra.gupy.io/candidates/jobs/11893666/apply?jobBoardSource=gupy_public_page`. Resultado: ATS Gupy, adapter V1, variante multi-step, zero campos, `supported=false`, confiança 0,5, fill não solicitado. Parada em INSPECT; FILL/VALIDATE/PREFLIGHT/READY externos não foram alcançados.

## 21. Segurança e privacidade

Migration sem senha/cookie/token plaintext; eventos sem respostas; consent token fora de logs; fixtures usam apenas `.test`; audit export exclui runtime/PII.

## 22. Validação

Suite completa: 574/574. Suites dedicadas: Application V2 28/28 e Gupy 15/15. Playwright 130/130; Candidate Knowledge 52/52; Intelligence 68/68; Resume 19/19; Experience 16/16. Demais validators de Discovery, Source Center, ATS e Automation passaram.

## 23. Conclusão e próximo marco

A fundação está completa e segura para integração futura, mas **não está pronta para candidatura real**. Próximo marco recomendado: homologar um transporte por adapter, começando por provider com página estável e receipt verificável; Gupy precisa de nova auditoria de sessão/DOM real antes de qualquer `canSubmit=true`.

## Acceptance checklist (48 itens)

| # | Critério | Resultado |
|---:|---|---|
| 1 | Estende V1 sem motor paralelo | SIM |
| 2 | Migration aditiva | SIM |
| 3 | Upgrade 18→19 testado | SIM |
| 4 | FK íntegra | SIM |
| 5 | Preflight central | SIM |
| 6 | Gate de estado | SIM |
| 7 | Gate de elegibilidade | SIM |
| 8 | Gate de gaps | SIM |
| 9 | Gate de perguntas | SIM |
| 10 | Gate de sensíveis | SIM |
| 11 | ResumeVersion exata | SIM |
| 12 | Hash de artefato | SIM |
| 13 | EvidenceGuard integrado | SIM |
| 14 | Duplicata canônica | SIM |
| 15 | Vaga fechada/unknown | SIM |
| 16 | Capability via registry | SIM |
| 17 | Saúde do adapter | SIM |
| 18 | Confiança DOM | SIM |
| 19 | Login handoff | SIM |
| 20 | MFA handoff | SIM |
| 21 | CAPTCHA handoff | SIM |
| 22 | Sem bypass | SIM |
| 23 | Kill switch false por padrão | SIM |
| 24 | Rate limit | SIM |
| 25 | Preview sem submit | SIM |
| 26 | Consentimento específico | SIM |
| 27 | Token não persistido em plaintext | SIM |
| 28 | Consentimento expira | SIM |
| 29 | Snapshot alterado invalida consent | SIM |
| 30 | Idempotency key obrigatória | SIM |
| 31 | Double click deduplicado | SIM |
| 32 | Lock por Application | SIM |
| 33 | Crash pré-ação recuperado | SIM |
| 34 | Pós-ação vira uncertain | SIM |
| 35 | Sem retry cego | SIM |
| 36 | Receipt somente confirmado | SIM |
| 37 | Eventos append-only | SIM |
| 38 | UI Preflight | SIM |
| 39 | UI Final Review | SIM |
| 40 | UI estado incerto | SIM |
| 41 | UI receipt | SIM |
| 42 | Gupy detect/identity | SIM |
| 43 | Gupy inspect/fill sintético | SIM |
| 44 | Gupy sensitive/unknown conservador | SIM |
| 45 | Gupy submit proibido | SIM |
| 46 | Gupy real chega a form fields | NÃO — DOM público atual expôs zero campos |
| 47 | Transporte externo homologado | NÃO — desabilitado por decisão do marco |
| 48 | Candidatura real enviada | NÃO — proibida no escopo |
