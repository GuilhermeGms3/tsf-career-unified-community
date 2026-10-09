# Fontes, autenticação e observabilidade

## Escopo

Base: `05e35ce`, main limpa. Stack preservada: Node ESM, SQLite nativo, Playwright 1.61.0 e SPA vanilla. Sem novas dependências. Python/career-engine, decisões, thresholds, geografia, Candidate Knowledge, ResumeVersion, Document Engine e gates de envio não foram redesenhados.

`/connections` é a entrada operacional. `connectionCapabilities()` projeta onboarding e adapters existentes, com o contrato limitado do Gupy V2 sem mudar o adapter legado V1. `SourceReadinessService` atende a tela e os itens do Application Batch. Autenticação, saúde e capacidades são independentes; READY não significa uma homologação remota nova. GET usa somente estado local.

Cobertura: JobSpy, Indeed, LinkedIn, Glassdoor, Google Jobs, Greenhouse, Lever, Ashby, SmartRecruiters, Workable, IEL, ProgramaThor, Sólides, Recrutei, Gupy, Workday, GitHub, WhatsApp, Vagas.com.br, Catho, InfoJobs, Eureca, GeekHunter, Remotar, Nerdin e páginas genéricas. Brave permanece pago opcional, sem exigência ou degradação. Workday declara PER_TENANT_SESSION, mas não possui adapter de candidatura. LinkedIn permanece público/limitado, NOT_MANAGED e MANUAL_CAPTURE para posts. WhatsApp continua no gerenciador legado em Integrações.

## Login Gupy: Windows + Docker

Instalação por usuário, executada uma vez na pasta do projeto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-source-auth.ps1
```

Abra o aplicativo em Chrome/Edge e use **Cofres → Gupy → Entrar**. O Windows pode pedir autorização para abrir o aplicativo externo. A conexão da conta não exige escolher empresa; quando o fluxo vier de uma candidatura, o jobId continua preservado para manter o contexto. A empresa é validada separadamente apenas ao preparar uma vaga.

### Atualização direcionada de UX (2026-08-28)

O contrato atual e a validação desta fase estão em [Autenticação Gupy e apresentação PT-BR](gupy-auth-presentation-pt-br.md). As verificações no fim deste documento descrevem a fase anterior.

Criar um pedido não inicia o login: `LAUNCH_PENDING` aguarda claim do auxiliar; só o claim gera `AUTH_IN_PROGRESS`. `BROWSER_OPENED` confirmado gera `USER_ACTION_REQUIRED`; a verificação positiva de estado passa por `SESSION_VALIDATING` antes de `SESSION_ACTIVE`. Falhas e expiração são terminais; a nova tentativa recebe outro ID/ticket. Leitura/poll aplica prazo de abertura de 20 s, lease do auxiliar de 30 s e prazo de validação de 45 s; a tentativa dura no máximo dez minutos.

O painel restaura o último pedido relacionado à empresa selecionada no GET, sem criar outro. Metadados públicos incluem datas de solicitação/claim/janela/heartbeat, evento e código sanitizado de falha. Nunca incluem ticket, cookies ou credenciais. O painel oferece instruções e comando temporário para executar `source-auth-launch.ps1` diretamente, independente do protocolo. Após recarregar a página, o ticket não é recuperável: use **Tentar novamente** para obter outra autorização. Não compartilhe esse comando.

O protocolo `career-unified-auth` inicia `source-auth-runner.mjs` com ticket aleatório de 256 bits, válido por dez minutos e armazenado somente como hash no servidor. Claim e conclusão têm estados e proteção de replay. O runner aceita parâmetros tipados, origem loopback e nenhuma instrução de shell arbitrária.

O auxiliar abre o Google Chrome instalado como processo normal e visível, com um diretório de perfil temporário exclusivo, e conecta o Playwright por CDP somente para observar a navegação autorizada. Não lê perfis Chrome/Edge/Firefox já existentes nem seus cofres de senhas. O usuário opera credenciais, CAPTCHA e MFA. Uma página central autenticada precisa de evidência positiva; URL sem formulário de senha não basta. O servidor faz uma segunda verificação independente antes de aceitar SESSION_ACTIVE.

Estado reutilizável vai para o CredentialVault AES-256-GCM já existente, com chave separada. SQLite recebe somente referência, escopo da conta, estado e datas. O contexto temporário é fechado/removido; não há perfil completo persistido/exportado. Somente cookies seguros compartilhados de `.gupy.io` são aceitos; cookies de terceiros e origens de storage são descartados.

Application Batch entrega esse estado a `BrowserManager.newContext`, sem iniciar trace. A autenticação é de **conta Gupy**, persistida sob `gupy.io` e reutilizável entre empregadores. Isso não prova acesso a uma empresa: o adapter ainda valida o portal da vaga ao preparar cada candidatura. Validade local máxima de 24h; auth/challenge visto pelo adapter interrompe o item com segurança.

Reautenticação retoma somente WAITING_USER por auth, com retry permitido. Preserva respostas, ResumeVersion, identidade e posição; nunca retoma submissão incerta. Desconectar invalida tickets, remove a sessão compartilhada da conta e fecha contextos Gupy, preservando histórico, oportunidades, evidências e documentos.

O protocolo fica em `HKCU\Software\Classes\career-unified-auth`, sem porta adicional. Desinstalação: remover somente essa chave específica, não o projeto nem seus dados.

### Limitações de autenticação verificadas

- O protocolo Windows foi instalado e o auxiliar abriu o Chrome normal com perfil isolado. Uma autenticação manual chegou ao portal central `portal.gupy.io/my/applications`; nenhuma credencial foi lida ou persistida pelo sistema.
- Probes controlados comprovaram que os cookies seguros compartilhados de `.gupy.io` bastam para restaurar a página central autenticada. Cookies específicos de empregador, localStorage, IndexedDB e sessionStorage não foram necessários e não são persistidos.
- O segundo probe no contêiner foi corrigido para usar o caminho fixo dos browsers Playwright; Chromium iniciou e o portal sem sessão redirecionou corretamente ao login.
- Depois das correções finais, a tentativa acompanhada terminou sem o usuário concluir o login. Portanto, o ciclo real `SESSION_ACTIVE`, a persistência no cofre, a revalidação após restart e o acesso a uma empresa real ainda não estão homologados ponta a ponta.
- A detecção positiva depende da página central de candidaturas e de texto/controle autenticado. Mudanças na UI da Gupy podem exigir adaptação conservadora.

## GitHub

Com `GITHUB_OAUTH_CLIENT_ID` de um App com device flow habilitado: endpoints oficiais, polling com intervalo/slow_down, timeout e device code cifrado. Escopo solicitado read:user; não solicita escrita para obter evidências. Acesso privado depende das permissões reais concedidas.

Sem esse App: abre a página oficial para token e oferece fallback avançado fine-grained somente leitura. Nunca solicita a senha GitHub. A intenção SYNC persiste durante a autenticação e continua após validação/salvamento. Credencial válida sincroniza diretamente. Desconexão também bloqueia fallback do token de ambiente nesta conexão, sem remover conhecimento anterior.

Nenhum token/App real estava configurado nesta validação; sync real não foi executado. Matcher continua usando somente evidência local.

Referência: [Device flow oficial](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow).

## Observabilidade

`/observability`: Problemas, Execuções, Erros e Logs. `/settings?section=logs` reutiliza o renderer; APIs legadas continuam disponíveis. Configurações avançadas de runtime continuam em Settings, sem serem chamadas pelas novas páginas.

Migration026 amplia structured_log_events e cria problemas/metadados de auth. Migration027 emite transições metadata-only de matching, evidências, histórico de candidatura, auth/health, fila, application drafts, render Tectonic, exportações, snapshots GitHub, inteligência e Mass Hunt. Discovery e Resume Batch continuam usando os logs existentes.

Triggers copiam somente IDs, estados e códigos fixos; nunca payload de respostas/documentos. Eventos JavaScript são sanitizados centralmente antes de persistir. Leitura/exportação sanitiza novamente dados legados. Categorias normalizadas estão disponíveis; nem toda categoria tem instrumentação individual para todas as operações históricas. Não se promete tracing distribuído completo ou captura de todo request externo.

DEBUG/INFO/WARN/ERROR/CRITICAL são suportados. severity mantém CRITICAL compatível com o CHECK legado de level. Correlação usa IDs persistentes de run/item/aplicação; requests recebem X-Correlation-Id e auth usa o ID da operação. Eventos históricos podem não ter correlação; não se inventam vínculos retroativos.

Problemas agregam categoria + provider + código. OPEN/ACKNOWLEDGED/IGNORED/RESOLVED preservam contagens e datas; nova ocorrência reabre resolvidos. Reautenticação observada resolve problemas de sessão. Agregação começa nos novos eventos após migração; histórico de logs segue consultável. Resolver manualmente não prova recuperação remota.

Execuções projetam Mass Hunt, Resume Batch, Application Batch e snapshots GitHub. Campos não disponíveis na origem não são medições; contagens GitHub por repositório continuam no painel de evidências. A aba Logs é a autoridade de filtragem detalhada por entidade e correlação.

Retenção: LOG_RETENTION_DAYS 1–365 (padrão30), LOG_MAX_ROWS 100–100000 (padrão5000). Poda após gravações pelo repositório e a cada hora cobre triggers. Limite pode ser temporariamente ultrapassado entre podas. Receipts, attempts, problemas e histórico de negócio não são apagados.

## TXT e segurança

Gerar TXT respeita os filtros dentro da retenção. Diagnóstico completo acrescenta readiness resumido, problemas, erros recentes, execuções e contagens de fila; esses extras são globais, enquanto os logs selecionados mantêm os filtros.

Header inclui versão0.1.0, commit se APP_COMMIT for informado (senão unknown explicitamente), runtime/plataforma/schema/filtros/data. URLs perdem query/userinfo/fragment. Chaves, tokens, cookies, headers, passwords, browser storage, respostas e conteúdo pessoal são redigidos. Nenhum sanitizador detecta universalmente segredos arbitrários em prosa: produtores devem emitir códigos/contadores e não conteúdo pessoal.

APIs novas exigem host loopback, origem compatível e JSON nas mutações. Handoff exige ticket específico, corpo de até600KB e estado validado de até512KB. Downloads usam no-store, text/plain, nosniff e attachment. Não requerem SaaS externo. Exports de validação ficam em tmp/ e não entram no Git.

## Verificação

- Focados90/90, rodada dedicada final37/37 e cache/SPA13/13; conjuntos sobrepostos, não somados como testes únicos.
- UI390/768/1366: cache de revisita, mutação no DOM montado e sem overflow.
- Suíte completa única: 813/815, 254449ms; duas expectativas antigas da sidebar foram atualizadas e reexecutadas separadamente. Código de produção não mudou após essa suíte.
- JS370 arquivos PASS; Python não alterado. SQLite27: integrity_check=ok, FK0.
- Docker app/engine healthy. Uma build app; engine não reconstruído. Tectonic CACHED; clones resources9,6s continuam dívida existente.
- TXT filtrado/completo HTTP200 e varredura de padrões de segredos sem ocorrências.
- Submission=false, LIVE_INSPECT=false; applications/attempts/receipts/SUBMITTED0; Brave0; APIs pagas obrigatórias0; imports de cookies pessoais0; leituras de credential store0; nenhuma senha fornecida/persistida nesta execução.

O relatório final da tarefa registra o rerun das expectativas de navegação e o commit/push.
