# Candidate Knowledge V2 — modelo e autoridade

Candidate Knowledge é a memória factual e reutilizável controlada pelo candidato. Ela não é um JSON viewer, não substitui evidência e não autoriza a criação de claims.

## Unidade de conhecimento

Cada item em `candidate_facts` possui uma chave canônica estável e metadados próprios:

- `unit_type`: identidade, contato, localização, skill, ferramenta, tecnologia, experiência, formação, certificação, idioma, projeto, preferência, fato ou resposta de candidatura;
- `verification_status`: `SYSTEM_EXTRACTED`, `USER_CONFIRMED`, `IMPORTED_CONFIRMED`, `REVIEW_REQUIRED` ou `REJECTED`;
- `confidence`: confiança da extração/normalização, independente da verificação;
- `reuse_policy`: `REUSABLE`, `REUSABLE_WITH_CONFIRMATION`, `APPLICATION_SPECIFIC`, `SENSITIVE_CONFIRM_EACH_TIME` ou `NEVER_AUTO_REUSE`;
- `lifecycle_status`: `ACTIVE`, `REJECTED`, `ARCHIVED` ou `LEGACY_READ_ONLY`;
- provenance: tipo, identificador e versão da fonte somente quando conhecidos;
- `raw_text`: texto original preservado, sem substituir o valor estruturado;
- timestamps de criação, confirmação, atualização e último uso.

Skills e termos seguros usam aliases do normalizador do Matcher. `MS Azure`, `Microsoft Azure` e `Azure` apontam para `skill.azure`; `Docker` e `Docker Compose` permanecem distintos. Reclassificações determinísticas podem criar uma unidade de outro tipo, mas ficam `REVIEW_REQUIRED` quando ainda exigem julgamento humano.

## Autoridade e sincronização

| Componente | Papel | Mutabilidade |
| --- | --- | --- |
| CandidateProfile | captura de identidade e preferências no formulário central | editável pelo usuário |
| Candidate Knowledge | memória factual/reutilizável e política por unidade | editável, rejeitável e arquivável com histórico |
| ResumeSpec | representação normalizada de um currículo | artifact de preparação, sujeito a revisão |
| ResumeVersion | snapshot exato de uma versão | imutável |
| Candidate Answer Memory | respostas confirmadas para perguntas ATS | editável; reutilização depende de categoria e sensibilidade |

O perfil projeta fatos para Candidate Knowledge. Rejeições e arquivos humanos não são reativados automaticamente; somente arquivos com proveniência comprovada de `PROFILE_RECONCILIATION` podem retornar quando o valor reaparece no perfil. A precedência persistida é `USER_CONFIRMED > IMPORTED_CONFIRMED > SYSTEM_EXTRACTED`. Uma fonte menos autoritativa divergente registra `candidate_fact_conflicts` como `REVIEW_REQUIRED`, sem overwrite. Reutilização para análise não autoriza autofill externo: este exige confirmação e política de campo elegível, inclusive no ponto final de escrita. Veja [hardening de autoridade e estado](targeted-authority-state-hardening.md).

ResumeSpec e ResumeVersion nunca viram automaticamente a fonte factual autoritativa. Candidate Knowledge preserva o vínculo com a origem, e EvidenceGuard continua validando claims e `evidenceIds` antes de qualquer tailoring.

## Migração 012

`012_candidate_knowledge_v2.sql` é aditiva. Ela acrescenta metadados V2 e cria histórico, conflitos e uso. `CandidateKnowledgeMigrator` explode os agregados reais `PROFILE.SKILLS`, `PROFILE.LANGUAGES`, `PROFILE.CERTIFICATIONS`, `PROFILE.PROJECTS`, `PROFILE.EXPERIENCE` e `PROFILE.EDUCATION` em transação.

O migrador:

- não altera migration antiga;
- preserva valor estruturado, `rawText`, origem, confiança e confirmação;
- não promove `SYSTEM_EXTRACTED` para `USER_CONFIRMED`;
- mantém o agregado como `LEGACY_READ_ONLY` depois do backfill;
- é idempotente por chave canônica;
- não cria unidade para array vazio;
- não apaga dados legados.

Rollback de aplicação pode ignorar as novas colunas e tabelas. Rollback físico de schema SQLite não é automatizado; preserve o arquivo e o backup antes de downgrade.

## Consumidores

- Application Engine sincroniza o perfil, consulta fatos ativos pela `CandidateKnowledgeBase.fromFacts()` e aplica a policy antes de classificar `KNOWN` ou `USER_REQUIRED`.
- Candidate Answer Memory só reutiliza resposta verificada, permitida e não sensível. Consentimento e texto contextual continuam específicos.
- Matcher recebe fatos granulares, mas deduplica evidência semanticamente entre perfil, currículo e Candidate Knowledge. Uso é registrado somente quando a evidência participa de `MATCH`/`PARTIAL_MATCH`.
- Resume base/evidence provider pode ler as mesmas unidades granulares. ResumeTailor e EvidenceGuard mantêm os vínculos de evidência e revisão obrigatória.

Conhecimento disponível não equivale a permissão para inventar claim.

## Segurança e API

`GET /api/candidate-knowledge` retorna somente `summary`, `sections` e `gaps`; valores sensíveis, provenance detalhada, IDs internos de objetos legados e blobs agregados não fazem parte da listagem. `GET /api/candidate-knowledge/facts/:key` retorna o detalhe de uma unidade e mantém valor sensível mascarado. O contrato anterior permanece disponível apenas por `?format=legacy` para consumidores locais em transição.

Mutations aceitam tipos e campos permitidos, limitam tamanhos e reaplicam policy no backend. A UI usa `textContent`/escape e nunca renderiza HTML vindo do dado. Candidate Knowledge não é incluída em eventos n8n ou WhatsApp.

## Invariante no Discovery V4

`OpportunityLead` e `HiringSignal` descrevem evidências externas sobre uma oportunidade; nunca viram fatos do candidato. A promoção humana cria uma oportunidade canônica, mas somente os consumidores existentes de Candidate Knowledge podem calcular match ou fornecer evidência para currículo. O Discovery V4 não infere, confirma nem sobrescreve conhecimento do candidato.
