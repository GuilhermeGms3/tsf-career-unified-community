# Primeira subida em manutencao

`CAREER_OPERATION_MODE=maintenance` exige `CAREER_SUBMISSION_ENABLED=false` e
um banco existente, ja migrado explicitamente para todas as migrations da release.
Nao cria banco vazio nem aplica schema automaticamente. `normal` preserva o
comportamento anterior; a stack Portainer inicia em manutencao por padrao.

O modo impede recuperacao/importacao do store, warmup, timers de busca e sessao,
workers de curriculo/LLM/AutoApply, callbacks automaticos apos login, despacho
de eventos, consumo de webhook e mutacoes gerais. Mantem leitura e as acoes
explicitas de Cofres (login/cadastro/check/disconnect e handoff de uso unico).
Nao desabilita agendas/politicas no banco. Leituras podem atualizar projecoes e
metadados de diagnostico; nao e um filesystem/database integralmente read-only.
O gateway Android pode ser habilitado nesse modo somente para consultas;
mutacoes retornam423 antes de executar decisoes ou reservar idempotencia.

`GET /api/health` retorna somente saude/modo; `GET /api/runtime` informa modo,
background e submit. Mutacoes bloqueadas retornam 423 `MAINTENANCE_MODE`,
inclusive webhook Evolution. Esse modo nao e uma autorizacao para reativar
agendas ou envios: sair dele exige decisao operacional separada.

## Operacao manual

`CAREER_OPERATION_MODE=manual` permite comandos autenticados do mobile sem
habilitar agendas ou canais. O banco precisa existir e estar migrado; recuperacao
de startup/importacao e callbacks de retomada apos login permanecem desligados.
GETs da web e renovacao de Cofres continuam disponiveis. Mutacoes gerais da web
e webhooks retornam423 `MANUAL_MODE_API_RESTRICTED`; comandos passam pelo gateway
mobile e seus controles de identidade, idempotencia e contexto.

Workers processam somente trabalhos criados nesta inicializacao; etapas de lote
tambem podem processar itens antigos explicitamente atualizados por um comando.
Nenhuma lease antiga e expirada/reclamada automaticamente nesse modo. Reiniciar
exige nova acao humana para o trabalho interrompido, sem retomar todo o backlog.
Pedidos antigos reutilizados por deduplicacao podem exigir cancelamento/revisao,
nao sao silenciosamente reativados.

Mass Hunt so inicia por comando; perfis/agendas salvos nao sao reescritos. Seus
curriculos prontos entram na Caixa para revisao, inclusive com nota alta, sem
WhatsApp nem aprovacao automatica por ATS. Perguntas ficam na Caixa do mobile;
nao ha despacho WhatsApp nem agendamento de IA tardia nesse modo.

Aprovacao/retomada/resposta mobile usa a mesma decisao versionada e idempotente.
`CAREER_SUBMISSION_ENABLED=true` habilita o envio final somente apos essa decisao
explicita e os gates existentes. Nao autoriza ATS sem suporte, pula CAPTCHA/MFA,
reutiliza aprovacao vencida nem repete envio incerto. `false` mantem o bloqueio
do clique final. Nao foi feita nova candidatura externa para testar a chave.

`/api/runtime` distingue backgroundEnabled=false de workersEnabled=true, e o
health mobile informa readOnly=false/operationMode=manual. Normal mantem a
operacao anterior; maintenance continua bloqueando comandos.

## Acesso privado (web e mobile)

Portas 7123/7125 ficam em loopback do host. Tailscale Serve publica HTTPS
privado, sem Funnel. Configure `CAREER_WEB_TRUST_PROXY=true`,
`CAREER_PUBLIC_URL=https://<host>.ts.net`, allowlist exata em
`CAREER_WEB_ALLOWED_TAILSCALE_USERS` e o endereco real do proxy/bridge em
`CAREER_WEB_PROXY_ADDRESSES`. Origem, Host, JSON, IP do proxy e identidade
devem coincidir. Nunca exponha a porta que confia nos headers diretamente.

Para Cofres, instale no Windows:

```powershell
./scripts/install-source-auth.ps1 -ServerOrigin https://<host>.ts.net
```

O destino e fixado pelo operador no handler HKCU, nao recebido por parametro
arbitrario no link. O protocolo continua com ID, ticket e porta. Chrome local
temporario, CAPTCHA/MFA humanos, ticket de uso unico e validacao no servidor
permanecem. HTTPS externo usa porta 443; nao usa localhost do PC por engano.
O instalador sem ServerOrigin conserva o fluxo local anterior.

## Banco e caminhos

Antes de iniciar, fazer backup nativo SQLite e ensaio das migrations. Aplicar
somente na copia de implantacao apos autorizacao; guardar baseline e chave.
`scripts/rebase-deployment-paths.mjs <copia>/career-hub.sqlite <copia>` apresenta
o plano; `--apply` altera somente caminhos Windows conhecidos de curriculos e
artefatos. Valida existencia, raiz e integridade e recusa o banco Windows
original conhecido. Nao muda hashes, conteudo, BASE 01, consentimentos ou status.
Monte a pasta como `/app/data`; preserve assinatura/timestamp do legado ou
mantenha importacao desativada. Nao usar o runtime para fazer a migracao inicial.

## LM Studio no PC

O endpoint armazenado deve ser `http://<IP-Tailscale-do-PC>:1234/v1` e
`CAREER_LLM_ALLOWED_ORIGINS=http://<IP-Tailscale-do-PC>:1234` no servidor.
`host.docker.internal` no Ubuntu NAO aponta ao PC. LM Studio pode escutar
diretamente no IP da Tailscale (`lms server start --bind <IP> --port 1234`).
Nao habilitar CORS geral. Restrinja acesso pela VPN/firewall. A listagem de
modelos prova conectividade, nao prova carregamento, qualidade ou GPU. Modelos
so devem ser carregados conforme a configuracao e disponibilidade do PC.

## Verificacao e rollback

### Estado operacional verificado em 21/10/2026

Apos autorizacao explicita, a copia dedicada no Ubuntu foi migrada de 056 para
058. A comparacao preservou contagens e conteudo das tabelas anteriores; cinco
caminhos Windows foram corrigidos somente na copia. Integridade SQLite `ok`,
nenhuma violacao de chave estrangeira, BASE 01 mantida, arquivos referenciados
e hashes de PDF/texto conferidos. A chave correspondente ao cofre foi restaurada
sem regeneracao. O arquivo baseline possui checksum verificado, ownership root
e atributo Linux de imutabilidade; isso nao substitui backup em outro host.

Somente app e motor Python foram iniciados. Modo maintenance, background=false
e submission=false foram confirmados por HTTP. A conexao do proprio container
com o LM Studio remoto funcionou; nao houve inferencia. Um reinicio controlado
do app preservou os hashes e contagens de 17 tabelas operacionais. Servicos
preexistentes de outros projetos nao foram reiniciados.

O helper Windows foi instalado com origem privada fixa e registro anterior
preservado. Serve foi habilitado posteriormente e o HTTPS privado respondeu200.
Em22/10, a API mobile foi publicada no mesmo HTTPS por prefixo e validada com
dados/PDF/SSE reais; manutencao continua bloqueando mutacoes. Nao houve Funnel.
Validacao visual de UI/Cofres e login humano nao estao comprovados por esses
testes de API. Nao considerar essa etapa uma homologacao de WhatsApp, AutoSubmit
ou operacao continua24h.

Ativar agendas, canais, comandos operacionais mobile e submissao requer decisao separada.
Uma implantacao por Compose no mesmo Docker aparece no Portainer, mas nao deve
ser confundida com uma stack criada/importada pelo editor do Portainer.

`tests/maintenance-deployment.test.mjs` cobre flags, banco ausente/antigo,
importacao/recovery bloqueados, HTTP real, guard Tailscale, runner HTTPS e rebase.
Conferir contagens, BASE/PDF/hash/chave, historico incerto e agenda preservados
apos primeiro startup e restart controlado da propria stack. Nao testar usando
contas pessoais sem autorizacao. Rollback para a baseline exige parar somente
TSF e reconciliar qualquer nova sessao/decisao; nunca abrir schema novo com
runtime antigo nem descartar escrita nova silenciosamente.
