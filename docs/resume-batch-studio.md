# Resume Batch Studio

## Fluxo

O Resume Batch Studio transforma uma seleção temporária de até 25 oportunidades e 10 currículos em um workflow persistente. A seleção não altera feedback, interesse ou decisão da oportunidade. A base escolhida pelo usuário é o padrão; recomendações nunca a substituem automaticamente.

1. Selecione oportunidades em Recomendadas, Vale revisar, Stretch ou Todas.
2. Escolha uma base, currículos adicionais, idioma, saídas, destino pós-preparo e, opcionalmente, aprovação automática dos itens sem alertas.
3. Revise a matriz vaga × currículo e confirme uma base por vaga.
4. O tailoring roda em pool limitado e para em `TAILORING_REVIEW_REQUIRED`, salvo quando o usuário ativou a aprovação automática e o item passou em EvidenceGuard e qualidade `PASS`.
5. Depois da aprovação factual, cada item cria uma `ResumeVersion` imutável e para em `VERSION_REVIEW_REQUIRED`; o mesmo opt-in permite aprovar e renderizar automaticamente somente itens sem alertas.
6. Somente versões aprovadas são renderizadas. PDF, LaTeX e ZIP Overleaf usam o Resume Document Engine existente.
7. O ZIP do batch contém somente artefatos solicitados e um `manifest.json` com hashes, itens e ausências explícitas.

Falhas ficam isoladas por item. Um batch pode terminar em `PARTIAL_SUCCESS` sem descartar currículos prontos. Revisão, rejeição, render e retry também têm ações individuais. As células da matriz expõem métricas e lacunas produzidas pelo Matcher/Gap Engine existente, sem reinterpretar NOT_INDEXED como incompetência.

A fila ativa permanece visível em um painel lateral global enquanto o usuário navega. O painel narra a etapa e a vaga atuais, mostra progresso e qualidade editorial e pode ser minimizado sem cancelar o trabalho. Mesmo quando o destino pós-preparo permite a política de AutoApply, somente um currículo com quality gate `PASS`, versão aprovada e PDF válido pode atravessar o dispatcher; alertas editoriais continuam em revisão humana.

O opt-in de aprovação sem abrir os detalhes é por lote e começa desligado. Ele não substitui a escolha do currículo-base por vaga, nem libera um changeset inválido ou uma regressão de nota. O envio externo continua dependendo da política ATS, do consentimento aplicável e do preflight final.

```text
Oportunidades → seleção → ResumeBatchRun / ResumeBatchItem
                              ↓
                  Analysis pool → matriz / cache
                              ↓
                   escolha humana por vaga
                              ↓
                  Tailoring pool → EvidenceGuard
                              ↓
                        revisão humana
                              ↓
                    Build pool → ResumeVersion
                              ↓
                        revisão humana
                              ↓
                 Render pool (limite global: 2)
                         ↙    ↓     ↘
                       PDF  LaTeX  Overleaf
                              ↓
                      ZIP com manifesto
```

## Integridade de ResumeVersion

`purpose` distingue `GENERIC` de `JOB_SPECIFIC`. A equivalência genérica usa currículo, conteúdo, template e idioma. A equivalência específica inclui também a vaga. Assim, conteúdo idêntico para duas vagas gera versões distintas, enquanto uma repetição para a mesma vaga reutiliza a versão equivalente.

Versões específicas podem registrar `batchRunId` e `batchItemId`, além de candidatura, tailoring, algoritmo e proveniência. Campos opcionais não são inventados durante a migração; versões históricas só são classificadas como específicas quando já possuem `job_id` confiável.

## Concorrência, idempotência e recuperação

Pools conservadores pertencem ao servidor: comparação 4, tailoring 1–2 conforme hardware, build 4 e Tectonic 2. O limite de render é compartilhado com os jobs documentais individuais, e chamadas para a mesma versão são serializadas. SQLite continua sob a conexão/lease principal; nenhum worker thread recebe conexão própria. O Matcher síncrono não ganha paralelismo de CPU; os slots permitem sobrepor etapas assíncronas.

Os pumps preenchem os slots disponíveis, consultam filas persistentes e voltam a trabalhar depois de cada conclusão. Após adquirir o owner lease exclusivo, a inicialização recupera jobs interrompidos, inclusive recentes; renders interrompidos ficam repetíveis. Os workers começam automaticamente depois da composição dos serviços. `REVIEW_REQUIRED` é espera humana terminal para polling, não falha nem timeout. Navegar para outra rota interrompe o polling da tela anterior, sem cancelar trabalho persistido.

Jobs técnicos equivalentes em `QUEUED` ou `RUNNING` são reutilizados. Comparações concluídas usam hash da vaga, currículo, perfil, conhecimento, evidência GitHub local, Family Fit e versão do Matcher. Tailoring possui identidade determinística por item/base/análise; criação do changeset e avanço do item são atômicos. Build reutiliza a identidade contextual da versão; render reutiliza artefatos READY; Overleaf reutiliza export com o mesmo hash da fonte.

Pedidos sem PDF geram fonte sem consultar Tectonic. Overleaf é exportação local, não upload. O ZIP usa sufixo determinístico por item, evitando colisões entre vagas com empresa/cargo iguais, e declara saídas ausentes. A fixture estável do cache Tectonic inclui também fonte de corpo em negrito; runtime continua `--untrusted --only-cached`.

## Validação reproduzível

Testes focados: `node --test tests/resume-batch-studio.test.mjs tests/resume-batch-frontend.test.mjs tests/resume-document-engine.test.mjs`.

`node scripts/validate-resume-batch.mjs` executa um lote sintético com duas vagas, comparação, duas revisões explícitas, Tectonic real, extração no career-engine local e ZIP. Requer o ambiente Docker já provisionado. Usa banco temporário e remove todos os artefatos de fixture; não acessa discovery, empregadores ou dados de candidatura reais.

Validação em 2026-08-27: fixture real concluída em 3.518 ms com dois renders simultâneos e todos os formatos prontos; testes focados 113/113. A única regressão completa teve 744/754; dez expectativas antigas de schema, navegação e formatação foram corrigidas e passaram em rerun 10/10. Não houve segunda suíte completa. Sintaxe de 343 arquivos, SQLite/FK, Docker app/engine e secret scan passaram. O smoke interativo foi bloqueado pela política do navegador; os testes frontend com fixtures e a API foram validados sem contornar esse bloqueio.

## Segurança

- EvidenceGuard bloqueia aprovação em lote se alguma mudança não estiver `VALID`.
- O backend valida IDs, listas, formatos, template, idioma e limite do batch.
- Nomes de empresa/cargo são sanitizados antes de virar caminho no ZIP.
- Logs `RESUME_BATCH` são sanitizados e filtráveis por batch, item, vaga e currículo.
- O fluxo não envia candidaturas e não ativa APIs pagas, login LinkedIn, Live Inspect ou Ollama.
