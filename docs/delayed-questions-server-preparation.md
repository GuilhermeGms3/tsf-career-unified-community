# Perguntas com prazo e preparacao do servidor

## Escopo de 20-21/10/2026

O modo novo e opt-in em Automacao > Busca e envio > WhatsApp primeiro.
Nao habilita Controlled Submit, nao muda a politica ATS80/60-79, nao renova
Cofres e nao promove nenhum portal nao homologado.

GET/PUT `/api/auto-apply/question-fallback` le/grava:

```json
{"enabled":false,"waitMinutes":20,"autoFillEnabled":false,"researchEnabled":false,"model":""}
```

GET `/api/auto-apply/policy` inclui tambem `questionFallbackPolicy`. A mutacao
reutiliza o guard local JSON. Booleans sao estritos, prazo inteiro1-120,
modelo com ate200 caracteres. Estado fica em app_metadata, chave
application_question_fallback_v1; nao precisa de nova migration. Banco ainda
precisa das migrations057/058 da entrega anterior para executar o motor atual.

## Fluxo e seguranca

1. Com modo ativado, pergunta vai ao WhatsApp antes de qualquer draft LLM.
2. Somente envio confirmado como AWAITING_ANSWER inicia o prazo. Falha de envio
   nao conta como oportunidade de resposta humana. Timer fica em intelligence_jobs,
   available_at, no worker existente com concorrencia1, sem browser esperando.
3. Vaga precisa estar na faixa AUTO_APPLY atual, com qualidade aprovada. Notas
   medianas nao recebem permissao automatica pelo silencio do usuario.
4. A tarefa guarda versao/hash do contexto, fingerprint, horario de envio e
   hash da fonte. Resposta humana, cancelamento, versao/fonte alterada ou politica
   desligada invalidam o processamento, inclusive se mudarem durante a inferencia.
5. Ao vencer, usa modelo explicitamente configurado, desde que instalado. Com
   campo vazio, exige um unico modelo instalado cujo ID corresponda a Qwen3 4B
   2507. Ausencia/ambiguidade/offline mantem pendencia; nao troca silenciosamente
   para outro modelo. LM Studio pode carregar pelo caminho JIT, se esse recurso
   estiver habilitado no servidor. Nao abre o aplicativo LM Studio automaticamente.
6. Texto novo e sempre REVIEW_REQUIRED; usuario aprova com USAR ou RESPONDER.
   Opcao separada autoFillEnabled permite apenas selecao de trecho literal da
   BASE01 para perguntas profissionais factuais textuais reconhecidas. IDs devem
   existir, texto precisa estar na fonte e as stacks mencionadas na pergunta
   precisam aparecer no trecho. Nao e uma promessa de avaliacao semantica perfeita.
7. Salario, disponibilidade, autorizacao de trabalho, identidade, dados sensiveis,
   consentimentos, anexos e controles nao suportados permanecem humanos. Nao se
   inventa resposta nem se consulta a internet para descobrir dados do candidato.
8. Fonte automatica e LLM_EXTRACTIVE, sem gravar memoria USER_CONFIRMED e sem
   marcar uma pessoa como autora. Decisao/pergunta/retomada passam pelo servico
   transacional existente. ATS_THRESHOLD tem retomada propria com revalidacao de
   politica e evento original da versao, sem fingir aprovacao WhatsApp.
   A ponte propria Gupy preserva essa origem e aceita somente texto profissional
   nao sensivel; nao converte trechos da IA em consentimento explicito.
9. Uma tentativa por contexto enviado, inclusive apos offline ou resposta fraca.
   Reescalonar o mesmo pedido nao cria loop. Novo pedido/contexto pode ter novo
   prazo; mudanca do prazo configurado nao antecipa/reinicia os pedidos existentes.
10. Recibo, sessao, perguntas restantes, elegibilidade e homologacao seguem sendo
    gates obrigatorios. Envio incerto nunca ganha retry automatico por este modo.

O timeout do provider LM Studio agora inclui a leitura JSON do corpo; antes o
timer terminava nos headers. Ollama, LM Studio e Brave recusam redirects de suas
APIs para nao transportar dados/chaves a um destino inesperado.

## Pesquisa web

Opcional e dependente da chave Brave Search ja suportada no TSF. Pesquisa apenas
empresa/cargo publicos, tres resultados, sem enviar curriculo ou perguntas/PII.
Resultados ficam separados da evidencia pessoal e marcados como nao confiaveis.
Links privados/credenciais nao entram no contexto; nenhum link e aberto pela LLM.
Falha/ausencia de chave usa somente o acervo, registrando o motivo sem loop.
Nao foi criado agente de navegador irrestrito nem dependencia de servico pago.

Referencias: [LM Studio JIT/TTL](https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict)
e [API de modelos](https://lmstudio.ai/docs/developer/rest).
O JIT/endpoint real do PC ainda precisa ser homologado; fixtures nao provam GPU,
qualidade de texto do Qwen instalado nem conectividade Ubuntu->PC.

## LLM do PC pelo Tailscale

CAREER_LLM_ALLOWED_ORIGINS aceita origens exatas, separadas por virgula. Exemplo
nao pessoal: `http://100.64.0.10:1234`. Somente enderecos da faixa Tailscale ou
hosts .ts.net explicitamente relacionados sao admitidos, alem dos hosts locais.
Porta/protocolo devem corresponder; credenciais na URL, query, fragmento e
origens publicas arbitrarias sao rejeitados. Nao liberar toda a LAN ou internet.
O classificador opcional de vagas LinkedIn consulta a mesma allowlist dos
providers, sem uma segunda regra que rejeite silenciosamente o PC autorizado.

Depois da implantacao, configurar Integracoes/LLM com origem VPN do PC e /v1
para LM Studio. host.docker.internal no Ubuntu NAO e o PC Windows. Manter LLM
protegida por Tailscale/ACL/firewall e nao publicar porta na internet. A allowlist
autoriza somente o transporte da LLM, nao os navegadores publicos de candidatura.

## Release e preflight de producao

Dockerfiles app/engine recebem --build-arg TSF_REVISION=<commit> e gravam label
org.opencontainers.image.revision, permitindo comparar release/imagem sem inferir
pela tag local. Build nao liga containers nem aplica migrations.

`scripts/production_preflight.py` faz somente leitura. Exemplo no Ubuntu:

```sh
CAREER_SUBMISSION_ENABLED=false python3 scripts/production_preflight.py \
  --source-dir /srv/tsf/source --data-dir /srv/tsf/data \
  --key-file /caminho/privado/source-credentials.key
```

Verifica manifesto limpo/commit/hashes/caminhos, banco existente com mode=ro,
integridade/FK/schema58, base ativa e agendas. Missing database nao cria uma base.
Sessoes/chave nao sao descriptografadas; flags de processo nao atestam flags do
container. Exit0 significa preflight estatico aprovado, nao homologacao24h.
Exit2 lista bloqueios sem modificar dados. Lock de envio incerto nao e removido.

Antes de iniciar: backup consistente DB/WAL/cofre/chave/artifacts, ensaio de
057/058 em copia, revisao de agenda legada RETRY_WAIT, validacao visual da BASE01,
configuracao privada HTTPS/gateway e testes de canal. Nao reaproveitar Evolution
de EasyCut ou workflows n8n ja existentes sem isolamento deliberado.
Relatorio operacional anterior: C:/TSF/benchmarks/operational-audit-20261020/RELATORIO.md.

## Estado operacional observado em 21/10

- Ubuntu acessivel por SSH/Tailscale, com Docker e Portainer existentes.
- Nenhum container TSF em execucao; nenhum Tailscale Serve configurado.
- Docker Compose CLI nao esta instalado nesse host. Portainer gerencia sua
  propria implantacao de stacks; nao presumir que comandos `docker compose`
  funcionarao no terminal sem preparar o plugin oficial separadamente.
- A base original ainda esta no schema056. O ensaio numa copia passou no
  schema058 com integrity_check ok e zero violacoes FK. Nao houve migracao
  da base original nem transferencia de cofre, chave ou curriculos ao Ubuntu.
- Existe agenda legada habilitada e historico de notificacoes sem integracao
  configurada. A inicializacao produtiva exige revisar isso antes de ligar filas.
- LLM do PC sem listener na verificacao desta rodada. Inferencia real, JIT,
  pesquisa Brave, canal WhatsApp e operacao24h continuam sem homologacao nova.
- Nao houve candidatura externa nesta entrega nem promocao de portal assistido
  para submit homologado. O recibo Nerdin historico nao valida os demais portais.

## Validacao

Testes focados: delayed-question, llm-runtime-policy, application-decisions,
application-question-escalation, intelligence, intelligence-persistence,
vault-portal-questions, automation-playwright, application-batch-gupy,
gupy-adapter-v1, question-fallback-routes e question-fallback-ui.
Preflight: `python -B -m unittest -v test_production_preflight.py` em scripts/.
Fixtures/temp DBs; nenhum teste precisa consumir fila pessoal, enviar WhatsApp
ou candidatar ao empregador. Resultados finais sao registrados na memoria local.
