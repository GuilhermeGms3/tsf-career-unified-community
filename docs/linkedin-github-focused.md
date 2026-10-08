# LinkedIn discovery e evidência GitHub persistente

## Escopo e arquitetura

Fase iniciada no commit `5fb8395`. Node ESM (Docker Node 22; host 24.11.1), SQLite nativo e career-engine Python 3.12 com python-jobspy 1.1.82. Não altera Decision Policy v2.1, thresholds, semântica de gaps, geografia, Resume Batch, identidade documental, EvidenceGuard ou submission.

## GitHub

O índice e sua projeção no Candidate Knowledge já existiam. A migration 024 acrescenta snapshots versionados por sync, com referência da conta, timestamps, versão do detector, resumo e evidências/proveniência sem arquivos-fonte. A execução explícita usa somente GitHub REST GET, o cofre AES-GCM existente ou `GITHUB_TOKEN` no ambiente. Token nunca retorna à UI; o indicador GitHub é apenas “Configurado”. Testar uma credencial nova não modifica a credencial usada por sync concorrente.

`POST /api/candidate-knowledge/providers/github/sync` deduplica chamadas simultâneas. O índice é incremental, com HEAD/no-op, filtro de artefatos antes do limite, paths antigos de rename e isolamento de falhas por repositório. Um sync incompleto preserva evidências anteriores; repositórios ausentes de uma enumeração completa bem-sucedida são desativados sem apagar histórico. `SYNCING` interrompido é apresentado como erro, sem iniciar rede automaticamente.

`GET /api/candidate-knowledge/providers/github` lê somente SQLite. Matching, comparação e Resume Batch reutilizam essa leitura local. O teste de restart executa cinco análises posteriores sem aumentar as chamadas ao cliente GitHub.

Meu Perfil → Evidências e conexões oferece sync, última atualização, tecnologias detectadas e recalibração local explícita. “Não detectado” não significa desconhecimento. `POST /api/candidate-knowledge/providers/github/recalculate` usa as mesmas vagas e o Matcher determinístico, sem Ollama, rede ou mudança de thresholds. O token real estava NOT_CONFIGURED durante a implementação: não se afirma sync real ou benefício factual para a conta do usuário.

## LinkedIn: investigação e decisão

Caminho: Search Intent → planner familiar → JobHunt → JobSpyProvider → career-engine `/jobs/search` → JobSpy LinkedIn guest Jobs → normalização → identidade/fontes → PreMatch → Matcher/Opportunity.

O planner existente mantém aliases da taxonomia. Exemplos: SUPPORT “Analista de Suporte”, INFRASTRUCTURE “Analista de Infraestrutura”, NETWORK_NOC “Analista de Redes”, DEVOPS_SRE “DevOps Engineer”, BACKEND “Backend Developer”. Não foi demonstrado que as strings precisassem ser reescritas. LOCAL_DF continua location Brasília/DF, remote=false; REMOTE_BRAZIL continua Brasil, remote=true. `hours_old=168` no experimento; o pedido limita `results_wanted` e o JobSpy pagina internamente (25 cards/página, limite interno start<1000). Deadline isolado do portal permanece 30 s, engine 70 s, transporte 85 s por default.

Baseline preservado: 10 tentativas LinkedIn, 1 sucesso, 9 timeouts, 10 resultados, 307.115 ms acumulados. Ele não isolava a causa dos timeouts.

Experimento pequeno: mesma query “Analista de Suporte”, Brasília, três resultados, sem remoto e sem retries. Com descrições: 4.023 ms, uma busca + três descrições. Sem descrições: 1.311 ms, uma busca, três resultados. Total: cinco requests HTTP. Isso demonstra custo de descrição nesta amostra, não prova a causa de cada timeout histórico nem ganho de cobertura no mercado inteiro.

O novo caminho descobre metadados sem descrição e enriquece no máximo três vagas com família reconhecida por busca, dentro do tempo restante. O endpoint interno usa ID numérico, origem fixa, timeout de 5 s e não segue redirects. Uma descrição ausente, falha ou timeout não remove a vaga. O cache SQLite por job ID dura 24 h; leituras, navegação, matching e recalibração não enriquecem. O cache não significa verificação da disponibilidade atual de uma vaga.

Telemetria separa resultados brutos, perdas de normalização, HTTP attempts concluídos do worker (incluindo retries), enriquecimento/cache/falhas e classificação. Se o worker for terminado antes de responder, a contagem HTTP é desconhecida, não zero. Health recente distingue HEALTHY/DEGRADED/TIMING_OUT/NO_RESULTS e nunca desabilita permanentemente a fonte.

## Ollama opcional e limite de capacidade

JobSpy acessa LinkedIn Jobs, não feed privado de recrutadores. Posts podem entrar pela captura manual existente, sem login, cookies, bypass ou nova coleta. Um gate determinístico reutiliza sinais de contratação e combina papel/contexto; posts técnicos, eventos e anúncios de novo emprego são negativos nos fixtures. Casos claros não usam modelo. Ambíguos permanecem POSSIBLE_JOB_POST caso a ampliação semântica falhe.

O resolvedor usa IntelligenceService existente, apenas endpoint local permitido, um request por candidato, concorrência 1, timeout 5 s, até três reservas por run e três por janela global de 60 s. O teto é conservador; não foi benchmarkado em hardware/modelo real disponível. Cache persistente considera conteúdo normalizado, versão do gate/prompt e configuração dos modelos; tarefas idênticas em voo são compartilhadas. Campos extraídos são substrings literais ou null; URL fabricada e JSON inválido são rejeitados. Confiança do modelo não vira conhecimento, fit ou decisão.

Calibração inicial de dez fixtures: quatro positivos claros, quatro negativos claros e dois ambíguos (duplicados). Uma chamada ao resolvedor de teste e uma deduplicação; nenhum falso positivo/negativo no gate para esse conjunto pequeno. Releitura posterior dá cache hit. Isso é validação determinística com modelo simulado, não medição da precisão de um LLM real.

## Proveniência

`provenance.sourceAttribution` separa `discoveredVia` de `applicationProvider` (GUPY/GREENHOUSE/LEVER/ASHBY/WORKDAY/UNKNOWN), por hostname exato/sufixo. Não faz crawling nem cria adapters. URLs de origem e candidatura são preservadas separadamente; fontes se acumulam no merge. A URL estável de LinkedIn permite reutilizar o registro quando enriquecimento revela identidade ATS mais forte. Não se mesclam automaticamente duas vagas só por título/empresa parecidos.

## Verificação

Testes focados: `tests/linkedin-github-focused.test.mjs`, `tests/github-sync-frontend.test.mjs`, `tests/evidence-intelligence-github.test.mjs` e `engine/test_service.py`. Os testes Python rodam com rede desabilitada. Logs de execução ficam em `tmp/linkedin-github-*.log`, não versionados.

Fontes primárias: [JobSpy](https://github.com/speedyapply/JobSpy) (descrições acrescentam requests por vaga) e [GitHub REST repositories](https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user). A implementação instalada 1.1.82 foi inspecionada; não houve upgrade de dependência.

## Resultado final — 2026-08-27

- Suíte completa única: 776/776, 229.025 ms. Grupo focado ampliado: 193/194, apenas expectativa antiga do schema 23; compatibilidade corrigida e rerun de schema/migrações 4/4. Testes novos estão incluídos na suíte completa verde.
- Sintaxe JS: 350 arquivos. Python engine: três arquivos com sintaxe válida; oito testes offline. O script de medição Python também foi executado com sucesso.
- SQLite runtime: schema 24, integrity_check ok, foreign keys zero. App/engine healthy após uma build de cada serviço; hashes de componentes conferidos contra o checkout. Audit ZIP validado com 571 entradas; secret scan em 40 arquivos, zero padrões de token/chave encontrados.
- Novo caminho real: uma busca, três resultados, zero perdas de normalização; discovery HTTP 1, tempo completo da busca 2.188 ms (worker 1.570 ms). Três enriquecimentos falharam, mas três vagas permaneceram presentes. Total 5.764 ms com enriquecimento. A repetição controlada tentou novamente os três enriquecimentos sem sucesso. Total da fase: 12 requests HTTP LinkedIn (cinco iniciais + uma busca nova + seis enriquecimentos). Não há evidência de ganho de tempo total ou melhoria da taxa de enriquecimento; há prova de preservação dos resultados.
- GitHub real: NOT_CONFIGURED, zero syncs. Conjunto local de referência: 267 oportunidades, 1.019 ocorrências NOT_INDEXED nas análises mais recentes; 185 BLOCKED, 50 STRETCH, 29 REVIEW, 3 SKIP. Não foi recalculado fingindo novas evidências.
- ATS no conjunto local: Gupy 33, Lever 18, Workday 4, Ashby 1, Greenhouse 0, Unknown 211. Apenas leitura/detecção, sem adapters novos.
- Segurança runtime: CAREER_SUBMISSION_ENABLED=false, LIVE_INSPECT=false, applications/attempts/receipts/SUBMITTED=0. Sem Brave, paid API, login LinkedIn, instalação de Ollama ou discovery ampla. A precisão/latência de um modelo real e a calibração do teto de três chamadas permanecem não verificadas.
